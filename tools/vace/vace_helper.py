"""Loopback-only upload and job API for the drive-gallery VACE experiment.

This server never receives Drive credentials or fetches remote media. Uploaded
files and job results persist locally; restarting intentionally forgets API IDs.
"""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

ORIGINS = {"https://srsplitter.github.io", "http://localhost:8080", "http://127.0.0.1:8080"}
MAX_SAFE_INTEGER = 2**53 - 1
MAX_CHUNK = 8 * 1024**2
RESERVE = 5 * 1024**3
MODEL_FILES = {
    "diffusion_models": "wan2.1_vace_1.3B_fp16.safetensors",
    "text_encoders": "umt5_xxl_fp8_e4m3fn_scaled.safetensors",
    "vae": "wan_2.1_vae.safetensors",
}
ID_PATTERN = r"[0-9a-f]{32}"
SCRIPTS = Path(__file__).resolve().parent


class APIError(Exception):
    def __init__(self, status, message):
        self.status = status
        super().__init__(message)


def number(value, name, low, high):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise APIError(400, f"{name} must be a number")
    if not math.isfinite(value) or not low <= value <= high:
        raise APIError(400, f"{name} must be between {low} and {high}")
    return value


def output_size(width, height):
    ratio = min(1, 832 / width, 480 / height)
    return max(16, int(width * ratio) // 16 * 16), max(16, int(height * ratio) // 16 * 16)


def range_bounds(value, size):
    if not value:
        return 0, size - 1, False
    match = re.fullmatch(r"bytes=(\d*)-(\d*)", value)
    if not match or not any(match.groups()) or size == 0:
        raise APIError(416, "Unsupported byte range")
    first, last = match.groups()
    if first:
        start = int(first)
        end = min(int(last), size - 1) if last else size - 1
    else:
        length = int(last)
        if length <= 0:
            raise APIError(416, "Invalid suffix range")
        start, end = max(0, size - length), size - 1
    if start >= size or end < start:
        raise APIError(416, "Range outside file")
    return start, end, True


class App:
    def __init__(self, root, python=sys.executable, ffmpeg="ffmpeg", ffprobe="ffprobe", port=7862):
        self.root = Path(root).resolve()
        self.jobs_root = self.root / "jobs"
        self.jobs_root.mkdir(parents=True, exist_ok=True)
        self.python, self.ffmpeg, self.ffprobe, self.port = python, ffmpeg, ffprobe, port
        self.uploads, self.jobs = {}, {}
        self.lock = threading.RLock()
        self.active = None
        self.health_cache = None
        self.health_checked = 0

    def upload_capacity(self):
        with self.lock:
            reserved = sum(u["size"] - u["received"] for u in self.uploads.values()
                           if u["received"] < u["size"])
            free = shutil.disk_usage(self.jobs_root).free
            return dict(max_upload_bytes=MAX_SAFE_INTEGER,
                        available_upload_bytes=min(MAX_SAFE_INTEGER, max(0, free - reserved - RESERVE)),
                        disk_free_bytes=free, reserved_upload_bytes=reserved,
                        disk_reserve_bytes=RESERVE)

    def health(self):
        with self.lock:
            if self.health_cache is not None and time.monotonic() - self.health_checked < 3:
                return dict(self.health_cache, busy=bool(self.active) or self.health_cache["comfy_busy"],
                            **self.upload_capacity())
        manifest = []
        try:
            manifest = json.loads((self.root / "model-manifest.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            pass
        if not isinstance(manifest, list):
            manifest = []
        manifest = [entry for entry in manifest if isinstance(entry, dict)]
        models = []
        for category, name in MODEL_FILES.items():
            path = self.root / "models" / category / name
            entry = next((m for m in manifest if m.get("category") == category and m.get("name") == name), {})
            expected = entry.get("size", 0)
            size = path.stat().st_size if path.is_file() else 0
            models.append(dict(name=name, path=str(path), size=size, expected_size=expected,
                               ready=isinstance(expected, int) and expected > 0 and size == expected))
        comfy = dict(reachable=False, error=None)
        comfy_busy = False
        try:
            def fetch(endpoint):
                with urllib.request.urlopen("http://127.0.0.1:8189" + endpoint, timeout=3) as response:
                    return json.loads(response.read(8 * 1024**2))
            fetch("/system_stats")
            queue = fetch("/queue")
            comfy_busy = bool(queue.get("queue_running") or queue.get("queue_pending"))
            schema = fetch("/object_info/WanVaceToVideo")
            comfy["reachable"] = True
            if "WanVaceToVideo" not in schema:
                comfy["error"] = "ComfyUI is missing the native WanVaceToVideo node"
        except (OSError, ValueError) as error:
            comfy["error"] = f"Local ComfyUI on port 8189 is unavailable: {error}"
        errors = []
        if not all(m["ready"] for m in models):
            errors.append("Model downloads or their local manifest are incomplete")
        if comfy["error"]:
            errors.append(comfy["error"])
        if not shutil.which(self.ffmpeg) or not shutil.which(self.ffprobe):
            errors.append("ffmpeg and ffprobe must be installed and on PATH")
        result = dict(ready=not errors, busy=bool(self.active) or comfy_busy,
                      error="; ".join(errors) if errors else None, models=models,
                      comfy=comfy, comfy_busy=comfy_busy,
                      chunk_bytes=MAX_CHUNK, fps=16, max_duration=5)
        with self.lock:
            self.health_cache, self.health_checked = result, time.monotonic()
        return dict(result, **self.upload_capacity())

    def new_upload(self, data):
        size = data.get("size")
        if isinstance(size, bool) or not isinstance(size, int) or not 1 <= size <= MAX_SAFE_INTEGER:
            raise APIError(400, f"size must be a positive JavaScript-safe integer (at most {MAX_SAFE_INTEGER})")
        name = data.get("name", "video")
        if not isinstance(name, str) or not 1 <= len(name) <= 255 or any(ord(c) < 32 for c in name):
            raise APIError(400, "Invalid display name")
        with self.lock:
            pending = [u for u in self.uploads.values() if u["received"] < u["size"]]
            if len(pending) >= 8:
                raise APIError(429, "Eight uploads are already unfinished; restart helper to reset IDs")
            if size > self.upload_capacity()["available_upload_bytes"]:
                raise APIError(507, "Insufficient disk space including the 5 GiB reserve")
            uid = uuid.uuid4().hex
            folder = self.jobs_root / ("upload-" + uid)
            folder.mkdir(exist_ok=False)
            path = folder / "source.bin"
            path.touch(exist_ok=False)
            upload = dict(id=uid, name=name, size=size, received=0, path=path,
                          lock=threading.Lock(), metadata=None)
            self.uploads[uid] = upload
        return self.upload_info(upload)

    @staticmethod
    def upload_info(upload):
        info = {k: upload[k] for k in ("id", "name", "size", "received")}
        info["complete"] = upload["size"] == upload["received"]
        if upload.get("metadata"):
            info.update(upload["metadata"])
        return info

    def find_upload(self, uid, complete=False):
        if not isinstance(uid, str) or not re.fullmatch(ID_PATTERN, uid):
            raise APIError(400, "Invalid upload ID")
        with self.lock:
            upload = self.uploads.get(uid)
        if upload is None:
            raise APIError(404, "Unknown upload ID (IDs expire when helper restarts)")
        if complete and upload["received"] != upload["size"]:
            raise APIError(409, "Upload is not complete")
        return upload

    def metadata(self, upload):
        with upload["lock"]:
            if upload["metadata"] is None:
                try:
                    result = subprocess.run([
                        self.ffprobe, "-v", "error", "-protocol_whitelist", "file,pipe",
                        "-format_whitelist", "mov,matroska,avi", "-show_streams", "-show_format",
                        "-of", "json", str(upload["path"]),
                    ], capture_output=True, check=True, timeout=30)
                    data = json.loads(result.stdout)
                    video = next(s for s in data["streams"] if s.get("codec_type") == "video")
                    width, height = int(video["width"]), int(video["height"])
                    duration = float(data["format"].get("duration", video.get("duration", 0)))
                    if width < 16 or height < 16 or width > 8192 or height > 8192 or width * height > 40_000_000:
                        raise ValueError("Video dimensions must be 16–8192 pixels, at most 40 megapixels")
                    if not math.isfinite(duration) or not 0 < duration <= 108000:
                        raise ValueError("Could not read a supported finite video duration")
                    rotations = [s.get("rotation", 0) for s in video.get("side_data_list", [])]
                    rotations.append(video.get("tags", {}).get("rotate", 0))
                    if any(float(r) % 360 for r in rotations):
                        raise ValueError("Rotated video metadata is unsupported; export an upright copy first")
                    upload["metadata"] = dict(width=width, height=height, duration=duration)
                except (OSError, subprocess.SubprocessError, ValueError, KeyError, StopIteration) as error:
                    raise APIError(422, f"Cannot read this video (MP4/MOV/MKV/WebM/AVI supported): {error}") from error
        return upload["metadata"]

    def frame(self, upload, at):
        meta = self.metadata(upload)
        number(at, "time", 0, max(0, meta["duration"] - 0.001))
        try:
            result = subprocess.run([
                self.ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin",
                "-protocol_whitelist", "file,pipe", "-format_whitelist", "mov,matroska,avi",
                "-ss", str(at), "-noautorotate", "-i", str(upload["path"]),
                "-map", "0:v:0", "-frames:v", "1", "-vf",
                "scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease,setsar=1",
                "-f", "image2pipe", "-vcodec", "png", "pipe:1",
            ], capture_output=True, check=True, timeout=30)
            if not result.stdout.startswith(b"\x89PNG"):
                raise ValueError("No frame at that time")
            return result.stdout
        except (OSError, subprocess.SubprocessError, ValueError) as error:
            raise APIError(422, f"Preview extraction failed: {error}") from error

    def new_job(self, data):
        upload = self.find_upload(data.get("upload_id"), complete=True)
        meta = self.metadata(upload)
        start = number(data.get("start", 0), "start", 0, meta["duration"])
        duration = number(data.get("duration", 3), "duration", 1, 5)
        frames = 4 * math.floor((duration * 16 - 1) / 4) + 1
        actual_duration = frames / 16
        if start + actual_duration > meta["duration"] + 0.001:
            raise APIError(400, "Selected clip extends beyond the source video")
        box = data.get("box")
        if not isinstance(box, list) or len(box) != 4:
            raise APIError(400, "box must be [x1,y1,x2,y2] normalized to 0..1")
        box = [number(v, "box coordinate", 0, 1) for v in box]
        if box[0] >= box[2] or box[1] >= box[3]:
            raise APIError(400, "box must have positive width and height")
        pixel_box = [math.floor(box[0] * meta["width"]), math.floor(box[1] * meta["height"]),
                     math.ceil(box[2] * meta["width"]), math.ceil(box[3] * meta["height"])]
        prompt = data.get("prompt")
        if not isinstance(prompt, str) or not 1 <= len(prompt.strip()) <= 2000 or "\x00" in prompt:
            raise APIError(400, "prompt must contain 1–2000 characters")
        health = self.health()
        if not health["ready"]:
            raise APIError(503, health["error"])
        with self.lock:
            if self.active or health["busy"]:
                raise APIError(409, "A local generation is already running; wait for it to finish")
            if shutil.disk_usage(self.jobs_root).free < RESERVE:
                raise APIError(507, "Less than 5 GiB of free disk space remains")
            jid = uuid.uuid4().hex
            folder = self.jobs_root / ("job-" + jid)
            folder.mkdir(exist_ok=False)
            width, height = output_size(meta["width"], meta["height"])
            job = dict(id=jid, status="queued", stage="queued", error=None, start=start,
                       duration=actual_duration, requested_duration=duration, frames=frames,
                       fps=16, width=width, height=height, folder=folder)
            self.jobs[jid] = job
            self.active = jid
            thread = threading.Thread(target=self.process_job, args=(job, upload, pixel_box, prompt.strip()), daemon=True)
            thread.start()
            return self.job_info(job)

    @staticmethod
    def job_info(job):
        return {k: v for k, v in job.items() if k != "folder"}

    def set_job(self, job, **changes):
        with self.lock:
            job.update(changes)

    def process_job(self, job, upload, box, prompt):
        work = job["folder"]
        def command(stage, arguments, timeout):
            self.set_job(job, status="running", stage=stage)
            with (work / (stage + ".log")).open("wb") as log:
                result = subprocess.run([self.python, *map(str, arguments)], stdout=log,
                                        stderr=subprocess.STDOUT, timeout=timeout)
            if result.returncode:
                detail = (work / (stage + ".log")).read_text(encoding="utf-8", errors="replace")[-3000:]
                raise RuntimeError(f"{stage} failed: {detail}")
        try:
            (work / "request.json").write_text(json.dumps(dict(upload_id=upload["id"], prompt=prompt,
                box=box, **self.job_info(job)), ensure_ascii=False, indent=2), encoding="utf-8")
            command("preparing", [SCRIPTS / "prepare_sample.py", "prepare", "--input", upload["path"],
                    "--output", work / "sample", "--start", job["start"], "--frames", job["frames"],
                    "--fps", 16, "--width", job["width"], "--height", job["height"],
                    "--box", ",".join(map(str, box))], 180)
            command("generating", [SCRIPTS / "run_vace.py", "--video", work / "sample/source.mp4",
                    "--mask", work / "sample/mask.mp4", "--prompt", prompt, "--frames", job["frames"],
                    "--fps", 16, "--width", job["width"], "--height", job["height"],
                    "--work-dir", work / "inference", "--prefix", "vace/" + job["id"],
                    "--ffmpeg", self.ffmpeg, "--ffprobe", self.ffprobe, "--timeout", 3600], 3720)
            manifest = json.loads((work / "inference/result.json").read_text(encoding="utf-8"))
            outputs = [Path(p).resolve() for p in manifest["outputs"] if Path(p).suffix.lower() == ".mp4"]
            if len(outputs) != 1 or outputs[0].parent != (work / "inference").resolve() or not outputs[0].is_file():
                raise RuntimeError("Generation returned no unique MP4 inside its job folder")
            command("compositing", [SCRIPTS / "prepare_sample.py", "composite", "--sample", work / "sample",
                    "--generated", outputs[0], "--output", work / "final", "--feather", 8], 180)
            self.set_job(job, status="done", stage="done", output_url=f"/jobs/{job['id']}/output",
                         comparison_url=f"/jobs/{job['id']}/comparison")
        except Exception as error:
            self.set_job(job, status="error", stage="error", error=str(error))
        finally:
            with self.lock:
                self.active = None
                self.health_checked = 0
            (work / "status.json").write_text(json.dumps(self.job_info(job), ensure_ascii=False, indent=2), encoding="utf-8")


class Handler(BaseHTTPRequestHandler):
    server_version = "VaceLocal/1.0"

    @property
    def app(self):
        return self.server.app

    def setup(self):
        super().setup()
        self.connection.settimeout(45)

    def validate(self, mutation=False):
        if self.headers.get("Host") not in {f"127.0.0.1:{self.app.port}", f"localhost:{self.app.port}"}:
            raise APIError(403, "Only the exact loopback Host is allowed")
        origin = self.headers.get("Origin")
        if origin is not None and origin not in ORIGINS:
            raise APIError(403, "Origin is not allowed")
        if mutation and (origin not in ORIGINS or self.headers.get("X-Vace-Client") != "drive-gallery"):
            raise APIError(403, "Mutations require an allowed Origin and X-Vace-Client: drive-gallery")
        if self.headers.get("Transfer-Encoding"):
            raise APIError(400, "Transfer-Encoding is unsupported; use Content-Length")

    def send_headers(self, status, content_type, length, extra=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        origin = self.headers.get("Origin")
        if origin in ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges")
        for key, value in (extra or {}).items():
            self.send_header(key, str(value))
        self.end_headers()

    def json(self, status, value):
        body = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_headers(status, "application/json; charset=utf-8", len(body))
        if self.command != "HEAD":
            self.wfile.write(body)

    def body_length(self, limit):
        values = self.headers.get_all("Content-Length", [])
        if len(values) != 1 or not re.fullmatch(r"\d+", values[0]):
            raise APIError(411, "One numeric Content-Length is required")
        length = int(values[0])
        if not 1 <= length <= limit:
            raise APIError(413, "Request body is too large or empty")
        return length

    def json_body(self):
        if self.headers.get_content_type() != "application/json":
            raise APIError(415, "Use application/json")
        length = self.body_length(16 * 1024)
        raw = self.rfile.read(length)
        if len(raw) != length:
            raise APIError(400, "Incomplete request body")
        try:
            value = json.loads(raw)
        except (ValueError, UnicodeDecodeError) as error:
            raise APIError(400, "Invalid JSON") from error
        if not isinstance(value, dict):
            raise APIError(400, "JSON body must be an object")
        return value

    def safe(self, action):
        try:
            action()
        except APIError as error:
            self.close_connection = True
            self.json(error.status, {"error": str(error)})
        except (BrokenPipeError, ConnectionResetError, socket.timeout):
            self.close_connection = True
        except Exception as error:
            self.close_connection = True
            self.log_error("Request failed: %s", error)
            self.json(500, {"error": "Local helper error; see its terminal log"})

    def do_OPTIONS(self):
        def preflight():
            self.validate()
            if self.headers.get("Origin") not in ORIGINS:
                raise APIError(403, "An allowed Origin is required")
            self.send_headers(204, "text/plain", 0, {
                "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, X-Vace-Client, Range",
                "Access-Control-Allow-Private-Network": "true", "Access-Control-Max-Age": "600"})
        self.safe(preflight)

    def do_POST(self):
        def post():
            self.validate(mutation=True)
            if self.path == "/uploads":
                self.json(201, self.app.new_upload(self.json_body()))
            elif self.path == "/jobs":
                self.json(202, self.app.new_job(self.json_body()))
            else:
                raise APIError(404, "Unknown endpoint")
        self.safe(post)

    def do_PUT(self):
        def put():
            self.validate(mutation=True)
            url = urllib.parse.urlsplit(self.path)
            match = re.fullmatch(r"/uploads/(" + ID_PATTERN + r")", url.path)
            if not match:
                raise APIError(404, "Unknown upload endpoint")
            query = urllib.parse.parse_qs(url.query)
            if set(query) != {"offset"} or len(query["offset"]) != 1 or not re.fullmatch(r"\d+", query["offset"][0]):
                raise APIError(400, "One numeric offset is required")
            offset = int(query["offset"][0])
            length = self.body_length(MAX_CHUNK)
            upload = self.app.find_upload(match[1])
            with upload["lock"]:
                if offset != upload["received"] or offset + length > upload["size"]:
                    raise APIError(409, f"Expected offset {upload['received']}; chunk must fit declared upload size")
                if shutil.disk_usage(self.app.jobs_root).free < length + RESERVE:
                    raise APIError(507, "Upload would consume the 5 GiB disk reserve")
                remaining = length
                with upload["path"].open("r+b") as output:
                    output.seek(offset)
                    try:
                        while remaining:
                            chunk = self.rfile.read(min(256 * 1024, remaining))
                            if not chunk:
                                raise APIError(400, "Incomplete upload chunk; retry the same offset")
                            output.write(chunk)
                            remaining -= len(chunk)
                    except BaseException:
                        output.truncate(offset)
                        raise
                upload["received"] += length
                self.json(200, self.app.upload_info(upload))
        self.safe(put)

    def do_HEAD(self):
        self.do_GET()

    def send_file(self, path):
        size = path.stat().st_size
        try:
            start, end, partial = range_bounds(self.headers.get("Range"), size)
        except APIError:
            self.send_headers(416, "video/mp4", 0, {"Content-Range": f"bytes */{size}"})
            return
        extra = {"Accept-Ranges": "bytes"}
        if partial:
            extra["Content-Range"] = f"bytes {start}-{end}/{size}"
        self.send_headers(206 if partial else 200, "video/mp4", end - start + 1, extra)
        if self.command == "HEAD":
            return
        with path.open("rb") as source:
            source.seek(start)
            remaining = end - start + 1
            while remaining:
                chunk = source.read(min(256 * 1024, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)

    def do_GET(self):
        def get():
            self.validate()
            url = urllib.parse.urlsplit(self.path)
            if url.path == "/health":
                self.json(200, self.app.health())
                return
            match = re.fullmatch(r"/uploads/(" + ID_PATTERN + r")(/frame)?", url.path)
            if match:
                upload = self.app.find_upload(match[1], complete=bool(match[2]))
                if match[2]:
                    query = urllib.parse.parse_qs(url.query)
                    try:
                        at = float(query.get("time", ["0"])[0])
                    except ValueError as error:
                        raise APIError(400, "time must be numeric") from error
                    image = self.app.frame(upload, at)
                    self.send_headers(200, "image/png", len(image))
                    if self.command != "HEAD":
                        self.wfile.write(image)
                else:
                    if upload["received"] == upload["size"]:
                        self.app.metadata(upload)
                    self.json(200, self.app.upload_info(upload))
                return
            match = re.fullmatch(r"/jobs/(" + ID_PATTERN + r")(/output|/comparison)?", url.path)
            if match:
                with self.app.lock:
                    job = self.app.jobs.get(match[1])
                    if job is None:
                        raise APIError(404, "Unknown job ID")
                    info = self.app.job_info(job)
                if match[2]:
                    if info["status"] != "done":
                        raise APIError(409, "Job has no completed output")
                    filename = "composite.mp4" if match[2] == "/output" else "comparison.mp4"
                    self.send_file(job["folder"] / "final" / filename)
                else:
                    self.json(200, info)
                return
            raise APIError(404, "Unknown endpoint")
        self.safe(get)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(r"C:\AI\VACE-local-test"))
    parser.add_argument("--python", default=sys.executable)
    parser.add_argument("--ffmpeg", default="ffmpeg")
    parser.add_argument("--ffprobe", default="ffprobe")
    args = parser.parse_args()
    app = App(args.root, args.python, args.ffmpeg, args.ffprobe)
    server = ThreadingHTTPServer(("127.0.0.1", 7862), Handler)
    server.daemon_threads = True
    server.app = app
    print("VACE local helper: http://127.0.0.1:7862 (loopback only)", flush=True)
    print(f"Files remain in {app.jobs_root}; stopping the helper does not cancel GPU work.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

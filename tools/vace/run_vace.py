"""Run a local VACE experiment through native ComfyUI nodes (no custom nodes).

Sampling defaults follow ComfyUI_examples/wan/vace_reference_to_video.json.
Mask videos are grayscale: white means regenerate, black means preserve.
--smoke generates one still without source media; it only checks inference.
"""

import argparse
import json
import mimetypes
from pathlib import Path
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid


def request(server, endpoint, payload=None, content_type="application/json"):
    if isinstance(payload, dict):
        payload = json.dumps(payload).encode()
    req = urllib.request.Request(server + endpoint, data=payload)
    if payload is not None:
        req.add_header("Content-Type", content_type)
    try:
        with urllib.request.urlopen(req, timeout=120) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(error.read().decode(errors="replace")) from error


def upload(server, path):
    boundary = uuid.uuid4().hex
    name = f"vace_{uuid.uuid4().hex}{path.suffix.lower()}"
    mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    body = (
        f'--{boundary}\r\nContent-Disposition: form-data; name="type"\r\n\r\ninput\r\n'
        f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="{name}"\r\n'
        f"Content-Type: {mime}\r\n\r\n"
    ).encode() + path.read_bytes() + f"\r\n--{boundary}--\r\n".encode()
    result = request(server, "/upload/image", body, f"multipart/form-data; boundary={boundary}")
    return "/".join(part for part in (result.get("subfolder"), result["name"]) if part)


def prepare_video(source, output, args, is_mask=False):
    scale = "neighbor" if is_mask else "lanczos"
    filters = (
        f"fps={args.fps},scale={args.width}:{args.height}:"
        f"force_original_aspect_ratio=decrease:flags={scale},"
        f"pad={args.width}:{args.height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1"
    )
    subprocess.run([
        args.ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
        "-ss", str(args.start), "-i", str(source), "-an", "-vf", filters,
        "-frames:v", str(args.frames), "-c:v", "libx264", "-crf", "0",
        "-pix_fmt", "yuv420p", str(output),
    ], check=True)
    count = subprocess.check_output([
        args.ffprobe, "-v", "error", "-select_streams", "v:0", "-count_frames",
        "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", str(output),
    ], text=True).strip()
    if int(count) != args.frames:
        raise ValueError(f"{source}: produced {count} frames, expected {args.frames}; choose fewer frames.")


def workflow(args, video=None, mask=None, reference=None):
    def node(kind, **inputs):
        return {"class_type": kind, "inputs": inputs}

    graph = {
        "1": node("UNETLoader", unet_name=args.model, weight_dtype="default"),
        "2": node("CLIPLoader", clip_name=args.text_encoder, type="wan", device="default"),
        "3": node("VAELoader", vae_name=args.vae),
        "4": node("CLIPTextEncode", clip=["2", 0], text=args.prompt),
        "5": node("CLIPTextEncode", clip=["2", 0], text=args.negative),
        "6": node("ModelSamplingSD3", model=["1", 0], shift=args.shift),
        "7": node("WanVaceToVideo", positive=["4", 0], negative=["5", 0],
                  vae=["3", 0], width=args.width, height=args.height,
                  length=args.frames, batch_size=1, strength=args.strength),
        "8": node("KSampler", model=["6", 0], seed=args.seed, steps=args.steps,
                  cfg=args.cfg, sampler_name="uni_pc", scheduler="simple",
                  positive=["7", 0], negative=["7", 1], latent_image=["7", 2], denoise=1.0),
        "9": node("TrimVideoLatent", samples=["8", 0], trim_amount=["7", 3]),
        "10": node("VAEDecode", samples=["9", 0], vae=["3", 0]),
    }
    if video:
        graph["20"] = node("LoadVideo", file=video)
        graph["21"] = node("GetVideoComponents", video=["20", 0])
        graph["7"]["inputs"]["control_video"] = ["21", 0]
    if mask:
        graph["22"] = node("LoadVideo", file=mask)
        graph["23"] = node("GetVideoComponents", video=["22", 0])
        # Native ImageToMask has RGB channels, not a luminance option. The mask is grayscale.
        graph["24"] = node("ImageToMask", image=["23", 0], channel="red")
        graph["7"]["inputs"]["control_masks"] = ["24", 0]
        if video:
            # VACE's InpaintingVideoAnnotator erases edit pixels to RGB 128.
            # Keeping the mosaic here would encode it as reactive visual conditioning.
            graph["26"] = node("EmptyImage", width=args.width, height=args.height,
                               batch_size=1, color=0x808080)
            graph["27"] = node("ImageCompositeMasked", destination=["21", 0],
                               source=["26", 0], mask=["24", 0], x=0, y=0, resize_source=False)
            graph["7"]["inputs"]["control_video"] = ["27", 0]
    if reference:
        graph["25"] = node("LoadImage", image=reference)
        graph["7"]["inputs"]["reference_image"] = ["25", 0]
    if args.frames == 1:
        graph["15"] = node("SaveImage", images=["10", 0], filename_prefix=args.prefix)
    else:
        graph["14"] = node("CreateVideo", images=["10", 0], fps=args.fps)
        graph["15"] = node("SaveVideo", video=["14", 0], filename_prefix=args.prefix,
                           format="mp4", **{"format.codec": "h264"})
    return graph


def check_server(args, graph):
    schemas = request(args.server, "/object_info")
    missing = sorted({item["class_type"] for item in graph.values()} - schemas.keys())
    if missing:
        raise RuntimeError(f"Missing native nodes: {missing}")
    for kind, key, name in (("UNETLoader", "unet_name", args.model),
                            ("CLIPLoader", "clip_name", args.text_encoder),
                            ("VAELoader", "vae_name", args.vae)):
        choices = schemas[kind]["input"]["required"][key][0]
        if name not in choices:
            raise RuntimeError(f"{kind} cannot find {name}; available: {choices}")
    print("Native nodes and all three model files are registered.", flush=True)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--server", default="http://127.0.0.1:8189")
    parser.add_argument("--video", type=Path)
    parser.add_argument("--mask", type=Path)
    parser.add_argument("--reference", type=Path)
    parser.add_argument("--smoke", action="store_true", help="One-frame inference check; no source video.")
    parser.add_argument("--check-only", action="store_true", help="Verify node/model registration; do not submit.")
    parser.add_argument("--dry-run", action="store_true", help="Write the graph without contacting ComfyUI.")
    parser.add_argument("--prompt", default="A photorealistic portrait of a fictional adult man, natural skin texture, soft daylight, neutral expression.")
    parser.add_argument("--negative", default="pixelated face, mosaic, deformed face, asymmetrical eyes, waxy skin, cartoon, text, watermark, low quality")
    parser.add_argument("--width", type=int, default=512)
    parser.add_argument("--height", type=int, default=512)
    parser.add_argument("--frames", type=int, default=49)
    parser.add_argument("--fps", type=float, default=16)
    parser.add_argument("--start", type=float, default=0)
    parser.add_argument("--steps", type=int, default=20)
    parser.add_argument("--cfg", type=float, default=6)
    parser.add_argument("--shift", type=float, default=8)
    parser.add_argument("--strength", type=float, default=1)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--model", default="wan2.1_vace_1.3B_fp16.safetensors")
    parser.add_argument("--text-encoder", default="umt5_xxl_fp8_e4m3fn_scaled.safetensors")
    parser.add_argument("--vae", default="wan_2.1_vae.safetensors")
    parser.add_argument("--prefix", default="vace/test")
    parser.add_argument("--work-dir", type=Path)
    parser.add_argument("--timeout", type=float, default=3600)
    parser.add_argument("--ffmpeg", default="ffmpeg")
    parser.add_argument("--ffprobe", default="ffprobe")
    args = parser.parse_args()
    args.server = args.server.rstrip("/")
    if urllib.parse.urlparse(args.server).hostname not in {"localhost", "127.0.0.1", "::1"}:
        parser.error("This client only sends media to a local ComfyUI server.")
    if args.smoke:
        if args.video or args.mask or args.reference:
            parser.error("--smoke cannot be combined with source media.")
        args.frames = 1
    elif not args.check_only and not (args.video and args.mask):
        parser.error("Supply both --video and --mask, or use --smoke.")
    if args.frames < 1 or (args.frames - 1) % 4 or args.width % 16 or args.height % 16:
        parser.error("Frames must be 4n+1 and width/height must be multiples of 16.")
    graph = workflow(args, "source.mp4" if args.video else None,
                     "mask.mp4" if args.mask else None, "reference.png" if args.reference else None)
    if args.check_only:
        check_server(args, graph)
        return
    work = (args.work_dir or Path(__file__).parent / "runs" / time.strftime("%Y%m%d-%H%M%S")).resolve()
    work.mkdir(parents=True, exist_ok=True)
    if not args.dry_run:
        check_server(args, graph)
        media = {}
        for kind in ("video", "mask"):
            source = getattr(args, kind)
            if source:
                target = work / f"prepared_{kind}.mp4"
                prepare_video(source.resolve(), target, args, is_mask=kind == "mask")
                media[kind] = upload(args.server, target)
        if args.reference:
            media["reference"] = upload(args.server, args.reference.resolve())
        graph = workflow(args, **media)
    (work / "workflow.json").write_text(json.dumps(graph, indent=2), encoding="utf-8")
    if args.dry_run:
        print(work / "workflow.json")
        return
    started = time.monotonic()
    submitted = request(args.server, "/prompt", {"prompt": graph, "client_id": uuid.uuid4().hex})
    prompt_id = submitted["prompt_id"]
    (work / "submitted.json").write_text(json.dumps(submitted, indent=2), encoding="utf-8")
    print(f"Queued {prompt_id}; work directory: {work}", flush=True)
    while time.monotonic() - started < args.timeout:
        history = request(args.server, f"/history/{prompt_id}").get(prompt_id)
        if history:
            (work / "history.json").write_text(json.dumps(history, indent=2), encoding="utf-8")
            if history.get("status", {}).get("status_str") == "error":
                raise RuntimeError(json.dumps(history["status"]["messages"], indent=2))
            outputs = history.get("outputs", {}).get("15", {})
            files = [item for values in outputs.values() if isinstance(values, list)
                     for item in values if isinstance(item, dict) and "filename" in item]
            saved = []
            for item in files:
                query = urllib.parse.urlencode({key: item[key] for key in ("filename", "subfolder", "type") if key in item})
                with urllib.request.urlopen(args.server + "/view?" + query, timeout=120) as response:
                    destination = work / Path(item["filename"]).name
                    destination.write_bytes(response.read())
                saved.append(str(destination))
                print(f"Output: {destination}", flush=True)
            if not files:
                raise RuntimeError(f"No saved output found; inspect {work / 'history.json'}")
            elapsed = time.monotonic() - started
            result = {"prompt_id": prompt_id, "outputs": saved, "elapsed_seconds": round(elapsed, 3)}
            (work / "result.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
            print(f"Completed in {elapsed:.1f} seconds.", flush=True)
            return
        print(f"Waiting: {time.monotonic() - started:.0f}s", flush=True)
        time.sleep(15)
    raise TimeoutError(f"Timed out waiting for {prompt_id}. The server job was not cancelled.")


if __name__ == "__main__":
    main()

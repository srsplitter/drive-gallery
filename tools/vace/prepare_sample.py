"""Prepare a static-box VACE sample and composite its generated face locally.

Requires ffmpeg/ffprobe on PATH and Pillow. This does not track a moving face:
the supplied box must cover the mosaic throughout this short, controlled shot.
All commands create a new output directory and never overwrite input files.
"""
import argparse
from fractions import Fraction
import json
import math
from pathlib import Path
import shutil
import subprocess

from PIL import Image, ImageDraw


def run(*args):
    subprocess.run([str(a) for a in args], check=True)


def probe(path):
    data = json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-count_frames", "-show_streams",
        "-show_format", "-of", "json", str(path),
    ], text=True, encoding="utf-8"))
    video = next((s for s in data["streams"] if s["codec_type"] == "video"), None)
    if video is None:
        raise ValueError(f"No video stream: {path}")
    return video, data


def check_clip(path, width, height, frames, fps):
    video, _ = probe(path)
    actual = (int(video["width"]), int(video["height"]),
              int(video.get("nb_read_frames", 0)))
    if actual != (width, height, frames):
        raise ValueError(f"Expected {width}x{height}, {frames} frames; got {actual}: {path}")
    if abs(float(Fraction(video["avg_frame_rate"])) - fps) > 0.001:
        raise ValueError(f"Frame rate must be {fps}, got {video['avg_frame_rate']}: {path}")


def new_folder(path):
    path = Path(path).resolve()
    path.mkdir(parents=True, exist_ok=False)
    return path


def save_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def ffmpeg(*args):
    run("ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-n", *args)


def prepare(args):
    source = Path(args.input).resolve(strict=True)
    if not math.isfinite(args.start) or not math.isfinite(args.fps) or args.start < 0 or args.frames < 1 or args.fps <= 0:
        raise ValueError("start must be nonnegative; frames and fps must be positive")
    if args.width < 16 or args.height < 16 or args.width % 16 or args.height % 16:
        raise ValueError("VACE sample width and height must be positive multiples of 16")
    if (args.frames - 1) % 4:
        raise ValueError("VACE frame count must be 4n+1 (for example 49 or 81)")
    # Metadata-only probe avoids decoding a long source before extracting the sample.
    data = json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(source)
    ], text=True, encoding="utf-8"))
    video = next(s for s in data["streams"] if s["codec_type"] == "video")
    if any(float(s.get("rotation", 0)) % 360 for s in video.get("side_data_list", [])):
        raise ValueError("Normalize the source rotation before selecting a pixel-coordinate box")
    sw, sh = int(video["width"]), int(video["height"])
    x1, y1, x2, y2 = args.box
    if not (0 <= x1 < x2 <= sw and 0 <= y1 < y2 <= sh):
        raise ValueError(f"Box must be within the source's {sw}x{sh} pixels, using exclusive x2/y2")
    if args.start >= float(data["format"].get("duration", "inf")):
        raise ValueError("start is beyond the end of the source")
    box = [math.floor(x1 * args.width / sw), math.floor(y1 * args.height / sh),
           math.ceil(x2 * args.width / sw), math.ceil(y2 * args.height / sh)]
    duration = args.frames / args.fps
    out = new_folder(args.output)
    ffmpeg("-ss", args.start, "-noautorotate", "-i", source,
           "-map", "0:v:0", "-map", "0:a:0?", "-map_metadata", "-1",
           "-vf", f"fps={args.fps},scale={args.width}:{args.height}:flags=lanczos,setsar=1",
           "-frames:v", args.frames, "-t", duration,
           "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p",
           "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out / "source.mp4")
    check_clip(out / "source.mp4", args.width, args.height, args.frames, args.fps)
    ffmpeg("-i", out / "source.mp4", "-frames:v", "1", "-update", "1", out / "first_frame.png")
    mask = Image.new("L", (args.width, args.height), 0)
    ImageDraw.Draw(mask).rectangle((box[0], box[1], box[2] - 1, box[3] - 1), fill=255)
    mask.save(out / "mask.png")
    ffmpeg("-loop", "1", "-framerate", args.fps, "-i", out / "mask.png",
           "-frames:v", args.frames, "-an", "-c:v", "libx264", "-crf", "0",
           "-pix_fmt", "yuv420p", "-movflags", "+faststart", out / "mask.mp4")
    check_clip(out / "mask.mp4", args.width, args.height, args.frames, args.fps)
    meta = dict(source=str(source), start=args.start, duration=duration,
                source_width=sw, source_height=sh, source_box=args.box, box=box,
                width=args.width, height=args.height, frames=args.frames, fps=args.fps,
                mask="white=edit, black=preserve", tracking="none; static rectangular box")
    save_json(out / "metadata.json", meta)
    print(json.dumps(dict(output=str(out), **meta), ensure_ascii=False, indent=2))


def outward_alpha(width, height, box, feather):
    """Keep every pixel inside the mosaic opaque; soften only outside it."""
    x1, y1, x2, y2 = box
    values = bytearray(width * height)
    for y in range(height):
        dy = max(y1 - y, 0, y - (y2 - 1))
        for x in range(width):
            dx = max(x1 - x, 0, x - (x2 - 1))
            distance = math.hypot(dx, dy)
            values[y * width + x] = (255 if distance == 0 else
                                    round(255 * max(0, 1 - distance / feather)) if feather else 0)
    return Image.frombytes("L", (width, height), bytes(values))


def composite(args):
    sample = Path(args.sample).resolve(strict=True)
    generated = Path(args.generated).resolve(strict=True)
    meta = json.loads((sample / "metadata.json").read_text(encoding="utf-8"))
    width, height, frames, fps = [meta[k] for k in ("width", "height", "frames", "fps")]
    if not math.isfinite(args.feather) or args.feather < 0:
        raise ValueError("feather must be a finite nonnegative number of resized pixels")
    for path in (sample / "source.mp4", generated):
        check_clip(path, width, height, frames, fps)
    out = new_folder(args.output)
    outward_alpha(width, height, meta["box"], args.feather).save(out / "alpha.png")
    duration = frames / fps
    ffmpeg("-i", sample / "source.mp4", "-i", generated,
           "-loop", "1", "-framerate", fps, "-i", out / "alpha.png",
           "-filter_complex", "[0:v]setpts=PTS-STARTPTS[bg];"
           "[1:v]setpts=PTS-STARTPTS[face];[face][2:v]alphamerge[fg];"
           "[bg][fg]overlay=shortest=1:format=auto,format=yuv420p[v]",
           "-map", "[v]", "-map", "0:a:0?", "-frames:v", frames, "-t", duration,
           "-r", fps, "-c:v", "libx264", "-crf", "16", "-c:a", "copy",
           "-movflags", "+faststart", out / "composite.mp4")
    check_clip(out / "composite.mp4", width, height, frames, fps)
    ffmpeg("-i", sample / "source.mp4", "-i", out / "composite.mp4",
           "-filter_complex", "[0:v][1:v]hstack=shortest=1[v]",
           "-map", "[v]", "-map", "0:a:0?", "-frames:v", frames, "-t", duration,
           "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "copy",
           "-movflags", "+faststart", out / "comparison.mp4")
    check_clip(out / "comparison.mp4", width * 2, height, frames, fps)
    save_json(out / "metadata.json", dict(sample=str(sample), generated=str(generated),
              feather_outward_pixels=args.feather, comparison="left=source, right=composite",
              **{k: meta[k] for k in ("width", "height", "frames", "fps", "box")}))
    print(f"Saved {out / 'composite.mp4'} and {out / 'comparison.mp4'}")


def box_arg(value):
    try:
        box = [int(n) for n in value.split(",")]
        if len(box) != 4:
            raise ValueError()
        return box
    except ValueError:
        raise argparse.ArgumentTypeError("Use x1,y1,x2,y2 in original video pixels")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    prep = commands.add_parser("prepare", help="Extract a controlled sample and static white edit mask")
    prep.add_argument("--input", required=True)
    prep.add_argument("--output", required=True, help="New directory; must not exist")
    prep.add_argument("--start", type=float, default=0)
    prep.add_argument("--frames", type=int, default=49)
    prep.add_argument("--fps", type=float, default=16)
    prep.add_argument("--width", type=int, default=832)
    prep.add_argument("--height", type=int, default=480)
    prep.add_argument("--box", type=box_arg, required=True, help="Static mosaic box, exclusive x2/y2")
    prep.set_defaults(action=prepare)
    comp = commands.add_parser("composite", help="Overlay the generated region and attach sample audio")
    comp.add_argument("--sample", required=True, help="Directory produced by prepare")
    comp.add_argument("--generated", required=True, help="Generated MP4 matching sample dimensions/fps/frames")
    comp.add_argument("--output", required=True, help="New directory; must not exist")
    comp.add_argument("--feather", type=float, default=8, help="Outward feather width in resized pixels")
    comp.set_defaults(action=composite)
    args = parser.parse_args()
    for tool in ("ffmpeg", "ffprobe"):
        if shutil.which(tool) is None:
            parser.error(f"{tool} is required on PATH")
    try:
        args.action(args)
    except (ValueError, OSError, subprocess.CalledProcessError, StopIteration) as error:
        parser.exit(1, f"Error: {error}\n")


if __name__ == "__main__":
    main()

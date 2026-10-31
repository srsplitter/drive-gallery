"""Install only the three official ComfyUI VACE weights; verify their LFS hashes."""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import shutil
import time
import urllib.request

ROOT = Path(r"C:\AI\VACE-local-test")
REPO = "Comfy-Org/Wan-2.1"
FILES = {
    "diffusion_models": "wan2.1_vace_1.3B_fp16.safetensors",
    "text_encoders": "umt5_xxl_fp8_e4m3fn_scaled.safetensors",
    "vae": "wan_2.1_vae.safetensors",
}


def read_json(url):
    with urllib.request.urlopen(url, timeout=60) as response:
        return json.load(response)


def digest(path):
    result = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(8 * 1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def download(item):
    path = ROOT / "models" / item["category"] / item["name"]
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.stat().st_size == item["size"] and digest(path) == item["sha256"]:
            print(f"Verified existing: {path.name}", flush=True)
            return
        raise RuntimeError(f"Existing file differs; refusing overwrite: {path}")
    partial = path.with_suffix(path.suffix + ".part")
    offset = partial.stat().st_size if partial.exists() else 0
    headers = {"User-Agent": "VACE-local-install/1.0"}
    if offset:
        headers["Range"] = f"bytes={offset}-"
    url = f"https://huggingface.co/{REPO}/resolve/{item['revision']}/{item['remote_path']}"
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=180) as response:
        if offset and response.status != 206:
            offset = 0
        mode = "ab" if offset else "wb"
        last = time.monotonic()
        with partial.open(mode) as output:
            while chunk := response.read(8 * 1024 * 1024):
                output.write(chunk)
                offset += len(chunk)
                if time.monotonic() - last > 20:
                    print(f"{path.name}: {offset / item['size']:.0%}", flush=True)
                    last = time.monotonic()
    if partial.stat().st_size != item["size"] or digest(partial) != item["sha256"]:
        raise RuntimeError(f"Download verification failed: {path.name}")
    partial.rename(path)
    print(f"SHA256 verified: {path.name}", flush=True)


def main():
    revision = read_json(f"https://huggingface.co/api/models/{REPO}")["sha"]
    manifest = []
    for category, name in FILES.items():
        entries = read_json(f"https://huggingface.co/api/models/{REPO}/tree/{revision}/split_files/{category}")
        entry = next(x for x in entries if x["path"].endswith("/" + name))
        manifest.append(dict(category=category, name=name, remote_path=entry["path"],
                             size=entry["size"], sha256=entry["lfs"]["oid"], revision=revision))
    ROOT.mkdir(parents=True, exist_ok=True)
    remaining = sum(max(0, x["size"] - sum(p.stat().st_size for p in [
        ROOT / "models" / x["category"] / x["name"],
        ROOT / "models" / x["category"] / (x["name"] + ".part")] if p.exists())) for x in manifest)
    free = shutil.disk_usage(ROOT).free
    print(f"Need {remaining / 1e9:.2f} GB; free {free / 1e9:.2f} GB", flush=True)
    if free < remaining + 5 * 1024**3:
        raise RuntimeError("Insufficient free space with 5 GiB reserve; no files deleted")
    (ROOT / "model-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(download, manifest))
    print("VACE weights installed and verified.", flush=True)


if __name__ == "__main__":
    main()

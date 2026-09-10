"""Generate a house study from the OpenAI image API and place it in the bench.

    python3 pipeline/generate_study.py homestead "one-room farmhouse ..." --guide pipeline/out/<batch>/house-3.png

Writes reference/studies/<name>-source.png plus <name>.json with prompt, model
and request id, then runs prepare_study for the bench. The token is read from
OPENAI_API_KEY or the macOS keychain. Nothing here is shipped.
"""

import argparse
import base64
import hashlib
import io
import json
import os
import subprocess
import sys
import time
from pathlib import Path

from PIL import Image, ImageDraw

from pack import south_vertex_offset
from prepare_study import prepare

ROOT = Path(__file__).resolve().parent.parent
STUDIES = ROOT / "reference" / "studies"
GUIDE_SIZE = 1024
DIAMOND = (255, 80, 80, 255)

STYLE = (
    "Isometric building sprite for a 2D city-building game set in ancient Greece. "
    "The first image is a geometry guide: keep its camera, footprint, shape, proportions and roof pitch exactly. "
    "Paint only the building, its props and the soft shadow it casts; the ground itself is drawn by the game, "
    "so there must be no ground plane, no grass, no dirt patch, no tile and no outline, only transparency. "
    "Everything must stay inside the footprint shown by the guide. "
    "The second image is the style reference: match its painterly look, its dark weathered plaster with "
    "warm ochre highlights, strong warm sunlight from the upper left and deep cool shadows on the right faces, "
    "chunky hand-painted texture, loose brushwork and inked silhouette; do not copy its building or its ground. "
    "No text, no people, fully transparent background."
)


def token():
    if os.environ.get("OPENAI_API_KEY"):
        return os.environ["OPENAI_API_KEY"]
    result = subprocess.run(
        ["security", "find-generic-password", "-s", "OPENAI_API_KEY", "-a", os.environ["USER"], "-w"],
        capture_output=True, text=True, check=True,
    )
    return result.stdout.strip()


def guide_image(render, footprint):
    """The calibrated Blender render over its tile diamond, squared up for the API."""
    body = Image.open(render).convert("RGBA")
    manifest = json.loads((ROOT / "pipeline" / "out" / "manifest.json").read_text())
    sprite = next(s for s in manifest["sprites"] if Path(s["file"]).name == Path(render).name and s["layer"] == "body")
    supersample = manifest["supersample"]
    half_w = footprint * manifest["tileWidth"] / 2 * supersample
    half_h = footprint * manifest["tileHeight"] / 2 * supersample
    across, down = south_vertex_offset(footprint, sprite["heightUnits"], manifest["tileWidth"] / 2 ** 0.5 * supersample)
    ox, oy = body.width / 2 + across, body.height / 2 + down
    canvas = Image.new("RGBA", body.size, (0, 0, 0, 0))
    ImageDraw.Draw(canvas).polygon(
        [(ox, oy), (ox + half_w, oy - half_h), (ox, oy - 2 * half_h), (ox - half_w, oy - half_h)],
        fill=(120, 120, 120, 90),
    )
    canvas.alpha_composite(body)
    side = max(canvas.size)
    offset = ((side - canvas.width) // 2, (side - canvas.height) // 2)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.alpha_composite(canvas, offset)
    scale = GUIDE_SIZE / side
    diamond = {"x": (ox + offset[0]) * scale, "y": (oy + offset[1]) * scale, "halfWidth": half_w * scale, "halfHeight": half_h * scale}
    return square.resize((GUIDE_SIZE, GUIDE_SIZE), Image.Resampling.LANCZOS), diamond


REMASTER_GUIDED = (
    "Isometric building sprite for a 2D city-building game set in ancient Greece. "
    "Two images. The first is a geometry guide: its camera, footprint size, position within the frame and "
    "overall height are exact and must be kept. The second is a small original sprite of the building to paint: "
    "take its design, composition, colours and lighting and repaint it at high resolution inside the guide's "
    "footprint, at the guide's scale, as a crisp hand-painted illustration with chunky texture, strong warm "
    "sunlight from the upper left, deep cool shadows on the right faces and an inked silhouette. "
    "Paint only the building, its props and its cast shadow; leave the ground out entirely, so the plot is "
    "fully transparent with no grass, dirt, tile or outline. No text, no people."
)

REMASTER = (
    "Isometric building sprite for a 2D city-building game set in ancient Greece. "
    "The image is a small, low-resolution original sprite. Repaint the same building at high resolution: "
    "same camera, same footprint, same composition, same proportions, same colours and lighting, "
    "every element in the same place, as a crisp hand-painted illustration with chunky texture, "
    "strong warm sunlight from the upper left, deep cool shadows on the right faces and an inked silhouette. "
    "Paint only the building, its props and its cast shadow; leave the ground out entirely, so the plot is "
    "fully transparent with no grass, dirt, tile or outline. No text, no people."
)


def original_guide(index, footprint):
    """The original sprite framed like a Blender guide: its diamond is the plot."""
    original = Image.open(ROOT / "reference" / "sprites" / "Zeus_General" / "Zeus_Housing" / f"{index}.png").convert("RGBA")
    scale = GUIDE_SIZE * 0.66 / original.width
    width, height = round(original.width * scale), round(original.height * scale)
    enlarged = original.resize((width, height), Image.Resampling.LANCZOS)
    square = Image.new("RGBA", (GUIDE_SIZE, GUIDE_SIZE), (0, 0, 0, 0))
    left, top = (GUIDE_SIZE - width) // 2, (GUIDE_SIZE - height) // 2
    square.alpha_composite(enlarged, (left, top))
    pitch = (original.width + 2) * scale
    diamond = {"x": GUIDE_SIZE / 2, "y": top + height, "halfWidth": pitch / 2, "halfHeight": pitch / 4}
    return square, diamond


def style_image(index):
    """The original sprite, enlarged so the model reads its texture rather than its pixels."""
    original = Image.open(ROOT / "reference" / "sprites" / "Zeus_General" / "Zeus_Housing" / f"{index}.png").convert("RGBA")
    scale = GUIDE_SIZE * 0.8 / original.width
    enlarged = original.resize((round(original.width * scale), round(original.height * scale)), Image.Resampling.LANCZOS)
    square = Image.new("RGBA", (GUIDE_SIZE, GUIDE_SIZE), (0, 0, 0, 0))
    square.alpha_composite(enlarged, ((GUIDE_SIZE - enlarged.width) // 2, (GUIDE_SIZE - enlarged.height) // 2))
    return square


HEIGHT_TOLERANCE = 1.15


def silhouette_top(image):
    solid = image.getchannel("A").point(lambda value: 255 if value > 128 else 0)
    bounds = solid.getbbox()
    return bounds[1] if bounds else image.height


def height_ratio(output, guide, diamond):
    """How tall the output stands above the plot's south vertex, relative to the guide."""
    guide_height = diamond["y"] - silhouette_top(guide)
    output_height = diamond["y"] - silhouette_top(output)
    return output_height / guide_height


def crop_to_plot(image, diamond):
    """Frame the output on the guide's plot: exact plot width, south vertex on the bottom
    edge, so the anchor is known. Nothing is masked; the model paints no ground."""
    ox, oy, hw = diamond["x"], diamond["y"], diamond["halfWidth"]
    solid = image.getchannel("A").point(lambda value: 255 if value > 128 else 0)
    top = solid.getbbox()[1] if solid.getbbox() else 0
    return image.crop((round(ox - hw), min(top, round(oy) - 1), round(ox + hw), round(oy)))


def call_api(prompt, images, model, quality):
    import urllib.request

    boundary = "----zeus-study"
    fields = {"model": model, "prompt": prompt, "size": "1024x1024", "quality": quality, "background": "transparent", "output_format": "png"}
    parts = []
    for key, value in fields.items():
        parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{key}\"\r\n\r\n{value}\r\n".encode())
    for index, image in enumerate(images):
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        parts.append(
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"image[]\"; filename=\"image{index}.png\"\r\nContent-Type: image/png\r\n\r\n".encode()
            + buffer.getvalue() + b"\r\n"
        )
    parts.append(f"--{boundary}--\r\n".encode())
    request = urllib.request.Request(
        "https://api.openai.com/v1/images/edits",
        data=b"".join(parts),
        headers={"Authorization": f"Bearer {token()}", "Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=300) as response:
                return json.load(response), response.headers.get("x-request-id")
        except urllib.error.HTTPError as error:
            body = error.read().decode()
            flapping_verification = error.code == 403 and "verified" in body
            transient = flapping_verification or error.code in (429, 500, 502, 503)
            if not transient or attempt == 3:
                sys.exit(f"API error {error.code}: {body}")
            print(f"transient {error.code}, retrying in {10 * (attempt + 1)}s", file=sys.stderr)
            time.sleep(10 * (attempt + 1))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("name")
    parser.add_argument("prompt")
    parser.add_argument("--guide", help="calibrated body render from pipeline/out")
    parser.add_argument("--original", type=int, help="remaster this original housing sprite instead of following a render")
    parser.add_argument("--footprint", type=int, default=2)
    parser.add_argument("--style", type=int, default=787, help="original housing sprite index used as style reference")
    parser.add_argument("--model", default="gpt-image-2")
    parser.add_argument("--quality", default="medium")
    parser.add_argument("--accept-oversize", action="store_true", help="keep an output taller than the guide allows")
    args = parser.parse_args()

    if not (args.guide or args.original):
        parser.error("pass --guide, --original, or both")
    STUDIES.mkdir(parents=True, exist_ok=True)
    if args.guide and args.original:
        guide, diamond = guide_image(args.guide, args.footprint)
        images = [guide, style_image(args.original)]
        prompt = f"{REMASTER_GUIDED}\n\nSubject: {args.prompt}"
    elif args.original:
        guide, diamond = original_guide(args.original, args.footprint)
        images = [guide]
        prompt = f"{REMASTER}\n\nSubject: {args.prompt}"
    else:
        guide, diamond = guide_image(args.guide, args.footprint)
        images = [guide, style_image(args.style)]
        prompt = f"{STYLE}\n\nSubject: {args.prompt}"
    guide.save(STUDIES / f"{args.name}-guide.png")
    result, request_id = call_api(prompt, images, args.model, args.quality)
    data = base64.b64decode(result["data"][0]["b64_json"])
    source = STUDIES / f"{args.name}-source.png"
    source.write_bytes(data)
    output = Image.open(source).convert("RGBA")
    ratio = height_ratio(output, guide, diamond)
    if ratio > HEIGHT_TOLERANCE and not args.accept_oversize:
        sys.exit(f"{args.name}: output stands {ratio:.2f}x the guide's height (limit {HEIGHT_TOLERANCE}); source kept, study not written")
    cropped = STUDIES / f"{args.name}-plot.png"
    crop_to_plot(output, diamond).save(cropped)
    (STUDIES / f"{args.name}.json").write_text(json.dumps({
        "prompt": prompt, "model": args.model, "quality": args.quality, "requestId": request_id,
        "usage": result.get("usage"), "sourceSha256": hashlib.sha256(data).hexdigest(),
        "guide": f"{args.name}-guide.png", "styleReference": args.original or args.style, "remasterOf": args.original, "diamond": diamond,
        "heightRatio": round(ratio, 3),
    }, indent=2))
    metadata = prepare(cropped, STUDIES / f"{args.name}.png", 59 * args.footprint, trim=False)
    print(json.dumps({k: metadata[k] for k in ("image", "width", "height", "requestId", "usage")}, indent=2))


if __name__ == "__main__":
    main()

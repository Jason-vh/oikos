"""Downsample, trim and pack Blender renders into a sprite atlas the game can load.

    python3 pipeline/pack.py

Anchors are computed analytically from the camera used by iso_render.py, so a
sprite lands on its tile without anyone eyeballing an offset.
"""

import json
import math
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IN_DIR = os.path.join(ROOT, "pipeline", "out")
OUT_DIR = os.path.join(ROOT, "public", "assets")
ATLAS_PAD = 4

RIGHT = (math.cos(math.radians(45)), math.sin(math.radians(45)), 0.0)
UP = (
    -math.sin(math.radians(45)) * math.cos(math.radians(30)),
    math.cos(math.radians(45)) * math.cos(math.radians(30)),
    math.sin(math.radians(30)),
)


def south_vertex_offset(footprint, height, pixels_per_unit):
    """Pixels from image centre down to the footprint's south vertex."""
    dx = footprint / 2
    dy = -footprint / 2
    dz = -height / 2
    return -(dx * UP[0] + dy * UP[1] + dz * UP[2]) * pixels_per_unit


def load_manifest():
    with open(os.path.join(IN_DIR, "manifest.json")) as handle:
        return json.load(handle)


def main():
    manifest = load_manifest()
    supersample = manifest["supersample"]
    pixels_per_unit = manifest["tileWidth"] / math.sqrt(2)
    os.makedirs(OUT_DIR, exist_ok=True)

    prepared = []
    for sprite in manifest["sprites"]:
        source = Image.open(os.path.join(IN_DIR, sprite["file"])).convert("RGBA")
        image = source.resize((sprite["width"], sprite["height"]), Image.LANCZOS)

        bbox = image.getbbox()
        if bbox is None:
            continue
        trimmed = image.crop(bbox)

        height_units = sprite.get("heightUnits", 2.1)
        anchor_y = image.height / 2 + south_vertex_offset(sprite["footprint"], height_units, pixels_per_unit)

        prepared.append(
            {
                "kind": sprite["kind"],
                "phase": sprite["phase"],
                "image": trimmed,
                "anchorX": (image.width / 2 - bbox[0]) / trimmed.width,
                "anchorY": (anchor_y - bbox[1]) / trimmed.height,
            }
        )

    prepared.sort(key=lambda item: (item["kind"], item["phase"]))
    columns = max(1, math.ceil(math.sqrt(len(prepared))))
    cell_width = max(item["image"].width for item in prepared) + ATLAS_PAD
    cell_height = max(item["image"].height for item in prepared) + ATLAS_PAD
    rows = math.ceil(len(prepared) / columns)

    atlas = Image.new("RGBA", (columns * cell_width, rows * cell_height), (0, 0, 0, 0))
    frames = []

    for index, item in enumerate(prepared):
        x = (index % columns) * cell_width + ATLAS_PAD // 2
        y = (index // columns) * cell_height + ATLAS_PAD // 2
        atlas.paste(item["image"], (x, y))
        frames.append(
            {
                "kind": item["kind"],
                "phase": item["phase"],
                "x": x,
                "y": y,
                "width": item["image"].width,
                "height": item["image"].height,
                "anchorX": round(item["anchorX"], 5),
                "anchorY": round(item["anchorY"], 5),
            }
        )

    atlas.save(os.path.join(OUT_DIR, "structures.png"))
    with open(os.path.join(OUT_DIR, "structures.json"), "w") as handle:
        json.dump({"image": "structures.png", "frames": frames}, handle, indent=2)

    print(f"packed {len(frames)} sprites into {atlas.size[0]}x{atlas.size[1]}")


if __name__ == "__main__":
    main()

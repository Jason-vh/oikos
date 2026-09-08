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
MAX_ATLAS_WIDTH = 4096

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


def shelf_pack(items):
    """Rows of equal-height sprites, tallest first: far tighter than a uniform grid."""
    area = sum((item["image"].width + ATLAS_PAD) * (item["image"].height + ATLAS_PAD) for item in items)
    widest = max(item["image"].width for item in items) + ATLAS_PAD
    width = min(MAX_ATLAS_WIDTH, max(widest, int(math.sqrt(area * 1.1))))

    ordered = sorted(items, key=lambda item: (-item["image"].height, -item["image"].width))
    placements = []
    shelf_y = 0
    shelf_height = 0
    cursor = 0

    for item in ordered:
        cell_width = item["image"].width + ATLAS_PAD
        if cursor + cell_width > width and cursor > 0:
            shelf_y += shelf_height
            shelf_height = 0
            cursor = 0
        placements.append((item, (cursor + ATLAS_PAD // 2, shelf_y + ATLAS_PAD // 2)))
        cursor += cell_width
        shelf_height = max(shelf_height, item["image"].height + ATLAS_PAD)

    return placements, (width, shelf_y + shelf_height)


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

        height_units = sprite["heightUnits"]
        anchor_y = image.height / 2 + south_vertex_offset(sprite["footprint"], height_units, pixels_per_unit)

        prepared.append(
            {
                "kind": sprite["kind"],
                "variant": sprite.get("variant", 0),
                "phase": sprite["phase"],
                "layer": sprite.get("layer", "body"),
                "image": trimmed,
                "anchorX": (image.width / 2 - bbox[0]) / trimmed.width,
                "anchorY": (anchor_y - bbox[1]) / trimmed.height,
            }
        )

    placements, size = shelf_pack(prepared)

    atlas = Image.new("RGBA", size, (0, 0, 0, 0))
    frames = []

    for item, (x, y) in placements:
        atlas.paste(item["image"], (x, y))
        frames.append(
            {
                "kind": item["kind"],
                "variant": item["variant"],
                "phase": item["phase"],
                "layer": item["layer"],
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

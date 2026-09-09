"""Downsample, trim and pack Blender renders into a sprite atlas the game can load.

    python3 pipeline/pack.py

Anchors are computed analytically from the camera used by iso_render.py, so a
sprite lands on its tile without anyone eyeballing an offset.
"""

import json
import math
import os

from PIL import Image, ImageChops, ImageEnhance, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IN_DIR = os.path.join(ROOT, "pipeline", "out")
OUT_DIR = os.path.join(ROOT, "public", "assets")
ATLAS_PAD = 4
SHADOW_FLOOR = 12
PIXEL_GRAIN = 2
CONTRAST = 1.26
SATURATION = 1.22
OUTLINE = (52, 38, 28)
OUTLINE_STRENGTH = 0.55
MAX_ATLAS_WIDTH = 4096

YAW = math.radians(45)
ELEVATION = math.radians(30)

RIGHT = (math.cos(YAW), math.sin(YAW), 0.0)
UP = (
    -math.sin(ELEVATION) * math.sin(YAW),
    math.sin(ELEVATION) * math.cos(YAW),
    math.cos(ELEVATION),
)


def footprint_sides(footprint):
    """A footprint is a square side, or a pair of sides for a building laid long."""
    if isinstance(footprint, (list, tuple)):
        return footprint[0], footprint[1]
    return footprint, footprint


def south_vertex_offset(footprint, height, pixels_per_unit):
    """Pixels from the image centre to the footprint's south vertex, across and down."""
    sides = footprint_sides(footprint)
    dx = sides[0] / 2
    dy = -sides[1] / 2
    dz = -height / 2
    across = (dx * RIGHT[0] + dy * RIGHT[1] + dz * RIGHT[2]) * pixels_per_unit
    down = -(dx * UP[0] + dy * UP[1] + dz * UP[2]) * pixels_per_unit
    return across, down


def load_manifest():
    with open(os.path.join(IN_DIR, "manifest.json")) as handle:
        return json.load(handle)


def period_downsample(source, width, height):
    """The original was drawn at 58 px a tile; we draw at 120. Resolve to the
    original's density and step back up, so a sprite pixel is a 2x2 block, as the
    terrain's is."""
    coarse = source.resize((width // PIXEL_GRAIN, height // PIXEL_GRAIN), Image.LANCZOS)
    return coarse.resize((coarse.width * PIXEL_GRAIN, coarse.height * PIXEL_GRAIN), Image.NEAREST)


def paint(image):
    """The original's sprites were renders touched up by hand: colour pushed, and a
    dark line drawn round every silhouette. Push the colour and draw the line."""
    alpha = image.getchannel("A")
    colour = image.convert("RGB")
    colour = ImageEnhance.Contrast(colour).enhance(CONTRAST)
    colour = ImageEnhance.Color(colour).enhance(SATURATION)

    solid = alpha.point(lambda value: 255 if value > 96 else 0)
    massed = solid.filter(ImageFilter.MinFilter(5)).filter(ImageFilter.MaxFilter(5))
    rim = ImageChops.subtract(massed.filter(ImageFilter.MaxFilter(3)), solid)
    edge = ImageChops.subtract(massed, massed.filter(ImageFilter.MinFilter(3)))
    inked = Image.new("RGB", image.size, OUTLINE)
    colour = Image.composite(Image.blend(colour, inked, OUTLINE_STRENGTH), colour, edge)

    result = Image.merge("RGBA", (*colour.split(), ImageChops.lighter(alpha, rim)))
    inked_rim = Image.new("RGBA", image.size, (*OUTLINE, 255))
    return Image.composite(inked_rim, result, rim)


def drop_faint_alpha(image):
    """A shadow catcher darkens the whole plane a little; clear that so the
    sprite trims down to the shadow itself."""
    alpha = image.getchannel("A").point(lambda value: 0 if value < SHADOW_FLOOR else value)
    image.putalpha(alpha)
    return image


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
        image = period_downsample(source, sprite["width"], sprite["height"])
        if sprite.get("layer") == "shadow":
            image = drop_faint_alpha(image)
        else:
            image = paint(image)

        bbox = image.getbbox()
        if bbox is None:
            continue
        trimmed = image.crop(bbox)

        height_units = sprite["heightUnits"]
        across, down = south_vertex_offset(sprite["footprint"], height_units, pixels_per_unit)
        anchor_x = image.width / 2 + across
        anchor_y = image.height / 2 + down

        prepared.append(
            {
                "kind": sprite["kind"],
                "variant": sprite.get("variant", 0),
                "layer": sprite.get("layer", "body"),
                "image": trimmed,
                "anchorX": (anchor_x - bbox[0]) / trimmed.width,
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

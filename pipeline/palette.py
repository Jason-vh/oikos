"""
Measure the original's colours so the style is numbers, not adjectives.

    python3 pipeline/palette.py            # writes pipeline/palette.json

Terrain: per class, the median colour, the grain (mean per-pixel deviation
inside a tile) and the drift (deviation of tile means across the class).
Buildings: the dominant colours of the housing ladder, quantised.
"""

import json
import os
from statistics import mean, median, pstdev

from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), "..")
SPRITES = os.path.join(ROOT, "reference", "sprites")
INDEX = os.path.join(os.path.dirname(__file__), "reference.json")
OUT = os.path.join(os.path.dirname(__file__), "palette.json")
TERRAIN_CLASSES = ["grass", "meadow", "bare", "deepWater", "beach", "road", "paving"]
HOUSING = [787, 788, 789, 790, 791, 792, 793, 794]
BUILDING_COLOURS = 12


def opaque_pixels(image):
    return [(r, g, b) for r, g, b, a in image.getdata() if a == 255]


def hex_of(rgb):
    return "#%02x%02x%02x" % tuple(int(round(c)) for c in rgb)


def luminance(rgb):
    r, g, b = rgb
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def tile_path(group, index):
    return os.path.join(SPRITES, group, f"{index}.png")


def measure_terrain(entry):
    low, high = entry["indices"]
    tiles = []
    for index in range(low, high + 1):
        path = tile_path(entry["group"], index)
        if not os.path.exists(path):
            continue
        image = Image.open(path).convert("RGBA")
        if image.width != 58 or image.height > 40:
            continue
        pixels = opaque_pixels(image)
        if pixels:
            tiles.append(pixels)
    all_pixels = [p for tile in tiles for p in tile]
    channel_median = tuple(median(p[c] for p in all_pixels) for c in range(3))
    grain = mean(pstdev(luminance(p) for p in tile) for tile in tiles)
    drift = pstdev(mean(luminance(p) for p in tile) for tile in tiles)
    return {
        "median": hex_of(channel_median),
        "luminance": round(mean(luminance(p) for p in all_pixels), 1),
        "grainWithinTile": round(grain, 1),
        "driftBetweenTiles": round(drift, 1),
        "tiles": len(tiles),
    }


def measure_housing(group):
    strip = Image.new("RGBA", (118 * len(HOUSING), 160), (0, 0, 0, 0))
    for slot, index in enumerate(HOUSING):
        sprite = Image.open(tile_path(group, index)).convert("RGBA")
        strip.alpha_composite(sprite, (slot * 118, 160 - sprite.height))
    opaque = Image.new("RGB", strip.size, (0, 0, 0))
    opaque.paste(strip, mask=strip.getchannel("A"))
    quantised = opaque.quantize(colors=BUILDING_COLOURS + 1, method=Image.Quantize.MEDIANCUT)
    palette = quantised.getpalette()[: 3 * (BUILDING_COLOURS + 1)]
    counts = sorted(quantised.getcolors(), reverse=True)
    colours = []
    for count, slot in counts:
        rgb = tuple(palette[3 * slot : 3 * slot + 3])
        if rgb == (0, 0, 0):
            continue
        colours.append({"hex": hex_of(rgb), "share": round(count / sum(c for c, _ in counts), 3)})
    return colours


def main():
    with open(INDEX) as handle:
        reference = json.load(handle)
    terrain = {name: measure_terrain(reference["terrain"][name]) for name in TERRAIN_CLASSES}
    housing = measure_housing(reference["buildings"]["house:6"]["group"])
    with open(OUT, "w") as handle:
        json.dump({"tile": reference["tile"], "terrain": terrain, "housing": housing}, handle, indent=2)
    print(json.dumps({"terrain": terrain, "housing": housing}, indent=2))


if __name__ == "__main__":
    main()

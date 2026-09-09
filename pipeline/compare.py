"""
Our sprites beside the originals, on the same tile diamond, at game scale.

    python3 pipeline/compare.py /tmp/compare.png              # everything in reference.json
    python3 pipeline/compare.py /tmp/compare.png house granary

Ours come from public/assets/structures.png, which is what the game draws.
Originals are scaled 58 -> 120 px per tile, nearest-neighbour, so the pixel
grain of the reference stays visible.
"""

import json
import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(__file__), "..")
ATLAS = os.path.join(ROOT, "public", "assets", "structures")
SPRITES = os.path.join(ROOT, "reference", "sprites")
INDEX = os.path.join(os.path.dirname(__file__), "reference.json")
CELL_W = 460
CELL_H = 520
BASELINE = 60
BACKGROUND = (60, 60, 60, 255)
DIAMOND = (255, 80, 80, 255)
LABEL = (255, 255, 255, 255)


def load_atlas():
    with open(ATLAS + ".json") as handle:
        manifest = json.load(handle)
    image = Image.open(ATLAS + ".png").convert("RGBA")
    frames = {}
    for frame in manifest["frames"]:
        if frame["layer"] != "body":
            continue
        crop = image.crop((frame["x"], frame["y"], frame["x"] + frame["width"], frame["y"] + frame["height"]))
        frames[f"{frame['kind']}:{frame['variant']}"] = (crop, frame["anchorX"] * frame["width"], frame["anchorY"] * frame["height"])
    return frames


def load_reference(index, tile):
    scale = tile["gameWidth"] / tile["width"]
    sprites = []
    for i in index["indices"]:
        sprite = Image.open(os.path.join(SPRITES, index["group"], f"{i}.png")).convert("RGBA")
        scaled = sprite.resize((round(sprite.width * scale), round(sprite.height * scale)), Image.NEAREST)
        footprint = max(1, round((sprite.width + 2) / (tile["width"] + 2)))
        sprites.append((scaled, scaled.width / 2, scaled.height, footprint))
    return sprites


def draw_diamond(draw, origin_x, origin_y, size, tile):
    half_w = size * tile["gameWidth"] / 2
    half_h = size * tile["gameHeight"] / 2
    draw.polygon(
        [(origin_x, origin_y), (origin_x + half_w, origin_y - half_h), (origin_x, origin_y - 2 * half_h), (origin_x - half_w, origin_y - half_h)],
        outline=DIAMOND,
    )


def place(sheet, draw, column, row, sprite, anchor_x, anchor_y, footprint, label, tile):
    origin_x = column * CELL_W + CELL_W / 2
    origin_y = (row + 1) * CELL_H - BASELINE
    draw_diamond(draw, origin_x, origin_y, footprint, tile)
    sheet.alpha_composite(sprite, (int(origin_x - anchor_x), int(origin_y - anchor_y)))
    draw.text((column * CELL_W + 6, row * CELL_H + 6), label, fill=LABEL)


def main():
    out = sys.argv[1]
    wanted = set(sys.argv[2:])
    with open(INDEX) as handle:
        reference = json.load(handle)
    tile = reference["tile"]
    atlas = load_atlas()
    rows = [(key, entry) for key, entry in reference["buildings"].items() if entry["indices"] and (not wanted or key.split(":")[0] in wanted)]

    columns = 1 + max(len(entry["indices"]) for _, entry in rows)
    sheet = Image.new("RGBA", (columns * CELL_W, len(rows) * CELL_H), BACKGROUND)
    draw = ImageDraw.Draw(sheet)
    for row, (key, entry) in enumerate(rows):
        originals = load_reference(entry, tile)
        footprint = originals[0][3]
        if key in atlas:
            sprite, anchor_x, anchor_y = atlas[key]
            place(sheet, draw, 0, row, sprite, anchor_x, anchor_y, footprint, f"ours {key}", tile)
        else:
            draw.text((6, row * CELL_H + 6), f"ours {key}: not in atlas", fill=LABEL)
        for column, (sprite, anchor_x, anchor_y, size) in enumerate(originals, start=1):
            place(sheet, draw, column, row, sprite, anchor_x, anchor_y, size, f"original {entry['name']} #{entry['indices'][column - 1]}", tile)
    sheet.save(out)
    print(out)


if __name__ == "__main__":
    main()

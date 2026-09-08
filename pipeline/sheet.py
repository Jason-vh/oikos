"""Contact sheet of rendered sprites at game scale, each over its tile diamond.

    python3 pipeline/sheet.py [phase] [out.png]
"""

import json
import math
import os
import sys

from PIL import Image, ImageDraw

from pack import IN_DIR, south_vertex_offset

phase = int(sys.argv[1]) if len(sys.argv) > 1 else 2
out_path = sys.argv[2] if len(sys.argv) > 2 else "/tmp/sheet.png"

with open(os.path.join(IN_DIR, "manifest.json")) as handle:
    manifest = json.load(handle)

tile_w = manifest["tileWidth"]
tile_h = manifest["tileHeight"]
pixels_per_unit = tile_w / math.sqrt(2)
sprites = sorted(
    (s for s in manifest["sprites"] if s["phase"] == phase),
    key=lambda s: (s["kind"], s["variant"]),
)

cell_w = 2 * tile_w + 40
cell_h = 420
sheet = Image.new("RGBA", (cell_w * len(sprites), cell_h), (70, 70, 70, 255))
draw = ImageDraw.Draw(sheet)

for index, sprite in enumerate(sprites):
    image = Image.open(os.path.join(IN_DIR, sprite["file"])).convert("RGBA")
    image = image.resize((sprite["width"], sprite["height"]), Image.LANCZOS)
    anchor_y = image.height / 2 + south_vertex_offset(sprite["footprint"], sprite["heightUnits"], pixels_per_unit)

    origin_x = index * cell_w + cell_w / 2
    origin_y = cell_h - 40
    size = sprite["footprint"]
    diamond = [
        (origin_x, origin_y),
        (origin_x + size * tile_w / 2, origin_y - size * tile_h / 2),
        (origin_x, origin_y - size * tile_h),
        (origin_x - size * tile_w / 2, origin_y - size * tile_h / 2),
    ]
    draw.polygon(diamond, outline=(255, 80, 80, 255))
    draw.line([(index * cell_w, 0), (index * cell_w, cell_h)], fill=(40, 40, 40, 255))
    sheet.alpha_composite(image, (int(origin_x - image.width / 2), int(origin_y - anchor_y)))
    draw.text((index * cell_w + 6, 6), f"{sprite['kind']} {sprite['variant']}", fill=(255, 255, 255, 255))

sheet.save(out_path)
print(out_path)

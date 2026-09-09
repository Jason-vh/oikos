"""Contact sheet of rendered sprites at game scale, each over its tile diamond.

    python3 pipeline/sheet.py [out.png]
"""

import json
import math
import os
import sys

from PIL import Image, ImageDraw

from pack import IN_DIR, footprint_sides, south_vertex_offset

out_path = sys.argv[1] if len(sys.argv) > 1 else "/tmp/sheet.png"

with open(os.path.join(IN_DIR, "manifest.json")) as handle:
    manifest = json.load(handle)

tile_w = manifest["tileWidth"]
tile_h = manifest["tileHeight"]
pixels_per_unit = tile_w / math.sqrt(2)
sprites = sorted(
    (s for s in manifest["sprites"] if s["layer"] == "body"),
    key=lambda s: (s["kind"], s["variant"]),
)

cell_h = 420
widths = [max(2 * tile_w, s["width"]) + 40 for s in sprites]
sheet = Image.new("RGBA", (sum(widths), cell_h), (70, 70, 70, 255))
draw = ImageDraw.Draw(sheet)

cell_x = 0
for index, sprite in enumerate(sprites):
    cell_w = widths[index]
    image = Image.open(os.path.join(IN_DIR, sprite["file"])).convert("RGBA")
    image = image.resize((sprite["width"], sprite["height"]), Image.LANCZOS)
    across, down = south_vertex_offset(sprite["footprint"], sprite["heightUnits"], pixels_per_unit)
    anchor_x = image.width / 2 + across
    anchor_y = image.height / 2 + down

    origin_x = cell_x + cell_w / 2
    origin_y = cell_h - 40
    east, north = footprint_sides(sprite["footprint"])
    diamond = [
        (origin_x, origin_y),
        (origin_x + east * tile_w / 2, origin_y - east * tile_h / 2),
        (origin_x + (east - north) * tile_w / 2, origin_y - (east + north) * tile_h / 2),
        (origin_x - north * tile_w / 2, origin_y - north * tile_h / 2),
    ]
    draw.polygon(diamond, outline=(255, 80, 80, 255))
    draw.line([(cell_x, 0), (cell_x, cell_h)], fill=(40, 40, 40, 255))
    sheet.alpha_composite(image, (int(origin_x - anchor_x), int(origin_y - anchor_y)))
    draw.text((cell_x + 6, 6), f"{sprite['kind']} {sprite['variant']}", fill=(255, 255, 255, 255))
    cell_x += cell_w

sheet.save(out_path)
print(out_path)

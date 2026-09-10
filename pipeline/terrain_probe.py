"""Can the image model repaint a terrain class so that its tiles still tile?

    python3 pipeline/terrain_probe.py grass --model gpt-image-2.5-sunburst

Sends a 4x4 patch of original tiles, gets a repaint, cuts it back into
diamonds, then re-tiles those in a fresh order beside the original. Seams
show up in the re-tiled sheet. Local only; nothing is shipped.
"""

import argparse
import base64
import io
import json
import random
from pathlib import Path

from PIL import Image, ImageDraw

from generate_study import ROOT, STUDIES, call_api

TILE_W, TILE_H, PITCH = 58, 30, 60
PATCH = 4
SCALE = 4
PROMPT = (
    "Isometric terrain for a 2D city-building game set in ancient Greece, viewed from the same camera as the "
    "image. The image is a low-resolution patch of ground tiles. Repaint it at high resolution as hand-painted "
    "ground: same colours, same brightness, same kind of surface, same 2:1 diamond grid, no objects, no "
    "buildings, no text, no lighting gradient across the patch, and no visible tile edges: the surface must be "
    "continuous so that any diamond cut from it can sit beside any other. Keep the outline of the patch exactly, "
    "with a transparent background outside it."
)


def tile_index(entry):
    low, high = entry["indices"]
    return [i for i in range(low, high + 1) if (ROOT / "reference" / "sprites" / entry["group"] / f"{i}.png").exists()]


def diamond_origin(column, row, scale):
    x = (column - row) * PITCH / 2 * scale
    y = (column + row) * TILE_H / 2 * scale
    return x, y


def lay_patch(tiles, order, scale):
    """Tiles laid in a 4x4 diamond, top-left of the bounding box at (0, 0)."""
    width = PATCH * PITCH * scale
    height = PATCH * TILE_H * scale
    sheet = Image.new("RGBA", (round(width), round(height)), (0, 0, 0, 0))
    for slot, (column, row) in enumerate((c, r) for r in range(PATCH) for c in range(PATCH)):
        tile = tiles[order[slot]]
        if scale != 1:
            tile = tile.resize((round(tile.width * scale), round(tile.height * scale)), Image.Resampling.NEAREST)
        x, y = diamond_origin(column, row, scale)
        sheet.alpha_composite(tile, (round(x + width / 2 - PITCH / 2 * scale), round(y)))
    return sheet


def diamond_mask():
    """The original's exact 58x30 diamond: hard-edged, so laid tiles meet without a seam."""
    original = Image.open(ROOT / "reference" / "sprites" / "Zeus_Terrain" / "Zeus_land1" / "81.png").convert("RGBA")
    mask = Image.new("L", (PITCH, TILE_H), 0)
    mask.paste(original.getchannel("A").point(lambda value: 255 if value else 0), (1, 0))
    return mask


def cut_tiles(sheet, scale):
    """Diamonds cut out of a repainted patch: downsample the full cell first, then apply
    the original's hard diamond, so no edge pixel is half transparent."""
    width = sheet.width
    mask = diamond_mask()
    tiles = []
    for row in range(PATCH):
        for column in range(PATCH):
            x, y = diamond_origin(column, row, scale)
            left = round(x + width / 2 - PITCH / 2 * scale)
            top = round(y)
            cell = sheet.crop((left, top, left + round(PITCH * scale), top + round(TILE_H * scale)))
            cell = cell.resize((PITCH, TILE_H), Image.Resampling.LANCZOS)
            cell.putalpha(mask)
            tiles.append(cell)
    return tiles


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("terrain", help="class in reference.json: grass, bare, meadow, road, paving")
    parser.add_argument("--model", default="gpt-image-2.5-sunburst")
    parser.add_argument("--quality", default="medium")
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()

    entry = json.loads((ROOT / "pipeline" / "reference.json").read_text())["terrain"][args.terrain]
    rng = random.Random(args.seed)
    indices = tile_index(entry)
    tiles = [Image.open(ROOT / "reference" / "sprites" / entry["group"] / f"{i}.png").convert("RGBA") for i in indices]
    tiles = [t for t in tiles if t.size[0] == TILE_W and t.size[1] <= TILE_H + 4]
    order = [rng.randrange(len(tiles)) for _ in range(PATCH * PATCH)]

    reference = lay_patch(tiles, order, SCALE)
    square = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    square.alpha_composite(reference, ((1024 - reference.width) // 2, (1024 - reference.height) // 2))
    STUDIES.mkdir(parents=True, exist_ok=True)
    square.save(STUDIES / f"terrain-{args.terrain}-guide.png")

    result, request_id = call_api(PROMPT, [square], args.model, args.quality)
    data = base64.b64decode(result["data"][0]["b64_json"])
    (STUDIES / f"terrain-{args.terrain}-source.png").write_bytes(data)
    repaint = Image.open(io.BytesIO(data)).convert("RGBA")
    patch = repaint.crop(((1024 - reference.width) // 2, (1024 - reference.height) // 2, (1024 + reference.width) // 2, (1024 + reference.height) // 2))
    cut = cut_tiles(patch, SCALE)

    shuffled = [rng.randrange(len(cut)) for _ in range(PATCH * PATCH)]
    left = lay_patch(tiles, shuffled, 3)
    right = lay_patch(cut, shuffled, 3)
    sheet = Image.new("RGBA", (left.width + right.width + 30, left.height + 24), (60, 60, 60, 255))
    sheet.alpha_composite(left, (0, 24))
    sheet.alpha_composite(right, (left.width + 30, 24))
    draw = ImageDraw.Draw(sheet)
    draw.text((6, 6), f"original {args.terrain}, re-tiled", fill="white")
    draw.text((left.width + 36, 6), f"repaint, cut and re-tiled ({args.model})", fill="white")
    out = STUDIES / f"terrain-{args.terrain}-retile.png"
    sheet.save(out)
    (STUDIES / f"terrain-{args.terrain}.json").write_text(json.dumps({"prompt": PROMPT, "model": args.model, "requestId": request_id, "usage": result.get("usage"), "indices": [indices[i] for i in order]}, indent=2))
    print(out)


if __name__ == "__main__":
    main()

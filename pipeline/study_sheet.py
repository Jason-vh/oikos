"""Original, our render and an AI study side by side at game pitch, with the tile diamond.

    python3 pipeline/study_sheet.py /tmp/sheet.png homestead-v1 --zoom 3
"""

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
STUDIES = ROOT / "reference" / "studies"
ORIGINAL = ROOT / "reference" / "sprites" / "Zeus_General" / "Zeus_Housing"
CELL = (170, 130)
BACKGROUND = (60, 60, 60, 255)


def panel(image, anchor_x, anchor_y, footprint, label, zoom):
    canvas = Image.new("RGBA", (CELL[0] * zoom, CELL[1] * zoom), BACKGROUND)
    draw = ImageDraw.Draw(canvas)
    ox, oy = CELL[0] * zoom / 2, (CELL[1] - 14) * zoom
    hw, hh = footprint * 30 * zoom, footprint * 15 * zoom
    draw.polygon([(ox, oy), (ox + hw, oy - hh), (ox, oy - 2 * hh), (ox - hw, oy - hh)], outline=(255, 80, 80, 255))
    scaled = image.resize((image.width * zoom, image.height * zoom), Image.Resampling.NEAREST)
    canvas.alpha_composite(scaled, (round(ox - anchor_x * scaled.width), round(oy - anchor_y * scaled.height)))
    draw.text((6, 6), label, fill="white")
    return canvas


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("out", type=Path)
    parser.add_argument("studies", nargs="+")
    parser.add_argument("--original", type=int, default=787)
    parser.add_argument("--zoom", type=int, default=3)
    args = parser.parse_args()

    original = Image.open(ORIGINAL / f"{args.original}.png").convert("RGBA")
    panels = [panel(original, 0.5, 1, 2, f"original #{args.original}", args.zoom)]
    for name in args.studies:
        meta = json.loads((STUDIES / f"{name}.json").read_text())
        image = Image.open(STUDIES / meta["image"]).convert("RGBA")
        panels.append(panel(image, meta["anchorX"], meta["anchorY"], 2, f"{name} {meta['width']}x{meta['height']}", args.zoom))
    sheet = Image.new("RGBA", (sum(p.width for p in panels), panels[0].height), BACKGROUND)
    x = 0
    for p in panels:
        sheet.alpha_composite(p, (x, 0))
        x += p.width
    sheet.save(args.out)
    print(args.out)


if __name__ == "__main__":
    main()

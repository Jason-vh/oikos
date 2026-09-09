"""
Lay out reference sprites at a zoom, nearest-neighbour, so texture can be read.

    python3 pipeline/sg_look.py /tmp/look.png Zeus_General/Zeus_Housing 781-793 --zoom 3
    python3 pipeline/sg_look.py /tmp/look.png Zeus_Terrain/Zeus_land1 0-47 60 61 --zoom 4 --cols 12
"""

import argparse
import os

from PIL import Image

SPRITES = os.path.join(os.path.dirname(__file__), "..", "reference", "sprites")


def parse_indices(tokens):
    for token in tokens:
        if "-" in token:
            low, high = token.split("-")
            yield from range(int(low), int(high) + 1)
        else:
            yield int(token)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("out")
    parser.add_argument("group")
    parser.add_argument("indices", nargs="+")
    parser.add_argument("--zoom", type=int, default=3)
    parser.add_argument("--cols", type=int, default=8)
    args = parser.parse_args()

    sprites = [Image.open(os.path.join(SPRITES, args.group, f"{i}.png")) for i in parse_indices(args.indices)]
    cell_w = max(s.width for s in sprites) * args.zoom
    cell_h = max(s.height for s in sprites) * args.zoom
    rows = (len(sprites) + args.cols - 1) // args.cols
    sheet = Image.new("RGBA", (args.cols * cell_w, rows * cell_h), (60, 60, 60, 255))
    for slot, sprite in enumerate(sprites):
        zoomed = sprite.resize((sprite.width * args.zoom, sprite.height * args.zoom), Image.NEAREST)
        x = (slot % args.cols) * cell_w + (cell_w - zoomed.width) // 2
        y = (slot // args.cols) * cell_h + cell_h - zoomed.height
        sheet.alpha_composite(zoomed, (x, y))
    sheet.save(args.out)


if __name__ == "__main__":
    main()

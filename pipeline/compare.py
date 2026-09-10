import argparse
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
BACKGROUND = (60, 60, 60, 255)
SHADOW_ALPHA = 0.45


def reference_scale(tile):
    return tile["gameWidth"] / tile["pitchWidth"]


def atlas_layers(stem):
    manifest = json.loads(stem.with_suffix(".json").read_text())
    image = Image.open(stem.with_suffix(".png")).convert("RGBA")
    sprites = {}
    for frame in manifest["frames"]:
        crop = image.crop((frame["x"], frame["y"], frame["x"] + frame["width"], frame["y"] + frame["height"]))
        if frame["layer"] == "shadow":
            crop.putalpha(crop.getchannel("A").point(lambda value: round(value * SHADOW_ALPHA)))
        key = f"{frame['kind']}:{frame['variant']}"
        sprites.setdefault(key, []).append({
            "image": crop,
            "x": -frame["anchorX"] * crop.width,
            "y": -frame["anchorY"] * crop.height,
            "footprint": frame["footprint"],
            "layer": frame["layer"],
        })
    for layers in sprites.values():
        layers.sort(key=lambda layer: layer["layer"] != "shadow")
    return sprites


def reference_layers(entry, tile):
    scale = reference_scale(tile)
    result = []
    for index in entry["indices"]:
        path = ROOT / "reference" / "sprites" / entry["group"] / f"{index}.png"
        source = Image.open(path).convert("RGBA")
        image = source.resize((round(source.width * scale), round(source.height * scale)), Image.Resampling.NEAREST)
        result.append((index, [{
            "image": image,
            "x": -image.width / 2,
            "y": -image.height,
            "footprint": (source.width + 2) / tile["pitchWidth"],
            "layer": "body",
        }]))
    return result


def sides(footprint):
    if isinstance(footprint, (list, tuple)):
        return footprint
    return footprint, footprint


def compose(layers, bounds, scale):
    left, top, right, bottom = bounds
    canvas = Image.new("RGBA", (math.ceil((right - left) * scale), math.ceil((bottom - top) * scale)))
    for layer in layers:
        image = layer["image"]
        size = (max(1, round(image.width * scale)), max(1, round(image.height * scale)))
        image = image.resize(size, Image.Resampling.NEAREST)
        canvas.alpha_composite(image, (round((layer["x"] - left) * scale), round((layer["y"] - top) * scale)))
    return canvas


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("out", type=Path)
    parser.add_argument("kinds", nargs="*")
    parser.add_argument("--atlas", type=Path, default=ROOT / "public/assets/structures")
    parser.add_argument("--zoom", type=int, default=2)
    parser.add_argument("--overlay", action="store_true")
    args = parser.parse_args()
    if args.zoom < 1:
        parser.error("--zoom must be a positive integer")

    reference = json.loads((ROOT / "pipeline/reference.json").read_text())
    tile = reference["tile"]
    atlas = atlas_layers(args.atlas)
    rows = []
    for key, entry in reference["buildings"].items():
        if not entry["indices"] or (args.kinds and key not in args.kinds and key.split(":")[0] not in args.kinds):
            continue
        if key not in atlas:
            raise ValueError(f"Missing baked asset: {key}")
        originals = reference_layers(entry, tile)
        rows.append((key, atlas[key], originals))
    if not rows:
        parser.error("No matching reference entries")

    layers = [layer for _, ours, originals in rows for group in [ours, *[layers for _, layers in originals]] for layer in group]
    bounds = (
        math.floor(min(layer["x"] for layer in layers)) - 8,
        math.floor(min(layer["y"] for layer in layers)) - 8,
        math.ceil(max(layer["x"] + layer["image"].width for layer in layers)) + 8,
        math.ceil(max(layer["y"] + layer["image"].height for layer in layers)) + 8,
    )
    scale = args.zoom / reference_scale(tile)
    cell_width = math.ceil((bounds[2] - bounds[0]) * scale)
    cell_height = math.ceil((bounds[3] - bounds[1]) * scale) + 28
    count = max(1 + len(originals) * (2 if args.overlay else 1) for _, _, originals in rows)
    sheet = Image.new("RGBA", (cell_width * count, cell_height * len(rows)), BACKGROUND)
    draw = ImageDraw.Draw(sheet)
    for row, (key, ours, originals) in enumerate(rows):
        own_image = compose(ours, bounds, scale)
        footprint = next(layer["footprint"] for layer in ours if layer["layer"] == "body")
        width, depth = sides(footprint)
        panels = [(f"ours {key} [{width}x{depth}]", own_image)]
        for index, layers in originals:
            original = compose(layers, bounds, scale)
            panels.append((f"original #{index} (sprite)", original))
            if args.overlay:
                panels.append(("50% overlay", Image.blend(own_image, original, 0.5)))
        for column, (label, panel) in enumerate(panels):
            sheet.alpha_composite(panel, (column * cell_width, row * cell_height + 28))
            draw.text((column * cell_width + 6, row * cell_height + 6), label, fill="white")
    args.out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(args.out)
    print(args.out)


if __name__ == "__main__":
    main()

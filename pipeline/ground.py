"""Generate a set of ground tiles for one terrain class and measure it against the original.

    python3 pipeline/ground.py grass                 # generate, cut, measure
    python3 pipeline/ground.py grass --measure-only  # re-measure the last run

The original 4x4 patch is sent with its tile seams blurred away, so the model
paints one continuous surface. That surface is cut into 16 diamonds at game
density. Pass/fail is numeric: median colour, luminance and grain within a
tolerance of pipeline/palette.json. Local only.
"""

import argparse
import base64
import io
import json
import random
from pathlib import Path
from statistics import mean, median, pstdev

from PIL import Image, ImageDraw, ImageFilter

from generate_study import ROOT, STUDIES, call_api
from terrain_probe import PATCH, PITCH, SCALE, TILE_H, TILE_W, cut_tiles, lay_patch, tile_index

LUMINANCE_TOLERANCE = 0.10
GRAIN_TOLERANCE = 0.35
DRIFT_LIMIT = 1.6

PROMPT = (
    "A flat ground texture for a 2D city-building game set in ancient Greece, seen straight from above at a "
    "slight tilt. The image is a low-resolution sample of the surface. Repaint it as one continuous high-resolution "
    "hand-painted surface with exactly the same colours, the same overall brightness and the same amount of "
    "small-scale variation: {character}. It must be a uniform, seamless field: no grid, no lines, no edges, no "
    "gradient across the image, no objects and no text. Fill the whole square image edge to edge."
)

CHARACTER = {
    "grass": "dark saturated olive grass, rough and uneven: dense clumps of blades with pale dry tips and near-black shadow between the clumps every few pixels, high contrast, nothing smooth or soft",
    "meadow": "sun-bleached ochre scrub with sparse dry grass tufts and a few tiny pebbles, no rocks or boulders",
    "bare": "dry trodden ochre earth with faint pebbles and dust",
}


def luminance(rgb):
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]


def measure(tiles):
    """Same numbers palette.py computes for the originals."""
    per_tile = [[p[:3] for p in t.getdata() if p[3] == 255] for t in tiles]
    everything = [p for tile in per_tile for p in tile]
    return {
        "median": "#%02x%02x%02x" % tuple(int(median(p[c] for p in everything)) for c in range(3)),
        "luminance": round(mean(luminance(p) for p in everything), 1),
        "grainWithinTile": round(mean(pstdev(luminance(p) for p in tile) for tile in per_tile), 1),
        "driftBetweenTiles": round(pstdev(mean(luminance(p) for p in tile) for tile in per_tile), 1),
    }


def verdict(result, target):
    checks = {
        "luminance": abs(result["luminance"] - target["luminance"]) / target["luminance"] <= LUMINANCE_TOLERANCE,
        "grain": abs(result["grainWithinTile"] - target["grainWithinTile"]) / target["grainWithinTile"] <= GRAIN_TOLERANCE,
        "drift": result["driftBetweenTiles"] <= max(2.0, target["driftBetweenTiles"] * DRIFT_LIMIT),
    }
    return checks, all(checks.values())


def score(result, target):
    return sum(abs(result[k] - target[k]) / max(target[k], 1) for k in ("luminance", "grainWithinTile", "driftBetweenTiles"))


SWATCH = 14
SOFTEN = {"grass": 0, "meadow": 1, "bare": 2}


def balance(tiles, measured, target):
    """A single multiplicative levels adjustment so the set's mean luminance matches the
    original's. The model paints consistently darker than its reference; this is the
    only colour operation applied, and it is recorded."""
    factor = target["luminance"] / measured["luminance"]
    if abs(factor - 1) < 0.02:
        return tiles, 1.0
    lut = [min(255, round(value * factor)) for value in range(256)]
    balanced = []
    for tile in tiles:
        channels = tile.split()
        balanced.append(Image.merge("RGBA", tuple(c.point(lut) for c in channels[:3]) + (channels[3],)))
    return balanced, round(factor, 3)


def seamless_reference(tiles, rng, soften):
    """A texture swatch with no geometry in it: small squares sampled from inside the original
    diamonds, laid in a rotated, jittered mosaic and softened, so the model sees only the surface."""
    mosaic = Image.new("RGBA", (1024 + 2 * SWATCH * SCALE, 1024 + 2 * SWATCH * SCALE), (0, 0, 0, 255))
    step = SWATCH * SCALE
    for y in range(0, mosaic.height, step // 2):
        for x in range(0, mosaic.width, step // 2):
            tile = tiles[rng.randrange(len(tiles))]
            cx, cy = tile.width // 2, tile.height // 2
            swatch = tile.crop((cx - SWATCH // 2, cy - SWATCH // 2, cx + SWATCH // 2, cy + SWATCH // 2))
            swatch = swatch.resize((step, step), Image.Resampling.NEAREST if not soften else Image.Resampling.BICUBIC).rotate(rng.choice((0, 90, 180, 270)))
            mask = Image.new("L", (step, step), 0)
            ImageDraw.Draw(mask).ellipse((0, 0, step - 1, step - 1), fill=255)
            mask = mask.filter(ImageFilter.GaussianBlur(step / 6))
            mosaic.paste(swatch, (x + rng.randrange(-step // 4, step // 4), y + rng.randrange(-step // 4, step // 4)), mask)
    square = mosaic.crop((step, step, step + 1024, step + 1024))
    if soften:
        square = square.filter(ImageFilter.GaussianBlur(soften))
    square.putalpha(Image.new("L", square.size, 255))
    return square


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("terrain", choices=list(CHARACTER))
    parser.add_argument("--model", default="gpt-image-2.5-sunburst")
    parser.add_argument("--quality", default="medium")
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--measure-only", action="store_true")
    parser.add_argument("--attempts", type=int, default=1, help="generate this many and keep the best-scoring")
    args = parser.parse_args()

    reference = json.loads((ROOT / "pipeline" / "reference.json").read_text())["terrain"][args.terrain]
    target = json.loads((ROOT / "pipeline" / "palette.json").read_text())["terrain"][args.terrain]
    rng = random.Random(args.seed)
    indices = tile_index(reference)
    originals = [Image.open(ROOT / "reference" / "sprites" / reference["group"] / f"{i}.png").convert("RGBA") for i in indices]
    originals = [t for t in originals if t.size[0] == TILE_W and t.size[1] <= TILE_H + 4]
    order = [rng.randrange(len(originals)) for _ in range(PATCH * PATCH)]
    out_dir = STUDIES / "ground"
    out_dir.mkdir(parents=True, exist_ok=True)
    source = out_dir / f"{args.terrain}-source.png"

    sources = sorted(out_dir.glob(f"{args.terrain}-source-[0-9]*.png")) or [source]
    if not args.measure_only:
        square = seamless_reference(originals, rng, SOFTEN[args.terrain])
        square.save(out_dir / f"{args.terrain}-guide.png")
        sources = []
        for attempt in range(args.attempts):
            result, request_id = call_api(PROMPT.format(character=CHARACTER[args.terrain]), [square], args.model, args.quality)
            path = out_dir / f"{args.terrain}-source-{attempt}.png"
            path.write_bytes(base64.b64decode(result["data"][0]["b64_json"]))
            (out_dir / f"{args.terrain}-request-{attempt}.json").write_text(json.dumps({"model": args.model, "quality": args.quality, "requestId": request_id, "usage": result.get("usage")}, indent=2))
            sources.append(path)

    candidates = []
    for path in sources:
        repaint = Image.open(path).convert("RGBA")
        repaint.putalpha(Image.new("L", repaint.size, 255))
        for cut_scale in (2, 3, 4):
            patch_w, patch_h = round(PATCH * PITCH * cut_scale), round(PATCH * TILE_H * cut_scale)
            patch = repaint.crop(((1024 - patch_w) // 2, (1024 - patch_h) // 2, (1024 + patch_w) // 2, (1024 + patch_h) // 2))
            cut = cut_tiles(patch, cut_scale)
            candidates.append((score(measure(cut), target), cut_scale, cut, path))
    _, cut_scale, tiles, chosen = min(candidates, key=lambda c: c[0])
    if chosen != source:
        source.write_bytes(chosen.read_bytes())
    tiles, factor = balance(tiles, measure(tiles), target)
    for index, tile in enumerate(tiles):
        tile.save(out_dir / f"{args.terrain}-{index}.png")

    measured = measure(tiles)
    checks, passed = verdict(measured, target)
    (out_dir / f"{args.terrain}.json").write_text(json.dumps({"tiles": len(tiles), "cutScale": cut_scale, "source": chosen.name, "luminanceFactor": factor, "measured": measured, "target": target, "checks": checks, "passed": passed}, indent=2))

    shuffled = [rng.randrange(len(tiles)) for _ in range(PATCH * PATCH)]
    left, right = lay_patch(originals, shuffled, 3), lay_patch(tiles, shuffled, 3)
    sheet = Image.new("RGBA", (left.width + right.width + 30, left.height + 24), (60, 60, 60, 255))
    sheet.alpha_composite(left, (0, 24))
    sheet.alpha_composite(right, (left.width + 30, 24))
    draw = ImageDraw.Draw(sheet)
    draw.text((6, 6), f"original {args.terrain}  lum {target['luminance']} grain {target['grainWithinTile']}", fill="white")
    draw.text((left.width + 36, 6), f"generated  lum {measured['luminance']} grain {measured['grainWithinTile']}  {'PASS' if passed else 'FAIL'}", fill="white")
    sheet.save(out_dir / f"{args.terrain}-retile.png")
    print(json.dumps({"terrain": args.terrain, "cutScale": cut_scale, "measured": measured, "target": {k: target[k] for k in ("median", "luminance", "grainWithinTile", "driftBetweenTiles")}, "checks": checks, "passed": passed}, indent=2))


if __name__ == "__main__":
    main()

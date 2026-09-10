"""Pack passing ground studies into public/assets/ground.png for the terrain atlas.

    python3 pipeline/pack_ground.py

Only classes whose ground.py run passed are packed. Each class contributes its
16 diamonds at atlas density (2x). The mapping from study class to the game's
terrain kind is explicit because the names disagree: the game's "grass" is the
original's ochre scrub, its "meadow" the original's green grass.
"""

import json
from pathlib import Path

from PIL import Image

from generate_study import ROOT, STUDIES

PIXEL_GRAIN = 2
TILE_W, TILE_H = 60, 30
GAME_KIND = {"bare": 0, "grass": 1}
OUT = ROOT / "public" / "assets"


def main():
    ground = STUDIES / "ground"
    packed = {}
    tiles = []
    for study, kind in GAME_KIND.items():
        report = ground / f"{study}.json"
        if not report.exists() or not json.loads(report.read_text())["passed"]:
            print(f"{study}: no passing run, kind {kind} stays procedural")
            continue
        variants = sorted(ground.glob(f"{study}-[0-9]*.png"), key=lambda p: int(p.stem.rsplit("-", 1)[1]))
        packed[kind] = {"study": study, "first": len(tiles), "count": len(variants)}
        tiles.extend(variants)
    if not tiles:
        print("nothing to pack")
        return

    cell_w, cell_h = TILE_W * PIXEL_GRAIN, TILE_H * PIXEL_GRAIN
    sheet = Image.new("RGBA", (cell_w * len(tiles), cell_h), (0, 0, 0, 0))
    for index, path in enumerate(tiles):
        tile = Image.open(path).convert("RGBA")
        sheet.alpha_composite(tile.resize((cell_w, cell_h), Image.Resampling.NEAREST), (index * cell_w, 0))
    OUT.mkdir(parents=True, exist_ok=True)
    sheet.save(OUT / "ground.png")
    (OUT / "ground.json").write_text(json.dumps({
        "image": "ground.png", "tileWidth": TILE_W, "tileHeight": TILE_H, "density": PIXEL_GRAIN,
        "kinds": {str(kind): entry for kind, entry in packed.items()},
    }, indent=2))
    print(f"packed {len(tiles)} ground tiles for kinds {sorted(packed)}")


if __name__ == "__main__":
    main()

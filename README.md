# Zeus — Master of Olympus (web)

A browser city builder in the spirit of Impressions' *Zeus: Master of Olympus*.
Isometric, tile-based, and built around the walker model that defines the original:
buildings do not serve a radius, they send people down roads.

```bash
npm install
npm run dev      # http://localhost:5180
npm run test     # unit tests (bun)
npm run smoke    # headless render + simulation check (needs a dev server running)
```

## Controls

| Input | Action |
| --- | --- |
| Left drag | Use the selected tool (roads follow an L-path) |
| Right / middle drag | Pan |
| WASD / arrows | Pan |
| Wheel | Zoom |
| `R`, `B`, `1`–`5`, `X` | Select tool |
| `O` | Appeal overlay |
| Space | Pause |

## What is simulated

- **Terrain**: grass, meadow (farms only), sand, rock, water, over 5 elevation levels.
- **Roads**: the only network. Everything social flows along it. A roadblock turns
  roaming walkers back without stopping anyone walking to a destination, so a block
  can be sealed off from wandering vendors while carts still reach it.
- **Distribution**: farms cart wheat to a granary in cartloads; an agora sends
  deliverymen to fetch a cartload (100 units) and peddlers to sell it door to door.
  A granary on its own feeds nobody. An agora runs three stalls, so three walkers at
  once; every other building sends one.
- **Walkers**: they leave and re-enter their building by its *exit point* — the first
  road found clockwise from north of the footprint — except a fountain's carrier,
  which comes home to the tile due north. Roamers walk out their range (water carrier
  27 tiles, vendor 44) serving houses beside the road, then take the shortest road
  home. Everyone moves at a citizen's 54.4 tiles a month. Cart pushers route with BFS
  to a granary.
- **Housing**: Shack → Hovel → Tenement → Homestead, gated on supplied services
  and, from Tenement up, on local appeal. Houses devolve when their tier's needs
  lapse or their surroundings decay.
- **Appeal**: Zeus's band model. Every building carries `INI, SZE, STP, RNG` and
  contributes `INI + STP * floor((d - 1) / SZE)` to each tile within `RNG` rings of
  its footprint — a fountain gives 4,4,2,2, a granary −12,−10,−8,−6. Housing itself
  is a source: shacks push their neighbours down and stop doing so as they evolve,
  so a block that improves keeps improving.
- **Labour**: a share of the population works — 37% at no wages up to 52% at very
  high, as on Mortal difficulty. Buildings are staffed in priority order, and an
  understaffed one runs at the fraction it is staffed to; an empty one stands idle.
- **Taxation**: a tax office sends a clerk roaming 35 tiles; only the houses he has
  passed pay. The bill is Zeus's `TRM × people × rate`, where the multiplier is 1 for
  a shack or hovel and 2 above, and the rate runs from none to outrageous.
- **Economy**: build costs, monthly taxes and a monthly wage bill.

## Architecture

```
src/sim/      headless simulation — no Pixi imports
  grid.ts         typed-array layers (terrain, height, road, roadblock, occupant, appeal)
  world.ts        fixed 20 Hz tick, placement, production, changed-tile tracking
  walkers.ts      spawn + movement + service delivery
  pathing.ts      road BFS, exit points, roaming
  time.ts         tick and month constants
  housing.ts      evolution rules
  appeal.ts       band model field
  labour.ts       wage levels, workforce, staffing
  taxation.ts     tax rates, tier multipliers, collection
  mapgen.ts       seeded terraced terrain
src/render/
  iso.ts          tile metric (120x60, 22px per elevation step) and height-aware picking
  canvas.ts       Canvas2D surfaces, sun model, lighting maths
  atlas.ts        procedural terrain/road/water/cliff atlas — one texture, one draw call
  textures.ts     per-building sprites drawn under a fixed sun
  baked.ts        loads Blender-rendered sprites when present, else falls back
  terrain.ts      tile sprites, edge blending, cliff faces, water animation
  scene.ts        buildings, walkers, particles, overlays
  atmosphere.ts   colour grade, bloom, vignette
  particles.ts    chimney smoke and cart dust
src/ui/         DOM overlay
pipeline/       Blender → sprite atlas asset pipeline
```

The simulation is deterministic per tick and independent of frame rate; rendering
reads it and never writes to it.

## How the graphics work

Nothing is hand-drawn. Two sources feed the same sprite interface:

1. **Procedural** — Canvas2D draws every tile, building and walker at load time.
   Terrain is packed into a single atlas so thousands of tiles cost one draw call.
   Adjacent terrain types blend across their shared edge with a gradient-masked
   copy of the neighbour, so there are no hard diamonds.
2. **Baked** — `pipeline/` renders 3D models in Blender and packs them into
   `public/assets/structures.png`. If that file exists the game prefers it.

**Lighting is baked, not shaded at runtime.** One fixed sun — 42° up, 125° round —
lights every model in Blender, which buys directional light and real contact
shadows without a normal-mapped shader, and works identically for procedural and
Blender-rendered art. A `ColorMatrixFilter` warms the whole world, with bloom and
a vignette on top.

Body and shadow are baked as **separate sprites** so a shadow can be drawn in its
own layer beneath every building. In one sprite a long shadow paints over the
neighbour it should fall behind.

Elevation is a real terrain layer: tiles are offset vertically, cliff faces are
drawn as affine-transformed rock sprites down to each lower neighbour, buildings
require level ground, and picking walks height levels from high to low so the
cursor lands on the surface you can actually see.

## Asset pipeline

```bash
npm run render   # Blender: body and shadow for every model at 2x (~50s)
npm run pack     # Pillow: downsamples, trims, packs, computes anchors

# iterate on one thing without re-rendering the rest
blender --background --python pipeline/iso_render.py -- --out pipeline/out \
  --only house-2,granary --samples 8
```

`--only` merges into the existing manifest, so one model is seconds rather than
a minute.

Renders are Cycles on the GPU at `SUPERSAMPLE = 2`, `SAMPLES = 16`. Both were 4x/48:
at final sprite size the difference is a mean of 0.3/255, and the full run went from
22 minutes to 1m40s. Rendering several models in parallel processes is *slower* than
one sequential process — they contend for the same GPU. `--samples` and `--device`
override per run.

```bash
python3 pipeline/sheet.py /tmp/sheet.png              # every sprite over its tile diamond
bun scripts/noon.mjs http://localhost:5180 out.png 400 [zoom] [liveMs]  # in-game shot; liveMs runs the sim first (~20 ticks/s)
```

One model unit is one tile side, so a 1×1 building's walls should stay inside
±0.5. `add_box` takes full extents; cones and cylinders take radii.

Material colours are written in sRGB and converted to linear at the material
boundary — passing sRGB straight to Blender is what makes renders look washed out.

The camera is orthographic at yaw 45° and **elevation 30°** — the angle at which one
tile step projects to exactly `TILE_WIDTH/2` across and `TILE_HEIGHT/2` down, so
renders drop into the game's metric with no fudging. Anchors are derived
analytically from that camera rather than eyeballed. A Cycles shadow-catcher plane
becomes the shadow sprite, framed wide enough for the shadow the sun actually casts.

Models live in `pipeline/iso_render.py`: the four housing tiers, wheat farm, granary,
agora, tax office, fountain and statue, each rendered as a body and a shadow. Sprites are keyed by
`kind:variant:layer` — housing uses the tier as its variant.

To add a building: write a builder, register it in `MODELS`, re-run the two commands.
The game picks it up with no client changes.

## Roadmap

The full inventory lives in [docs/roadmap.md](docs/roadmap.md). Next up:

1. **Palace** — required before taxes or any military, as in the original.
2. **Second production chain** — olives → olive press → a second agora stall.
3. **Culture and gods** — sanctuaries, gods that visit and bless or curse.
4. **Campaign scaffolding** — scenario definitions, goals, ratings.

## Art licence

Original *Zeus* assets are copyrighted and are not used here. Everything shipped is
generated by the code in `src/render/` or by the Blender models in `pipeline/`.

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
| `I`, `R`, `B`, `1`–`7`, `X` | Select tool |
| Click with `I` | Inspect a building, road or tile |
| `Esc` | Back to inspect, close the popup |
| `O` | Appeal overlay |
| `H` | Hazard overlay |
| Space | Pause |

## What is simulated

- **Terrain**: grass, meadow (farms only), sand, rock, water, over 5 elevation levels.
- **Roads**: the only network. Everything social flows along it. A roadblock turns
  roaming walkers back without stopping anyone walking to a destination, so a block
  can be sealed off from wandering vendors while carts still reach it.
- **Goods**: two chains. Wheat farm → granary; growers' lodge → olive press → oil.
  Producers cart their output to whoever accepts it, and an agora sends deliverymen to
  fetch a cartload (100 units) from whoever supplies it. A granary on its own feeds
  nobody. An agora runs three stalls — three walkers at once, one peddler per good;
  every other building sends one walker.
- **Walkers**: they leave and re-enter their building by its *exit point* — the first
  road found clockwise from north of the footprint — except a fountain's carrier,
  which comes home to the tile due north. Roamers walk out their range (water carrier
  27 tiles, vendor 44) serving houses beside the road, then take the shortest road
  home. Everyone moves at a citizen's 54.4 tiles a month. Cart pushers route with BFS
  to a granary.
- **Housing**: a 2×2 plot evolving Hut → Shack → Hovel → Homestead → Tenement →
  Apartment → Townhouse (8 to 60 citizens), gated on supplied services — food, then
  water, then culture, then olive oil — and, from Homestead up, on local appeal.
- **Culture**: a college trains a philosopher and walks him to a podium; from there he
  roams 35 tiles teaching the houses he passes. A college with no podium sends nobody. Houses devolve when their tier's needs
  lapse or their surroundings decay.
- **Appeal**: Zeus's band model. Every building carries `INI, SZE, STP, RNG` and
  contributes `INI + STP * floor((d - 1) / SZE)` to each tile within `RNG` rings of
  its footprint — a fountain gives 4,4,2,2, a granary −12,−10,−8,−6. Housing itself
  is a source: shacks push their neighbours down and stop doing so as they evolve,
  so a block that improves keeps improving.
- **Goals**: a scenario gives the city something to be for — citizens, people housed at
  a tier or better, a good produced per year, drachmas in the treasury — tracked in a
  panel and announced when all of them are met.
- **Hazards**: every building accrues fire and damage risk each month at its own rate —
  an olive press far faster than a podium. At 100 it burns down or collapses. A
  maintenance office sends a superintendent 44 tiles, and he wipes both risks clean on
  everything he walks past. A city without one is gone within a few years.
- **Popularity and migration**: citizens no longer appear from nowhere. Each month the
  city is judged on wages, taxes, whether the houses that need food have it,
  unemployment and debt; settlers move into empty rooms when it is liked and leave when
  it is not. Build workplaces or the idle turn against you.
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
  hazards.ts      fire and collapse risk
  scenario.ts     goals and how they are measured
  popularity.ts   sentiment and migration
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
  particles.ts    chimney smoke and cart dust
src/ui/         DOM overlay
  hud.ts          top bar, tool panel, message scroll
  inspect.ts      what every building, tile and tool says about itself
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

**Lighting is baked, not shaded at runtime.** One fixed sun — 58° up, 125° round —
lights every model in Blender, which buys directional light and real contact
shadows without a normal-mapped shader, and works identically for procedural and
Blender-rendered art.

**There is no post-processing.** The original is flat, bright and high-key: no colour
grade, no bloom, no vignette. The sun sits high and near-white against a bright sky,
so shadows stay short and pale, terrain is a light straw-and-olive palette, and tiles
vary by a couple of percent rather than a fifth. Anything that reads as "cinematic"
reads as wrong.

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

Models live in `pipeline/iso_render.py`: the seven housing tiers, wheat farm, growers'
lodge, olive press, granary, agora, college, podium, maintenance office, palace, tax
office, fountain and statue, each rendered as a body and a shadow. Sprites are keyed by
`kind:variant:layer` — housing uses `tier * 2`, plus one for the mirrored copy.

Mirrored variants reflect across `x = -y`, and the reflection is **baked into the mesh
from `matrix_basis`**: an object matrix cannot hold a reflection, and `matrix_world` is
still stale for objects the builder has only just created — reading it collapses every
box back to the unit cube.

To add a building: write a builder, register it in `MODELS`, re-run the two commands.
The game picks it up with no client changes.

## Roadmap

The full inventory lives in [docs/roadmap.md](docs/roadmap.md). Next up:

1. **Gods** — sanctuaries, gods that visit and bless or curse.
2. **Military** — rabble and hoplites raised from housing, invasions that head for the palace.
3. **Campaign** — more than one scenario, episodes, ratings, failure conditions.

## Art licence

Original *Zeus* assets are copyrighted and are not used here. Everything shipped is
generated by the code in `src/render/` or by the Blender models in `pipeline/`.

# Zeus

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

- **Terrain**: a 120×120 map drawn from one of six landscapes, chosen by the seed — a
  river valley, a coast of bays, the high country, a wide plain, a lakeland, a
  headland — each with its own hills, rivers, lakes and shoreline. Meadow follows the
  water, gathering on the banks a river or lake has watered; rock breaks out in seams
  along the tops. Whatever the seed, the map is guaranteed fields to farm, rock to
  quarry, water to fish and a dry edge for the settlers to walk in by. The view opens
  on the ground behind the entry flag, where the city has to start.
- **Roads**: the only network, and they answer to appeal: a bare track where nothing
  stands, cobbles once the ground is worth two, marble slabs at twelve. A road repaves
  itself as the block around it improves. Everything social flows along it. A roadblock turns
  roaming walkers back without stopping anyone walking to a destination, so a block
  can be sealed off from wandering vendors while carts still reach it.
- **Goods**: two chains. Wheat farm → granary; growers' lodge → olive press → oil.
  Producers cart their output to whoever accepts it. A granary on its own feeds nobody.
- **The agora**: paving laid *along* a road rather than beside it — the road under it
  keeps working. An agora is 6×3 with three stalls on one side; a grand agora is 6×5
  with three stalls each side. Empty, it does nothing: the player puts vendors on the
  stalls — food, fleece, oil, wine, arms, horses — and each one costs four workers,
  sends a deliveryman for a cartload (100 units) from the nearest store that supplies
  it, then peddles it to the houses he passes. Every other building sends one walker.
- **Walkers**: they leave and re-enter their building by its *exit point* — the first
  road found clockwise from north of the footprint — except a fountain's carrier,
  which comes home to the tile due north. Roamers walk out their range (water carrier
  27 tiles, vendor 44) serving houses beside the road, then take the shortest road
  home. Everyone moves at a citizen's 54.4 tiles a month. Cart pushers route with BFS
  to a granary.
- **Housing**: a 2×2 plot, laid out by dragging the housing tool across the ground. A
  fresh plot is nothing but a rough square of stakes and surveyor's string: it asks
  nothing of the city, lends it no appeal and cannot catch fire until someone lives
  there. Once settled it evolves Hut →
  Shack → Hovel → Homestead → Tenement → Apartment → Townhouse (8 to 60 citizens).
  Each step asks for one thing more than the last: food, then water, then culture,
  then fleece, then olive oil, and at the top athletics and drama — and, from
  Homestead up, a decent appeal. A house emptied of people is a plot again.
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
- **Popularity and migration**: citizens never appear from nowhere. Each month the
  city is judged on wages, taxes, whether the houses that need food have it,
  unemployment and debt. When it is liked, settlers gather at the entry point — a fixed
  flag on the edge of the map — and walk in along the roads in parties of eight to fill
  the nearest empty plot; when it is not, emigrants walk out the same way. Run no road
  to the flag and nobody can reach you. Build workplaces or the idle turn against you.
- **Labour**: a share of the population works — 37% at no wages up to 52% at very
  high, as on Mortal difficulty. Buildings are staffed in priority order, and an
  understaffed one runs at the fraction it is staffed to; an empty one stands idle.
- **Taxation**: a tax office sends a clerk roaming 35 tiles; only the houses he has
  passed pay. The bill is Zeus's `TRM × people × rate`, where the multiplier is 1 for
  a shack or hovel and 2 above, and the rate runs from none to outrageous.
- **Economy**: build costs, monthly taxes and a monthly wage bill. A city taxed at the
  normal rate covers its wages and a little more, so an ordinary city can pay its way
  without trade.

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
  hud.ts          top bar and its dropdowns, tool panel, menu
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

**There is no post-processing.** No colour grade, no bloom, no vignette. The look is
measured from the original, not remembered — see [Reference](#reference) — and the
numbers in `pipeline/palette.json` are the target:

| | Original | Ours before the reference |
| --- | --- | --- |
| Grass | `#5a6318`, luminance 94, grain 25 | `#afb76a`, luminance 176, grain 8 |
| Deep water | `#296b73`, luminance 96 | `#79b2b2`, luminance 166 |
| Bare ground / meadow | `#c6ad52`, luminance 171 | — |
| Road | `#dece9c`, luminance 205 | — |
| Agora paving | `#f7efd6`, luminance 230 | — |

*Grain* is the per-pixel luminance deviation inside one tile. The original's grass is
dark, saturated and noisy: a mid-olive that reads almost brown, with tufts and
shadow every few pixels, so the tile grid disappears. Water is deep teal, not cyan.
Bare ground and roads are the bright things — the contrast the eye reads is dark
green against pale ochre, not pale green against paler ochre.

Buildings are painted texture on simple mass: every roof shows its tile rows, walls
are whitewash over stone with dirt at the base, and every plot is cluttered with
amphorae, fences, awnings, a tree. A 2×2 house stands about as tall as its plot is
wide (townhouse: 128 px on a 118 px tile). A clean box with a flat colour per face
is the single most common way to get it wrong.

Body and shadow are baked as **separate sprites** so a shadow can be drawn in its
own layer beneath every building. In one sprite a long shadow paints over the
neighbour it should fall behind.

Elevation is a real terrain layer: tiles are offset vertically, buildings require
level ground, and picking walks height levels from high to low so the cursor lands
on the surface you can actually see.

A drop is read from its rocks, as in the original. Each level of a cliff face is one
**band of boulders** — sheared along the edge but never stretched, so a two-level
drop stacks two bands rather than smearing one — and a rim of larger rocks and grass
tufts straddles the lip. Rock terrain, which cannot be built on, carries the same
stones scattered loose and outcrops of five boulders where the map generator clusters
them.

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
analytically from that camera rather than eyeballed: `pack.py` projects the
footprint's south vertex through the camera's own basis, whose up vector is
`(-sin e·sin yaw, sin e·cos yaw, cos e)` — an up vector that is not perpendicular
to the view direction lifts every sprite off its plot. A Cycles shadow-catcher plane
becomes the shadow sprite, framed wide enough for the shadow the sun actually casts.

Models live in `pipeline/iso_render.py`: the seven common housing tiers and four elite ones, wheat farm, growers'
lodge, olive press, vineyard, winery, carding shed, granary, agora, college, podium, gymnasium, drama school, theatre, stadium, maintenance office, palace, tax
office, trading post, infirmary, watchpost, twelve sanctuaries, hero hall, fountain
and statue, each rendered as a body and a shadow. Sprites are keyed by
`kind:variant:layer` — housing uses `tier * 2`, plus one for the mirrored copy.

Mirrored variants reflect across `x = -y`, and the reflection is **baked into the mesh
from `matrix_basis`**: an object matrix cannot hold a reflection, and `matrix_world` is
still stale for objects the builder has only just created — reading it collapses every
box back to the unit cube.

To add a building: write a builder, register it in `MODELS`, re-run the two commands.
The game picks it up with no client changes.

## Roadmap

The full inventory lives in [docs/roadmap.md](docs/roadmap.md). Next up:

1. **The Poseidon layer** — science track, hippodrome, orichalc, pyramids.
2. **Odds and ends** — colonies, city rotation, "go to" event jumps.

## Reference

A privately owned copy of the original lives, git-ignored, in `reference/`. It is a
reference point only: nothing from it is shipped, copied or traced. Every sprite we
make is our own model, checked against the original for scale, palette, texture
density and clutter.

```bash
unzip -q zeus.zip 'Zeus + Poseidon/DATA/*' -d reference && mv 'reference/Zeus + Poseidon' reference/og
python3 pipeline/sg_extract.py reference/og/DATA/Zeus_General.sg3 reference/og/DATA/Zeus_Terrain.sg3 \
  reference/og/DATA/SprMain.sg3 reference/sprites          # .sg3/.555 -> PNG + contact sheets
python3 pipeline/sg_look.py /tmp/look.png Zeus_General/Zeus_Housing 781-794 --zoom 3   # zoomed strip
python3 pipeline/compare.py /tmp/compare.png house granary  # ours beside the original, same diamond
python3 pipeline/palette.py                                 # measure -> pipeline/palette.json
```

`pipeline/reference.json` maps every kind we draw to the original's sprite indices
(`Zeus_General/Zeus_Housing/787` is the homestead). Entries marked *tentative* were
identified by eye from the contact sheets and may be off by one.

**Before finishing any art change, run `compare.py` for the kinds touched and look at
it.** Name three differences that remain. If the terrain changed, take a `noon.mjs`
shot and measure it against `palette.json`.

## Art licence

Original *Zeus* assets are copyrighted and are not used here. Everything shipped is
generated by the code in `src/render/` or by the Blender models in `pipeline/`. The
`reference/` folder is for looking at, never for shipping.

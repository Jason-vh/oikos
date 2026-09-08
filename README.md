# Zeus — Master of Olympus (web)

A browser city builder in the spirit of Impressions' *Zeus: Master of Olympus*.
Isometric, tile-based, and built around the walker model that defines the original:
buildings do not serve a radius, they send people down roads.

```bash
npm install
npm run dev      # http://localhost:5180
npm run smoke    # headless render + simulation check (needs a dev server running)
```

## Controls

| Input | Action |
| --- | --- |
| Left drag | Use the selected tool (roads follow an L-path) |
| Right / middle drag | Pan |
| WASD / arrows | Pan |
| Wheel | Zoom |
| `R`, `1`–`5`, `X` | Select tool |
| `O` | Desirability overlay |
| Space | Pause |

## What is simulated

- **Terrain**: grass, meadow (farms only), sand, rock, water, over 5 elevation levels.
- **Roads**: the only network. Everything social flows along it.
- **Walkers**: cart pushers route with BFS to a granary; food vendors and water
  carriers roam randomly and serve houses adjacent to the road they walk.
- **Housing**: Shack → Hovel → Tenement → Homestead, gated on supplied services
  and local desirability. Houses devolve when their tier's needs lapse.
- **Desirability**: a field recomputed from building influence with linear falloff.
- **Economy**: build costs and a monthly head tax.

## Architecture

```
src/sim/      headless simulation — no Pixi imports
  grid.ts         typed-array layers (terrain, height, road, occupant, desirability)
  world.ts        fixed 20 Hz tick, placement, production, changed-tile tracking
  walkers.ts      spawn + movement + service delivery
  pathing.ts      road BFS and roaming
  housing.ts      evolution rules
  desirability.ts influence field
  mapgen.ts       seeded terraced terrain
src/render/
  iso.ts          tile metric (120x60, 22px per elevation step) and height-aware picking
  canvas.ts       Canvas2D surfaces, sun model, lighting maths
  atlas.ts        procedural terrain/road/water/cliff atlas — one texture, one draw call
  textures.ts     per-building sprites baked per sun phase
  baked.ts        loads Blender-rendered sprites when present, else falls back
  terrain.ts      tile sprites, edge blending, cliff faces, water animation
  scene.ts        buildings, walkers, particles, overlays
  atmosphere.ts   day/night colour grading, bloom, vignette
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

**Lighting is baked per sun phase, not shaded at runtime.** Each building is drawn
six times across the day arc plus once at night, and the renderer cross-fades
between the two phases either side of the current time. That gives directional
light, moving shadows and lit windows after dark without a normal-mapped shader,
and it works identically for procedural and Blender-rendered art. Global time of
day is a `ColorMatrixFilter` over the world, with bloom and a vignette on top.

Body and shadow are baked as **separate sprites**. A building's silhouette is the
same at every sun angle, so bodies cross-fade exactly; shadows move, and kept in
the same sprite the outgoing one has nowhere to fade to — you see both shadows,
then one vanishes. Split, each layer dissolves cleanly. One day/night cycle is one
calendar month (1200 ticks, 60s at 1x).

Elevation is a real terrain layer: tiles are offset vertically, cliff faces are
drawn as affine-transformed rock sprites down to each lower neighbour, buildings
require level ground, and picking walks height levels from high to low so the
cursor lands on the surface you can actually see.

## Asset pipeline

```bash
npm run render   # Blender: renders each model at 2x across 7 sun phases (~1.5 min)
npm run pack     # Pillow: downsamples, trims, packs, computes anchors

# iterate on one thing without re-rendering the rest
blender --background --python pipeline/iso_render.py -- --out pipeline/out \
  --only house-2,granary --phases 6 --samples 8
```

`--only` and `--phases` merge into the existing manifest, so a night-lighting tweak
is seconds rather than minutes.

Renders are Cycles on the GPU at `SUPERSAMPLE = 2`, `SAMPLES = 16`. Both were 4x/48:
at final sprite size the difference is a mean of 0.3/255, and the full run went from
22 minutes to 1m40s. Rendering several models in parallel processes is *slower* than
one sequential process — they contend for the same GPU. `--samples` and `--device`
override per run.

```bash
python3 pipeline/sheet.py 2 /tmp/sheet.png            # every sprite over its tile diamond
bun scripts/noon.mjs http://localhost:5180 out.png 100 [zoom] [liveMs]  # in-game shot; tick 430/820/1030 = noon/dusk/night; liveMs runs the sim first (~20 ticks/s)
```

One model unit is one tile side, so a 1×1 building's walls should stay inside
±0.5. `add_box` takes full extents; cones and cylinders take radii.

Material colours are written in sRGB and converted to linear at the material
boundary — passing sRGB straight to Blender is what makes renders look washed out.

The camera is orthographic at yaw 45° and **elevation 30°** — the angle at which one
tile step projects to exactly `TILE_WIDTH/2` across and `TILE_HEIGHT/2` down, so
renders drop into the game's metric with no fudging. Anchors are derived
analytically from that camera rather than eyeballed. A Cycles shadow-catcher plane
puts real contact shadows in the sprite's alpha.

Models live in `pipeline/iso_render.py`: the four housing tiers, wheat farm, granary,
fountain and statue, each rendered across six day phases plus night. Builders receive
the phase, so windows can be given an emissive material after dark. Sprites are keyed
by `kind:variant:phase` — housing uses the tier as its variant.

To add a building: write a builder, register it in `MODELS`, re-run the two commands.
The game picks it up with no client changes.

## Roadmap

1. **Labour and employment** — buildings need workers drawn from housing.
2. **Second production chain** — olives → olive press → agora stalls.
3. **Agora** — vendors spawning from a market rather than the granary itself.
4. **Culture and gods** — sanctuaries, gods that visit and bless or curse.
5. **Save/load** — structured clone of world state into IndexedDB.
6. **Campaign scaffolding** — scenario definitions, goals, ratings.

## Art licence

Original *Zeus* assets are copyrighted and are not used here. Everything shipped is
generated by the code in `src/render/` or by the Blender models in `pipeline/`.

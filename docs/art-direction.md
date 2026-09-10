# Art direction — Oikos

This is the visual contract for `src/art/`. It exists so a future agent can add a
model, or judge whether one belongs, without re-litigating taste. `/miniature.html`
(`src/miniature/world.ts`) is the approved reference scene: chunky, sun-bleached,
hand-built low-poly Aegean harbour. **The user has explicitly said no more
detailing.** Every rule below exists to keep new work at the same level of finish as
that scene — not above it.

`src/art/` is the only source of models in this repo. `src/miniature/world.ts`
imports its decorative models (`house`, `temple`, `boat`, `citizen`, `tree`, `stall`,
etc.) straight from `../art` and renders them as the fixed harbour benchmark. The
playable game (`src/render/city.ts`) calls `getBuildingModel()` from the same library
to place buildings per tile. There is no second model source, and no pending swap —
this is the integrated state.

## What this is not

- Not sprites, not billboards, not photo textures. Every surface is a flat-shaded
  `MeshStandardMaterial` picked from the palette below.
- Not externally generated (no AI image/model generation, no downloaded asset packs).
  Every mesh is built in code from primitives in `src/art/primitives.ts`.
- Not photoreal. No PBR texture maps, no normal maps, no decals. Bevels and vertex
  colour are the entire toolkit for surface interest.
- Not a target for "more detail". A model that already reads correctly at the
  camera distances below (see "Lighting, camera and shading budget") is finished.
  Additional geometry that doesn't change the read at those distances is scope
  creep, not craft.

## Palette

Defined once in `src/art/primitives.ts` as `colors`, keyed by name, and never
duplicated as a raw hex elsewhere. Every model call picks a name, not a value.

| name | hex | role |
| --- | --- | --- |
| `plaster` | `#f3dfb5` | wall render, most common surface |
| `cream` | `#ffefcb` | trim, cornices, paving highlights |
| `stone` | `#c9b689` | plinths, bases, kerbs |
| `paving` | `#e1d0a7` | ground paving, courtyards |
| `roof` | `#b85e41` | terracotta roof body |
| `roofLight` | `#cf7851` | roof tile highlight / ridge |
| `roofDark` | `#9c503b` | roof shadow tone |
| `blue` | `#426f83` | Aegean-blue painted accents (shutters, banding, cloth) |
| `blueLight` | `#68919c` | secondary blue accent |
| `dark` | `#364d48` | deep shadow fill (door gaps, window recess) |
| `wood` | `#846347` | timber, posts, crates |
| `olive` | `#879557` | foliage mid tone |
| `oliveLight` | `#a2ae70` | foliage highlight |
| `oliveDark` | `#627a50` | foliage shadow |
| `grass` | `#a7ac73` | terrain grass band |
| `earth` | `#b0a17b` | terrain earth band, furrows |
| `gold` | `#d6ab53` | brass fittings, wheat, accents |
| `linen` | `#ffedc5` | sails, awning cloth |

Do not introduce a new colour without a reason a reviewer can see in the model it
serves; do not reuse a name for a different hex. If a model needs vertex colour
(the sail is the one precedent — see `src/art/ships.ts`), tint from this same
palette.

## Material and geometry conventions

- Every material is `MeshStandardMaterial({ color, roughness: 0.88 })`, cached once
  per colour in `primitives.ts`'s `material()`. Nothing sets `metalness` except the
  hand-tuned water shader in `src/miniature/world.ts` (outside `src/art`) — buildings
  and props stay matte.
- Bevels: `box()` defaults to a `0.045` bevel radius, clamped to a quarter of the
  smallest dimension so thin members don't self-intersect. Pass a different one only
  for a specific reason — the roof ridge cap and the window mullions use a tighter
  `0.02`/`0.01` bevel, the way the existing code already does.
- `RoundedBoxGeometry` is built with a single segment (`1`) — the facets are visible
  and that's correct. Do not raise segment counts to "smooth out" a bevel; that reads
  as a style change, not a bugfix.
- `post()` (cylinder, 8 radial segments) and `lump()` (dodecahedron) are the only
  round/organic primitives. They're deliberately faceted, not smoothed.

## Scale

- `CELL_SIZE = 1.25` (`src/sim/island.ts`) — one simulation tile in world units.
- `GROUND_Y = 1.15` (`src/sim/island.ts`) — the height of the playable island's
  ground plane. Models from `getBuildingModel()` are built with their own ground at
  local `y = 0`; the renderer (`src/render/city.ts`) places that group at world
  `y = GROUND_Y`. `src/art` never bakes `GROUND_Y` into a model's geometry.
- A citizen (`citizen()` in `src/art/people.ts`) stands about **1.1** units tall.
  Every other model is scaled to read correctly next to that figure — a door a
  citizen can walk through, a table at roughly waist height. When adding a model,
  eyeball it against `citizen()` before anything else.

## Footprint and orientation

Every playable building has a footprint defined once, in the simulation catalog
(`src/sim/catalog.ts`'s `BUILDINGS`, in whole tiles) and converted to world units by
multiplying by `CELL_SIZE`. `src/art/buildings.ts`'s `footprintSize(kind)` does this
conversion; nothing in `src/art` hardcodes a footprint size independently of it.

| kind | tiles | world units |
| --- | --- | --- |
| `house` | 3×3 | 3.75×3.75 |
| `farm` | 4×4 | 5×5 |
| `granary` | 3×3 | 3.75×3.75 |
| `agora` | 3×3 | 3.75×3.75 |
| `fountain` | 2×2 | 2.5×2.5 |
| `maintenance` | 2×2 | 2.5×2.5 |

Rules that every `getBuildingModel()` result follows, and that `src/art/models.test.ts`
enforces on every kind and tier:

- The model is centred at the origin (`x = 0, z = 0`) and its whole bounding box —
  walls, roof overhang, awnings, pots, crop rows, everything — sits inside that
  footprint. **No mesh may protrude into the tile outside it**, because that tile may
  be a road, and nothing here should overlap traffic. A 1cm tolerance is allowed for
  floating point, nothing more.
- The model's lowest point sits at `y ≈ 0` (within ~2cm) — it stands on its own
  footprint, doesn't float and doesn't sink.
- The model faces **+Z**. Doors, windows, awnings, stalls, crop rows — whatever
  reads as "front" — face positive Z. `src/render/city.ts` rotates the whole group
  per the building's placed `rotation` in the world; `src/art` never bakes a
  rotation in.

Decorative, non-catalog models (`tree`, `citizen`, `boat`, `temple`, `stall`, the
decorative `house()`) don't carry a simulation footprint and aren't subject to this
rule — they were part of the original approved scene and are preserved exactly as
they were.

## Housing tiers

`house` is the only kind whose look changes with `tier` (the other kinds are
functionally distinct enough — a farm vs. a granary — that they don't need a second
axis of visual change). The three tiers, built by `dwelling(tier)` in
`src/art/houses.ts`, are genuinely different massing, not palette swaps, while
staying inside the same footprint and the same visual language as the approved
prototype:

1. **Small dwelling** — one room, low eaves, a single window. The plainest silhouette.
2. **Cottage** — larger footprint, taller eaves, a door canopy, shutters on two
   faces. Reads as a step up without changing material language.
3. **Taller courtyard house** — two storeys (upper-floor windows, a banding course
   between floors) with a small paved rear yard behind a low wall. This is *not* the
   decorative scene's wide courtyard extension (`house()` variant 2, in
   `houses.ts`, preserved unchanged for `/miniature.html`) — that shape is wider
   than a 3×3 footprint allows. The playable tier keeps the two-storey silhouette
   and the idea of a private yard, sized to fit.

## Lighting, camera and shading budget

Set by the shared `Stage` (`src/render/stage.ts`), used by the game (`/`, built
around `src/render/city.ts` + `src/render/island.ts`), the harbour benchmark
(`/miniature.html`, `src/miniature/world.ts`), and the model viewer (`/art.html`,
`src/art-viewer.ts`). A model built without knowing how it'll be lit will look wrong
under it, so these are the settings all three run under:

- **Camera**: orthographic, `(-30, 30, 20, -20, .1, 350)`. `/miniature.html` has
  three fixed views — harbour (`target [-2,0,-4]`, closest), streets
  (`target [-1,1.5,2]`, closer still), archipelago (`target [4,0,-18]`, furthest);
  the model viewer uses its own close-in view (`target [-1.2,1.2,0]`, `size 11`)
  built for judging one building against a citizen. A model has to read at all of
  these; the model viewer's distance and the benchmark's streets view are the
  harshest tests.
- **Key light**: one `DirectionalLight` (`0xffe6bd`, intensity `3.5`) from
  `(-25, 42, 24)`, casting shadows (`2048²` shadow map, `PCFSoftShadowMap`,
  `shadowMap.autoUpdate = false`, refreshed on demand via `Stage.shadows()`).
- **Fill**: one `HemisphereLight` (`0xe7f1ee` / `0xb4a075`, intensity `2.1`).
- **Golden hour** (both benchmark and viewer have a toggle, `Stage.golden()`): sun
  colour `0xffc083`, position `y 22` (lower angle), intensity `3.8`; ambient
  intensity drops to `1.55`. A model should still read correctly under this, not
  just the default noon light.
- **Ambient occlusion**: a `GTAOPass` (radius `.65`, distance exponent `1.5`,
  thickness `1`, blend intensity `.65`), rendered at **70% of the display
  resolution** and upscaled — contact shadow is a cheap post-process, not geometry.
  Don't add extra small geometry purely to fake contact shadow; the AO pass is the
  budget for that.
- **Anti-aliasing**: 2x MSAA on a half-float render target (`EffectComposer`'s
  target has `samples: 2`), not a higher sample count — edges on a model are
  expected to show some aliasing at this budget, not to be perfectly smooth.
- **Tone mapping**: ACES Filmic, exposure `1.18`.
- **Render loop**: the renderer only redraws on invalidation (an orbit change, a
  world update, a toggled control), not continuously. While the game is running and
  unpaused, world state updates and the resulting redraw are capped to 30fps —
  there is no budget for a model whose *appearance* depends on being drawn at a
  higher frame rate (no per-frame shader animation beyond the existing water/sail
  treatment in `world.ts`, which isn't part of `src/art`).

None of this is `src/art`'s to change — it's recorded here so a new model can be
sanity-checked against it (e.g. "does this read under a low, warm key light from the
west, at 70%-resolution AO") without booting the renderer.

## Topology and draw-call budget

Every primitive call (`box`, `post`, `lump`, `roof`, `pot`, …) that shares a colour
shares a material; `bake()` merges everything of one material into one draw call.
Measured against the current models (reproducible with the snippets in
`docs/art-tooling.md`):

| model | draw calls (materials) | triangles |
| --- | --- | --- |
| decorative `house()`, variant 0 | 11 | ~6,900 |
| decorative `house()`, variant 1 | 10 | ~9,100 |
| decorative `house()`, variant 2 (courtyard) | 15 | ~7,400 |
| `temple()` | 8 | ~11,500 |
| `boat()` | 6 | ~1,000 |
| `citizen()` | 6 | ~950 |
| `getBuildingModel('house', 1)` | 8 | ~3,600 |
| `getBuildingModel('house', 2)` | 10 | ~5,600 |
| `getBuildingModel('house', 3)` | 10 | ~8,000 |
| `getBuildingModel('farm')` | 10 | ~4,800 |
| `getBuildingModel('granary')` | 10 | ~4,600 |
| `getBuildingModel('agora')` | 3 | ~350 |
| `getBuildingModel('agora', 1, true)` (with vendor stall) | 9 | ~2,850 |
| `getBuildingModel('fountain')` | 6 | ~230 |
| `getBuildingModel('maintenance')` | 9 | ~3,100 |

`src/art/models.test.ts` enforces a ceiling of **16 draw calls** and **12,000
triangles** per `getBuildingModel()` result — generous headroom above every measured
model above, tight enough to fail loudly if a future change (e.g. raising a bevel
segment count, or looping a decoration too many times) quietly balloons a model past
the existing complexity.

## Model creation / editing workflow

1. Decide which file the model belongs in (see "Library layout" in
   `docs/art-tooling.md`) and sketch its shape against a citizen and its footprint
   (see above) before writing geometry.
2. Build with the primitives in `src/art/primitives.ts` only — `box`, `post`, `lump`,
   `roof`, `pot`, `group`, `mesh` — picking colours from `colors`. Don't reach for a
   raw `THREE.BoxGeometry` or a literal hex unless the primitive genuinely can't do
   the job (the boat hull, the sail, the temple pediment are the existing precedents
   for a bespoke `Shape`/`ExtrudeGeometry`).
3. If the model is a `getBuildingModel()` kind, build it inside its own
   `T.Group()` with everything centred on the origin and the front on +Z, then call
   `bake()` on the top-level group before returning it (see `buildings.ts` for the
   pattern) — this is what makes `disposeModel()` safe (see `docs/art-tooling.md`).
4. Check it against its footprint. The fastest way, with no renderer needed:
   ```ts
   import * as T from 'three';
   import { getBuildingModel } from './src/art/buildings';
   const box = new T.Box3().setFromObject(getBuildingModel('house', 3));
   console.log(box.min, box.max);
   ```
   or just run `bun test src/art` — the footprint test fails with the offending
   kind/tier named.
5. Look at it. `/art.html` (the model viewer, `src/art-viewer.ts`) — pick a
   kind/tier from the dropdown, see it against a citizen and its dashed footprint
   outline, with a live triangle/mesh count, wireframe toggle, turn/reset and
   golden-hour controls — is the fast per-model loop. `/miniature.html` is the full
   scene and the final check, since a model that's fine alone can still clash once
   it's sitting between the others.
6. Capture before and after with `npm run art:capture` (see
   `docs/art-tooling.md`) and compare the two sets of screenshots by eye. If the
   harbour, streets or archipelago views read differently from the previous capture
   at a glance, figure out why before moving on — either the change is a deliberate,
   signed-off shift in the scene, or the model regressed.

## Screenshot acceptance

A model (or a change to `src/art/primitives.ts` that everything else depends on)
is acceptable when, captured at all three of `/miniature.html`'s fixed camera views
— harbour, streets, archipelago (`src/miniature/main.ts`'s `views`) — it:

- sits fully inside its footprint with no visible gap or overlap onto neighbouring
  road tiles,
- reads at the same level of finish as the buildings already in the scene: no
  smoother, no flatter, no more or less ornamented,
- keeps the palette above — no new colours, no gradient/texture maps,
- doesn't change the silhouette or palette of anything not being worked on.

There is no screenshot committed to this repo to diff against — `artifacts/` (where
`npm run art:capture` writes) is gitignored. A reviewer capturing locally, comparing
the new set against a capture taken before the change, is the review process; see
`docs/art-tooling.md`.

## Model stages

`getBuildingModel(kind, { tier, vendorEnabled, stage, stores })` builds the model
for a simulation state: `stage` (0–3) drives wheat height and colour on a farm;
`stores` fills the granary yard (nine slots) and the agora stall (three slots) with
one bundle per 100 units of a food. `src/art/food.ts` owns each food's signature
(wheat sheaves, carrot crates, fish and meat racks, olive jars) — keep bundles under
a cell wide and readable at city zoom. A state change swaps the model, so variants
must stay cheap and inside the footprint. Citizens are built by
`figure()` with separate leg and arm groups; `animateFigure()` swings them.

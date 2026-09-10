# Art library tooling — `src/art/`

This is the "how it's built and wired" companion to `docs/art-direction.md` (read
that first for what a model should look like). This one is for whoever next touches
`src/art/`, or its callers in `src/miniature/world.ts`, `src/render/city.ts`,
`src/render/island.ts`, and `src/art-viewer.ts`.

## Library layout

```
src/art/
  primitives.ts   colours, cached materials/geometries, mesh/box/post/lump/group,
                  bake(), roof(), pot(), disposeModel(), releaseModelGeometries()
  houses.ts       house() — the decorative signature used by /miniature.html —
                  plus dwelling(tier) for getBuildingModel('house', tier)
  vegetation.ts   tree(); wheatFarm() for getBuildingModel('farm')
  people.ts       citizen()
  ships.ts        boat()
  temple.ts       temple(), stall() — the decorative shrine and the market stall,
                  the latter reused by getBuildingModel('agora', ..., vendorEnabled)
  civic.ts        fountain(), granary(), maintenance() — the small catalog buildings
  buildings.ts    footprintSize(kind), getBuildingModel(kind, tier, vendorEnabled) —
                  the dispatcher all callers use
  index.ts        the public surface — see "Callers" below
  models.test.ts  bun:test coverage — footprint, ground, vertex integrity,
                  draw-call/triangle budgets, disposal ownership
```

`src/art` is the only model source in this repo — there is no parallel or legacy
copy. `src/sim/types.ts` and `src/sim/catalog.ts` are read from (`BuildingKind`,
`BUILDINGS`) but never edited — footprint numbers come from there, once, so they
can't drift out of sync.

## Callers

`src/miniature/world.ts` (the `/miniature.html` benchmark) imports the decorative
names directly:

```ts
import { bake, boat, box, citizen, colors, group, house, lump, mesh, post, pot, releaseModelGeometries, stall, temple, tree } from '../art';
```

and builds the fixed harbour scene with them — this is the approved reference, not
something `src/art` drives.

`src/render/city.ts` (the playable game) calls `getBuildingModel()` per placed
building:

```ts
import { getBuildingModel, disposeModel } from '../art';

const model = getBuildingModel(building.kind, building.tier, building.vendorEnabled);
model.position.set(point.x, GROUND_Y, point.z);
model.rotation.y = -building.rotation * Math.PI / 2;
this.stage.scene.add(model);
// when the building is removed:
entry.model.removeFromParent();
disposeModel(entry.model);
```

- `kind: BuildingKind`, `tier: 1 | 2 | 3 = 1`, `vendorEnabled = false`. Only `house`
  varies by tier today; the other kinds accept a tier argument for signature
  stability but currently render the same model regardless of it. `vendorEnabled`
  only affects `agora` (installs `stall()`, or leaves the paving empty).
- The returned group is centred at the origin, grounded at local `y = 0`, facing
  +Z — position, rotate and add it exactly like any other `THREE.Group`.
- Building this way is a handful of `RoundedBoxGeometry`s and one `mergeGeometries()`
  call — cheap enough to call per placement, and `city.ts` does exactly that: a
  fresh `getBuildingModel()` call for every building, never `Object3D.clone()` of a
  cached instance. **Don't `clone()` a `getBuildingModel()` result to place a second
  instance and then `disposeModel()` the clone.** Three's `clone()` doesn't
  deep-clone geometry, so a clone shares its baked `BufferGeometry` objects with the
  original; disposing the clone would free the original's GPU buffers too.
  `getBuildingModel()` is cheap specifically so this trap doesn't need a
  workaround — `city.ts`'s own walker system (below) is the one place in this repo
  that does clone a template, and it correspondingly never disposes the clones.

`src/art-viewer.ts` (`/art.html`) drives `getBuildingModel()` the same way, per
dropdown selection, cloning each mesh's material (never its geometry) so a
per-instance wireframe toggle doesn't touch the shared palette, then disposing
those material clones itself before calling `disposeModel()` on the old group.

`city.ts`'s walker system (`walkerModel()`) caches one template `citizen()` group
per `WalkerKind` and reuses `.clone()`d references for every walker on the road,
never calling `disposeModel()` on those clones — the caution above, applied: a
clone shares its template's baked geometry, so disposing a clone would break every
other walker still using it.

## Resource ownership and `disposeModel()`

Three categories of resource exist here, and they're never mixed:

1. **Shared palette materials** (`primitives.ts`'s `materials` map, one
   `MeshStandardMaterial` per colour, created by `material()`). Every mesh this
   library ever creates gets its material from this cache. These are never disposed
   by anything in this library — not `disposeModel()`, not `releaseModelGeometries()`
   — because every model in a running scene shares them.
2. **Shared primitive template geometries**: the cached `RoundedBoxGeometry`s in
   `box()`'s `geometries` map, plus the module-level `cylinder` (used by `post()`)
   and `foliage` (used by `lump()`). Each is tagged `geometry.userData.sharedPrimitive
   = true` the moment it's created. Before a group is baked, its meshes reference
   these shared geometries directly.
3. **Owned, per-instance geometry**: what `bake()` produces. `bake()` clones every
   mesh's geometry, strips everything but `position`/`normal`, merges same-material
   clones into one `BufferGeometry` per material, and replaces the group's contents
   with those merged meshes. Each merged `BufferGeometry` is unique to that call —
   never aliased with the shared cache, never shared between two calls to
   `getBuildingModel()`. Anything built outside `bake()` with a bespoke
   `THREE.BufferGeometry`/`ExtrudeGeometry`/`ShapeGeometry`/`TorusGeometry` (the
   boat's hull, deck and sail; the temple's pediment and medallion) is likewise
   never shared, so it's safe to treat as owned too.

`disposeModel(group)` walks a group's mesh subtree and disposes every geometry that
is **not** tagged `sharedPrimitive` — category 3, never category 2, and it never
touches a material at all (never category 1). This is correct regardless of whether
the group passed in was ever baked: an un-baked group (raw `box()`/`post()`/`lump()`
calls, never merged) still only has its owned geometry disposed, and its shared
template geometry survives untouched, because the tag — not "did this pass through
`bake()`" — is what `disposeModel()` actually checks. `src/art/models.test.ts`
exercises exactly this un-baked case directly.

`disposeModel()` **only disposes geometry** — it never calls `group.clear()`,
never removes children, never touches `scene.remove()`. Freeing GPU resources and
taking the group out of the scene graph are two different jobs; the caller does the
second one, in whichever order suits it (both `city.ts` and `art-viewer.ts` remove
the group from its parent/scene, then call `disposeModel()` — either order is fine,
since disposal doesn't depend on the group still being in the scene).

`getBuildingModel()` always calls `bake()` on its result before returning, so in
practice a model built through it is one or a handful of independent, fully-owned
meshes — cheap to `disposeModel()`, safe to drop and rebuild as often as needed.

`releaseModelGeometries()` is the coarser tool `world.ts` uses for the decorative
scene: it disposes every cached shared primitive geometry (category 2) and clears
the caches. It's meant to be called once, after every model that will ever be built
in a session has been built and baked (as `world.ts` does, at the end of scene
construction) — calling it earlier just means the next `box()`/`post()`/`lump()`
call quietly rebuilds the cache entry. It never touches materials either.

## Model viewer (`/art.html`) and benchmark (`/miniature.html`)

Both share `Stage` (`src/render/stage.ts`) with the playable game.

- `/miniature.html` (`src/miniature/world.ts` + `src/miniature/main.ts`) is the
  approved full-scene prototype and remains the benchmark for "does this still look
  like the approved study". `main.ts`'s `views` defines the three fixed camera
  presets (harbour, streets, archipelago) and the pause/golden-hour toggles.
- `/art.html` (`src/art-viewer.ts`) is the focused model viewer built around
  `getBuildingModel()`: a dropdown over every kind/tier/vendor combination, a
  citizen for scale, a dashed footprint outline at the model's exact catalog size,
  live triangle/mesh-count metrics, a wireframe toggle, turn/reset camera controls
  and the same golden-hour toggle as the benchmark. It is the fast per-model loop
  described in `docs/art-direction.md`'s workflow section.

## Executable validation

- **`bun test src/art`**, wired as **`npm run art:check`**, is the real, run-it-now
  check for everything in `docs/art-direction.md`'s footprint/ground/topology
  rules, plus the resource-ownership contract above (`src/art/models.test.ts`). It
  needs nothing but this repo's `node_modules` — no renderer, no browser, no GPU.
- **`npm run art:capture`** runs `scripts/art-capture.mjs` against a running dev
  server (`npm run dev`, `http://localhost:5180` by default — pass a different base
  URL as the first CLI argument, and an output directory as the second). It drives
  `/miniature.html` and `/art.html` headlessly with Playwright and writes PNGs to
  `artifacts/art/` (gitignored — nothing here is committed as a reference; see
  "Screenshot acceptance" in `docs/art-direction.md`):
  - `harbour.png`, `streets.png`, `archipelago.png` — the benchmark's three fixed
    camera views.
  - `golden-hour.png` — the harbour view with the golden-hour toggle on.
  - `model-<kind>-<tier>.png` for every `/art.html` dropdown option (`house-1`,
    `house-2`, `house-3`, `farm-1`, `granary-1`, `agora-1`, `agora-2`, `fountain-1`,
    `maintenance-1`).
  - `wireframe.png` — a model with the wireframe toggle on, mid-turn.
  - `atelier-mobile.png` — `/art.html` at a 390×844 viewport.

  Alongside the captures, the script asserts: the benchmark reaches
  `data-ready="true"` with no console/page errors; dragging the camera changes it
  and "Reset view" restores the exact preset; the paused benchmark renders zero
  extra frames over several animation frames, and "Resume life" makes it render
  again; `/art.html` reaches `data-ready`/`data-model` correctly for every
  selection; the static model viewer never renders on its own; neither page reads
  or writes the game's own save key, and neither leaks `window.thalassa` onto
  itself. A failing assertion here is a real regression, not a flaky screenshot
  diff.

## Testing conventions used in `models.test.ts`

- Every `(kind, tier, vendorEnabled)` combination `getBuildingModel()` actually
  supports is generated once and asserted against: footprint containment (1cm
  tolerance), ground contact (`y ≈ 0`, 2cm tolerance), finite vertices (catches NaNs
  from a bad `Math.atan2`/normalize before they reach a renderer), and the
  draw-call/triangle budgets from `docs/art-direction.md`.
- The decorative originals (`house()`, `temple()`, `stall()`, `tree()`, `citizen()`,
  `boat()`) are smoke-tested for the same vertex-integrity and budget properties —
  not re-asserting their exact shape (that's what a human-reviewed capture from
  `npm run art:capture` is for).
- `bake()`'s handling of the boat's vertex-coloured sail is tested directly: the sail
  mesh must carry a `color` attribute the same length as its `position` attribute,
  and no other mesh in the boat should have one — proving `bake()`'s
  attribute-stripping (`position`/`normal` only) correctly excludes the sail rather
  than silently discarding its colours, because the sail is added to the group
  *after* `bake()` runs (see `ships.ts`).
- Resource ownership is tested with `BufferGeometry`/`Material`'s native `'dispose'`
  event, not by inspecting internal state: attach a listener before calling
  `disposeModel()`, assert it fired for owned geometry and never fired for a shared
  primitive or a shared material.

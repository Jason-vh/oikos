# Art library tooling — `src/art/`

This is the "how it's built and wired" companion to `docs/art-direction.md` (read
that first for what a model should look like). This one is for whoever next touches
`src/art/`, or integrates it into the game/renderer/benchmark/model viewer.

## Library layout

```
src/art/
  primitives.ts   colours, cached materials/geometries, mesh/box/post/lump/group,
                  bake(), roof(), pot(), disposeModel(), releaseModelGeometries()
  houses.ts       house() — the original decorative signature, unchanged — plus
                  dwelling(tier) for getBuildingModel('house', tier)
  vegetation.ts   tree(); wheatFarm() for getBuildingModel('farm')
  people.ts       citizen()
  ships.ts        boat()
  temple.ts       temple(), stall() — the decorative shrine and the market stall,
                  the latter reused by getBuildingModel('agora', ..., vendorEnabled)
  civic.ts        fountain(), granary(), maintenance() — the small catalog buildings
                  that didn't exist as standalone models before this library
  buildings.ts    footprintSize(kind), getBuildingModel(kind, tier, vendorEnabled) —
                  the dispatcher new code should call
  index.ts        the public surface — see "Integrating this into the game" below
  models.test.ts  bun:test coverage — footprint, ground, vertex integrity,
                  draw-call/triangle budgets, disposal ownership
```

`src/miniature/models.ts` is untouched and still works standalone; this library is a
parallel extraction, not a replacement of it in place. `src/sim/types.ts` and
`src/sim/catalog.ts` are read from (`BuildingKind`, `BUILDINGS`) but never edited —
footprint numbers come from there, once, so they can't drift out of sync.

## Integrating this into the game

`src/miniature/world.ts` currently does:

```ts
import { bake, boat, box, citizen, colors, group, house, lump, mesh, post, pot, releaseModelGeometries, stall, temple, tree } from './models';
```

Every one of those names is re-exported with the same signature from
`src/art/index.ts`. Swapping the import to:

```ts
import { bake, boat, box, citizen, colors, group, house, lump, mesh, post, pot, releaseModelGeometries, stall, temple, tree } from '../art';
```

is a drop-in change — nothing else in `world.ts` needs to move. That edit belongs to
the parent project (this library doesn't touch `src/miniature/*`), and is how the
decorative scene keeps working unchanged while the new playable-building code lives
alongside it.

For the new playable buildings:

```ts
import { getBuildingModel, disposeModel } from '../art';
import type { BuildingKind } from '../sim/types';

const model = getBuildingModel(kind, tier, vendorEnabled);
model.position.set(worldX, GROUND_Y, worldZ);
model.rotation.y = rotationToRadians(building.rotation);
scene.add(model);
// later, if the building is removed:
scene.remove(model);
disposeModel(model);
```

- `kind: BuildingKind`, `tier: 1 | 2 | 3 = 1`, `vendorEnabled = false`. Only `house`
  varies by tier today; the other kinds accept a tier argument for signature
  stability but currently render the same model regardless of it. `vendorEnabled`
  only affects `agora` (installs `stall()`, or leaves the paving empty).
- The returned group is centred at the origin, grounded at local `y = 0`, facing
  +Z — position, rotate and add it exactly like any other `THREE.Group`.
- Building this way is a handful of `RoundedBoxGeometry`s and one `mergeGeometries()`
  call — cheap enough to call per placement. **Caching is optional, not required.**
  If the parent caches one instance per `(kind, tier, vendorEnabled)` to reuse across
  many placements, do that by positioning multiple references to the *same* object in
  different scenes/times if the renderer supports it, or by calling
  `getBuildingModel()` again per placement — **don't `Object3D.clone()` a cached
  model to place a second instance and then `disposeModel()` the clone**. Three's
  `clone()` doesn't deep-clone geometry, so a clone shares its baked
  `BufferGeometry` objects with the original; disposing the clone would free the
  original's GPU buffers too. `getBuildingModel()` is cheap specifically so this
  trap doesn't need a workaround.

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

`getBuildingModel()` always calls `bake()` on its result before returning, so in
practice a model built through it is one or a handful of independent, fully-owned
meshes — cheap to `disposeModel()`, safe to drop and rebuild as often as needed.

`releaseModelGeometries()` is the old, coarser tool from `src/miniature/models.ts`,
kept with its original signature and behaviour for `world.ts`'s sake: it disposes
every cached shared primitive geometry (category 2) and clears the caches. It's
meant to be called once, after every model that will ever be built in a session has
been built and baked (as `world.ts` already does, at the end of scene construction) —
calling it earlier just means the next `box()`/`post()`/`lump()` call quietly rebuilds
the cache entry. It never touches materials either.

## Model viewer (`/art.html`) and benchmark (`/miniature.html`)

- `/miniature.html` (`src/miniature/`) is the existing, approved full-scene
  prototype and remains the benchmark for "does this still look like the approved
  study" — it is **owned by the parent project**, not this library, and this
  worktree does not add or modify it.
- `/art.html`, a focused model viewer built around `getBuildingModel()` (one
  building, all kinds/tiers/vendor states, rotate/inspect in isolation) is planned
  but **does not exist in this worktree**. It's called out in
  `docs/art-direction.md` as the fast per-model check because the parent project is
  building it around this library's `getBuildingModel()` export — this doc
  describes the contract it should render against, not a shipped page.

## Executable validation

- **`bun test src/art`** is the real, working, run-it-now check for everything in
  `docs/art-direction.md`'s footprint/ground/topology rules, plus the resource
  ownership contract above. It requires nothing but this repo's `node_modules`
  (`npm ci` in this worktree) — no renderer, no browser, no GPU.
- **`npm run art:check`** is the name this should eventually answer to, so "run the
  art check" doesn't require knowing it's a `bun test` call today. **It is not wired
  in this worktree's `package.json`** — the `art:check` script that exists there
  predates this library (a Python/Blender pipeline check, unrelated). Pointing
  `npm run art:check` at `bun test src/art` is a one-line `package.json` change for
  whoever owns that file next; nothing here claims it's already done.
- **`npm run art:capture`** — regenerating `public/art/harbour.png` (and any future
  pinned screenshots) needs a browser/WebGL context this library doesn't have access
  to and doesn't own. `scripts/smoke.mjs` in the parent project already does headless
  rendering of the main game and is the closest existing precedent for how this
  would work. **This script does not exist yet**; it's scoped here, not built here.

## Testing conventions used in `models.test.ts`

- Every `(kind, tier, vendorEnabled)` combination `getBuildingModel()` actually
  supports is generated once and asserted against: footprint containment (1cm
  tolerance), ground contact (`y ≈ 0`, 2cm tolerance), finite vertices (catches NaNs
  from a bad `Math.atan2`/normalize before they reach a renderer), and the
  draw-call/triangle budgets from `docs/art-direction.md`.
- The decorative originals (`house()`, `temple()`, `stall()`, `tree()`, `citizen()`,
  `boat()`) are smoke-tested for the same vertex-integrity and budget properties,
  proving the extraction didn't silently corrupt them — not re-asserting their exact
  shape (that's what the human-reviewed screenshot is for).
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

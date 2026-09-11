# Multiplayer: several islands, one map

Each player settles their own island on a shared map, keeps their own treasury,
and trades by sea. A shared sea rather than a world per player: one coordinate
space keeps `src/sim/grid.ts`, pathing, picking and rendering as they are, and it
makes a trade ship a walker crossing real water instead of a menu.

## Decisions

- Separate treasuries, one per player.
- You may only build on the island you have claimed.
- Old saves are migrated, not dropped.
- Island count set by what the renderer can afford.

## What the simulation already gives us

`src/sim/` meets the requirements for networked play without changes:

- `advance(world, seconds)` ticks a fixed `STEP = 0.25` and stores `remainder`;
  no wall clock inside the simulation.
- No `Math.random` anywhere. All variation comes from `hash(x, z, seed)`.
- `World` is plain JSON. `serializeWorld` is `JSON.stringify`; `deserializeWorld`
  already validates hostile input, which is both the join path and the
  anti-cheat boundary.
- Mutations are six functions: `build`, `placeRoadPath`, `demolish`, `setVendor`,
  `setHarbourTrade`, `buildStarterNeighbourhood`.
- No DOM or Three.js imports, so a server imports the simulation verbatim.

Verified: two `createWorld(2)` worlds advanced 300 s serialize identically.

One caveat. `src/sim/wildlife.ts` uses `Math.sin`, `Math.cos`, `Math.atan2` and
`Math.hypot`, which are implementation-defined and can differ between browser
engines, so bit-exact lockstep across engines is not safe. Island generation is
safe: `hash` and `Math.sqrt` only. Either keep the server authoritative with
snapshot resync, or make wildlife table-driven.

## What blocks several islands today

- `generateIsland` calls `floodLargest` (`src/sim/island.ts`), which discards
  every landmass but the largest. One island per map is deliberate.
- The map is a fixed 72×56 with a single `entry` on the widest south shore.
- Nothing in `World` has an owner; there is one `money`, and `getSummary`
  aggregates the whole map.

## Measured budget

Seed 1, one island, 72×56:

| | |
|---|---|
| `generateIsland` | 3.7 ms |
| land tiles | 2114 |
| terrain meshes / triangles | 10 / 8k |
| full scenery meshes | 1699 |
| scenery triangles | 125k |
| snapshot after 10 minutes | 38 KB, mostly 187 animals |

Triangles and simulation cost are immaterial. Draw calls decide the island
count: `src/render/island.ts` builds one baked `T.Group` per forest, scrub and
cliff tile — 961 of them — because each needs its own transform for the felling
animation and its own `visible` flag. Shadows draw each twice. Four islands
would be roughly 6800 calls.

**Today's ceiling is two islands, and it is a rendering accident rather than a
design limit.**

## Instanced decor

Decor variety is small and enumerable — tree, cypress, bush variants, cliff
outcrop, rocks — and all per-tile variation is scale and rotation jitter, which a
per-instance matrix carries. Bake each variant once per material, then one
`InstancedMesh` per variant and material: felling writes one instance matrix,
an occupied tile zeroes its instance scale. That is roughly 20–30 draw calls per
island instead of 1699, flat in map size, with the art and the fall animation
unchanged.

Six to eight islands then become affordable, and the limit moves to wildlife and
city buildings, which scale with what players build rather than with the sea.

## Generation by stamping

Built, and larger than first proposed. Each island is a full `generateIsland` run
on its own grid, stamped into a shared 538×230 map at a slot in a four-by-two
layout with eighteen-tile channels, sizes and offsets jittered from the seed.
Islands are 112×88 before jitter — about 5,600 land tiles each against 2,100
before — for around 40,000 land tiles in the sea. Generation costs 50 ms.

On all eight tested seeds the map holds exactly eight separate landmasses, each
with a harbour entry on land, and a road network can never leave its own island.

The save migration did not survive contact: a bigger home island is different
ground, so a stored city cannot be put back on it. Saves before version 4 are
refused with a message that says why, and the old migration chain — unreachable
once every earlier version is refused — went with it.

## Ownership as data

`world.players: { id, name, money }[]`, an `ownerId` on buildings and road
tiles, islands claimed by a player, and `getSummary(world, playerId)`. Staffing,
immigration, vendor circuits and connectivity are already bounded by water per
island, so most of the simulation needs no change — it needs to stop summing
across everything.

Sea trade then reuses the trade-order machinery in `src/sim/harbour.ts`:
harbour-to-harbour ship walkers between two islands on the same map.

## Everything up to the network is single-player

Multi-island maps, ownership and sea trade are all playable solo — you own one
island, the others sit empty — and testable headless with `bun test`. The
networked layer stays thin and goes last, on a simulation that already has
players in it.

## Stacked merge requests

0. **Instanced island decor and wildlife, throttled shadows.** Done on
   `perf/render-budget`. Render only, a single-player win on its own, unlocks the
   rest. Exposes per-frame draw calls and triangles on the debug object, and adds
   `npm run art:diff` to prove a rendering change left the picture alone.
1. **Stamped multi-island map** plus save migration by island offset.
2. **Players, treasuries, ownership**; placement restricted to your own island.
3. **Sea trade**: harbour-to-harbour ship walkers and trade orders between
   islands.
4. **Networking**: a command union and `applyCommand`, a Bun WebSocket room that
   sequences commands into `{ tick, commands }` frames and owns speed and pause,
   clients replaying frames with optimistic local apply, snapshot on join, world
   hash comparison for drift and snapshot resync on mismatch. Deployment gains
   one service beside Caddy (`deploy/`).

## Other performance gains on the table

Measured on seed 1 with the starter neighbourhood after ten simulated minutes.
Ordered by expected win. **The first three have landed on `perf/render-budget`**:
in the walkthrough's built-up city, draw calls per frame fell from **5468 to 381**
and the frame gap at the 90th percentile from 16.1 ms to 10.3 ms, with the
captures unchanged but for a fading toast.

1. **The shadow map is rebuilt 30 times a second over the whole scene.**
   `shadowMap.autoUpdate` is correctly off, but `src/main.ts` calls
   `stage.shadows()` on every animation tick, so a 2048² PCF map re-renders
   every shadow caster — terrain quads, all 1699 decor meshes, every building —
   because a walker moved. Separate the static casters from the moving ones:
   refresh the map when structure changes (build, demolish, fell, golden hour)
   and stop walkers and animals from driving it. Close to a halving of frame
   time, with no visual change.
2. **Wildlife costs as much as the island does.** 1040 draw calls for 187
   animals. See below.
3. **Instanced decor**: 1699 meshes to roughly 20–30. See above.
4. **Scene content per island, built lazily.** With several islands, only build
   scenery and wildlife for islands in or near view, and dispose the rest. This
   is what keeps eight islands affordable no matter how detailed one island is.
5. **Static transforms.** `matrixAutoUpdate` is never disabled anywhere, so
   Three.js recomputes world matrices for every static object each render. Terrain,
   decor and roads never move. Pure CPU win, growing with object count.
6. **GTAO.** A full-screen pass at 0.7 pixel ratio is the largest GPU cost on a
   modern machine; `?noao` already exists to measure it. Worth re-checking the
   resolution and radius against how visible the effect is at city zoom.
7. **Road geometry is rebuilt whole-map on any change**, keyed by
   `world.roads.join(',')` recomputed every sync. Trivial today (42 tiles,
   2.1 ms) but it scales with every player's roads at once. Chunk roads per
   island, rebuild only the dirty chunk, and key on a version counter.
8. **Allocation churn.** `sync` and `animate` allocate a `Vector3` and a
   position object per animal and walker four times a second. Reuse scratch
   vectors.
9. **Walkers and buildings are now the remaining cost.** With decor and wildlife
   instanced, the 381 calls left are mostly ten meshes per walker — articulated,
   so exactly the case `src/render/wildlife.ts` already solves — and about nine
   per building, which bakes by material and could merge further.

Not problems:

- **Simulation**: 30 µs per 0.25 s step with nine buildings, four steps a
  second; 332 µs across the archipelago, of which wildlife is almost all —
  stepping 3,700 animals costs 0.7 ms per simulated second against 0.008 ms for
  everything else. Invisible while playing, but it is why tests that advance
  twenty simulated minutes now need a longer timeout, and it is the first thing
  to make cheaper if the clock ever matters. Even a hundredfold city leaves it invisible. The thing to watch as
  cities grow is the BFS per walker dispatch (`findNearestConnected`,
  `buildServiceCircuit`); cache reachable sets per island, invalidated on road
  change.
- **Saving**: `serializeWorld` is 0.1 ms for 38 KB. Fine even eight times over.

## Wildlife rendering

Seed 1 at spawn, one island:

| kind | animals | meshes each | meshes total | triangles each |
|---|---|---|---|---|
| boar | 31 | 8 | 248 | 1044 |
| rabbit | 100 | 6 | **600** | 792 |
| fish | 48 | 3 | 144 | 180 |
| gull | 8 | 6 | 48 | 612 |
| | **187** | | **1040** | ~110k total |

`CityScene.syncAnimal` clones a per-kind template and adds it to the scene. The
clone cannot be baked flat, because `animateAnimal` rotates individual parts —
legs, wings, tails — every frame, and `bake` splits a part by material anyway, so
a boar is four body meshes plus four legs.

Two things stand out. Triangles are irrelevant: 110k for all wildlife, less than
one island's decor. And rabbits are 100 of the 187 animals and 58% of the draw
calls, while being 13 cm of painted toy that resolves to a few pixels at city
zoom.

**Culling alone does not fix it.** At the default view the camera spans roughly
60 tiles, so 140 of 187 animals are already on screen. Frustum culling buys a
quarter. It is worth having for the neighbours' islands, not for this.

**Per-part instancing does fix it.** Animation is rigid per part, so each
(kind, part, material) becomes one `InstancedMesh` whose instance matrix is the
animal's transform composed with that part's animated local transform:

- 1040 draw calls become **23**, the sum of the parts across four species.
- The pool is global, so it stays 23 with eight islands and 1500 animals.
- The per-frame CPU work is ~1100 matrix writes, flatter and cheaper than
  walking 187 nested groups and touching their world matrices.
- Hidden and dying animals stay expressible: `respawn > 0` is a zero-scale
  instance, and the death roll and sink are just the matrix.

Picking survives untouched: animals are picked by projecting their positions to
screen space (`CityScene.pick`), not by raycast, and hunter facing reads a
position. Keep positions in the entry record and those call sites change by a
line each.

As built on `perf/render-budget`:

- `src/render/instances.ts` holds the shared machinery: batches keyed by geometry
  and material, slots that can be written, hidden and handed back.
- `src/render/wildlife.ts` keeps one scratch model per species, poses it with the
  unchanged `animateAnimal`, and copies the resulting world matrices into
  instances. The animation code did not have to be rewritten, and the poses are
  identical to the ones the cloned models produced.
- `CityScene` keeps its own per-animal interpolation and now stores a position
  rather than a model, which is all `pick`, `hover` and hunter facing needed.
- Wildlife draws in 23 calls, and the same 23 whatever the animal count.
- A detail threshold could still drop rabbits and fish at far zoom, but that is a
  judgement call at normal city zoom, not a given.

## What the archipelago cost

Nothing, so far, at the frame level. With eight islands and about 3,700 animals:

| | one island | archipelago | zoomed out over the sea |
|---|---|---|---|
| draw calls | 381 | 393 | 575 |
| frame gap p90 | 10.3 ms | 10.2 ms | 10.8 ms |
| simulation step | 30 µs | 332 µs | — |

What it took beyond the generator:

- **The sun's shadow camera follows the view.** It was fixed at ±44 around the
  world origin, which covered the old single island exactly and would have left
  the rest of a 670-unit sea unshadowed.
- **Pan bounds come from the map** rather than a hardcoded 65-unit radius, and
  `minZoom` drops from .65 to .25 so a player can pull back and see a neighbour.
- **Decor instances are chunked** into 48-tile fields with their own bounding
  spheres, so off-screen ground is culled instead of submitted. Instance writes
  became targeted buffer ranges rather than whole-buffer uploads.
- **Wildlife and foam have a sight radius.** Animals beyond it hand back their
  instance slots and stop being posed; foam ribbons beyond it stop animating.
  Both follow the camera target, with hysteresis so nothing thrashes at the edge.

## Open questions

- Whether the sea wants haze: distant islands stay legible to about 300 units, so
  a wide view submits geometry it barely shows. Denser fog with a nearer far plane
  would cull it, at the cost of how the archipelago reads from above.
- Whether wildlife becomes table-driven for bit-exact lockstep, or stays as is
  behind an authoritative server.
- How a player claims an island, and what a lobby looks like before any city
  exists.

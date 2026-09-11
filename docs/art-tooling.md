# Art tooling — `src/art/`

How models are built, wired and checked. Read `art-direction.md` first.

## Layout

```
src/art/
  primitives.ts   colours, cached materials, box/post/lump/group/mesh, roof, pot,
                  bake(), disposeModel()
  houses.ts       dwelling(tier), dwellingPieces()
  assembly.ts     assemblyPart() timing, shellWalls() overlapping wall layout
  scaffolding.ts  scaffolding(width, depth, height) — struck once a building stands
  civic.ts        fountain, maintenance, lodge, woodcutter, stockpile, and their pieces
  granaries.ts    granary(stores), granaryPieces(stores)
  stall.ts        the agora's market stall, counter/posts/awning/goods
  food.ts         resource bundles (wheat, carrots, fish, meat, olives, lumber, clay,
                  stone), bundlesOf(stores, slots), bundleKey()
  cliffs.ts       inward-carved terrace faces and clustered limestone outcrops
  coast.ts        seeded shoreline profiles, carved faces and continuous shallows
  foam.ts         painted breakers that ride the shoreline's foot and shallows
  vegetation.ts   tree(), wheatFarm(stage)
  bushes.ts       bush(shape), seeded scrub pockets and smaller clifftop cushions
  people.ts       figure(colour, load) with legs/arms, animateFigure(), animateWork()
  animals.ts      boar, rabbit, fish, gull, animateAnimal()
  ships.ts        boat()
  buildings.ts    getBuildingModel(kind, { tier, vendorEnabled, stage, stores }),
                  getBuildingAssembly(kind, state)
  index.ts        public surface
  models.test.ts  footprint, ground contact, budgets, disposal ownership
```

## Ownership

- Palette materials are shared and never disposed.
- Primitive template geometries (box/post/lump caches) are shared; `bake()` copies
  vertex data out of them, so a baked model owns its geometry.
- `disposeModel(group)` disposes owned geometry only; it does not remove the group
  from the scene. Callers remove first, then dispose.
- Walker and animal templates are cloned per instance and never disposed
  individually (`src/render/city.ts` caches one template per kind and load).
- `getBuildingModel` is built fresh per placed building and disposed when the
  building's state key changes.
- `bake()` releases the source's owned geometry after copying it; shared primitive
  templates and palette materials remain untouched.
- A construction assembly is temporary geometry, owned by its `BuildingConstruction`
  and disposed the moment the building stands.

## Construction

Every placeable kind is raised piece by piece. `<model>Pieces()` names the parts and
their timing; `src/render/assembly.ts` seats them, raises the scaffolding and puffs
dust as each piece lands, then swaps to the ordinary material-batched model.

- The choreography is a **parallel authoring**, not a decomposition. The finished
  model must never pay for it: build both from the same dimension constants and the
  same finishing helpers, and keep the split geometry out of `getBuildingModel`.
- **Overlap, never butt.** A piece's cut ends belong inside its neighbour, or the two
  bevels leave a groove down the middle of a face and the shading shifts at the swap.
  `shellWalls()` lays out four overlapping walls for anything with a box body.
- `modelAssembly(false)` for what is laid out rather than raised — the farm, the
  agora — which skips the scaffolding.
- `dust: true` marks a piece heavy enough to raise dust; finishing touches do not.
- Tier upgrades keep the old settle-in pop: an evolution is not a construction. The
  harbour is never placed, so it has no choreography.
- Loaded cities and reduced-motion placement show completed models; paused placement
  still assembles. Construction is presentation only, never saved and never a
  simulation timer.
- `src/art/assembly.test.ts` holds every kind to the finished model's bounds and
  palette, and to its footprint at every pose and rotation.

## Adding a model

1. Build it from primitives in the relevant file, front facing `+Z`, ground at `y=0`.
2. Wire it in `buildings.ts` (or the walker/animal switch in `city.ts`).
3. Add an option to `art.html` and to the list in `scripts/art-capture.mjs`.
4. `npm run art:check` — footprint and budget tests cover every catalog kind.
5. Look at it in `/art.html` and in the game; compare captures.

## Tools

- **`/art.html`** (`src/art-viewer.ts`): the atelier. Footprint border, grid, scale
  citizen, wireframe, turntable, golden hour, animated walk/flap cycles. The chosen
  model is kept in `?model=…` so reloads and links preserve it. Every placeable
  building offers construction replay and a reversible progress slider, scaffolding
  and dust included — this is where timing is judged. Replay is disabled for reduced
  motion; manual scrubbing remains available without autoplay.
- **`npm run art:check`**: `bun test src/art`.
- **`npm run art:capture -- <base url>`**: captures every atelier model to
  `artifacts/art/`, including bushes and outcrops from four sides, and asserts the
  atelier stays still when nothing animates, keeps
  the selection in the URL across a reload, and never touches the game's save.
- **`npm run smoke:construction -- <base url>`**: assembly captures from four sides
  and at city zoom, one midway capture per kind, replay/scrub checks, idle rendering,
  reduced motion, paused placement, same-island checkpoint restore and atelier save
  isolation. Output: `artifacts/construction/`.
- **`npm run coast:capture -- <base url> [output] [seeds…]`**: coastlines on seeds
  1, 2, 8 and 37, from four sides and with the grid, plus the seed-1 village.
  Also use these views to judge inland cliffs and scrub in context.
  Uses isolated browser storage and checks paused rendering and unchanged simulation.
  Requires the dev server. Output: `artifacts/coast/`.
- **`npm run terrace:capture -- <base url> [output]`**: inland cliffs from four
  sides, before and after laying stairs through an outcrop, plus a close-up.
  Checks paused rendering and unchanged simulation. Output: `artifacts/terraces/`.
- **`npm run smoke:foam -- <base url>`**: breakers animate while running, freeze
  when paused, behind the menu and under reduced motion, and never render while idle.
  Output: `artifacts/foam/`.
- **`npm run smoke`** and **`npm run check`**: the gameplay walkthrough
  (`scripts/smoke.mjs`), which is where models are judged in context.

`artifacts/` is gitignored; compare a capture against your previous local capture.

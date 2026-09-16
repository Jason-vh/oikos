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
  roads.ts        connected outlines and seeded limestone flags
  stairs.ts       full-cell flights, inset cliff walls and terrain cuts
  cliffs.ts       inward-carved terrace faces and clustered limestone outcrops
  coast.ts        seeded shoreline profiles, carved faces and continuous shallows
  foam.ts         painted breakers that ride the shoreline's foot and shallows
  vegetation.ts   tree(), stump(litter), litterFor(roll), wheatFarm(stage)
  bushes.ts       bush(shape), seeded scrub pockets and smaller clifftop cushions
  people.ts       figure(colour, load) with legs/arms, axe(), spear(),
                  animateFigure(), animateIdle(), animateWork(), workPeriod(),
                  chopStrikes()
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

## Animation

The rig is five joints and nothing else: a body, two legs, two arms, each a baked box
on a pivot. There is no elbow, wrist or neck. Arms are `.34` long and shoulders `.42`
apart, which is short — a two-handed grip only works because the holding hand tucks
toward the midline. Know that before authoring a pose that asks an arm to reach.

A work animation is a table, not a branch. `WorkPose` is a row of semantic channels
(`swing`, `brace`, `lean`, `lift`…), never raw transforms; a `Cycle` is a period and a
list of keys:

```ts
const CHOP: Cycle = { period: 1.05, keys: [
  { at: 0, pose: READY, ease: smooth },
  { at: .38, pose: RAISED },                            // held to the next key
  { at: .5, pose: RAISED, ease: easeIn },
  { at: .58, pose: STRUCK, ease: easeOut, lands: true }, // the blow
  { at: .72, pose: RECOIL, ease: smooth },
  { at: 1, pose: READY },                               // closes the loop
] };
```

A hold is two keys with the same pose, so it is visible as one. `lands` marks the
instant something connects, and `landingsBy()` counts them — which is how the renderer
knows when to throw chips and shake the tree, from the same table that poses the arms.
Easings are named (`smooth`, `easeIn`, `easeOut`), never written out as arithmetic.
`poseAt()` writes into a pose the caller owns; it never hands back a shared scratch.

Apply the pose to the rig in one place. Then two animations share the rig and the
next one costs a table.

Work is scattered per walker the way idling is: the renderer offsets the phase by a
hash of the walker's id and subtracts the same offset from the landing count, so two
woodcutters side by side never swing in step and each still throws chips on its own
blow.

Tests hold what the eye is bad at: continuity under fine sampling, the cycle closing
on itself, the swing coming from the torso rather than the arm, and where the tool's
business end actually lands. Measure a posed model to set a reach constant; never
derive one by hand.

## Adding a model

1. Build it from primitives in the relevant file, front facing `+Z`, ground at `y=0`.
2. Wire it in `buildings.ts` (or the walker/animal switch in `city.ts`).
3. Add an option to `art.html` and to the list in `scripts/art-capture.mjs`.
4. `npm run art:check` — footprint and budget tests cover every catalog kind.
5. Look at it in `/art.html` and in the game; compare captures.

## Tools

- **`/art.html`** (`src/art-viewer.ts`): the atelier. Footprint border, grid, scale
  citizen, wireframe, turntable, golden hour, animated walk/flap cycles. The chosen
  model is kept in `?model=…` so reloads and links preserve it. `artStudy.pose(seconds)`
  scrubs an animated model to one instant and stops the clock there, the way the
  construction slider does; changing model starts it again.  Every placeable
  building offers construction replay and a reversible progress slider, scaffolding
  and dust included — this is where timing is judged. Replay is disabled for reduced
  motion; manual scrubbing remains available without autoplay.
- **`/sandbox.html`** (`src/sandbox.ts`): the terrain sandbox. One local island, no
  HUD, no saves, no server: `?seed=` picks the island, `Q` turns the camera, `G`
  toggles the grid, and `window.oikos` exposes seed, world, previews, road laying,
  demolition and projection for the capture scripts below. It is an authoring tool,
  never a way to play.
- **`npm run art:check`**: `bun test src/art`.
- **`npm run art:cycle -- <base url> [model] [frames] [turns]`**: walks one animated
  model through a whole cycle and lays the frames out as a contact sheet, framed on
  the subject rather than the scene — `artStudy.frame` projects the model's bounds, so
  the crop is right for any model. `turns` presses *Turn model*, which is how you get
  a view the scenery is not standing in front of. Output: `artifacts/cycles/<model>/`.
  This is the loop for judging motion; do not hand-roll a montage script.
- **`npm run art:capture -- <base url>`**: captures every atelier model to
  `artifacts/art/`, including roads, bushes and outcrops from four sides, and asserts the
  atelier stays still when nothing animates, keeps
  the selection in the URL across a reload, and never touches the game's save.
- **`npm run smoke:construction -- <base url>`**: assembly captures from four sides
  and at city zoom, one midway capture per kind, replay/scrub checks, idle rendering,
  reduced motion, placement in the sandbox, and atelier save isolation.
  Output: `artifacts/construction/`.
The capture scripts below drive the sandbox; pass the site's base URL, not a route.

- **`npm run coast:capture -- <base url> [output] [seeds…]`**: coastlines on seeds
  1, 2, 8 and 37, from four sides and with the grid, plus the seed-1 village.
  Also use these views to judge inland cliffs and scrub in context.
  Checks idle rendering and unchanged simulation. Requires the dev server.
  Output: `artifacts/coast/`.
- **`npm run terrace:capture -- <base url> [output]`**: inland cliffs from four
  sides, before and after laying stairs through an outcrop, plus four close views.
  Checks previews, rejected side entries, pixel-identical cliff restoration, save
  round-trips and idle rendering. Output: `artifacts/terraces/`.
- **`npm run road:capture -- <base url> [output]`**: limestone streets on seeds
  1, 2, 8 and 37 from four sides. Checks idle rendering, unchanged simulation, and
  pixel-identical scenery after placing then demolishing a road. Requires the dev
  server. Output: `artifacts/roads/`.
  Use `terrace:capture` alongside it for carved stairs, landings and rejected side entries.
- **`npm run smoke:foam -- <base url>`**: breakers animate, stay still under reduced
  motion, and never render while idle. Output: `artifacts/foam/`.
- **`npm run check`**: build, tests and the capture suites. Models are judged in
  the running game by eye; no gameplay walkthrough script remains.
- **`npm run art:diff -- <before dir> <after dir>`**: compares two capture
  directories pixel by pixel and reports how much of each image moved. Use it when
  a change is meant to leave the picture alone, such as a rendering optimisation.

`artifacts/` is gitignored; compare a capture against your previous local capture.

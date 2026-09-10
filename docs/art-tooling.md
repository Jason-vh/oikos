# Art tooling — `src/art/`

How models are built, wired and checked. Read `art-direction.md` first.

## Layout

```
src/art/
  primitives.ts   colours, cached materials, box/post/lump/group/mesh, roof, pot,
                  bake(), disposeModel()
  houses.ts       dwelling(tier)
  civic.ts        fountain, maintenance, lodge, woodcutter, stockpile
  granaries.ts    granary(stores)
  stall.ts        stall() — the agora's market stall
  food.ts         resource bundles (wheat, carrots, fish, meat, olives, lumber, clay,
                  stone), bundlesOf(stores, slots), bundleKey()
  vegetation.ts   tree(), wheatFarm(stage)
  people.ts       figure(colour, load) with legs/arms, animateFigure(), animateWork()
  animals.ts      boar, rabbit, fish, gull, animateAnimal()
  ships.ts        boat()
  buildings.ts    getBuildingModel(kind, { tier, vendorEnabled, stage, stores })
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

## Adding a model

1. Build it from primitives in the relevant file, front facing `+Z`, ground at `y=0`.
2. Wire it in `buildings.ts` (or the walker/animal switch in `city.ts`).
3. Add an option to `art.html` and to the list in `scripts/art-capture.mjs`.
4. `npm run art:check` — footprint and budget tests cover every catalog kind.
5. Look at it in `/art.html` and in the game; compare captures.

## Tools

- **`/art.html`** (`src/art-viewer.ts`): the atelier. Footprint border, grid, scale
  citizen, wireframe, turntable, golden hour, animated walk/flap cycles. The chosen
  model is kept in `?model=…` so reloads and links preserve it.
- **`npm run art:check`**: `bun test src/art`.
- **`npm run art:capture -- <base url>`**: captures every atelier model to
  `artifacts/art/` and asserts the atelier stays still when nothing animates, keeps
  the selection in the URL across a reload, and never touches the game's save.
- **`npm run smoke`** and **`npm run check`**: the gameplay walkthrough
  (`scripts/smoke.mjs`), which is where models are judged in context.

`artifacts/` is gitignored; compare a capture against your previous local capture.

# Art direction — Οἶκος

The visual contract for everything in `src/art/`. Read it before adding or changing
a model. The game itself (`/`, seed 1) is the reference scene; there is no separate
benchmark. Judge new work in the game at normal play zoom, then in the atelier.

## Intent

A painted wooden toy city under a warm sun. Chunky, low-poly, matte, bevelled.
Buildings are cream plaster with terracotta roofs and painted blue accents; land is
sun-bleached; the sea is turquoise near the shore. Everything reads first by
silhouette and colour, second by a single distinguishing feature, never by detail.
**Do not add detail to compensate for a weak silhouette.**

## Palette (`colors` in `src/art/primitives.ts`)

| Name | Hex | Use |
| --- | --- | --- |
| plaster | `f3dfb5` | walls |
| cream | `ffefcb` | trims, columns, steps |
| stone | `c9b689` | plinths, walls, cliffs |
| paving | `e1d0a7` | roads, courts |
| roof / roofLight / roofDark | `b85e41` / `cf7851` / `9c503b` | tiles |
| blue / blueLight | `426f83` / `68919c` | shutters, awnings, sails |
| dark | `364d48` | doorways, openings |
| wood | `846347` | timber, trunks, carts |
| olive / oliveLight / oliveDark | `879557` / `a2ae70` / `627a50` | foliage |
| grass / earth | `a7ac73` / `b0a17b` | ground |
| gold / linen | `d6ab53` / `ffedc5` | grain, cloth |

Terrain surface colours live in `src/render/terrain.ts` (`SURFACE`). Food and
material bundle colours live in `src/art/food.ts`. Add a colour only when no
existing one reads correctly at city zoom.

## Materials and geometry

- `MeshStandardMaterial`, roughness `.88`, no textures, no emissive, no transparency
  except placement ghosts. Materials are cached per colour; never dispose them.
- Boxes are `RoundedBoxGeometry` with bevel `.045` (`box()`); cylinders are 8-sided
  (`post()`); foliage and rocks are dodecahedra (`lump()`).
- Models are built from these primitives, then `bake()`d into one mesh per material.
  `disposeModel()` frees baked geometry only.
- A placed building is raised piece by piece inside timber scaffolding, set down by
  hand as a painted toy would be. The construction is authored beside the model, never
  cut out of it: see Construction in `art-tooling.md`. Keep it under two seconds, and
  keep the finished silhouette the thing the player waits for.

## Scale and footprints

- One cell is `CELL_SIZE = 1.25`; ground is `GROUND_Y = 1.15` plus `LEVEL_HEIGHT =
  1.6` per terrace. A citizen is ~1.1 tall.
- `getBuildingModel(kind, state)` returns a model centred on its footprint, ground at
  `y = 0`, front facing `+Z`, strictly inside `catalog width × depth × CELL_SIZE`
  (tested in `src/art/models.test.ts`). Nothing may overhang into a road.
- Housing tiers must differ in silhouette: dwelling (low, one storey), cottage
  (taller, awning), courtyard house (two storeys, balcony).
- Storage shows its contents: granary and stockpile expose eight bays, agora stall
  three; one bundle per 100 units, in that resource's signature (`food.ts`).

## Lighting and camera (`src/render/stage.ts`)

Orthographic camera; hemisphere light `e7f1ee`/`b4a075` at 2.1; sun `ffe6bd` at 3.5
from `(-25, 42, 24)`; ACES tone mapping at 1.18; 2× MSAA; GTAO at 70% resolution;
shadows refreshed on change, not per frame. Golden hour swaps the sun to `ffc083`
lower in the sky. Do not add bloom, vignette or outlines.

## Budgets

Keep a placeable building under 18 draw calls and ~9,000 triangles; walkers and
animals under 6 meshes. `models.test.ts` enforces the building budgets.

## Acceptance

A model is done when, in the game at the default zoom:

1. it is identifiable by silhouette among its neighbours;
2. its state is readable (crop height, stock bays, cargo);
3. it fits its footprint from all four rotations;
4. it does not introduce a new colour or material;
5. `npm run art:check` and `npm run art:capture` pass, and the captures in
   `artifacts/art/` look right beside the previous ones.

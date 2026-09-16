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

City colours — what a player picks when joining — are `cityColors` in the same
file, one muted hue per name in `src/sim/colors.ts`: terracotta, saffron, olive,
verdigris, aegean, lapis, plum, crimson. They mark a player, never a building.

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

- One cell is `CELL_SIZE = 1.25`; ground is `GROUND_Y = .4` plus `LEVEL_HEIGHT =
  1.6` per terrace. A citizen is ~1.1 tall. Level-0 shore meets the sea in a low
  lip; a coastal cliff is terrain that rose a terrace, not the default shoreline.
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

The camera stands off the target by a fixed multiple of the world span, so every
fragment lies in front of it and depth increases with distance. Haze is linear fog
measured from that standoff: it begins beyond the archipelago and closes well
inside the far plane, so clipped geometry is already the background colour and its
edge cannot be seen. Fog is a rim, not a wash — at play zoom nothing in frame is
hazed. Zoom is bounded by world distances rather than a zoom factor (`Stage.world`):
out to the whole archipelago and no further — the sea must never be seen to end — and
in to a single street from any view, founding included.

The placement grid is shown while something is being placed — a build tool or the
harbour in hand — or because the player asked for it. It eases in and out rather than
blinking, and fades away between view spans 90 and 170, where a cell is too small to
aim at and its lines only add noise to the land.

A claimed island is glazed in its owner's colour while a player is still choosing
where to land (`src/render/claims.ts`): one flat layer over the island's land tiles,
drawn without depth testing and before the rest of the transparent pass, so the
colour carries over the trees and roofs standing on those tiles rather than washing
the ground alone. A claimed island reads as one painted shape and a free one keeps
its green. Clouds still pass over it. The coastal band — land within two tiles of
water — is laid in the same colour at near-full strength, so the island is outlined
rather than only filled, and its city's name rides above it on a HUD card
(`src/ui/claim-labels.ts`) placed by projecting the island's centre. It is a
map-scale affordance, so glaze, outline and cards fade out together between view
spans 700 and 240 and are gone by the zoom a shore is picked at, where the terrain
must read true. All of it is taken down once that player has a city.

Wildlife is drawn near the view, not across the world: sight is the view span capped
at 220, so pulling back to the archipelago no longer places and poses every animal on
it at a few pixels each. Posing belongs to `animate`; `watch` only adds and removes
what sight has changed, and never rewrites a pose that nothing moved.

Decoration is never seen arriving. `IslandScenery.reveal` plants every chunk the
view reaches in the frame that asks for it, so a widening view is never short of
trees; what lies beyond the view is planted nearest-first under a few milliseconds a
frame, until the whole island stands. A city is complete on its first frame and the
rest of the archipelago follows within a second or two of idle time, so zooming out
later costs nothing. Chunks pop into visibility, never into existence.

Zoom follows the wheel exactly, with nothing between the hand and the view. Easing it
was tried and removed: on a trackpad, which already sends a smooth stream, smoothing
is only lag, and it reads as the page zooming itself. If a step ever needs softening,
soften the step — `controls.zoomSpeed` — not the response.

Contact shadows do fade with the view: GTAO renders the scene a second time for depth
and normals, which doubles the cost of a view full of trees for an occlusion radius
that is sub-pixel out there, so it fades out between spans 120 and 220 and the pass is
switched off once it contributes nothing.

## Sea and sky

The sea is one plane four world spans across (`src/render/extent.ts`). Its colour
comes from the land, not from distance: `src/render/sea.ts` bakes a distance-to-
shore field into a data texture and mixes shallow `559fa5` at the coast into deep
`3a7e93` about forty cells out. Offshore water reads as sea at any zoom without
help from the haze.

Wave marks are painted, not procedural wallpaper: crossed sine waves make a lattice
of identical dots, which is what a regular grid on water always looks like. Instead a
hash picks one short dash per jittered cell, sparsely, each on its own fade cycle, all
leaning the same way as a brush would. They fade out between view spans 90 and 260 —
detail belongs to the zoom that can see it.

Clouds (`src/art/clouds.ts`, `src/render/clouds.ts`) are the one thing in the sky:
three painted dodecahedron shapes, instanced, flat-bottomed, cream `fff6e6`. They
sit between 52 and 72 above the water, drift on world time — so they freeze with a
paused city and under reduced motion — and are the only transparency besides
placement ghosts. They fade in between view spans 300 and 560: high enough that a
cloud never dwarfs the island under it, and that its painted shadow — a soft patch
leaning away from the sun, drawn over land and sea alike — clears the cloud itself.
The sun's own shadow map is too small to reach them.

## Coastlines

`src/art/coast.ts` derives coastal profiles from neighbouring land and sea tiles.
Tile tops remain complete, flat squares; only the rock below the rim is carved.
Convex waterline corners are chamfered, with a continuous shallow-water band.
Slow seeded variation controls the cuts and band width. Narrow channels stay open.
The logical island, inland terraces, roads and building footprints never change.

Breakers (`src/art/foam.ts`) are painted cream ribbons that ride the same shoreline
profiles: they form offshore, widen against the rock and thin away on a seeded
stagger. They are flat quads at the waterline — one opaque mesh, no particles or
transparency — frozen whenever the city is paused and still under reduced motion.

## Inland cliffs

`src/art/cliffs.ts` carves terrace walls beneath flat rims, opened only for stairs. Broad
limestone facets and chamfered corners replace vertical earth walls and continuous
stripes. Seeded, slow variation shapes shoulders and short shelves; all cuts stay
inside the high ground. Profiles meet at terrace corners and return to the original
edge at coastal junctions, where stone triangles close the transition to the coast's
inset shoulders. Two-level drops remain closed. Clifftop stones form
occasional paired outcrops, cleared wherever a road occupies their tile.

## Felling

A tree is cut down, not deleted. `src/art/vegetation.ts` gives every trunk a root
flare so it looks planted; `src/render/island.ts` hinges the tile's decoration at
that trunk rather than at the tile centre. Each axe blow shakes the tree and throws
chips; the topple runs about a single horizontal axis away from whoever is chopping,
accelerating rather than easing out, and raises dust where the crown lands. Under
that dust the tree goes and a stump stays. What is left is seeded per trunk and mostly
modest: usually a bare cut stump, sometimes chips beside it, occasionally the bucked
log as well. Two trees on one tile never both leave a log — a worked forest should read
as cleared ground, not a woodyard. Stumps clear when the forest regrows, and hide
under a building placed on them.

The woodcutter is authored to match. `animateWork(elapsed, 'chop')` runs one
continuous cycle — wind-up, a beat held at the top, an accelerating strike, recoil,
recover. It is a felling cut, not a splitting blow: he stands side-on with the tree
off his front-right (`CHOP_SET`), winds the axe back over his far shoulder and sweeps
it round horizontally into the trunk, torso and arms twisting with it. That needs the
tool and arms on `YXZ` rotation order, so the swing is applied after the pitch rather
than inside it. Its phase comes from the task's start, so `chopStrikes()` tells the
renderer exactly when the blade lands.

**The swing comes from the trunk, not the wrists.** `pose.swing` turns the torso, and
the shoulders orbit with it (`setShoulder`); the working arm holds one angle against
the chest for the whole cycle, and the hips carry a third of the turn. Nothing swings
by waving an arm about a fixed shoulder, which is what reads as wrong at any zoom.

A tool is built with its origin at the grip and placed on the back hand every frame.
The fore hand is not authored: `aimArm` points it at a spot `HAND_SPAN` up the haft,
so both hands sit on the shaft a little apart and stay there as the tool moves. The
back hand tucks toward the midline (`TUCK`) because these arms are short — without it
the off hand cannot reach the haft at all.

The axe head sits square across the end of the haft, so the blade is unmistakably
perpendicular rather than in line with it. `CHOP_HEAD` is where the blade is and
`CHOP_SET` the bearing it strikes along, which is what the renderer turns the walker
by. Where the blade lands is measured, not guessed: a test holds it to that bearing
and inside `CHOP_REACH`.

The hunter's thrust is the same machinery with its own keyframes: guard, a coil that
draws the spear back and out to the side rather than up, an accelerating drive, a beat
leaning on the shaft while it is in, then recover. The spear is held level and points
at the quarry throughout — it never swings behind the shoulder, and no part of the
cycle stands still.

A walker steps up to whatever it is working, and back out before it is finished:
`CHOP_REACH` puts the blade on the bark, `HUNT_REACH` puts the spear in the flank.

## Scrub

`src/art/bushes.ts` authors low cushions, leaning upright shrubs and paired clumps
from two overlapping foliage masses. Olive dominates, with darker flanks and an
occasional light accent. Seeded patches leave open ground between denser pockets;
rotation, proportions and within-tile placement vary without crossing a tile edge.
Clifftops reuse smaller cushions. Every bush clears with its occupied tile and
returns unchanged when that tile is freed. No foliage animation or leaf detail.

## Roads

`src/art/roads.ts` separates network outlines and stair connections from limestone
paving. Broad, seeded flags run across cell boundaries; exposed edges stay narrowly
inset and convex corners are chamfered. No raised kerb ring, wear stripe or inlay.
Flat surfaces receive shadows without casting; stair treads and walls still cast.
Landings use the same paving. `src/art/stairs.ts` cuts a flight through the full
upper road cell, retaining solid cliff shoulders instead of freestanding cheeks.
Eight bevelled treads meet roads at the foot and rear landing, never halfway up.
The shared simulation profile controls orientation, walking and preview heights.
All road geometry stays within occupied cells. Road tiers remain deferred.

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

## Idleness

A person with nothing to do is not a statue. They breathe, shift their weight,
stretch now and then, and turn to look about — at the sea, at whoever is standing
nearby. None of it is authored per person or sent by the server: the client picks
from the walker's own id and the moment its wait began, so two people idling side
by side behave differently and every screen may differ without anything being wrong.
Keep these small. At city zoom a person is a few pixels tall, and the reading is
"someone is alive there", not a performance.

A grazing animal is the same idea: a settled boar dips its head rather than
standing to attention. Working is no different: two woodcutters at neighbouring trees
swing on their own phase, drawn from their own ids, and each throws its chips on its
own blow.

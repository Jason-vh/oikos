# Οἶκος: first playable

A small, deterministic, headless simulation for the first slice of the island game.
The whole thing lives in `src/sim/` and has no dependency on Three.js or the browser —
`advance(world, seconds)` is the only clock, and the same input always produces the
same output.

## The archipelago

`generateArchipelago(seed)` in `src/sim/island.ts` builds a sea of eight islands.
Each one is a full `generateIsland` run on its own grid, stamped into the shared map
at a slot in a four-by-two layout with eighteen-tile channels. `islandSizes(seed)`
deals out a fixed ladder of eight size factors, shuffled by the seed and given an
aspect jitter, so every archipelago holds one large island, one small one and a
spread between — the largest carries roughly two and a half times the land of the
smallest. Columns are as wide as their widest island and rows as deep as their
deepest, and each island is offset within its lane from the seed, so they scatter
rather than line up. Every island keeps its own harbour entry, and
`islandAt(map, x, z)` says which island a tile belongs to. The default `map.home` is the most central island. `world.cities[0].home` records the chosen
starting island; `islandFor(seed, home)` shares the generated terrain while providing
that island's `map.home` and harbour `map.entry`. Choosing one home never changes
another city's map.

Islands never share a bounding box and each is a single landmass, so a road network
can never leave the island it started on. The other seven are, for now, unclaimed
ground: wildlife lives there, the player cannot yet build there. Building previews, single placements, and road
strokes all refuse construction outside the city's home island, without spending money.
An island belongs to the first harbour placed on it.
Fertility overlays only highlight fields on the settled island. Older saves with
outlying disconnected construction remain loadable, and those structures can still
be demolished.

## An island

`generateIsland(seed, width, depth)` builds one island from a seed: a radial
mask plus value noise for the coastline, a relief field quantised into three levels
(lowland, plateau, upland) with cellular smoothing, and soil/wood fields for terrain.
Coast and relief noise are a fixed fraction of the island's span, so a larger island
keeps the same silhouette and the same number of headlands rather than fraying into
inlets. Soil and wood stay at absolute scale, so a larger island holds more fields
and woods of the same size rather than bigger ones.
Terrain kinds: `water`, `sand`, `grass`, `fertile`, `scrub`, `forest`, `rock`, `cliff`.
Buildings need level ground on grass/fertile/sand/scrub (farms: fertile only); roads
can also cross forest and climb cliff edges using stairs. `cliff` and `rock` cannot
hold buildings. The harbour entry is chosen on the widest flat south-facing shore, and the
ground around it is cleared, with a fertile patch to its north-east. `islandFor(seed)`
caches whole archipelagos; the world stores only the seed.

## Founding a city

A city exists because its harbour does. `harbourPlacement(world, x, z, rotation)`
in `src/sim/founding.ts` previews a 2×5 site: two rows of quay on flat, buildable,
level-0 shore and three rows of pier over open water, facing whichever of the four
ways `rotation` points. `claimHarbour(world, name, color, x, z, rotation)` commits it,
which is also the claim: the island under the quay becomes that city's `home`, and
an island already held by another city refuses the site. Founding is one-time; the
harbour can never move or be demolished. The name and colour come from the join,
not the click; a player choosing where to land sees every claimed island glazed in
its owner's colour, and the unclaimed ones in their own. There is no landing road and no free
ground: a new city holds 1600 drachma, one harbour, and nothing else, and pays for
its first road out of the quay.

`createWorld(seed = 1, home?, name?)` is the quick-start constructor used by tools
and tests. It sites the harbour itself with `findHarbourSite`, which walks outward
from the island's generated shore looking for a legal site with open ground behind
it, and paves the two apron tiles in front of the quay so the city is ready to
build. Nothing in the playable game calls it.

## One city, for now

A `World` holds the shared map seed, simulation clock, entity allocator, and
wildlife, plus `cities: City[]`. Each city owns `name`, `home`, `money`,
`harbour`, `produced`, `delivered`, `roads`, `buildings`, and `walkers` — the
whole of one settlement's infrastructure. Only a single city is supported
today; `primaryCity(world)` in `src/sim/city.ts` names that transitional
assumption at every call site that reads or writes city state. Saves are
rejected if they contain anything other than exactly one city. Multiple,
separately owned cities sharing one archipelago, and the ownership and
actor checks that come with them, are future work.

Nobody lives on the island yet — population only arrives once a dwelling is built
and connected, by road, back to the quay: settlers walk out of the harbour's own
door tiles, and `harbourDoors` is what connectivity is measured from. All eight islands on seeds 1 and 2 are tested
through the complete neighbourhood loop and save/load continuation.

## Placing and removing things

- `placement(world, city, tool, x, z, rotation)` previews a build: it never mutates
  the world, and reports the cost and the tiles it would occupy, whether or not the
  placement is legal. It reads the given `City` explicitly, never `primaryCity(world)`
  implicitly.
- `build(world, city, tool, x, z, rotation)` does the same check and, if it passes,
  deducts the cost and adds the building or road tile to the given `City`.
- `placeRoadPath(world, city, tiles)` places a whole drag of road tiles atomically:
  if any tile in the batch is invalid the whole thing is rejected and nothing is
  charged. Tiles that are already roads cost nothing, whether placed one at a time
  or as part of a path.
- `demolish(world, city, x, z)` removes whatever is on that tile. Demolishing a building
  refunds half its base cost (plus half the vendor fee, if one was installed on an
  agora being torn down). Demolishing a road never refunds anything — including the
  starter roads — so there's no way to profit by paving and immediately tearing up
  a tile.

### Serializable player commands

The game UI submits construction, road strokes, demolition, vendor changes, and
founding through `applyCommand(world, cityId, raw)` in `src/sim/commands.ts`.
`CityCommand` is a plain JSON union. `parseCommand()` checks action names, building
tools, integer coordinates and ids, rotations, booleans, and road strokes of
1–1024 tiles. It copies accepted data and strips unrelated fields, so queued
commands do not retain caller-owned arrays. `applyCommand` resolves `cityId`
against `world.cities`, rejecting an unknown id without touching the world, then
passes the resolved `City` to the mutator. Invalid commands fail without changing
simulation state.

Valid commands still pass through the ordinary placement, founding, and territory
rules. Resolving the target city by id is not yet ownership: there is still one
playable, persisted city, and this is the command boundary for a future
authoritative server rather than player authentication. Scenario helpers remain
direct simulation utilities; local undo remains a checkpoint operation.

Every `ActionResult` carries a human-readable `reason`, suitable for a HUD toast
as-is:

- Success: `'Dwelling built.'`, `'Road laid.'`, `'Food vendor added.'`,
  `'Vendor paused.'` / `'Vendor resumed.'` / `'Vendor already active.'`,
  `'Demolished, 70 drachmas refunded.'` (or `'Demolished. Roads are not
  refunded.'` for a road).
- Failure: a full sentence too — `'Farms need fertile ground.'`,
  `'Not enough drachmas.'`, `'Out of bounds.'`, `'That tile is occupied.'`,
  `'That tile is occupied by a road.'`, and so on.

`Placement.reason` is only ever populated on failure; a valid preview's `reason`
stays `''`.

Every building needs flat, unoccupied land: grass or fertile ground, never a hill
tile or water. A farm additionally needs *every* tile of its footprint to be
fertile. A tile can't hold both a road and a building at once. "Occupied" reads
globally: `placement`, `build`, `placeRoadPath`, and `harbourPlacement`
all reject a tile already held by another city's road, building, or founded
harbour, with no charge and no mutation, using `src/sim/occupancy.ts`. A city's
own existing road tiles remain free to re-lay regardless of anyone else's
territory.

Placement does **not** require a road connection — you can drop a farm in the
middle of nowhere — but a disconnected building is flagged as such
(`buildingStatus` says so, and `connected` is `false` on the record) and won't be
staffed, serviced, or in the case of a house, ever gain settlers, until a road
links it back to the entry.

## The four-house neighbourhood

`src/sim/scenario.ts` exports `planStarterNeighbourhood(world, city)`, which
searches the ground near the harbour road for a legal spot for each building (farm
first, then granary, four houses, agora, fountain, maintenance post) and the road
needed to connect each one, and `buildStarterNeighbourhood(world, city)` which
builds that plan and enables the vendor. Both read and build for the given `City`
explicitly; planning clones the `World` and resolves that city's trial copy by
its stable id, so it never mutates the original. Seeds 1–8 all yield a plan that reaches its first food in under
a minute and the goal in two to three simulated minutes. The browser walkthrough
builds the plan through the real UI.

## Food and storage

Food comes in kinds (`Food`: wheat, carrots, fish, meat, olives) and materials
(`Material`: lumber, clay, stone); `Resource` is either. Wheat, meat and lumber are
produced in this slice. Every storing building keeps `stores`, a map of food →
units. Capacity is physical: a granary has eight slots around its tower and an agora three, each
holding one bundle of 100 units of a single food, so the model shows exactly what
is stored. Walkers carry one food at a time (`walker.food`, `walker.cargo`); buyers
and vendors take whichever food the source has most of.

## The supply chain

Nothing is delivered by radius. Every good moves along roads, carried by a walker
that has to actually reach its destination.

- **Farm → granary.** A farm with workers grows food; when a harvest completes, it
  loads a cart with up to 100 units and sends it, by the shortest road route, to the
  nearest connected granary with room. The cart drops its cargo and walks home.
- **Granary → agora.** An agora with an enabled vendor sends a buyer to the nearest
  connected granary that has stock, who carries a cartload back to the agora.
- **Agora → houses.** Once the agora holds food, its vendor sets out on foot along
  a deterministic circuit of the reachable road network — a depth-first walk capped
  at a distance budget (60 tiles) rather than a random wander, so every house on a
  short network is reliably served every trip. It drops food at each house it
  passes (until its cargo runs out), then returns whatever it's carrying to the
  agora before going home.
- **Fountain → houses.** A fountain with staff sends a water carrier on the same
  kind of circuit, topping up the water of every house it passes.
- **Maintenance → everything.** A maintenance post's caretaker walks the same kind
  of circuit and repairs the condition of every building — house or workplace — it
  passes.

Every workplace needs staff to do any of this: about half the population is
available for work, split across every connected workplace's job slots in
proportion to how many it offers. A disconnected workplace never gets workers.

A vendor is a one-time purchase: `setVendor(city, agora.id, true)` charges
`VENDOR_COST` only the first time it's switched on for a given agora. Turning it
off and back on again doesn't charge a second time.

## Living in a house

A house starts empty. Once it's connected to the road network, parties of settlers
walk in from the harbour flag along the roads; they count as residents only when
they arrive. A house fills to 8 (tier 1, no requirements) quite quickly. From there:

- **Tier 2** (12 settlers) needs food. A house with food in store keeps growing
  toward 12; once full and fed for a short confirmation window, it upgrades.
- **Tier 3** (20 settlers) needs food *and* water, on the same terms.

Food is consumed continuously by the residents; water isn't consumed so much as it
evaporates over time — either way, a house that stops being served will eventually
run dry. When a house's *current* tier's requirement goes unmet, it has a grace
period (45 seconds) before it devolves one tier down, dropping any residents above
the lower tier's capacity. There are no fires, collapses or other disasters in this
slice — the worst that happens to a neglected house is that it slips backward one
step, and a caretaker's visit or a vendor's return lets it recover on the same
terms it grew by.

Building condition decays slowly regardless of tier, and is repaired by a
maintenance caretaker's visits; nothing about condition alone forces a house to
devolve in this slice.

## Status messages

`buildingStatus(city, building)` returns short, player-facing lines about what a
building needs or is doing right now — not a dump of its raw fields (the UI already
shows residents, stock, workers and condition numbers directly). A disconnected
building only ever reports that:

> 'Not linked to a road; nobody can reach it.'

Otherwise it says what a house is waiting on or growing into — `'Waiting for
settlers from the harbour.'`, `'Needs food to grow: add an agora vendor
nearby.'`, `'Needs water to become a courtyard house.'`, `'Out of food; a vendor
visit is needed.'`, `'A thriving courtyard house.'` — or what a workplace is doing
— `'Unstaffed; settlers are needed for work.'` / `'Short of workers; more settlers are needed.'`, `'Growing wheat, 40% to harvest.'`,
`'Empty; waiting for a farm cart.'`, `'Add a food vendor to start deliveries.'`,
`'Vendor on the streets.'` / `'Vendor resting at market.'` — with a trailing
`'Neglected; a caretaker will repair it.'` (or `'Neglected; build a maintenance post.'` when no connected post exists) appended whenever condition has dropped
below half.

## Money

Building, paving and the vendor's installation fee are one-off costs. Ongoing
income and upkeep are applied continuously (no tax walker): each resident brings in
a small, steady income, and every standing workplace has a modest upkeep, both
expressed as a rate per `MONTH_SECONDS` (60 simulated seconds) and settled every
tick. `getSummary(city)` reports the current population, employment, food in
storage, income, upkeep, balance, and how many tier-3 houses are inhabited.

## Gathering: hunters and woodcutters

`src/sim/gathering.ts`. A hunter's lodge (2×2, 3 jobs) and a woodcutter's cabin
(2×2, 3 jobs) send a walker *off the road*: `overlandPath` searches roads and then
passable open ground (grass, scrub, sand, fertile, forest, cliff edges) within
`GATHER_RANGE` (14 tiles), stepping between levels only across a cliff edge. The
hunter targets the nearest live boar or rabbit; on arrival, if the quarry is within
`CATCH_RADIUS`, the animal is `cornered` (it stops moving) and the hunter works for
`HUNT_SECONDS`; then it is killed (`respawn` set; it reappears at home after 240 s)
and the hunter carries its `yield` of meat back. The woodcutter targets a tile beside
standing forest, works for `FELL_SECONDS`, fells it (`world.felled`), and carries 25
lumber back. `walker.working` holds the seconds left at the site; the renderer plays
an axe swing or spear thrust while it is positive, then the tree topples and the
animal collapses. Felled
tiles regrow one at a time every 480 s unless built over. Gatherers stock up to 200
at home; carts take food to a granary and materials to a **stockpile** (3×3, eight
bays, same court as the granary). Walkers carry `overland` tiles so saves validate
off-road paths.

A gatherer's reach is never a circle: `gatherReach` runs the same flood as
`overlandPath` from the same door tile, so it stops at water, rock, cliffs and other
buildings exactly where the walker would. `src/render/reach.ts` traces its frontier
as one continuous blue line — one merged mesh, drawn inside the last reachable tile
rather than on the tile border, so it never hangs over a cliff or a shore. Corners
are trimmed, abutted or extended to suit the turn, so the stroke reads as an outline
and not as a row of rectangles. Obstacles enclosed by the reach are filled rather
than ringed: the line shows how far the gatherer goes, not every rock he steps
around. It is drawn while a cabin or lodge is being placed and while one is selected,
so the player can see what ground a site would command before paying for it.

A gatherer with nothing to do says so. `buildingStatus` reports its walker out, its
store full and waiting on a cart, or — the case that used to be silent — nothing left
to gather in reach. That last line asks `gatherErrand`, the same query that decides
whether to send a walker, so the cabin can never claim work it will not do. Lodge and
cabin share all of it: the same reach, the same outline, the same four lines with game
in place of trees.

## The harbour

`src/sim/harbour.ts`. A city's harbour is the quay and pier it was founded on —
never a placeable tool afterwards, and never demolishable. It begins unrebuilt
(`tier` 1): whenever a connected stockpile holds lumber, a porter carries up to a
cartload to the harbour, the same way a farm cart reaches a granary. Once
`HARBOUR_UPGRADE_LUMBER` (200) has arrived, the harbour rebuilds itself in stone
(`tier` 2) and the lumber is spent.

A rebuilt harbour can host one renewable export order. Switching it on (the same
`setVendor` action used for an agora's vendor, at no cost) sends porters to keep the
dock stocked; once it holds at least `HARBOUR_MIN_CARGO` (100) lumber, a ship departs
with the whole load, the lumber is sold at `HARBOUR_LUMBER_PRICE` per unit, and the
money lands immediately — the voyage itself (`HARBOUR_VOYAGE_SECONDS`, shown as the
ship's absence and return) is scenery, not a further condition on the payment.
Turning the trade off stops new porters going out; a voyage already under way still
returns and the dock still accepts what's already arrived.

`harbourStatus(building)` reports delivery progress while rebuilding, and while
rebuilt: a ship at sea, lumber loading for the next departure, or that the trade
is off. The harbour is otherwise an ordinary `Building` — inspectable, its model
keyed on `tier` and stage exactly like a farm's growth — so it needs no bespoke
render or HUD plumbing beyond that.

## Roads that climb

A road crossing a cliff rises one level through the full upper road cell, which
cannot hold a building. The lower road meets the foot at the cliff face; the opposite
edge meets the upper landing. Side entrances and competing downhill connections
are refused, including when a new road would change an existing connection.
Aligned stairs can continue through successive cells.

`src/sim/stairs.ts` derives orientation from the map and road set, without extra
save fields. The same eight-step profile controls terrain cuts, road models,
walkers and placement previews. Buildings and gatherers cannot enter through the
side walls. Removing roads recomputes the cuts and restores unused cliff surfaces.

## Wildlife

`src/sim/wildlife.ts` seeds animals from the map at `createWorld`: boar in forest,
rabbits in scrub, shoals of fish in coastal shallows, gulls over sand and shore.
An animal holds only a home tile, a drift of its own, and what a hunt has done to
it. Where it actually stands is a law, not a stored position: `animalAt(map,
occupied, animal, time)` is a pure function of the time you ask about, so the
server, every client and any test can evaluate it without stepping anything, and
motion is smooth at any frame rate. The wander loops around home within the
species' range and is pulled back along its own radius wherever terrain, roads or
buildings will not hold it, so raising a house moves the animals it displaces and
nothing else. A cornered or killed animal stands at home until its hour comes
round.
`SPECIES` declares each animal's `food` and `yield`
(boar 40 meat, rabbit 8 meat, a shoal 30 fish, gulls nothing) for the hunters and
fishers to come. Animals can be inspected like people.

## People

What a person is doing is a scheduled activity, not a countdown: a task carries the
moment it began and the moment it ends, so the axe falls at the same instant on
every screen and stops on time without waiting to be told. Where someone is and
what work they perform is the authority's; what it looks like to be idle is the
client's alone. A walker kept waiting turns to look about, chosen from its own id
and the moment its wait began — the same everywhere it matters and nowhere on the
wire.

Every walker can be inspected: `walkerName(walker)` gives a stable name from its id,
`WALKER_ROLES` its role, and `walkerStatus(city, walker)` one line on what it is
doing and carrying. The renderer shows cargo on the model: a carter's cart is heaped
with its food on the way out and empty on the way back; jar-carriers carry a jar
only while loaded.

## The goal

`summary.goal` is `true` once at least four tier-3 houses are inhabited, the
monthly balance is non-negative, and the world has both produced and delivered
food at least once. It's a marker of a healthy city, not a stopping condition —
`advance()` keeps the simulation running exactly the same whether or not the goal
has been met.

## Robustness

Roads can be cut and buildings demolished at any time, including while a walker is
mid-journey:

- Demolishing a walker's **home** building removes the walker outright — its cargo
  is lost, not duplicated or teleported. Retiring a hunter releases its prey unless
  another hunter is still working on that animal.
- Demolishing a walker's **target** (its cart or buyer's destination) turns it back
  along the road it already walked, so it heads home instead of vanishing or
  arriving somewhere it never travelled to.
- Removing a road or changing stair connections retires walkers whose paths become
  invalid rather than letting them jump gaps or cross walls. Stranded hunters
  release their quarry.

None of this can corrupt stock: cargo is always deducted from its source at the
moment a walker is dispatched, so a walker going missing never produces a negative
or duplicated number anywhere in the world.

## Saving and loading

`serializeWorld(world)` returns a JSON string; `deserializeWorld(raw)` returns a
`World` or `null`. Loading is strict: it checks the save format's version and
island, that every number is finite and in a sane range, that building and walker
ids are unique and consistent with `nextId`, that no building overlaps a road or
another building, and that every walker's path is a real, road-adjacent route
(no jump between two tiles that aren't neighbours). Anything that doesn't pass is
rejected as unsupported rather than partially loaded. A valid save round-trips
exactly, including walkers already mid-journey, which keep walking correctly after
a reload. The harbour's site and progress (tier, stock, trade order, voyage) are preserved
exactly, including the quay's orientation. `CURRENT_VERSION` in `src/sim/types.ts`
is the only format loaded. `MIGRATIONS` in `src/sim/save.ts` raises the older
formats that can be raised, keyed by the version each one reads; a version with no
entry is refused outright.

A save holds a seed and tile indices, not terrain: `islandFor(seed)` regenerates the
map on load. Any change to `generateArchipelago` or `generateIsland` therefore
invalidates every stored world — indices name tiles on a map that no longer exists,
and the wildlife roster changes size — and must bump `CURRENT_VERSION`. Version 14
has no migration for exactly that reason: the islands were resized beneath it.
`src/sim/fixtures/kalliste-before-the-resize.json` is a world from that generation,
kept so the refusal stays tested. Version 16 only relabels the save's `island` field,
which once read `kalliste`, so it migrates: the terrain is untouched and stored
worlds are raised on load. `deserializeWorld` still accepts exactly one city; `deserializeSharedWorld`
accepts 0 to `ISLAND_COUNT`, with unique ids and homes, no two cities' roads,
buildings or harbours overlapping, and every harbour standing on its own island's
shore.

Older road layouts are retained, but trips using incompatible stair connections
are retired on load; those edges no longer provide access.

## Tests

`bun test src/sim` covers placement and cost rules, connectivity, employment,
the full farm-to-house supply chain and its timing targets, vendor enable/disable
billing, water and maintenance service, housing grace and devolution, road breaks
and demolition mid-delivery, the harbour's rebuild and renewable trade with the
same robustness guarantees as every other delivery, save/load round-trips and
corruption rejection, and determinism of the fixed timestep (one big `advance()`
matches many small ones).

# Οἶκος: first playable

A small, deterministic, headless simulation for the first slice of the island game.
The whole thing lives in `src/sim/` and has no dependency on Three.js or the browser —
`advance(world, seconds)` is the only clock, and the same input always produces the
same output.

## The archipelago

`generateArchipelago(seed)` in `src/sim/island.ts` builds a sea of eight islands.
Each one is a full `generateIsland` run on its own grid, stamped into the shared map
at a slot in a four-by-two layout with eighteen-tile channels; slot sizes and offsets
are jittered from the seed, so the islands scatter rather than line up. Every island
keeps its own harbour entry, and `islandAt(map, x, z)` says which island a tile
belongs to. The default `map.home` is the most central island. `world.home` records the chosen
starting island; `islandFor(seed, home)` shares the generated terrain while providing
that island's `map.home` and harbour `map.entry`. Choosing one home never changes
another city's map.

Islands never share a bounding box and each is a single landmass, so a road network
can never leave the island it started on. The other seven are, for now, unclaimed
ground: wildlife lives there, the player cannot yet build there.

## An island

`generateIsland(seed, width, depth)` builds one island from a seed: a radial
mask plus value noise for the coastline, a relief field quantised into three levels
(lowland, plateau, upland) with cellular smoothing, and soil/wood fields for terrain.
Terrain kinds: `water`, `sand`, `grass`, `fertile`, `scrub`, `forest`, `rock`, `cliff`.
Buildings need level ground on grass/fertile/sand/scrub (farms: fertile only); roads
can also cross forest and climb cliff edges using stairs. `cliff` and `rock` cannot
hold buildings. The harbour entry is chosen on the widest flat south-facing shore, and the
ground around it is cleared, with a fertile patch to its north-east. `islandFor(seed)`
caches whole archipelagos; the world stores only the seed.

## Starting a city

`createWorld(seed = 1, home?)` returns a treasury of 1600 drachma, no buildings, and
a starter road running north from the chosen island's harbour entry. Omitting
`home` selects the most central island. Menu → New island offers all eight starting
islands in a fresh archipelago; cancelling leaves the current city unchanged.
Nobody lives on the island yet — population only arrives once a dwelling is built
and connected, by road, back to that entry. All eight islands on seeds 1 and 2 are tested
through the complete neighbourhood loop and save/load continuation.

## Placing and removing things

- `placement(world, tool, x, z, rotation)` previews a build: it never mutates the
  world, and reports the cost and the tiles it would occupy, whether or not the
  placement is legal.
- `build(world, tool, x, z, rotation)` does the same check and, if it passes,
  deducts the cost and adds the building or road tile.
- `placeRoadPath(world, tiles)` places a whole drag of road tiles atomically: if any
  tile in the batch is invalid the whole thing is rejected and nothing is charged.
  Tiles that are already roads cost nothing, whether placed one at a time or as part
  of a path.
- `demolish(world, x, z)` removes whatever is on that tile. Demolishing a building
  refunds half its base cost (plus half the vendor fee, if one was installed on an
  agora being torn down). Demolishing a road never refunds anything — including the
  starter roads — so there's no way to profit by paving and immediately tearing up
  a tile.

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
fertile. A tile can't hold both a road and a building at once.

Placement does **not** require a road connection — you can drop a farm in the
middle of nowhere — but a disconnected building is flagged as such
(`buildingStatus` says so, and `connected` is `false` on the record) and won't be
staffed, serviced, or in the case of a house, ever gain settlers, until a road
links it back to the entry.

## The four-house neighbourhood

`src/sim/scenario.ts` exports `planStarterNeighbourhood(world)`, which searches the
ground near the harbour road for a legal spot for each building (farm first, then
granary, four houses, agora, fountain, maintenance post) and the road needed to
connect each one, and `buildStarterNeighbourhood(world)` which builds that plan and
enables the vendor. Seeds 1–8 all yield a plan that reaches its first food in under
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

A vendor is a one-time purchase: `setVendor(world, agora.id, true)` charges
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

`buildingStatus(world, building)` returns short, player-facing lines about what a
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
tick. `getSummary(world)` reports the current population, employment, food in
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

## The harbour

`src/sim/harbour.ts`. Every island starts with a harbour: a dockyard sited once, at
`createWorld`, on buildable ground touching the starter road nearest the entry —
`world.harbour`, not a placeable tool, and never demolishable. It begins unrebuilt
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
Each animal (`world.wildlife`) wanders deterministically around a home tile within
its species' range, staying on terrain it can roam and off roads and buildings;
they are saved with the world. `SPECIES` declares each animal's `food` and `yield`
(boar 40 meat, rabbit 8 meat, a shoal 30 fish, gulls nothing) for the hunters and
fishers to come. Animals can be inspected like people.

## People

Every walker can be inspected: `walkerName(walker)` gives a stable name from its id,
`WALKER_ROLES` its role, and `walkerStatus(world, walker)` one line on what it is
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
  is lost, not duplicated or teleported.
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
a reload. Only the harbour's progress (tier, stock, trade order, voyage) is stored;
its site is re-derived from the seed on load, so a save from before the harbour
existed gets one sited fresh rather than needing its position migrated.
Version 5 stores the chosen home island explicitly. Version-4 archipelago saves
migrate to their original central island without moving their cities; versions
before the archipelago remain unsupported. Camera preferences identify the chosen
home as well as the seed. Restoring a different home rebuilds the scene even when
the archipelago seed is unchanged.

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

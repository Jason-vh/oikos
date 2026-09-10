# Thalassa: first playable

A small, deterministic, headless simulation for the first slice of the island game.
The whole thing lives in `src/sim/` and has no dependency on Three.js or the browser —
`advance(world, seconds)` is the only clock, and the same input always produces the
same output.

## Starting a city

`createWorld()` returns a treasury of 1600 drachma, no buildings, and two starter
roads meeting at the entry flag `(21, 24)`: one running north along `x = 21` up to
`z = 14`, and one crossing east–west along `z = 20` from `x = 10` to `x = 30`.
Nobody lives on the island yet — population only arrives once a dwelling is built
and connected, by road, back to that entry point.

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
- `demolish(world, x, z)` removes whatever is on that tile — a building or a road —
  for free (no refund).

Every building needs flat, unoccupied land: grass or fertile ground, never a hill
tile or water. A farm additionally needs *every* tile of its footprint to be
fertile. A tile can't hold both a road and a building at once.

Placement does **not** require a road connection — you can drop a farm in the
middle of nowhere — but a disconnected building is flagged as such
(`buildingStatus` says so, and `connected` is `false` on the record) and won't be
staffed, serviced, or in the case of a house, ever gain settlers, until a road
links it back to the entry.

## The four-house neighbourhood

`src/sim/scenario.ts` exports `buildStarterNeighbourhood(world)`, a ready-made,
tested layout for a first city: one farm, one granary, one agora with its food
vendor switched on, one fountain, one maintenance post, and four houses, all built
on the terrain the map actually offers and wired into the starter roads with one
short road spur. The exact coordinates (also useful for a renderer or a manual
playtest):

| Building | Tile (x, z) | Footprint |
| --- | --- | --- |
| Farm | (26, 11) | 4×4, on fertile ground |
| Granary | (24, 17) | 3×3 |
| Agora (+ vendor) | (13, 21) | 3×3 |
| Fountain | (19, 17) | 2×2 |
| Maintenance post | (22, 17) | 2×2 |
| House | (10, 17) | 3×3 |
| House | (14, 17) | 3×3 |
| House | (18, 21) | 3×3 |
| House | (24, 21) | 3×3 |

Plus a five-tile road spur at `x = 27, z = 15..19` connecting the farm south to the
`z = 20` cross road.

Starting from `createWorld()`, this layout reaches its first food delivery in well
under 90 simulated seconds, its first house upgrade in well under 240 seconds, and
all four houses settle into fully-inhabited, water-and-food-supplied dwellings
inside five simulated minutes — after which the neighbourhood runs indefinitely on
its own income.

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

A house starts empty. Once it's connected to the road network, settlers arrive on
their own, filling it to 8 (tier 1, no requirements) quite quickly. From there:

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

## Money

Building, paving and the vendor's installation fee are one-off costs. Ongoing
income and upkeep are applied continuously (no tax walker): each resident brings in
a small, steady income, and every standing workplace has a modest upkeep, both
expressed as a rate per `MONTH_SECONDS` (60 simulated seconds) and settled every
tick. `getSummary(world)` reports the current population, employment, food in
storage, income, upkeep, balance, and how many tier-3 houses are inhabited.

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
- Cutting a road tile a walker's path depends on drops that walker rather than
  letting it jump the gap.

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
a reload.

## Tests

`bun test src/sim` covers placement and cost rules, connectivity, employment,
the full farm-to-house supply chain and its timing targets, vendor enable/disable
billing, water and maintenance service, housing grace and devolution, road breaks
and demolition mid-delivery, save/load round-trips and corruption rejection, and
determinism of the fixed timestep (one big `advance()` matches many small ones).

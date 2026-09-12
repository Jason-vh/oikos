# Shared-world implementation

Implementation notes for phase 1 of [the roadmap](../roadmap.md), not a claim
that multiplayer has shipped. The current game remains local and single-city.

## One canonical world

Terrain, time, remainder, the entity allocator, wildlife, felled trees and regrowth
belong to World. Settlement metadata, roads, buildings and walkers belong to City.
The collection move landed in version 9. Read-only queries (grid routing and map
helpers, placement/road-path/founding previews, construction and logistics
queries, getSummary/buildingStatus/walkerStatus), construction commands (build,
placeRoadPath, demolish, setVendor, foundHarbour, applyCommand), and the economic
simulation tick (staffing, farms, agora and service dispatch, gathering, the
harbour, walker movement, housing, finances) all take an explicit City. The
engine has no remaining primary-city defaults outside the constructor, the
single-city save loader, local UI/test wrappers, and single-city checkpoint undo.

City-specific engine functions must take `(world, city, …)` explicitly. Resolve
city IDs against the canonical World at command boundaries; never accept an
untrusted City object. Do not use optional primary-city defaults inside the
engine, per-player Worlds, or shallow World views. A view can silently lose writes
to shared primitive fields such as `nextId` and `regrowth`.

Keep the existing single-city save restriction until context threading is complete.
Each intermediate slice must remain playable and stay under 1,000 changed lines.

## Simulation order

Preserve the existing single-city order while adding cities:

1. Advance shared time once.
2. For each founded city: staffing, workplaces, service dispatch, harbour, walkers.
3. Step wildlife once.
4. Step forest regrowth once.
5. For each founded city: housing and finances.

Use stable city order. Connectivity, staffing, delivery candidates and summaries
are city-local. Collision and extraction queries must account for every city's
infrastructure. Do not turn local road routing into a shared-road graph.

Wildlife currently excludes harbour footprints from its obstacle set. Changing
that rule is a deliberate behaviour change, not part of a neutral field move.

## Founding and compatibility

An unfinished city must not stop established cities. Its save invariants are local:
starting treasury, exact prepared roads, empty buildings/walkers, pristine harbour,
and zero production/deliveries. Shared time and ecology may already have advanced.
Pending cities count as claimed.

Preserve legacy outlying infrastructure. Earlier saves can contain construction
outside their home island, and those records remain loadable and demolishable.
New construction still respects territory. Do not add a blanket off-home rejection
to the loader. Reject a new claim if another city's legacy infrastructure already
occupies that island; do not silently transfer or discard it.

`src/sim/occupancy.ts` computes one city's foreign-occupied tiles — every other
city's roads, buildings, and founded harbours, read straight from the canonical
World — once per construction call, not per tile. `placement`/`build`/`placeRoadPath`
in world.ts, the farm and footprint previews in construction.ts, and
`foundingPlacement`/`foundHarbour` in founding.ts all reject a foreign tile
without mutating the World; a city's own existing road tiles stay free to re-lay
regardless of what another city holds elsewhere. A pending city's placeholder
harbour site is not occupancy, matching `harbourTiles`; its prepared roads still
count, since pending cities are already claimed. `buildingAt`, demolition, and
local logistics remain city-local by design, so legacy off-home infrastructure
stays exactly as removable as before.

Keep existing entity IDs, including the original harbour's `0`. Allocate newly
claimed harbours through the shared `nextId`; never assign `0` to every harbour.
Validate harbour, building, walker and wildlife IDs globally. City IDs remain
stable identities, not array positions.

## Save schema and claims

Version 10 adds `World.nextCityId`, a stable allocator for City ids kept
separate from the shared entity `nextId`. Migrating any earlier version derives
it from the single legacy city's existing id (`id + 1`); a v9 save must still
contain exactly one City to migrate, matching what the engine could ever
actually have produced, and a malformed N-city v9 is refused rather than split.
There is one v10 shape; nothing observes an intermediate "v10 without
nextCityId".

`deserializeWorld` keeps its existing local policy: exactly one City, so the
current single-player UI can never load an empty or multi-city save.
`deserializeSharedWorld` is the separate entry point for a future server: the
same validation, but 0 to `ISLAND_COUNT` Cities. Both share one core that
validates, per save: every building/walker/wildlife id and every harbour id are
globally unique across all Cities (at most one harbour may keep the legacy `0`);
every City id is unique and below `nextCityId`; every City's home island is
unique; no two Cities' roads, buildings, or founded harbours physically share a
tile; and a walker's home/target only ever resolves against its own City's
buildings. A pending City's placeholder harbour site is excluded from the
overlap check, matching construction-time occupancy, but its id is still
reserved and validated. Legacy off-home infrastructure is still accepted for a
City's own records; the overlap check only rejects two different Cities
physically colliding. Time, remainder, felled trees and regrowth are shared
fields with no per-City invariant, except that they must all still be zero
while every City in the save remains pending — nothing could have advanced
them otherwise.

`src/sim/claims.ts` is a trusted internal API, not yet a `CityCommand`: no
networking, identity, or ownership check is wired up. `claimIsland(world, home)`
validates the home island, rejects it if any City (founded or pending) already
claims it or if another City's legacy infrastructure already physically
occupies it, and only then allocates a City id from `nextCityId` and a harbour
id from `nextId` and appends the new pending City — nothing else in the World
changes, and a rejected claim mutates nothing. `createSharedWorld(seed)` is the
empty canonical archipelago a future server starts from: shared wildlife and
`nextId` spawned once, `cities: []`, `nextCityId: 1`. `createWorld` and local
founding are unchanged; a locally created city keeps harbour id `0`.

## Ownership and presentation

An authenticated actor and a requested city are separate inputs. The server
resolves the city, checks its owner, then executes the command. Client-supplied
player or owner fields confer no authority. Island claims must be atomic.

Viewing a city grants no writes. Keep viewed/active city IDs in client UI state,
not by reordering or replacing World.cities. Founding another city must not reset
the archipelago; retain a separate, clearly labelled local-world reset action.

Whole-world checkpoint undo is only safe in local single-city play; `canUndoConstruction`
already refuses whenever either World holds more than one city. Disable it further
before independent owners can issue commands. Clearing history on a city switch
alone is insufficient. A future shared undo would need an authorized compensating
command, not snapshot rollback.

## Authoritative server

One server owns one World. Clients submit identified commands, not replacement
Worlds. Authenticate reconnects with opaque credentials kept outside public world
snapshots. Reject foreign commands without mutation; deduplicate request IDs.

The server advances while a connection remains and pauses when empty. Personal
menus and hidden tabs cannot pause other players' economies. Clients render
server snapshots rather than relying on cross-engine floating-point lockstep.
Persist world and identity mappings consistently; never silently replace an
unreadable server save with a fresh world.

Production deployment deletes and replaces the checkout. Keep server state in a
persistent Docker volume outside that checkout, not beside the source or build.
Redeployment must preserve that volume and the stored identities.

## Acceptance checks

- Two cities sustain separate village loops, treasuries, workforces and deliveries.
- Both advance regardless of which is viewed; shared time and ecology step once.
- A pending newcomer survives save/load after the world has advanced.
- Duplicate claims, foreign commands and cross-city walker references are rejected.
- Legacy outposts and existing IDs survive migration without reassignment.
- Global occupancy blocks overlap; local logistics cannot borrow another city's stores.
- Two clients reconnect to the same persisted world; one remaining client keeps
  every city running, and the last disconnect pauses it.

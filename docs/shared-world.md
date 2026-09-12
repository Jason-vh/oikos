# Shared-world implementation

Implementation notes for phase 1 of [the roadmap](../roadmap.md), not a claim
that multiplayer has shipped. The current game remains local and single-city.

## One canonical world

Terrain, time, remainder, the entity allocator, wildlife, felled trees and regrowth
belong to World. Settlement metadata, roads, buildings and walkers belong to City.
The collection move landed in version 9. Read-only queries (grid routing and map
helpers, placement/road-path/founding previews, construction and logistics
queries, getSummary/buildingStatus/walkerStatus) and construction commands
(build, placeRoadPath, demolish, setVendor, foundHarbour, applyCommand) now take
an explicit City. The economic simulation tick (staffing, production, delivery,
housing, finances) is the next step.

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

Keep existing entity IDs, including the original harbour's `0`. Allocate newly
claimed harbours through the shared `nextId`; never assign `0` to every harbour.
Validate harbour, building, walker and wildlife IDs globally. City IDs remain
stable identities, not array positions.

## Ownership and presentation

An authenticated actor and a requested city are separate inputs. The server
resolves the city, checks its owner, then executes the command. Client-supplied
player or owner fields confer no authority. Island claims must be atomic.

Viewing a city grants no writes. Keep viewed/active city IDs in client UI state,
not by reordering or replacing World.cities. Founding another city must not reset
the archipelago; retain a separate, clearly labelled local-world reset action.

Whole-world checkpoint undo is only safe in local single-city play. Disable it
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

## Acceptance checks

- Two cities sustain separate village loops, treasuries, workforces and deliveries.
- Both advance regardless of which is viewed; shared time and ecology step once.
- A pending newcomer survives save/load after the world has advanced.
- Duplicate claims, foreign commands and cross-city walker references are rejected.
- Legacy outposts and existing IDs survive migration without reassignment.
- Global occupancy blocks overlap; local logistics cannot borrow another city's stores.
- Two clients reconnect to the same persisted world; one remaining client keeps
  every city running, and the last disconnect pauses it.

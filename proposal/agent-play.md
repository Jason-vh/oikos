# Agents playing Οἶκος

Exploration, not a commitment. An MCP server that lets a language-model agent
found and run a city — locally for experiments, and on the shared authority as an
ordinary player.

## Why this is worth doing

- **Balance evidence.** The roadmap wants "several viable layouts" and
  "recoverable decline". Agents can play the starter loop dozens of times per
  change and report what actually happens, which the deleted browser walkthroughs
  never did.
- **A diagnostics forcing function.** An agent sees exactly what the HUD says.
  If it cannot work out why a house is decaying, neither can a player.
- **Shared-world load.** Filling islands with agent citizens exercises claiming,
  offline continuation, and reconnection under real traffic.
- **Play.** An agent neighbour on the archipelago is the cheapest version of
  "another player's island becomes relevant".

## What already exists

Acting is solved. `CityCommand` in `src/sim/commands.ts` is the whole verb set —
`build`, `roadPath`, `demolish`, `vendor`, `foundHarbour` — already validated
against hostile input, already the boundary the authority enforces ownership on.
An agent needs no new mutations.

Judging is solved too, in the form the HUD uses: `getSummary(city)`,
`buildingStatus(city, building)`, `harbourStatus`, `walkerStatus` return short
English sentences ("Harvest ready, but no granary to send it to.").

## What is missing

Seeing. Measured on a starter neighbourhood at five minutes:

| Datum | Size |
| --- | --- |
| `serializeWorld(world)` | 437 KB (2358 wildlife dominate) |
| Archipelago grid | 538 × 230 tiles |
| One island as one char per tile | 9.4 KB, ~2.7k tokens |
| A 48 × 32 window | 1.6 KB |

A snapshot is unreadable and a full-island map is too expensive per turn. The
work is a **projection**: a small, pure reader over `World` that answers the
questions a player answers by looking.

## Shape

```
src/agent/view.ts      World + City -> text (survey, report, inspect)
src/agent/session.ts   AgentPort: snapshot() + submit(CityCommand)
scripts/mcp.ts         stdio MCP server over an AgentPort
```

`src/agent/` reads simulation state and never writes it; commands go through
`applyCommand`, exactly like the renderer and the UI. No DOM, no Three.js, no new
sim concepts.

Two ports behind one tool surface:

- **Local** — own the `World` in process, `advance(world, seconds)` on request.
  Deterministic, free, no server, no wall clock. This is the eval substrate.
- **Shared** — wrap `SharedSession` (`src/ui/shared-session.ts`) against a
  running authority. Same tools; time passes in wall-clock and `advance` becomes
  `wait`.

Build local first. The shared port is a transport swap, not a redesign.

## Tools

Observation:

- `survey` — island bounds, entry, terrain legend and counts, ASCII map, windowed
  around the city by default, full island on request.
- `report` — treasury, `getSummary`, harbour progress, buildings with their
  status lines, walkers counted by kind rather than listed.
- `inspect` — one tile or one building: terrain, level, occupant, road link,
  the same status text a click shows.
- `check_placement` — dry run through `placement()`/`roadPathPlacement()`,
  returning cost, tiles, and the refusal reason. Free, pure, already written.

Action: `build`, `lay_road`, `demolish`, `set_vendor`, `found_harbour`,
`claim_island`.

Clock: `advance` (local) / `wait` (shared).

`check_placement` is the tool that makes agents playable at all: it turns
building into propose-then-commit instead of guessing against a treasury.

A `connect(from, to)` road tool built on `roadReachable` is tempting and should
wait. Pathing for the player is a design question, not an affordance to hand an
agent quietly.

## Decisions to make

- **MCP SDK or hand-rolled.** Settled: `@modelcontextprotocol/sdk`, as a dev
  dependency, out of the browser bundle. Its stdio transport pulls in nothing but
  `node:process` — express and hono sit behind the HTTP transports and are never
  loaded — and it runs under Bun, which `src/agent/mcp.test.ts` proves by spawning
  the real server. Each tool is declared once as a zod schema: the SDK validates
  arguments against it and publishes it, so there is no second hand-written copy
  of the contract to drift.
- **Map encoding.** One char per tile reads well and costs ~2.7k tokens per
  island. Windows plus a coarse overview are probably right, but this needs an
  agent actually playing to settle.
- **Shared identity.** `/api/session/join` admits anyone under a name and returns
  a cookie. An agent needs a credential file and a name convention that makes
  agent citizens legible to humans in the world.
- **Cheating boundary.** The local port could expose anything — terrain oracles,
  wildlife positions, future harvests. It should expose what a player can see,
  or the balance evidence it produces is worthless.

## Delivery

1. Projection layer plus tests: `survey`, `report`, `inspect`, `check_placement`
   over a fixed seed. No MCP yet, no dependency.
2. Local MCP server: `scripts/mcp.ts`, the command tools, the clock, save/load of
   a slot for repeatable runs.
3. Shared port: `SharedSession` behind the same tools, claiming and founding
   included.
4. Evals: scripted scenarios scored on reaching the healthy-neighbourhood goal,
   run against balance changes.

Each is an independent merge request well under the size limit.

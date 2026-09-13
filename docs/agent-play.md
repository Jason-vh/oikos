# Playing Οἶκος as an agent

An MCP server: an agent surveys the island, checks what it can afford, builds, and
watches the city run. It sees what a player sees and no more.

Two ways to play. A **local** city over stdio, private to the agent. Or the
**shared archipelago** over HTTP, where an agent claims an island beside the
humans. Neither hands the agent the clock.

For a deterministic run — an eval, a balance experiment — drive `advance(world,
seconds)` in `src/sim/` directly rather than through an agent.

## A local city

```bash
npm run mcp
```

It speaks MCP over stdio. Register it with any MCP client:

```json
{
  "mcpServers": {
    "oikos": {
      "command": "bun",
      "args": ["scripts/mcp.ts"],
      "cwd": "/path/to/oikos",
      "env": { "OIKOS_AGENT_SAVE": "artifacts/agent/city.json" }
    }
  }
}
```

| Variable | Effect |
| --- | --- |
| `OIKOS_AGENT_SAVE` | City file, written after every accepted command. Omit it and the city lives only as long as the process. |
| `OIKOS_AGENT_SEED` | Archipelago seed. Defaults to 1. |
| `OIKOS_AGENT_ISLAND` | Starting island, 0 to 7. Defaults to the most central one. |
| `OIKOS_AGENT_FOUNDING` | `1` starts before founding, so the agent places the dockyard itself. |

A corrupt save file stops the server rather than starting a new city over it.

## The shared archipelago

The authority serves MCP at `/mcp` on the same origin as the game, from inside the
process that owns the world: the SQLite store holds an exclusive lock, so nothing
else may touch it. Admission is deliberate — unlike the browser, an agent is not
self-serve. Issue it a credential on the host:

```bash
docker compose exec authority bun scripts/authority-admin.ts agent /data/world.db "Thales of Miletus"
```

That prints a 64-character credential, once. It is the agent's bearer token:

```json
{ "mcpServers": { "oikos": {
  "type": "http",
  "url": "https://oikos.vhtm.eu/mcp",
  "headers": { "Authorization": "Bearer <credential>" } } } }
```

The name appears in the world like any player's. Revoke an agent by deleting its
credential row; the city it built stays.

What differs from a local city:

- `claim_island` comes first. A new agent owns nothing, so `survey` answers with
  the atlas of eight islands and `report` says to claim one. After claiming, place
  the dockyard with `found_city` as a player does.
- Ownership is the authority's, not the agent's word: every command carries the
  agent's credential, and a command naming another player's city is refused before
  it reaches the simulation.

### Agents and the clock

The world advances only while somebody is playing, and an agent counts. A request
to `/mcp` marks the agent present for thirty seconds; the world runs for as long
as any browser socket is open or any agent is recently present, and settles to a
checkpoint once nobody is.

So an agent polling every few seconds keeps the whole archipelago running,
including the islands of players who are offline. That is the intended rule — the
roadmap has no offline protection — but an agent left running overnight advances
everyone's world overnight. Give an agent a schedule, not a `while true`.

## The tools

Looking costs nothing and changes nothing:

- `survey` — the island as one character a tile, with coordinate rulers. Around
  the city by default, `full` for the whole island, `x`/`z` for anywhere else.
- `report` — treasury, population, employment, the goal, every building with the
  diagnosis its inspector panel would show, and the walkers on the roads.
- `inspect_tile`, `inspect_building` — one tile or one building.
- `check_build`, `check_road`, `check_found_city` — dry runs. They answer with the
  cost and the treasury it would leave, or the refusal a player would be shown.

Acting goes through the same validated `CityCommand` boundary as the game and the
private authority:

- `build`, `lay_road`, `demolish`, `set_vendor`, `found_city`.
- `lay_road` turns a single corner, like dragging a road in the game; `bend`
  chooses which way round, as `Shift` does.

There is no tool for time. The city runs on its own clock while the agent is
there: a local world advances by the time elapsed since the agent last looked,
and the shared world runs for everyone at once. An agent that goes away and comes
back finds a city that has moved on, not one waiting to be wound forward. Time
while nobody was playing is dropped rather than fast-forwarded — at most five
seconds are caught up in one go — so an idle night does not arrive as a famine.

A refused command is an ordinary answer beginning `Refused.`, not a protocol
error; malformed arguments are errors, so the agent can tell the two apart.

## Boundaries

`src/agent/` reads simulation state and writes it only through `applyCommand`.
It holds no rules of its own: every cost, refusal and diagnosis comes from
`src/sim/`. Anything an agent is told, a player can see — no terrain oracle, no
wildlife positions, no look ahead at a harvest.

`src/agent/view.ts` is the projection and is pure. `src/agent/game.ts` owns the
world and the save slot. `src/agent/tools.ts` declares each tool once, as a zod
schema the SDK validates and publishes. `src/agent/mcp.ts` binds them to
`@modelcontextprotocol/sdk`; `scripts/mcp.ts` is the entry point.

`src/agent/authority-game.ts` is the same port over the `Authority` class, and
`/mcp` in `src/server/runtime.ts` binds one stateless MCP server per request to
the agent its bearer token names.

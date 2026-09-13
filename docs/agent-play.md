# Playing Οἶκος as an agent

An MCP server over a local city: an agent surveys the island, checks what it can
afford, builds, and asks for time to pass. It sees what a player sees and no more.

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

Time is explicit:

- `pass_time` runs the simulation for up to 600 simulated seconds and answers with
  the report that resulted. Nothing moves between calls, so a slow agent and a
  fast one play the same game.

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

The shared archipelago is next: the same tools against a running authority, with
claiming and ownership, so an agent can settle an island beside a human.

# Seeing your change

Three surfaces, and the one you want is usually not the first one you reach for.

| Surface | What it is for | Command |
| --- | --- | --- |
| `/` | The shared game: sessions, claims, prediction, the HUD | `npm run play` |
| `/sandbox.html` | One local island, no HUD, no server — terrain and road art | `npm run dev` |
| `/art.html` | One model at a time, with a construction scrubber | `npm run dev` |

## The shared game

```bash
npm run play                 # authority + Vite against artifacts/dev/world.db
npm run play -- --fresh      # start the archipelago over
```

The world is a file under `artifacts/`, not the checkout, and it survives between
runs. Kalliste has eight islands and a claim is permanent, so a few founding runs
exhaust it: when a shore can no longer be found, use `--fresh` rather than looking
for the bug. `--agent "<name>"` prints an MCP credential before the server takes
its exclusive lock on the database, which is the only moment one can be issued.

`npm run dev` alone serves the pages but has no authority behind it, so `/` will
sit at *Cannot reach the world* forever. That is a missing server, not a broken
client.

A page load fetches `/api/world/preview` first: it carries the world and whether
the cookie is known. An unknown visitor gets that world rendered behind the join
modal and no socket is attempted until the join sets a cookie.

## Scripting the shared game

`/?debug` puts `window.oikos` on the page. It sends through the same validated
`CityCommand` boundary and the same session the HUD uses, so a script drives the
real path rather than a parallel one — and the authority still refuses anything a
player could not do.

```js
await oikos.settled();                        // the authority has caught up
oikos.checkClaim(x, z, rotation);             // dry run, as the preview does
await oikos.claim(x, z, rotation);            // resolves when the receipt lands
await oikos.build('house', x, z);
await oikos.road([{ x, z }, { x: x + 1, z }]);
oikos.select(x, z);                           // inspect, as a click would
oikos.state; oikos.session; oikos.status;     // predicted world, cursor, phase
oikos.log;                                    // every protocol frame, both ways
```

Actions resolve when the authority answers, so await them instead of sleeping.
`oikos.log` is the ring buffer to read first when something hangs: it records
what the client sent and what it received, which is enough to place a fault on
one side of the socket or the other.

`/?debug&latency=250` delays what the client sends. Prediction and reconciliation
are invisible over loopback and obvious at 250 ms.

## Browser automation

Launch the full browser, not Playwright's headless shell. `launchGameBrowser()`
in `scripts/sandbox-page.mjs` is the one way in:

```js
const browser = await launchGameBrowser();     // chromium.launch({ channel: 'chromium' })
```

The headless shell renders through SwiftShader, which is far too slow for an
archipelago of this size: a scrubbed construction sequence that finishes in
seconds under real Chromium runs for minutes, and often never finishes at all.
It is also slow enough that the page cannot drain its WebSocket. Control frames then queue behind the wildlife
snapshots — 90 KB a second — and a receipt can arrive fifteen seconds late, by
which time the client has given up and reported *Connection lost*. It reads
exactly like a protocol bug and is only the renderer. The same run under
`channel: 'chromium'` answers in single-digit milliseconds.

Never quote a frame time, a long task or a click latency measured under the
headless shell.

`scripts/play-smoke.mjs` is the worked example; `npm run smoke:play` runs it
against whatever `npm run play` is serving. Only `/art.html`, which draws one
model, is light enough for the shell.

## Reading the world while it runs

The authority holds an exclusive lock on its database for its whole lifetime, so
SQLite cannot be opened beside it. Read it through the game instead: `oikos.state`
on a `?debug` page is the whole shared world, because a snapshot already carries
it. For an agent's view, give yourself a credential with `--agent` and talk to
`/mcp`; see [Playing as an agent](agent-play.md).

## What the server is doing

```bash
OIKOS_LOG=1 npm run play
```

Traces sockets opening and closing, every request with its status, every control
frame with what `send` returned, and every snapshot dropped for backpressure.
Without it the transport is silent, including its failures.

## Before merging

`npm run check` — build, tests, art captures, the construction smoke, and the
play-loop smoke on a throwaway world. Model changes also want `npm run art:check`
and a look at the game, per [art tooling](art-tooling.md).

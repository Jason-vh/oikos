# Private shared server

The playable `/` remains local. This server has no game UI or static hosting yet.
Use Bun 1.4.2 or newer (`npm ci` installs the verified 1.4.2 runtime for npm
scripts). Older Bun versions can hang while stopping backpressured WebSockets;
the factory refuses them. Explicitly initialize SQLite outside the checkout:

```bash
npm ci
npm run authority -- init /absolute/persistent/world.db
OIKOS_DB=/absolute/persistent/world.db OIKOS_PUBLIC_ORIGIN=https://game.example npm run server
```

The server exclusively locks its database for its lifetime. Never initialize over
an existing database. Admission is open: anyone reaching the configured origin may
join under a name of their choosing. A player is their cookie and nothing else;
there is no recovery endpoint, so a lost cookie is a lost city.
`PORT` defaults to 3000; `OIKOS_HOST` defaults to 127.0.0.1. Terminate HTTPS at a
trusted same-origin proxy forwarding HTTP and WebSocket upgrades. Forwarded IP
headers are deliberately ignored: admission quotas use the TCP peer, so proxied
admissions share a quota. HTTP public origins are allowed only on loopback for
development. Cookies remain Secure even there. Never expose this private service
without the configured HTTPS origin. `/healthz` reports liveness without state.
SIGINT/SIGTERM checkpoint and stop; storage faults stop the listener and exit 1.

## Protocol 3

POST `/api/session/join`, exact configured `Origin`, `application/json`, and
`{"name":"<1–24 characters>"}` (maximum 1 KiB) admits a player. Names are trimmed,
reject control characters, need not be unique, and are stored on the actor row.
Success returns only `{"ok":true}` and `__Host-oikos=<credential>; Path=/; HttpOnly;
Secure; SameSite=Strict; Max-Age=31536000`. All application responses are `no-store`.
An authenticated browser cannot join again. Unusable names and a full realm fail
normally. Joins allow five attempts/minute/IP, burst five, and the realm holds at
most 1024 actors.

GET `/api/world` upgrades only with that exact Origin and an authenticated cookie.
A client sends:

```json
{"type":"request","binding":"<session binding from snapshot>","requestId":"00000000000000000000000000000001","seq":1,"operation":{"kind":"claim","home":0}}
```

A claim is `{"kind":"claim","x":…,"z":…,"rotation":0-3}`: it places the player's
harbour, claims that island and founds a city named after the actor. Commands use
`{"kind":"command","cityId":1,"command":<CityCommand>}`. Outer
fields are exact. Pure normalization parses inner command data for replay
fingerprints; dispatch executes only after explicit city authorization. There are
no actor, World replacement or clock inputs.
Request IDs are 32 hex or UUID; sequences are positive safe integers.

A durable processed/replayed result produces
`{type:"receipt",requestId,seq,result:{ok,reason,status,cityId?}}`, then a current
snapshot at the next permitted send. Non-consuming refusals produce
`{type:"reject",code,session}`. Codes: `invalid-request`, `unauthenticated`, `gap`,
`conflict`, `pruned`, `exhausted`, `rate-limited`, `session-mismatch`. Never parse human reasons.
Logical failures consume a sequence and receipt without changing World.

Snapshots are `{type:"snapshot",protocol:3,realmId,streamId,serial,session,world}`.
Session contains only `binding`, `ownedCityIds`, `nextSeq` (null at exhaustion), and
`receiptWatermark` (highest pruned sequence). `realmId` persists across restarts;
`streamId` is fresh each lifetime; serial increases within that stream. Public
packets contain no actor identities, credentials or ownership table. Validate World
with `deserializeSharedWorld`, not the local-game loader.

`binding` is a domain-separated SHA-256 of realm and credential, not the credential,
its stored hash, or an actor ID. It is not accepted for authentication; its safety
relies on the generated credential's 256-bit entropy. It remains stable across reconnects/restarts,
but changes with realm or credential. Every request must match its authenticated
socket's binding before dispatch; mismatch consumes nothing. Binding never grants
authentication. Persist pending requests with realm and binding, and never rewrite
them for a replacement login, including a different actor in the same realm.

Automatic recovery replays the exact envelope only when a matching snapshot proves
its sequence was consumed. Unconsumed/future journals require explicit resolution:
a failed journal clear may hide a prior rejection. Never automatically rewrite or
reapply conflicting, expired, or indeterminate requests.
A fresh user retry requires a new ID and current cursor. Receipts retain 256
sequences per actor. Multiple sockets share that actor's sequence and rate bucket.

## Clock and bounds

A monotonic 250 ms loop advances every founded city while a socket is OPEN.
Zero OPEN sockets pause; opening the first socket resets the anchor. Requests and last
close settle elapsed time. Gaps over five seconds are pauses, not catch-up.
Tick-only changes checkpoint every five seconds and on last close/graceful stop.
Successful mutations already persist current World; replay and logical failure
do not clear dirty tick state. Checkpoint fences and exhaustion fail closed.

Requests allow 64 KiB, eight/second/actor with burst 16. Limits are 64 sockets
total and eight/actor. Snapshots are gzip binary frames, at most four/second per
socket, with one shared serialized World per broadcast; clients inflate them and
must keep packet order. Control packets stay text.

A consumed sequence snapshots its author immediately, past that cap: the receipt
alone does not release the client's next write, so the reconciling snapshot must
not wait for the loop. Its cost is bounded by the sender's own request budget.
It rides beside the steady rhythm rather than displacing it: an early frame leaves
the socket's interval where it was, so the next tick still lands on time and a
client keeps interpolating walkers against an even cadence. Rejects, peers and
ticks keep the four-Hz cap.

Wildlife travels on the same packet at its own once-a-second cadence, as
`wildlife: Animal[] | null`; the World beside it always carries an empty wildlife
array. Null means unchanged, and a client keeps the animals it holds. A handshake
snapshot must carry them, so a connection never starts without a complete World.
This is what keeps an action's frame small: the cities, roads, buildings and
walkers of a fresh archipelago gzip to 133 bytes, its 2,344 animals to 93 KB.

permessage-deflate is off. Bun drops compressed browser-to-server frames, so
negotiating it silently loses every request; application gzip replaces it. A
backpressured socket skips snapshots until writable; there is no application
snapshot queue. Receipts and rejects are sent even when a snapshot is still
draining, and only a failed send terminates the socket. Bun's outgoing buffer
limit is 1 MiB with closure on overflow.

Run `npm test`, `npm run typecheck`, and `npm run build`. Transport tests use
real ephemeral listeners and temporary SQLite; only the private factory clock
and scheduler are injected. No HTTP debug controls exist.

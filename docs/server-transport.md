# Private shared server

The playable `/` remains local. This server has no game UI or static hosting yet.
Use Bun 1.4.2 or newer (`npm ci` installs the verified 1.4.2 runtime for npm
scripts). Older Bun versions can hang while stopping backpressured WebSockets;
the factory refuses them. Explicitly initialize SQLite outside the checkout:

```bash
npm ci
npm run authority -- init /absolute/persistent/world.db
npm run authority -- invite /absolute/persistent/world.db
OIKOS_DB=/absolute/persistent/world.db OIKOS_PUBLIC_ORIGIN=https://game.example npm run server
```

Issue invites while stopped: the server exclusively locks its database for its
lifetime. Treat invite stdout as a secret, never a log. There is no public invite
creation or recovery endpoint. Never initialize over an existing database.
`PORT` defaults to 3000; `OIKOS_HOST` defaults to 127.0.0.1. Terminate HTTPS at a
trusted same-origin proxy forwarding HTTP and WebSocket upgrades. Forwarded IP
headers are deliberately ignored: admission quotas use the TCP peer, so proxied
admissions share a quota. HTTP public origins are allowed only on loopback for
development. Cookies remain Secure even there. Never expose this private service
without the configured HTTPS origin. `/healthz` reports liveness without state.
SIGINT/SIGTERM checkpoint and stop; storage faults stop the listener and exit 1.

## Protocol 1

POST `/api/session/redeem`, exact configured `Origin`, `application/json`, and
`{"invite":"<64 hex>"}` (maximum 1 KiB) admits a single-use invite. Success returns
only `{"ok":true}` and `__Host-oikos=<credential>; Path=/; HttpOnly; Secure;
SameSite=Strict; Max-Age=31536000`. All application responses are `no-store`.
Authenticated browsers cannot redeem another invite. Bad, used and full-world
invites fail normally. Admissions allow five attempts/minute/IP, burst five.

GET `/api/world` upgrades only with that exact Origin and an authenticated cookie.
A client sends:

```json
{"type":"request","requestId":"00000000000000000000000000000001","seq":1,"operation":{"kind":"claim","home":0}}
```

Commands use `{"kind":"command","cityId":1,"command":<CityCommand>}`. Outer
fields are exact. Pure normalization parses inner command data for replay
fingerprints; dispatch executes only after explicit city authorization. There are
no actor, World replacement or clock inputs.
Request IDs are 32 hex or UUID; sequences are positive safe integers.

A durable processed/replayed result produces
`{type:"receipt",requestId,seq,result:{ok,reason,status,cityId?}}`, then a current
snapshot at the next permitted send. Non-consuming refusals produce
`{type:"reject",code,session}`. Codes: `invalid-request`, `unauthenticated`, `gap`,
`conflict`, `pruned`, `exhausted`, `rate-limited`. Never parse human reasons.
Logical failures consume a sequence and receipt without changing World.

Snapshots are `{type:"snapshot",protocol:1,realmId,streamId,serial,session,world}`.
Session contains only `ownedCityIds`, `nextSeq` (null at exhaustion), and
`receiptWatermark` (highest pruned sequence). `realmId` persists across restarts;
`streamId` is fresh each lifetime; serial increases within that stream. Public
packets contain no actor identities, credentials or ownership table. Validate World
with `deserializeSharedWorld`, not the local-game loader.

Reconnect may replay the exact pending envelope after acknowledgement loss.
Conflicting/expired envelopes must never be automatically rewritten or reapplied.
A fresh user retry requires a new ID and current cursor. Receipts retain 256
sequences per actor. Multiple sockets share that actor's sequence and rate bucket.

## Clock and bounds

A monotonic 250 ms loop advances every founded city while a socket remains.
Zero sockets pause; joining the first socket resets the anchor. Requests and last
close settle elapsed time. Gaps over five seconds are pauses, not catch-up.
Tick-only changes checkpoint every five seconds and on last close/graceful stop.
Successful mutations already persist current World; replay and logical failure
do not clear dirty tick state. Checkpoint fences and exhaustion fail closed.

Requests allow 64 KiB uncompressed, eight/second/actor with burst 16. Limits are
64 sockets total and eight/actor. Snapshots are compressed, at most four/second
per socket, with one shared serialized World per broadcast. A backpressured socket
skips snapshots until writable; there is no application snapshot queue. Bun may
hold one already-enqueued snapshot (send returns -1); it is never resent. Control
traffic cannot accumulate behind it: immediate termination and exact replay
instead, including when a control send itself reports backpressure. Bun's
outgoing buffer limit is 1 MiB with closure on overflow.

Run `npm test`, `npm run typecheck`, and `npm run build`. Transport tests use
real ephemeral listeners and temporary SQLite; only the private factory clock
and scheduler are injected. No HTTP debug controls exist.

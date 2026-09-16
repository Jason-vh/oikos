# Deployment

```text
https://oikos.vhtm.eu
```

Oikos on the shared `vhtm-eu` VM: the local game as static files, and the private
shared archipelago behind the same origin. Architecture and conventions live in
<https://github.com/Jason-vh/vhtm.eu>.

## Architecture

```text
client
  -> https://oikos.vhtm.eu
  -> exe.dev edge (TLS)
  -> vhtm-eu :8080 → Caddy → 127.0.0.1:3010
  -> web container: Caddy serving dist/, proxying /api, /mcp and /healthz
  -> authority container: Bun serving the shared World from /data/world.db
```

The authority keeps its SQLite world on the named `world` volume, which outlives
the deploy directory: every deploy deletes and recreates `/home/exedev/apps/oikos`,
so nothing inside the checkout may hold state. The compose project is pinned to
`oikos`, so the volume keeps its name across deploys. Never run `docker compose
down -v`: that destroys the archipelago.

The store takes an exclusive lock for its whole lifetime, so exactly one authority
runs at a time and deploys briefly interrupt shared play. The static game keeps
serving throughout.

`OIKOS_PUBLIC_ORIGIN` must equal the browser's origin exactly: `/api/world` refuses
other origins, and the session cookie is `Secure`, `HttpOnly` and `SameSite=Strict`.

## One-time exe.dev / DNS setup

```bash
ssh exe.dev domain add vhtm-eu oikos.vhtm.eu

# DNS (Porkbun, vhtm.eu zone):
#   oikos.vhtm.eu  CNAME  vhtm-eu.exe.xyz
```

## One-time world setup

The authority refuses to start without an initialized store, and refuses to
initialize over an existing one. Create the world once:

```bash
cd /home/exedev/apps/oikos
docker compose run --rm authority bun scripts/authority-admin.ts init /data/world.db
docker compose up -d
```

## Deploy

Every push to `main` runs on the self-hosted runner labeled `oikos-prod`, builds
both images, recreates the containers, and reloads Caddy.

## Resetting the world after a format change

A world holds a seed and tile indices, not terrain, so changing the island
generator invalidates every stored world; `CURRENT_VERSION` is bumped to say so
(see [gameplay](../docs/gameplay.md)). The authority then refuses to start and
says which format it found:

```text
Authority store world data is corrupt or incompatible: stored format 14, this
authority reads 16.
```

It will not initialize over an existing store, so the old world has to go. Keep a
copy, then create the new one with the image that refused the old:

```bash
cd /home/exedev/apps/oikos
docker compose stop authority
docker run --rm -v oikos_world:/data -v "$PWD":/backup alpine \
  sh -c 'mv /data/world.db /backup/world-$(date +%F).db; rm -f /data/world.db-wal /data/world.db-shm'
docker compose run --rm authority bun scripts/authority-admin.ts init /data/world.db
docker compose up -d
```

Everyone loses their cities and rejoins under a city name. Announce it before, not
after. A format bump that only relabels the save, as version 16 does, carries a
migration instead: stored worlds are raised on load and nothing is lost.

## Operations

Admission is open: anyone who reaches the origin joins under a city name. Nothing
needs issuing.

Agents are not open. `/mcp` serves the shared world to agents over MCP, and takes
a bearer credential issued by hand:

```bash
docker compose exec authority bun scripts/authority-admin.ts agent /data/world.db "Thales of Miletus"
```

The credential is printed once and cannot be recovered; issue another if it is
lost. An agent request keeps the world running for thirty seconds, exactly as an
open browser socket does. See [playing as an agent](../docs/agent-play.md).

The store is WAL with `synchronous = NORMAL`: one fsync per checkpoint rather than
three per commit, and a power cut can lose the last few transactions — receipt and
world together, which the client resolves as indeterminate rather than as a lie.
A clean stop checkpoints the WAL away, so a backup taken with the authority stopped
is one file. Copying a running world needs `world.db-wal` beside it.

Back up before risky changes, with the authority stopped so the file is quiet:

```bash
docker compose stop authority
docker run --rm -v oikos_world:/data -v "$PWD":/backup alpine \
  cp /data/world.db /backup/world-$(date +%F).db
docker compose start authority
```

```bash
docker compose logs -f authority
docker compose ps
curl -I http://localhost:3010/
curl http://localhost:3010/healthz
```

Check the deployment by hand in a browser: the game loads, joining works, and the
world advances.

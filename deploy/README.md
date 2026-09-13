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
  -> web container: Caddy serving dist/, proxying /api and /healthz
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

## Operations

Invites need the database lock, so stop the authority first. Treat the printed
code as a secret: it admits one player, once.

```bash
ssh vhtm-eu.exe.xyz
cd /home/exedev/apps/oikos
docker compose stop authority
docker compose run --rm authority bun scripts/authority-admin.ts invite /data/world.db
docker compose start authority
```

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

An invite also buys an end-to-end check of a running deployment: it serves the
local game, redeems through the proxy, and claims an island on the real world.
Run it from a checkout with `npm ci` and Playwright available, and remember it
spends the invite and claims an island.

```bash
npm run smoke:deployment -- https://oikos.vhtm.eu <invite>
```

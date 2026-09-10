# Deployment

```text
https://zeus.vhtm.eu
```

Static Vite build of Thalassa hosted on the shared `vhtm-eu` VM. Architecture and
conventions live in <https://github.com/Jason-vh/vhtm.eu>.

## Architecture

```text
client
  -> https://zeus.vhtm.eu
  -> exe.dev edge (TLS)
  -> vhtm-eu :8080 → Caddy → 127.0.0.1:3010
  -> Caddy in the container serving dist/
```

No database, no env vars, no secrets.

## One-time exe.dev / DNS setup

```bash
ssh exe.dev domain add vhtm-eu zeus.vhtm.eu

# DNS (Porkbun, vhtm.eu zone):
#   zeus.vhtm.eu  CNAME  vhtm-eu.exe.xyz
```

## Deploy

Every push to `main` runs on the self-hosted runner labeled `zeus-prod`,
builds the image, brings up the container, and reloads Caddy.

## Operations

```bash
ssh vhtm-eu.exe.xyz
cd /home/exedev/apps/zeus
docker compose logs -f app
curl -I http://localhost:3010/
```

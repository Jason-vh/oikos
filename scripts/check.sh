#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-5181}"
AUTHORITY_PORT="${AUTHORITY_PORT:-3001}"
WORLD="$(mktemp -d)/world.db"
npm run build
npm test
npm run authority -- init "$WORLD"
OIKOS_DB="$WORLD" OIKOS_PUBLIC_ORIGIN="http://127.0.0.1:$PORT" PORT="$AUTHORITY_PORT" npm run server &
AUTHORITY=$!
OIKOS_AUTHORITY_PORT="$AUTHORITY_PORT" npx vite preview --host 127.0.0.1 --port "$PORT" --strictPort &
SERVER=$!
trap 'kill $SERVER $AUTHORITY' EXIT
npx wait-on "http://127.0.0.1:$PORT" "http://127.0.0.1:$AUTHORITY_PORT/healthz"
node scripts/art-capture.mjs "http://127.0.0.1:$PORT" artifacts/art
node scripts/construction-smoke.mjs "http://127.0.0.1:$PORT" artifacts/construction
node scripts/play-smoke.mjs "http://127.0.0.1:$PORT" artifacts/play

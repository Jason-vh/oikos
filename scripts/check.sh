#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-5181}"
npm run build
npm test
npx vite preview --host 127.0.0.1 --port "$PORT" --strictPort &
SERVER=$!
trap 'kill $SERVER' EXIT
npx wait-on "http://127.0.0.1:$PORT"
node scripts/art-capture.mjs "http://127.0.0.1:$PORT" artifacts/art
node scripts/construction-smoke.mjs "http://127.0.0.1:$PORT" artifacts/construction

# Οἶκος

Read `README.md`, `docs/dev-loop.md`, `docs/gameplay.md`, `docs/art-direction.md`,
and `docs/art-tooling.md` before changing the game.

`npm run play` runs the game. `/?debug` scripts it. Both are in `docs/dev-loop.md`,
along with why browser automation here must not use the headless shell.

## Boundaries

- Simulation belongs in `src/sim/`; no DOM or Three.js imports there.
- Rendering reads simulation state. Commands and simulation steps are the only writers.
- Art is authored in `src/art/`. Reuse the shared palette and primitives.
- Keep the approved painted-toy art style. Do not add detail to compensate for weak silhouettes.
- Do not reintroduce the legacy sprite game, extraction pipelines, or original assets.
- No code comments. Use explicit names and small, direct functions.

## Verification

- Behaviour changes: `npm test`, `npm run build`, and the browser smoke tests.
- Shared-game changes: `npm run smoke:play`, then play it yourself at `npm run play`.
- Suspect your own harness before the game. Read `oikos.log` and `OIKOS_LOG=1`
  before concluding the transport is broken.
- Model changes: `npm run art:check`, then `npm run art:capture` and look at the game.
- Judge models at normal city zoom, not only close-up. Check footprints from every side.
- Preserve paused/reduced-motion behaviour and local-save isolation between art tools and game.
- Keep screenshots under `artifacts/`; update canonical references deliberately, never automatically.

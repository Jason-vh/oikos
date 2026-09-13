# Shared-game browser verification

```sh
npm ci
npm test
npm run smoke:shared
npm run smoke:shared:live
npm run smoke:shared:recovery
```

Each browser command builds production assets first. Direct Bun invocation requires
`npm run build` beforehand. `npm run check` runs all three commands sequentially.
Never run them concurrently: frontend `127.0.0.1:5218` and authority
`127.0.0.1:5219` are strict, distinct ports. Occupied ports fail, never fall back.

Each run owns fresh temporary SQLite, real invites and isolated Chromium contexts.
The production page uses the real Stage/CityScene/HUD through a same-origin proxy.
Servers, browsers and temporary databases close on success, failure and signals.
No existing database, browser World setter or debug mutation command is used.

Core and recovery scripts inject the supported deterministic server clock. Valid
commands have independent cloned-World oracles; denials preserve known mutable
targets. Gestures observe blocked UI, then actual page readiness and reconciled
World/ownership before release. Recovery accepts native or cancellable DOM dialogs.
ACK interception is application-delivery loss, not TCP-unread loss; native WirePeer
tests separately cover unread-wire recovery.

The live script uses the unmodified production clock from cold admission onward,
with passive WebSocket observation. Reconciliation uses monotonic/stable fields;
the earliest restart snapshot must exactly equal the persisted World.

Headless Chromium renders through software GL, where the HUD's translucent blurs
cost whole seconds per repaint: a scripted click on the claim control measured
9.6s, and the published local game renders at about 2fps here too. The live pages
therefore use a smaller viewport and a 45s action timeout, which buys the software
renderer time without touching any assertion. Traces are opt-in through
`OIKOS_TRACE=1`; they are unnecessary weight on a passing run.

Keep two jointly held slices, each below 1000 additions/deletions:
1. Fixture, controls, core/live scripts, this document and their npm/check entries.
2. Recovery script and its npm/check entry; remove the old manual-invite smoke.
   Covers fresh realms, storage faults, bootstrap feedback/errors, reduced-motion
   poses, menus and desktop/mobile captures. Depends on slice 1.

Artifacts are retained per run under `artifacts/shared-browser/runs/`; root reports
point to the latest run. Traces include ephemeral authentication traffic: keep private.
Append `-- --baseline-a0` only to reproduce the rejected baseline: it verifies
unchanged a0 sources before allowing the camera-reload workaround. Default commands
never use it. Coordinate the corrected runtime hash before acceptance. Full village
logistics remain outside these browser scripts; all release slices stay jointly held.

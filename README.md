# Thalassa

A living Aegean miniature. Build a small island neighbourhood around real road-bound
food deliveries, water carriers, and caretakers.

```bash
npm install
npm run dev
```

- `/` — playable island; autosaves locally, never to a server.
- `/miniature.html` — approved harbour composition benchmark.
- `/art.html` — isolated model viewer.

## Play

Build four dwellings beside the harbour road. Grow wheat on the fertile eastern
fields, store it in a granary, then add a food vendor to an agora. Connect everything
with roads. Add a fountain and maintenance post. Reliable food and water evolve
homes into cottages and courtyard houses.

Left-click builds or inspects. Drag to lay roads. Right-drag pans; scroll zooms;
Alt-drag orbits. `1`–`7` select construction tools, `X` demolishes, `R` rotates a
building, `Q` rotates the camera, `Escape` inspects, and `Space` pauses.
On touchscreens, use two fingers to pan/zoom.

## Development

```bash
npm test
npm run build
npm run art:check
npm run smoke -- http://localhost:5180/?debug
npm run art:capture -- http://localhost:5180
```

- [Gameplay and first-island scope](docs/gameplay.md)
- [Art direction](docs/art-direction.md)
- [Model authoring and visual checks](docs/art-tooling.md)
- [Deployment](deploy/README.md)

`src/sim/` owns serializable, deterministic game state; `src/render/` reads it.
`src/art/` owns procedural models; `src/ui/` provides the interface. No original
Zeus assets or sprite pipelines are used. Legacy work is preserved at Git tag
`archive/pre-miniature-restart`.

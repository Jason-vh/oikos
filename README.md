# Οἶκος

Live at <https://oikos.vhtm.eu>.

*Οἶκος* (oikos): the household, root of *economy*. A city builder on the Aegean:
settle an island, feed and water its households along real roads, hunt, fell,
farm and trade your way to a thriving city. The first island is Kalliste.

```bash
npm install
npm run dev
```

- `/` — playable island; autosaves locally, never to a server.
- `/art.html` — isolated model viewer.

## Play

Build four dwellings beside the harbour road. Grow wheat on the fertile striped
fields, store it in a granary, then add a food vendor to an agora. Connect everything
with roads. Add a fountain and maintenance post. Reliable food and water evolve
homes into cottages and courtyard houses.

Left-click builds or inspects. Drag to lay roads. WASD / arrow keys or right-drag
pan; scroll zooms; Alt-drag orbits. `1`–`7` select construction tools, `X` demolishes, `R` rotates a
building, `G` toggles the grid, `Q` rotates the camera, and `Space` pauses.
`Escape` cancels the current tool, or opens the menu (save, load, new island,
model atelier). On touchscreens, use two fingers to pan/zoom.

## Development

```bash
npm run check                                   # build, tests, browser walkthrough, art captures (run before merging; CI runs tests and build only)
npm run smoke -- http://localhost:5180/?debug   # gameplay walkthrough against a running dev server (append &lean for a fast, unshaded run)
npm run art:capture -- http://localhost:5180    # model captures into artifacts/art
```

- [Gameplay and first-island scope](docs/gameplay.md)
- [Art direction](docs/art-direction.md)
- [Model authoring and visual checks](docs/art-tooling.md)
- [Deployment](deploy/README.md)

`src/sim/` owns serializable, deterministic game state; `src/render/` reads it.
`src/art/` owns procedural models; `src/ui/` provides the interface. No original
Zeus assets or sprite pipelines are used. The project began as a Zeus: Master of
Olympus homage; that work is preserved at Git tag `archive/pre-miniature-restart`.

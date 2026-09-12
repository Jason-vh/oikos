# Οἶκος

Live at <https://oikos.vhtm.eu>.

*Οἶκος* (oikos): the household, root of *economy*. A city builder on the Aegean:
settle an island, feed and water its households along real roads, hunt, fell,
farm and trade your way to a thriving city. Kalliste is an archipelago of eight
islands; you start on the most central one, or choose another through Menu → New
island. Each has a prepared landing road. On a new island, place your founding
dockyard beside that road before building homes; the rest remain unsettled.

```bash
npm install
npm run dev
```

- `/` — playable archipelago; autosaves locally, never to a server.
- `/art.html` — isolated model viewer.

## Play

Build four dwellings beside the harbour road. Grow wheat on the fertile striped
fields, store it in a granary, then add a food vendor to an agora. Connect everything
with roads. Add a fountain and maintenance post. Reliable food and water evolve
homes into cottages and courtyard houses. Fell forest for lumber: porters carry it
to the harbour, enough rebuilds the quay in stone, and a trade order ships it
overseas for coin.

Left-click builds or inspects. Drag to lay roads. WASD / arrow keys or right-drag
pan; scroll zooms; Alt-drag orbits. `1`–`0` select construction tools, `X` demolishes, `R` rotates a
building, `G` toggles the grid, `Q` rotates the camera, `H` returns to the village,
and `Space` pauses. `Shift` switches the bend while laying roads.
`Escape` cancels the current tool or opens the menu, pausing the city until closed.
The menu holds checkpoints, import/export, sound, and the model atelier.
Autosaves never replace your manual checkpoint. Camera and sound preferences stay local.

## Development

```bash
npm run check                                   # build, tests, browser walkthrough, art captures (run before merging; CI runs tests and build only)
npm run smoke -- http://localhost:5180/?debug   # gameplay walkthrough against a running dev server (append &lean for a fast, unshaded run)
npm run smoke:settlement -- http://localhost:5180/?debug
npm run art:capture -- http://localhost:5180    # model captures into artifacts/art
```

- [Vision and roadmap](roadmap.md)
- [Gameplay and first-island scope](docs/gameplay.md)
- [Art direction](docs/art-direction.md)
- [Model authoring and visual checks](docs/art-tooling.md)
- [Deployment](deploy/README.md)

`src/sim/` owns serializable, deterministic game state; `src/render/` reads it.
`src/art/` owns procedural models; `src/ui/` provides the interface. No original
Zeus assets or sprite pipelines are used. The project began as a Zeus: Master of
Olympus homage; that work is preserved at Git tag `archive/pre-miniature-restart`.

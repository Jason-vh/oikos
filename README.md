# Οἶκος

Live at <https://oikos.vhtm.eu>.

*Οἶκος* (oikos): the household, root of *economy*. A city builder on the Aegean:
settle an island, feed and water its households along real roads, hunt, fell,
farm and trade your way to a thriving city. Kalliste is a shared archipelago of
eight islands. Join under a name, claim an unclaimed island, place your founding
dockyard beside its landing road, and build. One player or eight, it is the same
world: the server owns it and saves it.

```bash
npm install
npm run dev                                     # the game; needs a running authority
```

- `/` — the shared archipelago. Nothing is saved locally.
- `/art.html` — isolated model viewer.
- `/sandbox.html` — one local island for terrain and road art work; no HUD, no saves.

Running the authority locally:

```bash
npm run authority -- init /tmp/oikos/world.db
OIKOS_DB=/tmp/oikos/world.db OIKOS_PUBLIC_ORIGIN=http://localhost:5180 npm run server
```

## Play

Build four dwellings beside the harbour road. Grow wheat on the fertile striped
fields, store it in a granary, then add a food vendor to an agora. Connect everything
with roads. Add a fountain and maintenance post. Reliable food and water evolve
homes into cottages and courtyard houses. Fell forest for lumber: porters carry it
to the harbour, enough rebuilds the quay in stone, and a trade order ships it
overseas for coin.

Left-click builds or inspects. Drag to lay roads. WASD / arrow keys or right-drag
pan; scroll zooms; Alt-drag orbits. `1`–`0` select construction tools, `X` demolishes, `R` rotates a
building, `G` toggles the grid, `Q` rotates the camera, and `H` returns to the village.
`Shift` switches the bend while laying roads. `Escape` cancels the current tool or
opens the menu. Shared time never pauses for a menu; a pause of your own is still to
come. The menu holds the grid, sound, and the model atelier.

## Development

```bash
npm run check                                   # build, tests, art captures (run before merging; CI runs tests and build only)
npm run art:capture -- http://localhost:5180    # model captures into artifacts/art
```

Behaviour is covered by `bun test`. Browser work is judged in the game and through
the art captures; there are no gameplay walkthrough scripts.

- [Vision and roadmap](roadmap.md)
- [Gameplay and first-island scope](docs/gameplay.md)
- [Art direction](docs/art-direction.md)
- [Model authoring and visual checks](docs/art-tooling.md)
- [Deployment](deploy/README.md)
- [Playing as an agent](docs/agent-play.md)
- [Private server transport](docs/server-transport.md)
- [Shared client adapter](docs/shared-session.md) and [shared game](docs/shared-game.md)

`src/sim/` owns serializable, deterministic game state; `src/render/` reads it.
`src/art/` owns procedural models; `src/ui/` provides the interface. No original
Zeus assets or sprite pipelines are used. The project began as a Zeus: Master of
Olympus homage; that work is preserved at Git tag `archive/pre-miniature-restart`.

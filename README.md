# Οἶκος

Live at <https://oikos.vhtm.eu>.

*Οἶκος* (oikos): the household, root of *economy*. A city builder on the Aegean:
settle an island, feed and water its households along real roads, hunt, fell,
farm and trade your way to a thriving city. The world is a shared archipelago of
eight islands, no two the same size. Name your city, pick its colour, claim an unclaimed island, place your founding
dockyard beside its landing road, and build. One player or eight, it is the same
world: the server owns it and saves it.

```bash
npm install
npm run play                                    # the game: authority and client together
```

- `/` — the shared archipelago. Nothing is saved locally.
- `/art.html` — isolated model viewer.
- `/sandbox.html` — one local island for terrain and road art work; no HUD, no saves.

`npm run play -- --fresh` starts the archipelago over once its eight islands are
claimed. `npm run dev` serves the pages without an authority, which is enough for
`/art.html` and `/sandbox.html` but leaves `/` waiting to connect.

Running the authority by hand:

```bash
npm run authority -- init /tmp/oikos/world.db
OIKOS_DB=/tmp/oikos/world.db OIKOS_PUBLIC_ORIGIN=http://localhost:5180 npm run server
```

## Play

Build four dwellings beside the harbour road. Grow wheat on the fertile striped
fields — or send a hunter after game and a fishing wharf after the shoals offshore —
store it in a granary, then add a food vendor to an agora. Connect everything
with roads. Add a fountain and maintenance post. Reliable food and water evolve
homes into cottages and courtyard houses. Plant olives on ground a farm cannot use,
press them into oil, and sell it from a second agora stall: houses with oil become
townhouses. Fell forest for lumber: porters carry it
to the harbour, enough rebuilds the quay in stone, and a trade order ships it
overseas for coin. The catalogue is earned rather than given: a tool stays locked
until enough people live at the tier it asks for, and the guide names the next one.

Left-click builds or inspects. Drag to lay roads. WASD / arrow keys or right-drag
pan; scroll zooms; Alt-drag orbits. Tools are chosen in the toolbar. `R` rotates a
building, `G` toggles the grid, `Q` rotates the camera, and `H` returns to the village.
`Shift` switches the bend while laying roads. `Escape` cancels the current tool or
opens the menu. Shared time never pauses for a menu; a pause of your own is still to
come. The menu holds the grid, sound, and the model atelier.

## Development

```bash
npm run check                                   # build, tests, art captures, smokes (run before merging; CI runs tests and build only)
npm run art:capture -- http://localhost:5180    # model captures into artifacts/art
```

Behaviour is covered by `bun test`. The play loop — joining, claiming, founding,
building — is covered in a real browser by `npm run smoke:play`. Art is judged in
the game and through the art captures.

`/?debug` exposes `window.oikos` for scripting the shared game, and `?latency=250`
delays what the client sends. See [the development loop](docs/dev-loop.md), which
also explains why browser automation here must not use Playwright's headless shell.

- [The development loop](docs/dev-loop.md)
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

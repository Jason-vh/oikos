# Zeus — Master of Olympus (web)

A browser city builder in the spirit of Impressions' *Zeus: Master of Olympus*.
Isometric, tile-based, and built around the walker model that defines the original:
buildings do not serve a radius, they send people down roads.

```bash
npm install
npm run dev      # http://localhost:5180
npm run smoke    # headless render + simulation check (needs a dev server running)
```

## Controls

| Input | Action |
| --- | --- |
| Left drag | Use the selected tool (roads follow an L-path) |
| Right / middle drag | Pan |
| WASD / arrows | Pan |
| Wheel | Zoom |
| `R`, `1`–`5`, `X` | Select tool |
| `O` | Desirability overlay |
| Space | Pause |

## What is simulated

- **Terrain**: grass, meadow (farms only), water, rock.
- **Roads**: the only network. Everything social flows along it.
- **Walkers**: cart pushers route with BFS to a granary; food vendors and water
  carriers roam randomly and serve houses adjacent to the road they walk.
- **Housing**: Shack → Hovel → Tenement → Homestead, gated on supplied services
  and local desirability. Houses devolve when their tier's needs lapse.
- **Desirability**: a field recomputed from building influence with linear falloff.
- **Economy**: build costs and a monthly head tax.

## Architecture

```
src/sim/      headless simulation — no Pixi imports
  grid.ts         typed-array layers (terrain, road, occupant, desirability)
  world.ts        fixed 20 Hz tick, placement, production
  walkers.ts      spawn + movement + service delivery
  pathing.ts      road BFS and roaming
  housing.ts      evolution rules
  desirability.ts influence field
  mapgen.ts       seeded terrain
src/render/   Pixi v8 — textures generated at runtime, no art assets
src/ui/       DOM overlay
```

The simulation is deterministic per tick and independent of frame rate; rendering
reads it and never writes to it. Speed controls and future save/load fall out of
that split.

## Roadmap

1. **Labour and employment** — buildings need workers drawn from housing.
2. **Second production chain** — olives → olive press → agora stalls, so goods,
   storage yards and vendors generalise beyond food.
3. **Agora** — vendors spawning from a market supplied by granary + storage,
   rather than the granary itself.
4. **Culture and gods** — sanctuaries, gods that visit and bless or curse.
5. **Save/load** — structured clone of world state into IndexedDB.
6. **Campaign scaffolding** — scenario definitions, goals, ratings.

## Art

Everything on screen is generated from `Graphics` primitives at runtime. Original
game assets are copyrighted and must not be shipped; any real art has to be drawn
or commissioned against the same isometric tile metrics (`TILE_WIDTH` 64,
`TILE_HEIGHT` 32).

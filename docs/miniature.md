# Aegean miniature study

Open `/miniature.html` after `npm run dev`. The original game remains at `/`.
Both entry points are included in `npm run build`.

## Direction

A living Greek miniature, not a literal board game: chunky plaster buildings,
terracotta roofs, painted shutters, matte surfaces, bevelled edges, and continuous
terraced land. A hilltop temple anchors the skyline; a harbour connects the town to
another inhabited island. Citizens carry amphorae, ships rock and sail, and gulls
circle the waterfront.

The scene is independently authored with procedural Three.js geometry. No original
Zeus sprites, external models, textures, fonts, or network services are needed.

## Controls

- Drag to orbit; right-drag to pan; scroll to zoom.
- Touch: one finger orbits; two fingers pan and pinch to zoom.
- Harbour, Streets, and Archipelago select camera compositions.
- Golden hour changes sunlight and shadow direction.
- Pause life freezes citizens, ships, gulls, and water, but keeps the camera usable.
- Reset view restores the selected camera composition.

Reduced-motion preferences start the scene paused. WebGL 2 is required.

## Review at three scales

- **Harbour:** does the town feel cohesive, grounded, and inviting?
- **Streets:** are roofs, shutters, cargo, and building proportions convincing?
- **Archipelago:** do silhouettes and sailing ships carry the view without tiny detail?

This is an art test, not a replacement renderer or a playable expansion. It does
not load, mutate, or save game state. Walking and sailing routes are decorative.
It does not yet implement building placement, terrain streaming, island economies,
LOD, or simulation integration.

## Implementation

- `src/miniature/models.ts`: shared palette and authored building/prop geometry.
- `src/miniature/world.ts`: scene composition and decorative animation.
- `src/miniature/main.ts`: orthographic camera, lighting, contact shading, controls.
- `src/miniature/style.css`: independent study interface.

Static geometry is combined by material to limit draw calls. Moving models are
batched individually. Rendering uses a capped pixel ratio, multisampled targets,
ambient occlusion, tone mapping, and shadow refreshes capped at ten per second.
This is a bounded prototype; material batching is not a substitute for future
chunking, instancing, LOD, and performance tests at city scale.

## Verification

```bash
npm run build
npm test
node scripts/miniature-smoke.mjs http://127.0.0.1:5180/miniature.html
```

The browser check captures all three views, golden-hour lighting, and a mobile
viewport under `/tmp/zeus-miniature`. It checks camera interaction, lighting,
animation, pause, reduced motion, browser errors, and isolation from saved games.

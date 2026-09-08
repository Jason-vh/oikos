import { Grid, TERRAIN_GRASS, TERRAIN_MEADOW, TERRAIN_ROCK, TERRAIN_WATER } from './grid';

export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateMap(grid: Grid, seed: number): void {
  const random = createRandom(seed);
  grid.terrain.fill(TERRAIN_GRASS);

  carveRiver(grid, random);
  scatterBlobs(grid, random, TERRAIN_MEADOW, 7, 2, 4);
  scatterBlobs(grid, random, TERRAIN_ROCK, 4, 1, 3);
}

function carveRiver(grid: Grid, random: () => number): void {
  let centre = Math.floor(grid.size * (0.6 + random() * 0.25));

  for (let y = 0; y < grid.size; y++) {
    centre += Math.round(random() * 2 - 1);
    centre = Math.min(grid.size - 3, Math.max(2, centre));
    const width = 2 + Math.floor(random() * 2);

    for (let dx = 0; dx < width; dx++) {
      const x = centre + dx;
      if (grid.contains(x, y)) grid.terrain[grid.index(x, y)] = TERRAIN_WATER;
    }
  }
}

function scatterBlobs(
  grid: Grid,
  random: () => number,
  terrain: number,
  count: number,
  minRadius: number,
  maxRadius: number,
): void {
  for (let blob = 0; blob < count; blob++) {
    const cx = Math.floor(random() * grid.size);
    const cy = Math.floor(random() * grid.size);
    const radius = minRadius + random() * (maxRadius - minRadius);

    for (let y = Math.floor(cy - radius); y <= cy + radius; y++) {
      for (let x = Math.floor(cx - radius); x <= cx + radius; x++) {
        if (!grid.contains(x, y)) continue;
        const distance = Math.hypot(x - cx, y - cy) + random() * 0.9;
        if (distance > radius) continue;
        const index = grid.index(x, y);
        if (grid.terrain[index] === TERRAIN_GRASS) grid.terrain[index] = terrain;
      }
    }
  }
}

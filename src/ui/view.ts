import type { View } from '../render/stage';
import { CELL_SIZE, islandFor } from '../sim/island';

export const VIEW_KEY = 'oikos.view.v1';

export function parseView(raw: string | null, seed: number, home?: number): View | null {
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw);
    if (saved?.seed !== seed || !saved.view) return null;
    if (home !== undefined && (saved.home ?? islandFor(seed).home) !== home) return null;
    const { target, offset, size, zoom } = saved.view;
    const map = islandFor(seed);
    const bounds = Math.max(map.width, map.depth) * CELL_SIZE / 2 + 20;
    for (const vector of [target, offset]) {
      if (!Array.isArray(vector) || vector.length !== 3) return null;
      if (!vector.every((value) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= bounds)) return null;
    }
    if (typeof size !== 'number' || !Number.isFinite(size) || size < 10 || size > 200) return null;
    if (typeof zoom !== 'number' || !Number.isFinite(zoom) || zoom < .25 || zoom > 3.8) return null;
    const distance = Math.hypot(...offset);
    if (distance < 10 || distance > 200 || offset[1] <= 0) return null;
    return { target, offset, size, zoom };
  } catch {
    return null;
  }
}

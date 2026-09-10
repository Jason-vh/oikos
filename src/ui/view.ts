import type { View } from '../render/stage';

export const VIEW_KEY = 'oikos.view.v1';

export function parseView(raw: string | null, seed: number): View | null {
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw);
    if (saved?.seed !== seed || !saved.view) return null;
    const { target, offset, size, zoom } = saved.view;
    for (const vector of [target, offset]) {
      if (!Array.isArray(vector) || vector.length !== 3) return null;
      if (!vector.every((value) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 200)) return null;
    }
    if (typeof size !== 'number' || !Number.isFinite(size) || size < 10 || size > 200) return null;
    if (typeof zoom !== 'number' || !Number.isFinite(zoom) || zoom < .65 || zoom > 3.8) return null;
    const distance = Math.hypot(...offset);
    if (distance < 10 || distance > 200 || offset[1] <= 0) return null;
    return { target, offset, size, zoom };
  } catch {
    return null;
  }
}

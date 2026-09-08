export const TILE_WIDTH = 64;
export const TILE_HEIGHT = 32;

export interface Point {
  x: number;
  y: number;
}

export function tileToScreen(tileX: number, tileY: number): Point {
  return {
    x: (tileX - tileY) * (TILE_WIDTH / 2),
    y: (tileX + tileY) * (TILE_HEIGHT / 2),
  };
}

export function screenToTile(screenX: number, screenY: number): Point {
  const a = screenX / (TILE_WIDTH / 2);
  const b = screenY / (TILE_HEIGHT / 2);
  return {
    x: (a + b) / 2,
    y: (b - a) / 2,
  };
}

export function footprintAnchor(tileX: number, tileY: number, size: number): Point {
  return {
    x: (tileX - tileY) * (TILE_WIDTH / 2),
    y: (tileX + tileY + 2 * size - 1) * (TILE_HEIGHT / 2),
  };
}

export function depthOf(tileX: number, tileY: number, size: number): number {
  return tileX + tileY + 2 * (size - 1);
}

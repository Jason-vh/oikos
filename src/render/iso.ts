export const TILE_WIDTH = 120;
export const TILE_HEIGHT = 60;
export const ELEVATION_STEP = 22;

export interface Point {
  x: number;
  y: number;
}

export function tileToScreen(tileX: number, tileY: number, height = 0): Point {
  return {
    x: (tileX - tileY) * (TILE_WIDTH / 2),
    y: (tileX + tileY) * (TILE_HEIGHT / 2) - height * ELEVATION_STEP,
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

export function footprintAnchor(
  tileX: number,
  tileY: number,
  width: number,
  depth: number,
  height = 0,
): Point {
  return {
    x: (tileX - tileY + width - depth) * (TILE_WIDTH / 2),
    y: (tileX + tileY + width + depth - 1) * (TILE_HEIGHT / 2) - height * ELEVATION_STEP,
  };
}

export function depthOf(tileX: number, tileY: number, width: number, depth: number): number {
  return tileX + tileY + (width - 1) + (depth - 1);
}

export function pickTile(
  worldX: number,
  worldY: number,
  heightAt: (x: number, y: number) => number,
  maxHeight: number,
): Point {
  for (let height = maxHeight; height > 0; height--) {
    const candidate = screenToTile(worldX, worldY + height * ELEVATION_STEP);
    const tile = { x: Math.floor(candidate.x), y: Math.floor(candidate.y) };
    if (heightAt(tile.x, tile.y) === height) return tile;
  }

  const ground = screenToTile(worldX, worldY);
  return { x: Math.floor(ground.x), y: Math.floor(ground.y) };
}

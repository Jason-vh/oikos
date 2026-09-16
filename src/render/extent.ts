import { CELL_SIZE, type IslandMap } from '../sim/island';

const VIEW_MARGIN = 40;
const SEA_SHARE = 4;

export function worldSpan(map: IslandMap): number {
  return Math.hypot(map.width * CELL_SIZE, map.depth * CELL_SIZE) + VIEW_MARGIN * 2;
}

export function seaSpan(map: IslandMap): number {
  return worldSpan(map) * SEA_SHARE;
}

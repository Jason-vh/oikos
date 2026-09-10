import type { ActionResult, BuildTool, Rotation, Tile, World } from './types';
import { build, placeRoadPath, setVendor } from './world';

export const STARTER_ROAD_SPUR: Tile[] = [
  { x: 26, z: 12 },
  { x: 26, z: 13 },
  { x: 26, z: 14 },
  { x: 26, z: 15 },
  { x: 26, z: 16 },
  { x: 26, z: 17 },
  { x: 26, z: 18 },
  { x: 26, z: 19 },
  { x: 26, z: 20 },
];

export interface ScenarioBuilding {
  tool: BuildTool;
  x: number;
  z: number;
  rotation?: Rotation;
}

export const STARTER_NEIGHBOURHOOD: ScenarioBuilding[] = [
  { tool: 'house', x: 10, z: 17 },
  { tool: 'house', x: 14, z: 17 },
  { tool: 'house', x: 18, z: 17 },
  { tool: 'house', x: 22, z: 17 },
  { tool: 'farm', x: 27, z: 12 },
  { tool: 'granary', x: 27, z: 17 },
  { tool: 'agora', x: 17, z: 21 },
  { tool: 'fountain', x: 22, z: 21 },
  { tool: 'maintenance', x: 24, z: 21 },
];

export function buildStarterNeighbourhood(world: World): ActionResult {
  const spur = placeRoadPath(world, STARTER_ROAD_SPUR);
  if (!spur.ok) return spur;

  for (const item of STARTER_NEIGHBOURHOOD) {
    const result = build(world, item.tool, item.x, item.z, item.rotation ?? 0);
    if (!result.ok) return result;
  }

  const agora = world.buildings.find((building) => building.kind === 'agora');
  if (!agora) return { ok: false, reason: 'agora missing' };
  return setVendor(world, agora.id, true);
}

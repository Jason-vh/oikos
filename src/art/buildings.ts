import * as T from 'three';
import type { BuildingKind } from '../sim/types';
import { BUILDINGS } from '../sim/catalog';
import { CELL_SIZE } from '../sim/island';
import { bake, box, colors, post } from './primitives';
import { dwelling } from './houses';
import { wheatFarm } from './vegetation';
import { granary as granaryModel, fountain as fountainModel, maintenance as maintenanceModel } from './civic';
import { stall } from './temple';

export function footprintSize(kind: BuildingKind): { width: number; depth: number } {
  const definition = BUILDINGS[kind];
  return { width: definition.width * CELL_SIZE, depth: definition.depth * CELL_SIZE };
}

function agora(vendorEnabled: boolean): T.Group {
  const market = new T.Group();
  box(market, colors.paving, 0, .09, 0, 3.55, .18, 3.55);
  box(market, colors.stone, 0, .19, 0, 3.65, .06, 3.65);
  for (const [px, pz] of [[-1.65, -1.65], [1.65, -1.65], [-1.65, 1.65], [1.65, 1.65]]) {
    post(market, colors.cream, px, .32, pz, .06, .3);
  }
  if (vendorEnabled) stall(market, -.7, .2, .6, colors.blue);
  return market;
}

export function getBuildingModel(kind: BuildingKind, tier: 1 | 2 | 3 = 1, vendorEnabled = false): T.Group {
  const model = new T.Group();
  switch (kind) {
    case 'house':
      model.add(dwelling(tier));
      break;
    case 'farm':
      model.add(wheatFarm());
      break;
    case 'granary':
      model.add(granaryModel());
      break;
    case 'agora':
      model.add(agora(vendorEnabled));
      break;
    case 'fountain':
      model.add(fountainModel());
      break;
    case 'maintenance':
      model.add(maintenanceModel());
      break;
  }
  bake(model);
  return model;
}

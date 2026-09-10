import * as T from 'three';
import type { BuildingKind, Stores } from '../sim/types';
import { BUILDINGS } from '../sim/catalog';
import { CELL_SIZE } from '../sim/island';
import { bake, box, colors, post } from './primitives';
import { dwelling } from './houses';
import { wheatFarm } from './vegetation';
import { fountain as fountainModel, maintenance as maintenanceModel } from './civic';
import { granaryVariant, type GranaryVariant } from './granaries';

export const GRANARY_VARIANT: GranaryVariant = 'pithoi-low';
import { stall } from './temple';

export function footprintSize(kind: BuildingKind): { width: number; depth: number } {
  const definition = BUILDINGS[kind];
  return { width: definition.width * CELL_SIZE, depth: definition.depth * CELL_SIZE };
}

function agora(vendorEnabled: boolean, stores: Stores): T.Group {
  const market = new T.Group();
  box(market, colors.paving, 0, .09, 0, 3.55, .18, 3.55);
  box(market, colors.stone, 0, .19, 0, 3.65, .06, 3.65);
  for (const [px, pz] of [[-1.65, -1.65], [1.65, -1.65], [-1.65, 1.65], [1.65, 1.65]]) {
    post(market, colors.cream, px, .32, pz, .06, .3);
  }
  if (vendorEnabled) stall(market, -.7, .2, .6, colors.blue, stores);
  return market;
}

export type ModelStage = 0 | 1 | 2 | 3;

export interface ModelState { tier?: 1 | 2 | 3; vendorEnabled?: boolean; stage?: ModelStage; stores?: Stores; granary?: GranaryVariant; }

export function getBuildingModel(kind: BuildingKind, state: ModelState = {}): T.Group {
  const { tier = 1, vendorEnabled = false, stage = 3, stores = {}, granary = GRANARY_VARIANT } = state;
  const model = new T.Group();
  switch (kind) {
    case 'house':
      model.add(dwelling(tier));
      break;
    case 'farm':
      model.add(wheatFarm(stage));
      break;
    case 'granary':
      model.add(granaryVariant(granary, stores));
      break;
    case 'agora':
      model.add(agora(vendorEnabled, stores));
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

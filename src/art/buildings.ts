import * as T from 'three';
import type { BuildingKind, Stores } from '../sim/types';
import { bake, box, colors, post } from './primitives';
import { assemblyPart, modelAssembly, type ModelAssembly } from './assembly';
import { dwelling, dwellingPieces, COTTAGE_VARIANTS, COURTYARD_VARIANTS, DWELLING_VARIANTS } from './houses';
import { wheatFarm, wheatFarmPieces, FARM_VARIANTS } from './vegetation';
import { fountain as fountainModel, fountainPieces, lodge as lodgeModel, lodgePieces, maintenance as maintenanceModel, maintenancePieces, stockpile as stockpileModel, stockpilePieces, woodcutter as woodcutterModel, woodcutterPieces } from './civic';
import { granary, granaryPieces } from './granaries';
import { harbour as harbourModel } from './harbour';
import { stall, stallAwning, stallCounter, stallGoods, stallPosts } from './stall';

const STALL_AT: [number, number, number] = [-.7, .2, .6];

function agoraBed(parent: T.Object3D): void {
  box(parent, colors.paving, 0, .09, 0, 3.55, .18, 3.55);
}

function agoraPaving(parent: T.Object3D): void {
  box(parent, colors.stone, 0, .19, 0, 3.65, .06, 3.65);
}

function agoraPosts(parent: T.Object3D): void {
  for (const [px, pz] of [[-1.65, -1.65], [1.65, -1.65], [-1.65, 1.65], [1.65, 1.65]]) {
    post(parent, colors.cream, px, .32, pz, .06, .3);
  }
}

function agora(vendorEnabled: boolean, stores: Stores): T.Group {
  const market = new T.Group();
  agoraBed(market);
  agoraPaving(market);
  agoraPosts(market);
  if (vendorEnabled) stall(market, ...STALL_AT, colors.blue, stores);
  return market;
}

function agoraPieces(vendorEnabled: boolean, stores: Stores): ModelAssembly {
  const assembly = modelAssembly(false);
  agoraBed(assemblyPart(assembly, { name: 'bed', at: 0, lift: 0, dust: true }));
  agoraPaving(assemblyPart(assembly, { name: 'paving', at: .14, lift: .16, duration: .26, dust: true }));
  agoraPosts(assemblyPart(assembly, { name: 'corner-posts', at: .3, lift: .24, duration: .26 }));
  if (!vendorEnabled) return assembly;
  const shop = (name: string, at: number, lift = .3, duration = .28, dust = false) => {
    const part = assemblyPart(assembly, { name, at, lift, duration, dust });
    const anchor = new T.Group();
    anchor.position.set(...STALL_AT);
    part.add(anchor);
    return anchor;
  };
  stallCounter(shop('stall-counter', .46, .3, .28, true));
  stallPosts(shop('stall-posts', .66, .4));
  stallAwning(shop('awning', .86, .3, .3), colors.blue);
  stallGoods(shop('goods', 1.06, .14, .22), stores);
  return assembly;
}

export type ModelStage = 0 | 1 | 2 | 3;

export interface ModelState { tier?: 1 | 2 | 3; vendorEnabled?: boolean; stage?: ModelStage; stores?: Stores; variant?: number; }

export function modelVariants(kind: BuildingKind, tier: 1 | 2 | 3 = 1): number {
  if (kind === 'house') return [DWELLING_VARIANTS, COTTAGE_VARIANTS, COURTYARD_VARIANTS][tier - 1];
  if (kind === 'farm') return FARM_VARIANTS;
  return 1;
}

export function variantFor(kind: BuildingKind, tier: 1 | 2 | 3, roll: number): number {
  const count = modelVariants(kind, tier);
  return Math.min(count - 1, Math.floor(roll * count));
}

export function getBuildingAssembly(kind: BuildingKind, state: ModelState = {}): ModelAssembly | null {
  const { tier = 1, vendorEnabled = false, stage = 3, stores = {}, variant = 0 } = state;
  const assembly = choreography(kind, tier, vendorEnabled, stage, stores, variant);
  if (!assembly) return null;
  for (const part of assembly.parts) bake(part.model);
  return assembly;
}

function choreography(kind: BuildingKind, tier: 1 | 2 | 3, vendorEnabled: boolean, stage: ModelStage, stores: Stores, variant: number): ModelAssembly | null {
  switch (kind) {
    case 'house': return tier === 1 ? dwellingPieces(variant) : null;
    case 'farm': return wheatFarmPieces(stage, variant);
    case 'granary': return granaryPieces(stores);
    case 'agora': return agoraPieces(vendorEnabled, stores);
    case 'fountain': return fountainPieces();
    case 'maintenance': return maintenancePieces();
    case 'lodge': return lodgePieces();
    case 'woodcutter': return woodcutterPieces();
    case 'stockpile': return stockpilePieces(stores);
    case 'harbour': return null;
  }
}

export function getBuildingModel(kind: BuildingKind, state: ModelState = {}): T.Group {
  const { tier = 1, vendorEnabled = false, stage = 3, stores = {}, variant = 0 } = state;
  const model = new T.Group();
  switch (kind) {
    case 'house':
      model.add(dwelling(tier, variant));
      break;
    case 'farm':
      model.add(wheatFarm(stage, variant));
      break;
    case 'granary':
      model.add(granary(stores));
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
    case 'lodge':
      model.add(lodgeModel());
      break;
    case 'woodcutter':
      model.add(woodcutterModel());
      break;
    case 'stockpile':
      model.add(stockpileModel(stores));
      break;
    case 'harbour':
      model.add(harbourModel(tier === 2 ? 2 : 1, stage, stores));
      break;
  }
  bake(model);
  return model;
}

import * as T from 'three';
import type { BuildingKind, Stalls, Stores } from '../sim/types';
import { bake, box, colors, post } from './primitives';
import { assemblyPart, modelAssembly, type ModelAssembly } from './assembly';
import { dwelling, dwellingPieces, COTTAGE_VARIANTS, COURTYARD_VARIANTS, DWELLING_VARIANTS, TOWNHOUSE_VARIANTS } from './houses';
import { wheatFarm, wheatFarmPieces, FARM_VARIANTS } from './vegetation';
import { fountain as fountainModel, fountainPieces, lodge as lodgeModel, lodgePieces, maintenance as maintenanceModel, maintenancePieces, stockpile as stockpileModel, stockpilePieces, woodcutter as woodcutterModel, woodcutterPieces } from './civic';
import { granary, granaryPieces } from './granaries';
import { harbour as harbourModel } from './harbour';
import { wharf as wharfModel, wharfPieces } from './wharf';
import { oliveOrchard, oliveOrchardPieces, olivePress, olivePressPieces } from './olives';
import { jarAwning, jarCounter, jarGoods, jarPosts, oilStall, stall, stallAwning, stallCounter, stallGoods, stallPosts } from './stall';

const STALL_AT: [number, number, number] = [-.7, .2, .6];
const OIL_STALL_AT: [number, number, number] = [.95, .2, -1.05];

function foodOf(stores: Stores): Stores {
  const { oil: _oil, ...rest } = stores;
  return rest;
}

function oilOf(stores: Stores): Stores {
  return stores.oil ? { oil: stores.oil } : {};
}

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

function agora(stalls: Stalls, stores: Stores): T.Group {
  const market = new T.Group();
  agoraBed(market);
  agoraPaving(market);
  agoraPosts(market);
  if (stalls.food?.installed) stall(market, ...STALL_AT, colors.blue, foodOf(stores));
  if (stalls.oil?.installed) oilStall(market, ...OIL_STALL_AT, oilOf(stores));
  return market;
}

function agoraPieces(stalls: Stalls, stores: Stores): ModelAssembly {
  const assembly = modelAssembly(false);
  agoraBed(assemblyPart(assembly, { name: 'bed', at: 0, lift: 0, dust: true }));
  agoraPaving(assemblyPart(assembly, { name: 'paving', at: .14, lift: .16, duration: .26, dust: true }));
  agoraPosts(assemblyPart(assembly, { name: 'corner-posts', at: .3, lift: .24, duration: .26 }));
  const shop = (at: [number, number, number]) => (name: string, delay: number, lift = .3, duration = .28, dust = false) => {
    const part = assemblyPart(assembly, { name, at: delay, lift, duration, dust });
    const anchor = new T.Group();
    anchor.position.set(...at);
    part.add(anchor);
    return anchor;
  };
  if (stalls.food?.installed) {
    const bench = shop(STALL_AT);
    stallCounter(bench('stall-counter', .46, .3, .28, true));
    stallPosts(bench('stall-posts', .66, .4));
    stallAwning(bench('awning', .86, .3, .3), colors.blue);
    stallGoods(bench('goods', 1.06, .14, .22), foodOf(stores));
  }
  if (stalls.oil?.installed) {
    const bench = shop(OIL_STALL_AT);
    jarCounter(bench('oil-counter', 1.24, .3, .28, true));
    jarPosts(bench('oil-posts', 1.44, .4));
    jarAwning(bench('oil-awning', 1.62, .3, .3));
    jarGoods(bench('jars', 1.8, .14, .22), oilOf(stores));
  }
  return assembly;
}

export type ModelStage = 0 | 1 | 2 | 3;

export interface ModelState { tier?: 1 | 2 | 3 | 4; stalls?: Stalls; stage?: ModelStage; stores?: Stores; variant?: number; }

export function modelVariants(kind: BuildingKind, tier: 1 | 2 | 3 | 4 = 1): number {
  if (kind === 'house') return [DWELLING_VARIANTS, COTTAGE_VARIANTS, COURTYARD_VARIANTS, TOWNHOUSE_VARIANTS][tier - 1];
  if (kind === 'farm') return FARM_VARIANTS;
  return 1;
}

export function variantFor(kind: BuildingKind, tier: 1 | 2 | 3 | 4, roll: number): number {
  const count = modelVariants(kind, tier);
  return Math.min(count - 1, Math.floor(roll * count));
}

export function getBuildingAssembly(kind: BuildingKind, state: ModelState = {}): ModelAssembly | null {
  const { tier = 1, stalls = {}, stage = 3, stores = {}, variant = 0 } = state;
  const assembly = choreography(kind, tier, stalls, stage, stores, variant);
  if (!assembly) return null;
  for (const part of assembly.parts) bake(part.model);
  return assembly;
}

function choreography(kind: BuildingKind, tier: 1 | 2 | 3 | 4, stalls: Stalls, stage: ModelStage, stores: Stores, variant: number): ModelAssembly | null {
  switch (kind) {
    case 'house': return tier === 1 ? dwellingPieces(variant) : null;
    case 'farm': return wheatFarmPieces(stage, variant);
    case 'orchard': return oliveOrchardPieces(stage);
    case 'press': return olivePressPieces(stores);
    case 'granary': return granaryPieces(stores);
    case 'agora': return agoraPieces(stalls, stores);
    case 'fountain': return fountainPieces();
    case 'maintenance': return maintenancePieces();
    case 'lodge': return lodgePieces();
    case 'woodcutter': return woodcutterPieces();
    case 'stockpile': return stockpilePieces(stores);
    case 'wharf': return wharfPieces(stores);
    case 'harbour': return null;
  }
}

export function getBuildingModel(kind: BuildingKind, state: ModelState = {}): T.Group {
  const { tier = 1, stalls = {}, stage = 3, stores = {}, variant = 0 } = state;
  const model = new T.Group();
  switch (kind) {
    case 'house':
      model.add(dwelling(tier, variant));
      break;
    case 'farm':
      model.add(wheatFarm(stage, variant));
      break;
    case 'orchard':
      model.add(oliveOrchard(stage));
      break;
    case 'press':
      model.add(olivePress(stores));
      break;
    case 'granary':
      model.add(granary(stores));
      break;
    case 'agora':
      model.add(agora(stalls, stores));
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
    case 'wharf':
      model.add(wharfModel(stores));
      break;
    case 'harbour':
      model.add(harbourModel(tier === 2 ? 2 : 1, stage, stores));
      break;
  }
  bake(model);
  return model;
}

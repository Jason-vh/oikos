import type { CityColor } from './colors';

export type BuildingKind = 'house' | 'farm' | 'orchard' | 'press' | 'granary' | 'agora' | 'fountain' | 'maintenance' | 'lodge' | 'woodcutter' | 'stockpile' | 'wharf' | 'harbour';
export type BuildTool = Exclude<BuildingKind, 'harbour'> | 'road';
export type Tool = BuildTool | 'inspect' | 'demolish';
export type Rotation = 0 | 1 | 2 | 3;
export type Terrain = 'water' | 'sand' | 'grass' | 'fertile' | 'scrub' | 'forest' | 'rock' | 'cliff';
export type Food = 'wheat' | 'carrots' | 'fish' | 'meat' | 'olives';
export type Material = 'lumber' | 'clay' | 'stone';
export type Good = 'oil';
export type Resource = Food | Material | Good;
export type Stores = Partial<Record<Resource, number>>;
export type StallGood = 'food' | 'oil';
export interface Stall { installed: boolean; enabled: boolean; }
export type Stalls = Partial<Record<StallGood, Stall>>;
export interface Tile { x: number; z: number; }
export interface Building extends Tile {
  id: number;
  kind: BuildingKind;
  rotation: Rotation;
  tier: 1 | 2 | 3 | 4;
  residents: number;
  food: number;
  water: number;
  oil: number;
  condition: number;
  stores: Stores;
  progress: number;
  workers: number;
  vendorEnabled: boolean;
  vendorInstalled: boolean;
  stalls: Stalls;
  connected: boolean;
  serviceTimer: number;
  upgradeTimer: number;
}
export type AnimalKind = 'boar' | 'rabbit' | 'fish' | 'gull';
export interface AnimalPlace {
  x: number;
  z: number;
}
export interface Animal {
  id: number;
  kind: AnimalKind;
  homeX: number;
  homeZ: number;
  drift: number;
  respawnAt: number | null;
  cornered: boolean;
}
export type WalkerKind = 'cart' | 'buyer' | 'vendor' | 'water' | 'maintenance' | 'immigrant' | 'hunter' | 'woodcutter' | 'fisher' | 'porter';
export interface Walker {
  id: number;
  kind: WalkerKind;
  homeId: number;
  targetId: number | null;
  path: number[];
  departedAt: number;
  step: number;
  progress: number;
  food: Resource | null;
  cargo: number;
  returning: boolean;
  overland: number[];
  quarry: number | null;
  task: WalkerTask | null;
}
export type TaskKind = 'chop' | 'hunt' | 'net';
export interface WalkerTask {
  kind: TaskKind;
  since: number;
  until: number;
}
export interface City {
  id: number;
  name: string;
  color: CityColor;
  home: number;
  money: number;
  harbour: Building;
  produced: number;
  delivered: number;
  roads: number[];
  buildings: Building[];
  walkers: Walker[];
}
export const CURRENT_VERSION = 18 as const;
export const WORLD_LABEL = 'archipelago' as const;
export interface World {
  version: typeof CURRENT_VERSION;
  island: typeof WORLD_LABEL;
  seed: number;
  time: number;
  remainder: number;
  nextId: number;
  nextCityId: number;
  wildlife: Animal[];
  felled: number[];
  regrowth: number;
  cities: City[];
}
export interface ActionResult { ok: boolean; reason: string; }
export interface Placement extends ActionResult { cost: number; tiles: number[]; blocked?: number[]; }
export interface Summary {
  population: number;
  workers: number;
  jobs: number;
  food: number;
  income: number;
  upkeep: number;
  balance: number;
  prosperous: number;
  townhouses: number;
  goal: boolean;
}

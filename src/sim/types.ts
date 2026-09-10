export type BuildingKind = 'house' | 'farm' | 'granary' | 'agora' | 'fountain' | 'maintenance' | 'lodge' | 'woodcutter' | 'stockpile' | 'harbour';
export type BuildTool = Exclude<BuildingKind, 'harbour'> | 'road';
export type Tool = BuildTool | 'inspect' | 'demolish';
export type Rotation = 0 | 1 | 2 | 3;
export type Terrain = 'water' | 'sand' | 'grass' | 'fertile' | 'scrub' | 'forest' | 'rock' | 'cliff';
export type Food = 'wheat' | 'carrots' | 'fish' | 'meat' | 'olives';
export type Material = 'lumber' | 'clay' | 'stone';
export type Resource = Food | Material;
export type Stores = Partial<Record<Resource, number>>;
export interface Tile { x: number; z: number; }
export interface Building extends Tile {
  id: number;
  kind: BuildingKind;
  rotation: Rotation;
  tier: 1 | 2 | 3;
  residents: number;
  food: number;
  water: number;
  condition: number;
  stores: Stores;
  progress: number;
  workers: number;
  vendorEnabled: boolean;
  vendorInstalled: boolean;
  connected: boolean;
  serviceTimer: number;
  upgradeTimer: number;
}
export type AnimalKind = 'boar' | 'rabbit' | 'fish' | 'gull';
export interface Animal {
  id: number;
  kind: AnimalKind;
  x: number;
  z: number;
  homeX: number;
  homeZ: number;
  heading: number;
  phase: number;
  respawn: number;
  cornered: boolean;
}
export type WalkerKind = 'cart' | 'buyer' | 'vendor' | 'water' | 'maintenance' | 'immigrant' | 'hunter' | 'woodcutter' | 'porter';
export interface Walker {
  id: number;
  kind: WalkerKind;
  homeId: number;
  targetId: number | null;
  path: number[];
  step: number;
  progress: number;
  food: Resource | null;
  cargo: number;
  returning: boolean;
  overland: number[];
  quarry: number | null;
  working: number;
}
export interface World {
  version: 3;
  island: 'kalliste';
  seed: number;
  time: number;
  remainder: number;
  money: number;
  nextId: number;
  roads: number[];
  buildings: Building[];
  walkers: Walker[];
  wildlife: Animal[];
  felled: number[];
  regrowth: number;
  produced: number;
  delivered: number;
  harbour: Building;
}
export interface ActionResult { ok: boolean; reason: string; }
export interface Placement extends ActionResult { cost: number; tiles: number[]; }
export interface Summary {
  population: number;
  workers: number;
  jobs: number;
  food: number;
  income: number;
  upkeep: number;
  balance: number;
  prosperous: number;
  goal: boolean;
}

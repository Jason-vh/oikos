export type BuildingKind = 'house' | 'farm' | 'granary' | 'agora' | 'fountain' | 'maintenance';
export type BuildTool = BuildingKind | 'road';
export type Tool = BuildTool | 'inspect' | 'demolish';
export type Rotation = 0 | 1 | 2 | 3;
export type Terrain = 'water' | 'grass' | 'fertile' | 'hill';
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
  stock: number;
  progress: number;
  workers: number;
  vendorEnabled: boolean;
  vendorInstalled: boolean;
  connected: boolean;
  serviceTimer: number;
  upgradeTimer: number;
}
export type WalkerKind = 'cart' | 'buyer' | 'vendor' | 'water' | 'maintenance';
export interface Walker {
  id: number;
  kind: WalkerKind;
  homeId: number;
  targetId: number | null;
  path: number[];
  step: number;
  progress: number;
  cargo: number;
  returning: boolean;
}
export interface World {
  version: 1;
  island: 'thalassa';
  time: number;
  remainder: number;
  money: number;
  nextId: number;
  roads: number[];
  buildings: Building[];
  walkers: Walker[];
  produced: number;
  delivered: number;
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

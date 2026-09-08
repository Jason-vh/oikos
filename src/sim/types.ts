export type ServiceKind = 'food' | 'water';

export const SERVICE_KINDS: ServiceKind[] = ['food', 'water'];

export type BuildingKind = 'house' | 'wheatFarm' | 'granary' | 'fountain' | 'statue';

export type ServiceSupply = Record<ServiceKind, number>;

export interface Building {
  id: number;
  kind: BuildingKind;
  x: number;
  y: number;
  size: number;
  tier: number;
  population: number;
  supply: ServiceSupply;
  stock: number;
  productionProgress: number;
  spawnTimer: number;
  walkerOut: boolean;
}

export type WalkerKind = 'cartPusher' | 'foodVendor' | 'waterCarrier';

export type WalkerState = 'roaming' | 'delivering' | 'returning';

export interface Walker {
  id: number;
  kind: WalkerKind;
  homeId: number;
  targetId: number;
  state: WalkerState;
  from: number;
  to: number;
  prev: number;
  progress: number;
  route: number[];
  routeIndex: number;
  stepsLeft: number;
  cargo: number;
}

export const emptySupply = (): ServiceSupply => ({ food: 0, water: 0 });

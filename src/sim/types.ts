export type ServiceKind = 'food' | 'water' | 'tax';

export const SERVICE_KINDS: ServiceKind[] = ['food', 'water', 'tax'];

export type BuildingKind =
  | 'house'
  | 'wheatFarm'
  | 'granary'
  | 'agora'
  | 'fountain'
  | 'statue'
  | 'taxOffice';

export type ServiceSupply = Record<ServiceKind, number>;

export interface Building {
  id: number;
  kind: BuildingKind;
  x: number;
  y: number;
  size: number;
  tier: number;
  population: number;
  staff: number;
  supply: ServiceSupply;
  stock: number;
  productionProgress: number;
  spawnTimer: number;
  walkersOut: number;
}

export type WalkerKind = 'cartPusher' | 'deliveryman' | 'peddler' | 'waterCarrier' | 'clerk';

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

export const emptySupply = (): ServiceSupply => ({ food: 0, water: 0, tax: 0 });

export function createBuilding(id: number, kind: BuildingKind, x: number, y: number, size: number): Building {
  return {
    id,
    kind,
    x,
    y,
    size,
    tier: 0,
    population: kind === 'house' ? 4 : 0,
    staff: 0,
    supply: emptySupply(),
    stock: 0,
    productionProgress: 0,
    spawnTimer: 0,
    walkersOut: 0,
  };
}

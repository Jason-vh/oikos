export type ServiceKind =
  | 'food'
  | 'water'
  | 'oil'
  | 'wine'
  | 'fleece'
  | 'culture'
  | 'athletics'
  | 'drama'
  | 'tax'
  | 'health'
  | 'safety';

export const SERVICE_KINDS: ServiceKind[] = [
  'food',
  'water',
  'oil',
  'wine',
  'fleece',
  'culture',
  'athletics',
  'drama',
  'tax',
  'health',
  'safety',
];

export type Good = 'food' | 'olives' | 'oil' | 'grapes' | 'wine' | 'fleece';

export const GOODS: Good[] = ['food', 'olives', 'oil', 'grapes', 'wine', 'fleece'];

export type GoodStock = Record<Good, number>;

export type BuildingKind =
  | 'house'
  | 'estate'
  | 'wheatFarm'
  | 'granary'
  | 'growersLodge'
  | 'olivePress'
  | 'agora'
  | 'college'
  | 'podium'
  | 'maintenanceOffice'
  | 'fountain'
  | 'statue'
  | 'taxOffice'
  | 'palace'
  | 'tradingPost'
  | 'infirmary'
  | 'watchpost'
  | 'heroHall'
  | 'tower'
  | 'vineyard'
  | 'winery'
  | 'cardingShed'
  | 'gymnasium'
  | 'dramaSchool'
  | 'theatre'
  | 'stadium'
  | 'sanctuaryZeus'
  | 'sanctuaryPoseidon'
  | 'sanctuaryDemeter'
  | 'sanctuaryAthena'
  | 'sanctuaryArtemis'
  | 'sanctuaryApollo'
  | 'sanctuaryAres'
  | 'sanctuaryHephaestus'
  | 'sanctuaryAphrodite'
  | 'sanctuaryHermes'
  | 'sanctuaryDionysus'
  | 'sanctuaryHades';

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
  stock: GoodStock;
  fireRisk: number;
  damageRisk: number;
  disease: number;
  crime: number;
  productionProgress: number;
  spawnTimer: number;
  walkersOut: number;
}

export type WalkerKind =
  | 'cartPusher'
  | 'deliveryman'
  | 'peddler'
  | 'waterCarrier'
  | 'philosopher'
  | 'superintendent'
  | 'clerk'
  | 'doctor'
  | 'watchman'
  | 'athlete'
  | 'actor';

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
  good: Good;
}

export const emptySupply = (): ServiceSupply => ({
  food: 0,
  water: 0,
  oil: 0,
  wine: 0,
  fleece: 0,
  culture: 0,
  athletics: 0,
  drama: 0,
  tax: 0,
  health: 0,
  safety: 0,
});

export const emptyStock = (): GoodStock => ({ food: 0, olives: 0, oil: 0, grapes: 0, wine: 0, fleece: 0 });

export function createBuilding(id: number, kind: BuildingKind, x: number, y: number, size: number): Building {
  return {
    id,
    kind,
    x,
    y,
    size,
    tier: 0,
    population: kind === 'house' ? 4 : kind === 'estate' ? 2 : 0,
    staff: 0,
    supply: emptySupply(),
    stock: emptyStock(),
    fireRisk: 0,
    damageRisk: 0,
    disease: 0,
    crime: 0,
    productionProgress: 0,
    spawnTimer: 0,
    walkersOut: 0,
  };
}

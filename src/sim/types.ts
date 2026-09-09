export type ServiceKind =
  | 'food'
  | 'water'
  | 'oil'
  | 'wine'
  | 'fleece'
  | 'armour'
  | 'horses'
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
  'armour',
  'horses',
  'culture',
  'athletics',
  'drama',
  'tax',
  'health',
  'safety',
];

export type Good =
  | 'food'
  | 'olives'
  | 'oil'
  | 'grapes'
  | 'wine'
  | 'fleece'
  | 'wood'
  | 'marble'
  | 'bronze'
  | 'armour'
  | 'sculpture'
  | 'horses';

export const GOODS: Good[] = [
  'food',
  'olives',
  'oil',
  'grapes',
  'wine',
  'fleece',
  'wood',
  'marble',
  'bronze',
  'armour',
  'sculpture',
  'horses',
];

export type GoodStock = Record<Good, number>;

export type BuildingKind =
  | 'house'
  | 'estate'
  | 'wheatFarm'
  | 'carrotFarm'
  | 'onionFarm'
  | 'huntingLodge'
  | 'fishery'
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
  | 'hippodrome'
  | 'timberMill'
  | 'masonryShop'
  | 'foundry'
  | 'armoury'
  | 'sculptureStudio'
  | 'horseRanch'
  | 'mint'
  | 'artisansGuild'
  | 'monument'
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
  | 'sanctuaryHades'
  | 'sanctuaryHera'
  | 'sanctuaryAtlas'
  | 'pyramidModest'
  | 'pyramid'
  | 'pyramidGreat';

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
  built: number;
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
  | 'actor'
  | 'soldier'
  | 'invader'
  | 'artisan'
  | 'immigrant'
  | 'emigrant';

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

export const emptySupply = (): ServiceSupply => (Object.fromEntries(SERVICE_KINDS.map((service) => [service, 0])) as ServiceSupply);

export const FINISHED = 100;

export const emptyStock = (): GoodStock =>
  Object.fromEntries(GOODS.map((good) => [good, 0])) as GoodStock;

export function createBuilding(id: number, kind: BuildingKind, x: number, y: number, size: number): Building {
  return {
    id,
    kind,
    x,
    y,
    size,
    tier: 0,
    population: 0,
    staff: 0,
    supply: emptySupply(),
    stock: emptyStock(),
    fireRisk: 0,
    damageRisk: 0,
    disease: 0,
    crime: 0,
    productionProgress: 0,
    built: kind.startsWith('sanctuary') || kind.startsWith('pyramid') ? 0 : FINISHED,
    spawnTimer: 0,
    walkersOut: 0,
  };
}

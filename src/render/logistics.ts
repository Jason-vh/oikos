import * as T from 'three';
import { bake, colors, disposeModel, errandToken, houseSupplies, post } from '../art';
import { footprint } from '../sim/catalog';
import { CELL_SIZE, groundHeight, worldPositionOn, type IslandMap } from '../sim/island';
import { serviceCoverage, tradePartners, walkerDelivery, type Delivery } from '../sim/logistics';
import { fadedMaterial } from './emphasis';
import { gatherReach, isGatherer } from '../sim/gathering';
import { reachOutline } from './reach';
import type { Building, City, Walker, World } from '../sim/types';

const TOKEN_LIFT = .62;
const TOKEN_BOB = .09;
const TOKEN_BOB_RATE = 1.7;
const TOKEN_BOB_STAGGER = .8;

interface FloatingToken {
  model: T.Group;
  restY: number;
  phase: number;
}

function findBuilding(world: World, id: number): { city: City; building: Building } | null {
  for (const city of world.cities) {
    if (city.harbour.id === id) return { city, building: city.harbour };
    const building = city.buildings.find((candidate) => candidate.id === id);
    if (building) return { city, building };
  }
  return null;
}

function findWalker(world: World, id: number): { city: City; walker: Walker } | null {
  for (const city of world.cities) {
    const walker = city.walkers.find((candidate) => candidate.id === id);
    if (walker) return { city, walker };
  }
  return null;
}

function disconnectedMark(depth: number): T.Group {
  const mark = new T.Group();
  const z = depth / 2 + .35;
  for (const angle of [.55, -.55]) {
    const pole = post(mark, colors.wood, 0, .3, z, .035, .74);
    pole.rotation.z = angle;
  }
  post(mark, colors.dark, 0, .56, z, .05, .05);
  bake(mark);
  return mark;
}

export function syncHouseSupplies(model: T.Group, building: Building): void {
  if (building.kind !== 'house') return;
  const key = building.residents > 0 ? `${building.tier}:${building.food > 0}:${building.water > 0}:${building.oil > 0}` : '';
  if (model.userData.suppliesKey === key) return;
  const previous = model.userData.suppliesGroup as T.Group | undefined;
  if (previous) {
    previous.removeFromParent();
    disposeModel(previous);
  }
  model.userData.suppliesKey = key;
  model.userData.suppliesGroup = undefined;
  if (key === '') return;
  const supplies = houseSupplies(building.tier, building.food > 0, building.water > 0, building.oil > 0);
  model.add(supplies);
  model.userData.suppliesGroup = supplies;
}

export function syncDisconnectedMark(model: T.Group, building: Building): void {
  const key = building.connected ? '' : 'disconnected';
  if (model.userData.disconnectedKey === key) return;
  const previous = model.userData.disconnectedGroup as T.Group | undefined;
  if (previous) {
    previous.removeFromParent();
    disposeModel(previous);
  }
  model.userData.disconnectedKey = key;
  model.userData.disconnectedGroup = undefined;
  if (key === '') return;
  const { depth } = footprint(building.kind, building.rotation);
  const mark = disconnectedMark(depth * CELL_SIZE);
  model.add(mark);
  model.userData.disconnectedGroup = mark;
}

export class LogisticsOverlay {
  private readonly root = new T.Group();
  private readonly tokens = new T.Group();
  private readonly floating: FloatingToken[] = [];
  private readonly tokenTemplates = new Map<string, T.Group>();
  private readonly reachBand = new T.Group();
  private reachKey = '';
  private key = '';

  constructor(scene: T.Scene, private readonly map: IslandMap, private readonly buildingTop: (id: number) => number) {
    this.root.add(this.tokens, this.reachBand);
    scene.add(this.root);
  }

  private tokenFor(delivery: Delivery): T.Group {
    const key = `${delivery.errand}:${delivery.resource ?? ''}:${delivery.stocked}`;
    let template = this.tokenTemplates.get(key);
    if (!template) {
      template = errandToken(delivery.errand, delivery.resource);
      if (!delivery.stocked) {
        template.traverse((child) => {
          if (child instanceof T.Mesh && !Array.isArray(child.material)) child.material = fadedMaterial(child.material);
        });
      }
      this.tokenTemplates.set(key, template);
    }
    const token = template.clone();
    token.traverse((child) => { child.castShadow = false; });
    return token;
  }

  bob(time: number): boolean {
    if (this.floating.length === 0) return false;
    for (const token of this.floating) {
      token.model.position.y = token.restY + Math.sin(time * TOKEN_BOB_RATE + token.phase) * TOKEN_BOB;
    }
    return true;
  }

  private showReach(world: World | null, found: { city: City; building: Building } | null): void {
    const building = found?.building;
    const gatherer = building !== undefined && isGatherer(building.kind);
    const key = world && gatherer && found ? `${found.building.id}:${found.city.roads.length}:${world.felled.length}` : '';
    if (key === this.reachKey) return;
    this.reachKey = key;
    this.clearReach();
    if (key === '' || !world || !found) return;
    const outline = reachOutline(this.map, gatherReach(world, found.city, found.building.kind, found.building.x, found.building.z, found.building.rotation));
    if (outline) this.reachBand.add(outline);
  }

  private clearReach(): void {
    for (const child of this.reachBand.children) (child as T.Mesh).geometry.dispose();
    this.reachBand.clear();
  }

  update(world: World | null, buildingId: number | null, walkerId: number | null): void {
    const found = world && buildingId !== null ? findBuilding(world, buildingId) : null;
    this.showReach(world, found);
    if (!world) {
      this.clearMarks();
      return;
    }
    if (found) {
      const { city, building } = found;
      const covered = serviceCoverage(world, city, building);
      this.apply(city, `b:${building.id}`, covered.length > 0 ? covered : tradePartners(city, building));
      return;
    }
    const foundWalker = walkerId !== null ? findWalker(world, walkerId) : null;
    if (foundWalker) {
      const delivery = walkerDelivery(foundWalker.walker);
      this.apply(foundWalker.city, `w:${foundWalker.walker.id}`, delivery ? [delivery] : []);
      return;
    }
    this.clearMarks();
  }

  private apply(city: City, key: string, deliveries: Delivery[]): void {
    const marksKey = deliveries.length === 0 ? '' : `${key}:${deliveries.map((one) => `${one.id}=${one.errand}${one.resource ?? ''}${one.stocked ? '' : '-'}`).join(',')}`;
    if (marksKey === this.key) return;
    this.key = marksKey;
    this.tokens.clear();
    this.floating.length = 0;
    for (const delivery of deliveries) {
      const served = city.harbour.id === delivery.id ? city.harbour : city.buildings.find((candidate) => candidate.id === delivery.id);
      if (!served) continue;
      const token = this.tokenFor(delivery);
      const { width, depth } = footprint(served.kind, served.rotation);
      const point = worldPositionOn(this.map, served.x + width / 2, served.z + depth / 2);
      const top = Math.max(this.buildingTop(served.id), groundHeight(this.map, served.x, served.z));
      token.position.set(point.x, top + TOKEN_LIFT, point.z);
      token.rotation.y = -served.rotation * Math.PI / 2;
      this.tokens.add(token);
      this.floating.push({ model: token, restY: token.position.y, phase: this.floating.length * TOKEN_BOB_STAGGER });
    }
  }

  clear(): void {
    this.showReach(null, null);
    this.clearMarks();
  }

  private clearMarks(): void {
    if (this.key === '') return;
    this.key = '';
    this.tokens.clear();
    this.floating.length = 0;
  }

  dispose(): void {
    this.clear();
    this.root.removeFromParent();
    for (const template of this.tokenTemplates.values()) disposeModel(template);
    this.tokenTemplates.clear();
  }

  get counts(): { served: number; reach: number } {
    return { served: this.tokens.children.length, reach: this.reachBand.children.length };
  }
}

import * as T from 'three';
import { bake, colors, disposeModel, houseSupplies, post } from '../art';
import { footprint } from '../sim/catalog';
import { CELL_SIZE, groundHeight, worldPositionOn, type IslandMap } from '../sim/island';
import { stairLayout } from '../sim/stairs';
import { addRoadMark } from './road-marks';
import { deliveryRoutes, serviceRoute, walkerRoute } from '../sim/logistics';
import type { Building, City, Walker, World } from '../sim/types';

const ROUTE_COLOR = colors.blueLight;
const DELIVERY_COLOR = colors.roof;
const SERVED_COLOR = colors.gold;

type RouteStyle = 'planned' | 'live' | 'delivery';

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
  const key = building.residents > 0 ? `${building.tier}:${building.food > 0}:${building.water > 0}` : '';
  if (model.userData.suppliesKey === key) return;
  const previous = model.userData.suppliesGroup as T.Group | undefined;
  if (previous) {
    previous.removeFromParent();
    disposeModel(previous);
  }
  model.userData.suppliesKey = key;
  model.userData.suppliesGroup = undefined;
  if (key === '') return;
  const supplies = houseSupplies(building.tier, building.food > 0, building.water > 0);
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
  private readonly routeTiles = new T.Group();
  private readonly servedMarks = new T.Group();
  private readonly unitPlane = new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private readonly plannedMaterial = new T.MeshBasicMaterial({ color: ROUTE_COLOR, transparent: true, opacity: .48, depthWrite: false });
  private readonly liveMaterial = new T.MeshBasicMaterial({ color: ROUTE_COLOR, transparent: true, opacity: .68, depthWrite: false });
  private readonly deliveryMaterial = new T.MeshBasicMaterial({ color: DELIVERY_COLOR, transparent: true, opacity: .55, depthWrite: false });
  private readonly servedMaterial = new T.MeshBasicMaterial({ color: SERVED_COLOR, transparent: true, opacity: .4, depthWrite: false });
  private key = '';

  constructor(scene: T.Scene, private readonly map: IslandMap) {
    this.root.add(this.routeTiles, this.servedMarks);
    scene.add(this.root);
  }

  update(world: World | null, buildingId: number | null, walkerId: number | null): void {
    if (!world) {
      this.clear();
      return;
    }
    const found = buildingId !== null ? findBuilding(world, buildingId) : null;
    if (found) {
      const { city, building } = found;
      const circuit = serviceRoute(world, city, building);
      if (circuit) {
        const key = `b:${building.id}:${circuit.live}:${circuit.path.join(',')}`;
        this.apply(city, key, [circuit.path], circuit.servedIds, circuit.live ? 'live' : 'planned');
        return;
      }
      const deliveries = deliveryRoutes(city, building);
      if (deliveries.length > 0) {
        const key = `d:${building.id}:${deliveries.map((route) => `${route.walkerId}=${route.path.join('-')}`).join(',')}`;
        this.apply(city, key, deliveries.map((route) => route.path), deliveries.map((route) => route.otherId), 'delivery');
        return;
      }
      this.clear();
      return;
    }
    const foundWalker = walkerId !== null ? findWalker(world, walkerId) : null;
    if (foundWalker) {
      const path = walkerRoute(foundWalker.walker);
      const key = `w:${foundWalker.walker.id}:${path.join(',')}`;
      this.apply(foundWalker.city, key, [path], [], 'live');
      return;
    }
    this.clear();
  }

  private apply(city: City, key: string, paths: number[][], servedIds: number[], style: RouteStyle): void {
    const layoutKey = `${key}:${city.roads.join(',')}`;
    if (layoutKey === this.key) return;
    this.key = layoutKey;
    this.routeTiles.clear();
    this.servedMarks.clear();
    if (key === '') return;
    const routeMaterial = style === 'live' ? this.liveMaterial : style === 'delivery' ? this.deliveryMaterial : this.plannedMaterial;
    const tiles = new Set<number>();
    for (const path of paths) for (const index of path) tiles.add(index);
    const stairs = stairLayout(this.map, new Set(city.roads));
    for (const index of tiles) addRoadMark(this.routeTiles, this.map, stairs, index, this.unitPlane, routeMaterial, .2);
    for (const id of new Set(servedIds)) {
      const served = city.harbour.id === id ? city.harbour : city.buildings.find((candidate) => candidate.id === id);
      if (!served) continue;
      const { width, depth } = footprint(served.kind, served.rotation);
      const point = worldPositionOn(this.map, served.x + width / 2, served.z + depth / 2);
      const mark = new T.Mesh(this.unitPlane, this.servedMaterial);
      mark.scale.set(width * CELL_SIZE + .12, 1, depth * CELL_SIZE + .12);
      mark.position.set(point.x, groundHeight(this.map, served.x, served.z) + .07, point.z);
      this.servedMarks.add(mark);
    }
  }

  clear(): void {
    if (this.key === '') return;
    this.key = '';
    this.routeTiles.clear();
    this.servedMarks.clear();
  }

  dispose(): void {
    this.clear();
    this.root.removeFromParent();
    this.unitPlane.dispose();
    this.plannedMaterial.dispose();
    this.liveMaterial.dispose();
    this.deliveryMaterial.dispose();
    this.servedMaterial.dispose();
  }

  get counts(): { route: number; served: number } {
    return { route: this.routeTiles.children.length, served: this.servedMarks.children.length };
  }
}

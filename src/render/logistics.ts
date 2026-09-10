import * as T from 'three';
import { bake, colors, disposeModel, houseSupplies, post } from '../art';
import { footprint } from '../sim/catalog';
import { CELL_SIZE, groundHeight, tileAtOn, worldPositionOn, type IslandMap } from '../sim/island';
import { serviceRoute, walkerRoute } from '../sim/logistics';
import type { Building, World } from '../sim/types';

const ROUTE_COLOR = colors.blueLight;
const SERVED_COLOR = colors.gold;

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
    const building = buildingId !== null ? world.buildings.find((candidate) => candidate.id === buildingId) ?? null : null;
    if (building) {
      const route = serviceRoute(world, building);
      const key = route ? `b:${building.id}:${route.live}:${route.path.join(',')}` : '';
      this.apply(world, key, route?.path ?? [], route?.servedIds ?? [], route?.live ?? false);
      return;
    }
    const walker = walkerId !== null ? world.walkers.find((candidate) => candidate.id === walkerId) ?? null : null;
    if (walker) {
      const path = walkerRoute(walker);
      const key = `w:${walker.id}:${path.join(',')}`;
      this.apply(world, key, path, [], true);
      return;
    }
    this.clear();
  }

  private apply(world: World, key: string, path: number[], servedIds: number[], live: boolean): void {
    if (key === this.key) return;
    this.key = key;
    this.routeTiles.clear();
    this.servedMarks.clear();
    if (key === '') return;
    const routeMaterial = live ? this.liveMaterial : this.plannedMaterial;
    for (const index of new Set(path)) {
      const tile = tileAtOn(this.map, index);
      const point = worldPositionOn(this.map, tile.x + .5, tile.z + .5);
      const surface = new T.Mesh(this.unitPlane, routeMaterial);
      surface.scale.set(CELL_SIZE - .2, 1, CELL_SIZE - .2);
      surface.position.set(point.x, groundHeight(this.map, tile.x, tile.z) + .09, point.z);
      this.routeTiles.add(surface);
    }
    for (const id of servedIds) {
      const served = world.buildings.find((candidate) => candidate.id === id);
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
    this.servedMaterial.dispose();
  }
}

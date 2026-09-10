import * as T from 'three';
import { bake, box, citizen, colors, disposeModel, getBuildingModel, lump, post } from '../art';
import { footprint } from '../sim/catalog';
import { CELL_SIZE, GROUND_Y, MAP_WIDTH, tileAt, tileIndex, worldPosition } from '../sim/island';
import type { Building, BuildTool, Placement, Rotation, Walker, WalkerKind, World } from '../sim/types';
import type { Stage } from './stage';
import { IslandScenery } from './island';

interface BuildingEntry { key: string; model: T.Group; }
interface WalkerEntry { model: T.Group; from: T.Vector3; target: T.Vector3; elapsed: number; }

export class CityScene {
  readonly scenery: IslandScenery;
  private readonly buildings = new Map<number, BuildingEntry>();
  private readonly walkers = new Map<number, WalkerEntry>();
  private readonly walkerTemplates = new Map<WalkerKind, T.Group>();
  private readonly roads = new T.Group();
  private readonly selection = new T.Mesh(new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({ color: 0xffefae, transparent: true, opacity: .4, depthWrite: false }));
  private readonly preview = new T.Group();
  private roadKey = '';
  private previewKey = '';
  private ghost: T.Group | null = null;
  private selected: number | null = null;
  private readonly validMaterial = new T.MeshBasicMaterial({ color: 0x79b58b, transparent: true, opacity: .38, depthWrite: false });
  private readonly invalidMaterial = new T.MeshBasicMaterial({ color: 0xd3664e, transparent: true, opacity: .45, depthWrite: false });
  private readonly tileGeometry = new T.PlaneGeometry(CELL_SIZE - .06, CELL_SIZE - .06).rotateX(-Math.PI / 2);

  constructor(private readonly stage: Stage) {
    this.scenery = new IslandScenery(stage.scene);
    this.selection.visible = false;
    stage.scene.add(this.roads, this.selection, this.preview);
  }

  private roadModels(world: World): void {
    const key = world.roads.join(',');
    if (key === this.roadKey) return;
    this.roadKey = key;
    disposeModel(this.roads);
    this.roads.clear();
    for (const index of world.roads) {
      const tile = tileAt(index);
      const p = worldPosition(tile.x + .5, tile.z + .5);
      box(this.roads, colors.paving, p.x, GROUND_Y + .015, p.z, CELL_SIZE, .07, CELL_SIZE, .025);
      if (index % 3 !== 0) box(this.roads, colors.cream, p.x - .15, GROUND_Y + .058, p.z + .08, .58, .012, .42, .008);
    }
    if (world.roads.length) bake(this.roads);
    this.stage.shadows();
  }

  sync(world: World): void {
    this.roadModels(world);
    const ids = new Set(world.buildings.map((building) => building.id));
    const occupied = new Set(world.roads);
    for (const [id, entry] of this.buildings) {
      if (ids.has(id)) continue;
      entry.model.removeFromParent();
      disposeModel(entry.model);
      this.buildings.delete(id);
      this.stage.shadows();
    }
    for (const building of world.buildings) {
      const { width, depth } = footprint(building.kind, building.rotation);
      for (let z = building.z; z < building.z + depth; z++) {
        for (let x = building.x; x < building.x + width; x++) occupied.add(tileIndex(x, z));
      }
      const key = `${building.kind}:${building.tier}:${building.vendorEnabled}:${building.rotation}:${building.x}:${building.z}`;
      const existing = this.buildings.get(building.id);
      if (existing?.key === key) continue;
      if (existing) {
        existing.model.removeFromParent();
        disposeModel(existing.model);
      }
      const model = getBuildingModel(building.kind, building.tier, building.vendorEnabled);
      const point = worldPosition(building.x + width / 2, building.z + depth / 2);
      model.position.set(point.x, GROUND_Y, point.z);
      model.rotation.y = -building.rotation * Math.PI / 2;
      model.userData.buildingId = building.id;
      this.stage.scene.add(model);
      this.buildings.set(building.id, { key, model });
      this.stage.shadows();
    }
    this.scenery.clearTrees(occupied);
    const walkerIds = new Set(world.walkers.map((walker) => walker.id));
    for (const [id, entry] of this.walkers) {
      if (walkerIds.has(id)) continue;
      entry.model.removeFromParent();
      this.walkers.delete(id);
    }
    for (const walker of world.walkers) this.syncWalker(walker);
    this.select(world.buildings.find((building) => building.id === this.selected) ?? null);
    this.stage.invalidate();
  }

  private walkerModel(kind: WalkerKind): T.Group {
    const existing = this.walkerTemplates.get(kind);
    if (existing) return existing.clone();
    const color = { cart: colors.gold, buyer: colors.roof, vendor: colors.blue, water: colors.blueLight, maintenance: colors.oliveDark }[kind];
    const model = citizen(color, kind === 'water' || kind === 'buyer' || kind === 'vendor');
    if (kind === 'cart') {
      const cart = new T.Group();
      box(cart, colors.wood, 0, .4, -.62, .62, .38, .68);
      for (const side of [-1, 1]) {
        const wheel = post(cart, colors.dark, side * .36, .24, -.62, .19, .09);
        wheel.rotation.z = Math.PI / 2;
      }
      lump(cart, colors.gold, 0, .64, -.62, .3, .18, .3);
      bake(cart);
      model.add(cart);
    }
    model.scale.setScalar(.83);
    this.walkerTemplates.set(kind, model);
    return model.clone();
  }

  private syncWalker(walker: Walker): void {
    const current = tileAt(walker.path[Math.min(walker.step, walker.path.length - 1)]);
    const next = tileAt(walker.path[Math.min(walker.step + 1, walker.path.length - 1)]);
    const a = worldPosition(current.x + .5, current.z + .5);
    const b = worldPosition(next.x + .5, next.z + .5);
    const target = new T.Vector3(T.MathUtils.lerp(a.x, b.x, walker.progress), GROUND_Y + .08, T.MathUtils.lerp(a.z, b.z, walker.progress));
    let entry = this.walkers.get(walker.id);
    if (!entry) {
      const model = this.walkerModel(walker.kind);
      model.position.copy(target);
      this.stage.scene.add(model);
      entry = { model, from: target.clone(), target, elapsed: .25 };
      this.walkers.set(walker.id, entry);
    } else {
      entry.from.copy(entry.model.position);
      entry.target.copy(target);
      entry.elapsed = 0;
    }
    if (a.x !== b.x || a.z !== b.z) entry.model.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
  }

  animate(time: number, delta: number, speed: number): void {
    this.scenery.update(time);
    for (const [id, walker] of this.walkers) {
      walker.elapsed += delta * speed;
      walker.model.position.lerpVectors(walker.from, walker.target, Math.min(1, walker.elapsed / .25));
      walker.model.position.y += Math.abs(Math.sin(time * 7 + id)) * .022;
    }
    this.stage.invalidate();
  }

  select(building: Building | null): void {
    this.selected = building?.id ?? null;
    this.selection.visible = building !== null;
    if (!building) return;
    const { width, depth } = footprint(building.kind, building.rotation);
    const p = worldPosition(building.x + width / 2, building.z + depth / 2);
    this.selection.scale.set(width * CELL_SIZE + .12, 1, depth * CELL_SIZE + .12);
    this.selection.position.set(p.x, GROUND_Y + .065, p.z);
  }

  showPreview(tool: BuildTool | 'demolish', x: number, z: number, rotation: Rotation, placement: Placement): void {
    this.preview.clear();
    for (const index of placement.tiles) {
      if (index < 0 || index >= MAP_WIDTH * 32) continue;
      const tile = tileAt(index);
      const p = worldPosition(tile.x + .5, tile.z + .5);
      const surface = new T.Mesh(this.tileGeometry, placement.ok ? this.validMaterial : this.invalidMaterial);
      surface.position.set(p.x, GROUND_Y + .09, p.z);
      this.preview.add(surface);
    }
    const key = `${tool}:${rotation}`;
    if (key !== this.previewKey) {
      this.previewKey = key;
      if (this.ghost) {
        this.ghost.traverse((child) => {
          if (child instanceof T.Mesh) {
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            for (const material of materials) material.dispose();
          }
        });
        disposeModel(this.ghost);
      }
      this.ghost = null;
      if (tool !== 'road' && tool !== 'demolish') {
        this.ghost = getBuildingModel(tool, 1, tool === 'agora');
        this.ghost.traverse((child) => {
          if (!(child instanceof T.Mesh)) return;
          const material = (child.material as T.MeshStandardMaterial).clone();
          material.transparent = true;
          material.opacity = .45;
          material.depthWrite = false;
          child.material = material;
          child.castShadow = false;
        });
      }
    }
    if (this.ghost && tool !== 'road' && tool !== 'demolish') {
      const size = footprint(tool, rotation);
      const p = worldPosition(x + size.width / 2, z + size.depth / 2);
      this.ghost.position.set(p.x, GROUND_Y + .06, p.z);
      this.ghost.rotation.y = -rotation * Math.PI / 2;
      this.preview.add(this.ghost);
    }
    this.stage.invalidate();
  }

  hidePreview(): void {
    this.preview.clear();
    this.stage.invalidate();
  }

  pickBuilding(clientX: number, clientY: number): number | null {
    const bounds = this.stage.canvas.getBoundingClientRect();
    const ray = new T.Raycaster();
    ray.setFromCamera(new T.Vector2((clientX - bounds.left) / bounds.width * 2 - 1, -(clientY - bounds.top) / bounds.height * 2 + 1), this.stage.camera);
    const hits = ray.intersectObjects([...this.buildings.values()].map((entry) => entry.model), true);
    let object: T.Object3D | null = hits[0]?.object ?? null;
    while (object) {
      if (typeof object.userData.buildingId === 'number') return object.userData.buildingId;
      object = object.parent;
    }
    return null;
  }
}

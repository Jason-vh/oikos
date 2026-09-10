import * as T from 'three';
import { animateFigure, bake, box, bundle, bundleKey, colors, disposeModel, figure, getBuildingModel, post, type ModelStage } from '../art';
import { footprint } from '../sim/catalog';
import { AGORA_SLOTS, GRANARY_SLOTS } from '../sim/balance';
import { CELL_SIZE, groundHeight, tileAtOn, tileIndexOn, worldPositionOn, type IslandMap } from '../sim/island';
import type { Building, BuildTool, Food, Placement, Rotation, Walker, WalkerKind, World } from '../sim/types';
import type { Stage } from './stage';
import { IslandScenery } from './island';

interface BuildingEntry { key: string; model: T.Group; }
interface WalkerEntry { key: string; model: T.Group; from: T.Vector3; target: T.Vector3; elapsed: number; moving: boolean; }

function modelStage(building: Building): ModelStage {
  if (building.kind === 'farm') return Math.min(3, Math.floor(building.progress * 4)) as ModelStage;
  return 3;
}

function storesKey(building: Building): string {
  if (building.kind === 'granary') return bundleKey(building.stores, GRANARY_SLOTS);
  if (building.kind === 'agora') return bundleKey(building.stores, AGORA_SLOTS);
  return '';
}

export class CityScene {
  readonly scenery: IslandScenery;
  private readonly buildings = new Map<number, BuildingEntry>();
  private readonly walkers = new Map<number, WalkerEntry>();
  private readonly walkerTemplates = new Map<string, T.Group>();
  private readonly roads = new T.Group();
  private readonly selection = new T.Mesh(new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({ color: 0xffefae, transparent: true, opacity: .4, depthWrite: false }));
  private readonly preview = new T.Group();
  private roadKey = '';
  private previewKey = '';
  private ghost: T.Group | null = null;
  private selectedWalker: number | null = null;
  private readonly validMaterial = new T.MeshBasicMaterial({ color: 0x79b58b, transparent: true, opacity: .38, depthWrite: false });
  private readonly invalidMaterial = new T.MeshBasicMaterial({ color: 0xd3664e, transparent: true, opacity: .45, depthWrite: false });
  private readonly tileGeometry = new T.PlaneGeometry(CELL_SIZE - .06, CELL_SIZE - .06).rotateX(-Math.PI / 2);

  constructor(private readonly stage: Stage, readonly map: IslandMap) {
    this.scenery = new IslandScenery(stage.scene, map);
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
      const tile = tileAtOn(this.map, index);
      const p = worldPositionOn(this.map, tile.x + .5, tile.z + .5);
      const y = groundHeight(this.map, tile.x, tile.z);
      box(this.roads, colors.paving, p.x, y + .015, p.z, CELL_SIZE, .07, CELL_SIZE, .025);
      if (index % 3 !== 0) box(this.roads, colors.cream, p.x - .15, y + .058, p.z + .08, .58, .012, .42, .008);
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
        for (let x = building.x; x < building.x + width; x++) occupied.add(tileIndexOn(this.map, x, z));
      }
      const stage = modelStage(building);
      const key = `${building.kind}:${building.tier}:${building.vendorEnabled}:${stage}:${storesKey(building)}:${building.rotation}:${building.x}:${building.z}`;
      const existing = this.buildings.get(building.id);
      if (existing?.key === key) continue;
      if (existing) {
        existing.model.removeFromParent();
        disposeModel(existing.model);
      }
      const model = getBuildingModel(building.kind, { tier: building.tier, vendorEnabled: building.vendorEnabled, stage, stores: building.stores });
      const point = worldPositionOn(this.map, building.x + width / 2, building.z + depth / 2);
      model.position.set(point.x, groundHeight(this.map, building.x, building.z), point.z);
      model.rotation.y = -building.rotation * Math.PI / 2;
      model.userData.buildingId = building.id;
      this.stage.scene.add(model);
      this.buildings.set(building.id, { key, model });
      this.stage.shadows();
    }
    this.scenery.clearDecor(occupied);
    const walkerIds = new Set(world.walkers.map((walker) => walker.id));
    for (const [id, entry] of this.walkers) {
      if (walkerIds.has(id)) continue;
      entry.model.removeFromParent();
      this.walkers.delete(id);
    }
    for (const walker of world.walkers) this.syncWalker(walker);
    this.stage.invalidate();
  }

  private walkerModel(kind: WalkerKind, load: Food | null): T.Group {
    const key = `${kind}:${load ?? ''}`;
    const existing = this.walkerTemplates.get(key);
    if (existing) return existing.clone();
    const colour: Record<WalkerKind, number> = { cart: colors.gold, buyer: colors.roof, vendor: colors.blue, water: colors.blueLight, maintenance: colors.oliveDark, immigrant: colors.linen };
    const carries = kind === 'water' || (load !== null && kind !== 'cart');
    const model = figure(colour[kind], carries ? 'jar' : kind === 'immigrant' ? 'bundle' : 'none').root;
    if (kind === 'cart') {
      const cart = new T.Group();
      box(cart, colors.wood, 0, .4, -.62, .62, .38, .68);
      for (const side of [-1, 1]) {
        const wheel = post(cart, colors.dark, side * .36, .24, -.62, .19, .09);
        wheel.rotation.z = Math.PI / 2;
      }
      if (load) {
        const heap = new T.Group();
        heap.position.set(0, .48, -.62);
        heap.scale.setScalar(.8);
        bundle(heap, load, 0, 0, 0, 1);
        cart.add(heap);
      }
      bake(cart);
      model.add(cart);
    }
    if (kind === 'immigrant') {
      const companion = figure(colors.roof, 'bundle').root;
      companion.position.set(.34, 0, -.42);
      const child = figure(colors.oliveLight, 'none').root;
      child.scale.setScalar(.7);
      child.position.set(-.3, 0, -.36);
      model.add(companion, child);
    }
    model.scale.setScalar(.83);
    this.walkerTemplates.set(key, model);
    return model.clone();
  }

  private syncWalker(walker: Walker): void {
    const current = tileAtOn(this.map, walker.path[Math.min(walker.step, walker.path.length - 1)]);
    const next = tileAtOn(this.map, walker.path[Math.min(walker.step + 1, walker.path.length - 1)]);
    const a = worldPositionOn(this.map, current.x + .5, current.z + .5);
    const b = worldPositionOn(this.map, next.x + .5, next.z + .5);
    const y = T.MathUtils.lerp(groundHeight(this.map, current.x, current.z), groundHeight(this.map, next.x, next.z), walker.progress);
    const target = new T.Vector3(T.MathUtils.lerp(a.x, b.x, walker.progress), y + .08, T.MathUtils.lerp(a.z, b.z, walker.progress));
    const load = walker.cargo > 0 ? walker.food : null;
    const key = `${walker.kind}:${load ?? ''}`;
    let entry = this.walkers.get(walker.id);
    if (entry && entry.key !== key) {
      const replacement = this.walkerModel(walker.kind, load);
      replacement.position.copy(entry.model.position);
      replacement.rotation.copy(entry.model.rotation);
      entry.model.removeFromParent();
      entry.model = replacement;
      entry.key = key;
      this.stage.scene.add(replacement);
    }
    if (!entry) {
      const model = this.walkerModel(walker.kind, load);
      model.position.copy(target);
      this.stage.scene.add(model);
      entry = { key, model, from: target.clone(), target, elapsed: .25, moving: false };
      this.walkers.set(walker.id, entry);
    } else {
      entry.from.copy(entry.model.position);
      entry.target.copy(target);
      entry.elapsed = 0;
      entry.moving = entry.from.distanceToSquared(target) > 1e-6;
    }
    if (a.x !== b.x || a.z !== b.z) entry.model.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
  }

  animate(time: number, delta: number, speed: number): void {
    this.scenery.update(time);
    for (const [id, walker] of this.walkers) {
      walker.elapsed += delta * speed;
      walker.model.position.lerpVectors(walker.from, walker.target, Math.min(1, walker.elapsed / .25));
      const stride = walker.moving ? .55 : 0;
      const phase = time * 9 * Math.max(1, speed) + id;
      animateFigure(walker.model, phase, stride);
      for (const companion of walker.model.children.slice(5)) {
        if (companion.children.length >= 5) animateFigure(companion, phase + 1.3, stride);
      }
    }
    this.followSelection();
    this.stage.invalidate();
  }

  select(building: Building | null, walkerId: number | null = null): void {
    this.selectedWalker = walkerId;
    this.selection.visible = building !== null || walkerId !== null;
    if (walkerId !== null) {
      this.selection.scale.set(1.1, 1, 1.1);
      this.followSelection();
      return;
    }
    this.selection.visible = building !== null;
    if (!building) return;
    const { width, depth } = footprint(building.kind, building.rotation);
    const p = worldPositionOn(this.map, building.x + width / 2, building.z + depth / 2);
    this.selection.scale.set(width * CELL_SIZE + .12, 1, depth * CELL_SIZE + .12);
    this.selection.position.set(p.x, groundHeight(this.map, building.x, building.z) + .065, p.z);
  }

  showPreview(tool: BuildTool | 'demolish', x: number, z: number, rotation: Rotation, placement: Placement): void {
    this.preview.clear();
    for (const index of placement.tiles) {
      if (index < 0 || index >= this.map.width * this.map.depth) continue;
      const tile = tileAtOn(this.map, index);
      const p = worldPositionOn(this.map, tile.x + .5, tile.z + .5);
      const surface = new T.Mesh(this.tileGeometry, placement.ok ? this.validMaterial : this.invalidMaterial);
      surface.position.set(p.x, groundHeight(this.map, tile.x, tile.z) + .09, p.z);
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
        this.ghost = getBuildingModel(tool, { vendorEnabled: tool === 'agora', stores: tool === 'agora' ? { wheat: 300 } : {} });
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
      const p = worldPositionOn(this.map, x + size.width / 2, z + size.depth / 2);
      this.ghost.position.set(p.x, groundHeight(this.map, x, z) + .06, p.z);
      this.ghost.rotation.y = -rotation * Math.PI / 2;
      this.preview.add(this.ghost);
    }
    this.stage.invalidate();
  }

  hidePreview(): void {
    this.preview.clear();
    this.stage.invalidate();
  }

  private followSelection(): void {
    if (this.selectedWalker === null) return;
    const entry = this.walkers.get(this.selectedWalker);
    if (!entry) return;
    this.selection.position.set(entry.model.position.x, entry.model.position.y - .015, entry.model.position.z);
  }

  pick(clientX: number, clientY: number): { building: number | null; walker: number | null } {
    const bounds = this.stage.canvas.getBoundingClientRect();
    const ray = new T.Raycaster();
    ray.setFromCamera(new T.Vector2((clientX - bounds.left) / bounds.width * 2 - 1, -(clientY - bounds.top) / bounds.height * 2 + 1), this.stage.camera);
    let nearest: { id: number; distance: number } | null = null;
    const centre = new T.Vector3();
    for (const [id, entry] of this.walkers) {
      centre.copy(entry.model.position).setY(entry.model.position.y + .5);
      const distance = ray.ray.distanceToPoint(centre);
      if (distance < .75 && (!nearest || distance < nearest.distance)) nearest = { id, distance };
    }
    if (nearest) return { building: null, walker: nearest.id };
    const hits = ray.intersectObjects([...this.buildings.values()].map((entry) => entry.model), true);
    let object: T.Object3D | null = hits[0]?.object ?? null;
    while (object) {
      if (typeof object.userData.buildingId === 'number') return { building: object.userData.buildingId, walker: null };
      object = object.parent;
    }
    return { building: null, walker: null };
  }

  dispose(): void {
    for (const entry of this.buildings.values()) {
      entry.model.removeFromParent();
      disposeModel(entry.model);
    }
    this.buildings.clear();
    for (const entry of this.walkers.values()) entry.model.removeFromParent();
    this.walkers.clear();
    for (const template of this.walkerTemplates.values()) disposeModel(template);
    this.walkerTemplates.clear();
    disposeModel(this.roads);
    this.roads.removeFromParent();
    this.selection.removeFromParent();
    this.preview.removeFromParent();
    this.scenery.dispose();
  }

  probe(clientX: number, clientY: number): { color: string; y: number; name: string }[] {
    const bounds = this.stage.canvas.getBoundingClientRect();
    const ray = new T.Raycaster();
    ray.setFromCamera(new T.Vector2((clientX - bounds.left) / bounds.width * 2 - 1, -(clientY - bounds.top) / bounds.height * 2 + 1), this.stage.camera);
    return ray.intersectObjects(this.stage.scene.children, true).filter((hit) => hit.object instanceof T.Mesh).slice(0, 4).map((hit) => { const material = (hit.object as T.Mesh).material as T.MeshStandardMaterial; return { color: material.color.getHexString(), y: hit.point.y, name: `${material.type} t=${material.transparent} o=${material.opacity} side=${material.side} vis=${hit.object.visible} normals=${!!(hit.object as T.Mesh).geometry.getAttribute('normal')} n=${Array.from((hit.object as T.Mesh).geometry.getAttribute('normal').array.slice(0, 3)).map((v) => v.toFixed(2))}` }; });
  }
}

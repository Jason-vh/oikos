import * as T from 'three';
import { animalModel, animateAnimal, animateFigure, animateWork, bake, box, bundle, bundleKey, colors, disposeModel, figure, getBuildingModel, lump, post, type ModelStage } from '../art';
import { footprint } from '../sim/catalog';
import { AGORA_SLOTS, GRANARY_SLOTS } from '../sim/balance';
import { CELL_SIZE, groundHeight, levelOn, LEVEL_HEIGHT, tileAtOn, tileIndexOn, worldPositionOn, type IslandMap } from '../sim/island';
import type { Animal, AnimalKind, Building, BuildTool, Placement, Resource, Rotation, Walker, WalkerKind, World } from '../sim/types';
import type { Stage } from './stage';
import { IslandScenery } from './island';

interface BuildingEntry { key: string; tier: number; model: T.Group; intro: number; from: number; }
interface Departure { model: T.Group; elapsed: number; }
interface Puff { model: T.Group; material: T.MeshStandardMaterial; elapsed: number; }
interface WalkerEntry { key: string; kind: WalkerKind; model: T.Group; from: T.Vector3; target: T.Vector3; elapsed: number; moving: boolean; working: boolean; heading: number; }
interface AnimalEntry { model: T.Group; from: T.Vector3; target: T.Vector3; heading: number; elapsed: number; moving: boolean; dying: number; }

const RAMP_SPAN = 1;
const TURN_RATE = 14;
const INTRO_SECONDS = .45;
const EXIT_SECONDS = .3;
const PUFF_SECONDS = .7;
const PUFF_GEOMETRY = new T.DodecahedronGeometry(1, 0);

function backOut(t: number): number {
  const overshoot = 1.6;
  const shifted = t - 1;
  return 1 + shifted * shifted * ((overshoot + 1) * shifted + overshoot);
}

function dustPuff(x: number, y: number, z: number, width: number, depth: number): Puff {
  const model = new T.Group();
  const material = new T.MeshStandardMaterial({ color: colors.cream, roughness: .88, transparent: true, opacity: .75, depthWrite: false });
  for (let index = 0; index < 7; index++) {
    const angle = index / 7 * Math.PI * 2;
    const cloud = new T.Mesh(PUFF_GEOMETRY, material);
    cloud.position.set(Math.cos(angle) * width * .38, .15, Math.sin(angle) * depth * .38);
    cloud.scale.setScalar(.22 + (index % 3) * .08);
    model.add(cloud);
  }
  model.position.set(x, y, z);
  return { model, material, elapsed: 0 };
}

function turnToward(current: number, goal: number, delta: number): number {
  const difference = Math.atan2(Math.sin(goal - current), Math.cos(goal - current));
  return current + difference * Math.min(1, delta * TURN_RATE);
}

function rampHeight(from: number, to: number, progress: number): number {
  if (from === to) return from;
  const start = .5 - RAMP_SPAN / 2;
  const t = Math.min(1, Math.max(0, (progress - start) / RAMP_SPAN));
  const tread = Math.abs(to - from) / 8;
  return T.MathUtils.lerp(from, to, t) + (t > 0 && t < 1 ? tread / 2 : 0);
}

function modelStage(building: Building): ModelStage {
  if (building.kind === 'farm') return Math.min(3, Math.floor(building.progress * 4)) as ModelStage;
  return 3;
}

function storesKey(building: Building): string {
  if (building.kind === 'granary' || building.kind === 'stockpile') return bundleKey(building.stores, GRANARY_SLOTS);
  if (building.kind === 'agora') return bundleKey(building.stores, AGORA_SLOTS);
  return '';
}

export class CityScene {
  readonly scenery: IslandScenery;
  private readonly buildings = new Map<number, BuildingEntry>();
  private readonly walkers = new Map<number, WalkerEntry>();
  private readonly walkerTemplates = new Map<string, T.Group>();
  private readonly animals = new Map<number, AnimalEntry>();
  private readonly animalTemplates = new Map<AnimalKind, T.Group>();
  private readonly departures: Departure[] = [];
  private readonly puffs: Puff[] = [];
  private readonly roads = new T.Group();
  private readonly hoverMark = new T.Mesh(new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({ color: 0xffefae, transparent: true, opacity: .18, depthWrite: false }));
  private primed = false;
  private readonly selection = new T.Mesh(new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({ color: 0xffefae, transparent: true, opacity: .4, depthWrite: false }));
  private readonly preview = new T.Group();
  private roadKey = '';
  private previewKey = '';
  private ghost: T.Group | null = null;
  private selectedWalker: number | null = null;
  private readonly validMaterial = new T.MeshBasicMaterial({ color: 0x79b58b, transparent: true, opacity: .38, depthWrite: false });
  private readonly invalidMaterial = new T.MeshBasicMaterial({ color: 0xd3664e, transparent: true, opacity: .45, depthWrite: false });
  private readonly tileGeometry = new T.PlaneGeometry(CELL_SIZE - .06, CELL_SIZE - .06).rotateX(-Math.PI / 2);

  constructor(private readonly stage: Stage, readonly map: IslandMap, private readonly motion = true) {
    this.scenery = new IslandScenery(stage.scene, map);
    this.selection.visible = false;
    this.hoverMark.visible = false;
    stage.scene.add(this.roads, this.selection, this.hoverMark, this.preview);
  }

  private roadModels(world: World): void {
    const key = world.roads.join(',');
    if (key === this.roadKey) return;
    this.roadKey = key;
    disposeModel(this.roads);
    this.roads.clear();
    const roads = new Set(world.roads);
    for (const index of world.roads) {
      const tile = tileAtOn(this.map, index);
      const p = worldPositionOn(this.map, tile.x + .5, tile.z + .5);
      const y = groundHeight(this.map, tile.x, tile.z);
      const level = levelOn(this.map, tile.x, tile.z);
      const climb = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dz]) => roads.has(tileIndexOn(this.map, tile.x + dx, tile.z + dz)) && levelOn(this.map, tile.x + dx, tile.z + dz) === level + 1);
      if (climb) {
        const [dx, dz] = climb;
        const steps = 8;
        const span = CELL_SIZE * RAMP_SPAN;
        const origin = { x: p.x + dx * CELL_SIZE / 2, z: p.z + dz * CELL_SIZE / 2 };
        for (let step = 0; step < steps; step++) {
          const along = (step + .5) / steps - .5;
          const rise = (step + 1) / steps * LEVEL_HEIGHT;
          const tread = span / steps + .02;
          box(this.roads, colors.cream, origin.x + dx * along * span, y + rise / 2 + .015, origin.z + dz * along * span, dx === 0 ? CELL_SIZE - .2 : tread, rise, dz === 0 ? CELL_SIZE - .2 : tread, .012);
        }
        for (const side of [-1, 1]) {
          box(this.roads, colors.stone, origin.x + (dx === 0 ? side * (CELL_SIZE / 2 - .05) : 0), y + LEVEL_HEIGHT * .5 + .1, origin.z + (dz === 0 ? side * (CELL_SIZE / 2 - .05) : 0), dx === 0 ? .1 : span, LEVEL_HEIGHT + .2, dz === 0 ? .1 : span, .02);
        }
        box(this.roads, colors.paving, p.x - dx * CELL_SIZE * .35, y + .015, p.z - dz * CELL_SIZE * .35, dx === 0 ? CELL_SIZE : CELL_SIZE * .3, .07, dz === 0 ? CELL_SIZE : CELL_SIZE * .3, .025);
        continue;
      }
      const descent = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dz]) => roads.has(tileIndexOn(this.map, tile.x + dx, tile.z + dz)) && levelOn(this.map, tile.x + dx, tile.z + dz) === level - 1);
      if (descent) {
        const [dx, dz] = descent;
        box(this.roads, colors.paving, p.x - dx * CELL_SIZE * .25, y + .015, p.z - dz * CELL_SIZE * .25, dx === 0 ? CELL_SIZE : CELL_SIZE * .5, .07, dz === 0 ? CELL_SIZE : CELL_SIZE * .5, .025);
        continue;
      }
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
      this.buildings.delete(id);
      if (this.motion) this.depart(entry.model);
      else {
        entry.model.removeFromParent();
        disposeModel(entry.model);
      }
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
      const animated = this.motion && this.primed && (!existing || existing.tier !== building.tier);
      const entry = { key, tier: building.tier, model, intro: animated ? 0 : INTRO_SECONDS, from: existing ? .85 : .4 };
      this.buildings.set(building.id, entry);
      if (animated) this.settle(entry);
      this.stage.shadows();
    }
    this.primed = true;
    this.scenery.clearDecor(occupied, new Set(world.felled));
    const walkerIds = new Set(world.walkers.map((walker) => walker.id));
    for (const [id, entry] of this.walkers) {
      if (walkerIds.has(id)) continue;
      entry.model.removeFromParent();
      this.walkers.delete(id);
    }
    for (const walker of world.walkers) this.syncWalker(walker);
    const animalIds = new Set(world.wildlife.map((animal) => animal.id));
    for (const [id, entry] of this.animals) {
      if (animalIds.has(id)) continue;
      entry.model.removeFromParent();
      this.animals.delete(id);
    }
    for (const animal of world.wildlife) this.syncAnimal(animal);
    this.stage.invalidate();
  }

  private animalPosition(animal: Animal): T.Vector3 {
    const point = worldPositionOn(this.map, animal.x, animal.z);
    if (animal.kind === 'fish') return new T.Vector3(point.x, -.03, point.z);
    if (animal.kind === 'gull') return new T.Vector3(point.x, 7.5 + Math.sin(animal.phase * .8) * .6, point.z);
    return new T.Vector3(point.x, groundHeight(this.map, Math.floor(animal.x), Math.floor(animal.z)), point.z);
  }

  private syncAnimal(animal: Animal): void {
    const target = this.animalPosition(animal);
    let entry = this.animals.get(animal.id);
    if (!entry) {
      let template = this.animalTemplates.get(animal.kind);
      if (!template) {
        template = animalModel(animal.kind);
        template.scale.setScalar(animal.kind === 'boar' ? 1.15 : animal.kind === 'rabbit' ? 1.25 : animal.kind === 'gull' ? .9 : 1.1);
        this.animalTemplates.set(animal.kind, template);
      }
      const model = template.clone();
      model.userData.kind = animal.kind;
      model.position.copy(target);
      model.rotation.y = -animal.heading + Math.PI / 2;
      this.stage.scene.add(model);
      entry = { model, from: target.clone(), target, heading: animal.heading, elapsed: .25, moving: false, dying: 0 };
      this.animals.set(animal.id, entry);
      if (animal.respawn > 0) model.visible = false;
      return;
    }
    if (animal.respawn > 0 && entry.model.visible && entry.dying === 0) entry.dying = .01;
    if (animal.respawn === 0 && !entry.model.visible) {
      entry.model.visible = true;
      entry.model.rotation.z = 0;
      entry.dying = 0;
    }
    entry.from.copy(entry.model.position);
    entry.target.copy(target);
    entry.heading = animal.heading;
    entry.elapsed = 0;
    entry.moving = entry.from.distanceToSquared(target) > 1e-5;
  }

  private walkerModel(kind: WalkerKind, load: Resource | null): T.Group {
    const key = `${kind}:${load ?? ''}`;
    const existing = this.walkerTemplates.get(key);
    if (existing) return existing.clone();
    const colour: Record<WalkerKind, number> = { cart: colors.gold, buyer: colors.roof, vendor: colors.blue, water: colors.blueLight, maintenance: colors.oliveDark, immigrant: colors.linen, hunter: 0x6f5a3c, woodcutter: 0x8a5a3a };
    const gatherer = kind === 'hunter' || kind === 'woodcutter';
    const carries = kind === 'water' || (load !== null && kind !== 'cart' && !gatherer);
    const model = figure(colour[kind], carries ? 'jar' : kind === 'immigrant' || (gatherer && load !== null) ? 'bundle' : 'none').root;
    if (gatherer) {
      const tool = new T.Group();
      tool.position.set(.24, .55, .08);
      if (kind === 'hunter') {
        const spear = post(tool, colors.wood, 0, .3, 0, .022, 1.5);
        spear.rotation.x = .15;
        lump(tool, colors.stone, 0, 1.06, -.11, .04, .12, .03);
      } else {
        post(tool, colors.wood, 0, .15, 0, .028, .75);
        box(tool, colors.stone, .0, .5, .05, .05, .18, .12, .01);
      }
      bake(tool);
      model.add(tool);
    }
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
    const y = rampHeight(groundHeight(this.map, current.x, current.z), groundHeight(this.map, next.x, next.z), walker.progress);
    const target = new T.Vector3(T.MathUtils.lerp(a.x, b.x, walker.progress), y + .08, T.MathUtils.lerp(a.z, b.z, walker.progress));
    const load: Resource | null = walker.cargo > 0 ? walker.food : null;
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
    const fresh = !entry;
    if (!entry) {
      const model = this.walkerModel(walker.kind, load);
      model.position.copy(target);
      this.stage.scene.add(model);
      entry = { key, kind: walker.kind, model, from: target.clone(), target, elapsed: .25, moving: false, working: false, heading: 0 };
      this.walkers.set(walker.id, entry);
    } else {
      entry.from.copy(entry.model.position);
      entry.target.copy(target);
      entry.elapsed = 0;
      entry.moving = entry.from.distanceToSquared(target) > 1e-6;
    }
    entry.working = walker.working > 0;
    let facing: number | null = null;
    if (entry.working && walker.quarry !== null) {
      const quarry = walker.kind === 'hunter' ? this.animals.get(walker.quarry)?.model.position : null;
      const tile = walker.kind === 'woodcutter' ? tileAtOn(this.map, walker.quarry) : null;
      const goal = quarry ?? (tile ? new T.Vector3(worldPositionOn(this.map, tile.x + .5, tile.z + .5).x, 0, worldPositionOn(this.map, tile.x + .5, tile.z + .5).z) : null);
      if (goal) facing = Math.atan2(goal.x - target.x, goal.z - target.z);
    }
    if (facing !== null) entry.heading = facing;
    else if (a.x !== b.x || a.z !== b.z) entry.heading = Math.atan2(b.x - a.x, b.z - a.z);
    if (fresh) entry.model.rotation.y = entry.heading;
  }

  animate(time: number, delta: number, speed: number): void {
    this.scenery.update(time);
    for (const [id, walker] of this.walkers) {
      walker.elapsed += delta * speed;
      walker.model.position.lerpVectors(walker.from, walker.target, Math.min(1, walker.elapsed / .25));
      walker.model.rotation.y = turnToward(walker.model.rotation.y, walker.heading, delta * speed);
      const stride = walker.moving ? .55 : 0;
      const phase = time * 9 * Math.max(1, speed) + id;
      if (walker.working) animateWork(walker.model, time * Math.max(1, speed) + id, walker.kind === 'hunter' ? 'thrust' : 'chop');
      else animateFigure(walker.model, phase, stride);
      for (const companion of walker.model.children.slice(5)) {
        if (companion.children.length >= 5) animateFigure(companion, phase + 1.3, stride);
      }
    }
    for (const [id, animal] of this.animals) {
      animal.elapsed += delta * speed;
      animal.model.position.lerpVectors(animal.from, animal.target, Math.min(1, animal.elapsed / .25));
      const kind = this.kindOf(animal.model);
      animal.model.rotation.y = turnToward(animal.model.rotation.y, -animal.heading + Math.PI / 2, delta * speed);
      if (animal.dying > 0) {
        animal.dying += delta * speed;
        const t = Math.min(1, animal.dying / .9);
        animal.model.rotation.z = t * Math.PI / 2;
        animal.model.position.y = animal.target.y + Math.sin(t * Math.PI) * .12;
        if (t >= 1) {
          animal.model.visible = false;
          animal.dying = 0;
        }
        continue;
      }
      animateAnimal(animal.model, kind, time * Math.max(1, speed) + id, animal.moving);
    }
    if (this.scenery.animateFalls(delta * speed)) this.stage.shadows();
    this.followSelection();
    this.stage.invalidate();
  }

  private depart(model: T.Group): void {
    const bounds = new T.Box3().setFromObject(model);
    const size = bounds.getSize(new T.Vector3());
    const puff = dustPuff(model.position.x, model.position.y, model.position.z, size.x, size.z);
    this.stage.scene.add(puff.model);
    this.puffs.push(puff);
    this.departures.push({ model, elapsed: 0 });
  }

  private settle(entry: BuildingEntry): void {
    const t = Math.min(1, entry.intro / INTRO_SECONDS);
    const scale = t >= 1 ? 1 : entry.from + (1 - entry.from) * backOut(t);
    entry.model.scale.setScalar(scale);
  }

  transitions(delta: number): boolean {
    let active = false;
    for (const entry of this.buildings.values()) {
      if (entry.intro >= INTRO_SECONDS) continue;
      entry.intro += delta;
      this.settle(entry);
      active = true;
    }
    for (const departure of [...this.departures]) {
      departure.elapsed += delta;
      const t = Math.min(1, departure.elapsed / EXIT_SECONDS);
      departure.model.scale.set(1 + t * .08, 1 - t * .9, 1 + t * .08);
      if (t >= 1) {
        departure.model.removeFromParent();
        disposeModel(departure.model);
        this.departures.splice(this.departures.indexOf(departure), 1);
      }
      active = true;
    }
    for (const puff of [...this.puffs]) {
      puff.elapsed += delta;
      const t = Math.min(1, puff.elapsed / PUFF_SECONDS);
      const spread = 1 + t * 1.6;
      puff.model.scale.set(spread, 1 + t * .8, spread);
      puff.model.position.y += delta * .35;
      puff.material.opacity = .75 * (1 - t) * (1 - t);
      if (t >= 1) {
        puff.model.removeFromParent();
        puff.material.dispose();
        this.puffs.splice(this.puffs.indexOf(puff), 1);
      }
      active = true;
    }
    if (active) this.stage.shadows();
    return active;
  }

  hover(clientX: number, clientY: number, world: World): boolean {
    const picked = this.pick(clientX, clientY);
    const building = world.buildings.find((candidate) => candidate.id === picked.building);
    const mover = picked.walker !== null ? this.walkers.get(picked.walker) : picked.animal !== null ? this.animals.get(picked.animal) : null;
    this.hoverMark.visible = building !== undefined || mover !== undefined;
    if (mover) {
      this.hoverMark.scale.set(1.1, 1, 1.1);
      this.hoverMark.position.set(mover.model.position.x, mover.model.position.y - .015, mover.model.position.z);
    } else if (building) {
      const { width, depth } = footprint(building.kind, building.rotation);
      const p = worldPositionOn(this.map, building.x + width / 2, building.z + depth / 2);
      this.hoverMark.scale.set(width * CELL_SIZE + .12, 1, depth * CELL_SIZE + .12);
      this.hoverMark.position.set(p.x, groundHeight(this.map, building.x, building.z) + .06, p.z);
    }
    this.stage.invalidate();
    return this.hoverMark.visible;
  }

  clearHover(): void {
    if (!this.hoverMark.visible) return;
    this.hoverMark.visible = false;
    this.stage.invalidate();
  }

  private kindOf(model: T.Object3D): AnimalKind {
    return model.userData.kind as AnimalKind;
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
    const entry = this.walkers.get(this.selectedWalker) ?? this.animals.get(this.selectedWalker);
    if (!entry) return;
    this.selection.position.set(entry.model.position.x, entry.model.position.y - .015, entry.model.position.z);
  }

  pick(clientX: number, clientY: number): { building: number | null; walker: number | null; animal: number | null } {
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
    if (nearest) return { building: null, walker: nearest.id, animal: null };
    let nearestAnimal: { id: number; distance: number } | null = null;
    for (const [id, entry] of this.animals) {
      centre.copy(entry.model.position).setY(entry.model.position.y + .25);
      const distance = ray.ray.distanceToPoint(centre);
      if (distance < .7 && (!nearestAnimal || distance < nearestAnimal.distance)) nearestAnimal = { id, distance };
    }
    if (nearestAnimal) return { building: null, walker: null, animal: nearestAnimal.id };
    const hits = ray.intersectObjects([...this.buildings.values()].map((entry) => entry.model), true);
    let object: T.Object3D | null = hits[0]?.object ?? null;
    while (object) {
      if (typeof object.userData.buildingId === 'number') return { building: object.userData.buildingId, walker: null, animal: null };
      object = object.parent;
    }
    return { building: null, walker: null, animal: null };
  }

  dispose(): void {
    for (const entry of this.buildings.values()) {
      entry.model.removeFromParent();
      disposeModel(entry.model);
    }
    this.buildings.clear();
    for (const entry of this.walkers.values()) entry.model.removeFromParent();
    this.walkers.clear();
    for (const entry of this.animals.values()) entry.model.removeFromParent();
    this.animals.clear();
    for (const template of this.animalTemplates.values()) disposeModel(template);
    this.animalTemplates.clear();
    for (const template of this.walkerTemplates.values()) disposeModel(template);
    this.walkerTemplates.clear();
    for (const departure of this.departures) {
      departure.model.removeFromParent();
      disposeModel(departure.model);
    }
    this.departures.length = 0;
    for (const puff of this.puffs) {
      puff.model.removeFromParent();
      puff.material.dispose();
    }
    this.puffs.length = 0;
    disposeModel(this.roads);
    this.roads.removeFromParent();
    this.selection.removeFromParent();
    this.hoverMark.removeFromParent();
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

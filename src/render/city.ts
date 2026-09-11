import * as T from 'three';
import { animateFigure, animateWork, bake, box, bundle, bundleKey, colors, disposeModel, figure, getBuildingAssembly, getBuildingModel, lump, post, type ModelStage } from '../art';
import { footprint } from '../sim/catalog';
import { AGORA_SLOTS, GRANARY_SLOTS } from '../sim/balance';
import { CELL_SIZE, GROUND_Y, LEVEL_HEIGHT, groundHeight, insideMapOn, tileAtOn, tileIndexOn, worldPositionOn, type IslandMap } from '../sim/island';
import { buildRoads } from '../art/roads';
import { STAIR_WIDTH } from '../art/stairs';
import { roadHeight, stairLayout, STAIR_STEPS, type Stair } from '../sim/stairs';
import { addRoadMark } from './road-marks';
import type { Animal, AnimalKind, Building, BuildTool, Placement, Resource, Rotation, Tile, Walker, WalkerKind, World } from '../sim/types';
import type { Stage } from './stage';
import { IslandScenery } from './island';
import { LogisticsOverlay, syncDisconnectedMark, syncHouseSupplies } from './logistics';
import { BuildingConstruction } from './assembly';
import { DustField } from './dust';
import { WildlifeField } from './wildlife';

interface BuildingEntry { key: string; tier: number; model: T.Group; intro: number; from: number; construction: BuildingConstruction | null; }
interface Departure { model: T.Group; elapsed: number; }
interface WalkerEntry { key: string; kind: WalkerKind; model: T.Group; from: T.Vector3; target: T.Vector3; elapsed: number; moving: boolean; working: boolean; heading: number; stepped: boolean; }
interface AnimalEntry { kind: AnimalKind; position: T.Vector3; from: T.Vector3; target: T.Vector3; heading: number; facing: number; roll: number; phase: number; elapsed: number; moving: boolean; dying: number; visible: boolean; }

const TURN_RATE = 14;
const INTRO_SECONDS = .45;
const EXIT_SECONDS = .3;


function backOut(t: number): number {
  const overshoot = 1.6;
  const shifted = t - 1;
  return 1 + shifted * shifted * ((overshoot + 1) * shifted + overshoot);
}

function turnToward(current: number, goal: number, delta: number): number {
  const difference = Math.atan2(Math.sin(goal - current), Math.cos(goal - current));
  return current + difference * Math.min(1, delta * TURN_RATE);
}

function rampHeight(from: number, to: number, progress: number): number {
  if (from === to) return from;
  const t = Math.min(1, Math.max(0, progress));
  const tread = Math.abs(to - from) / STAIR_STEPS;
  return T.MathUtils.lerp(from, to, t) + (t > 0 && t < 1 ? tread / 2 : 0);
}

function modelStage(building: Building): ModelStage {
  if (building.kind === 'farm') return Math.min(3, Math.floor(building.progress * 4)) as ModelStage;
  if (building.kind === 'harbour') return (building.progress === 0 ? 0 : Math.min(3, 1 + Math.floor(building.progress * 3))) as ModelStage;
  return 3;
}

function storesKey(building: Building): string {
  if (building.kind === 'granary' || building.kind === 'stockpile' || building.kind === 'harbour') return bundleKey(building.stores, GRANARY_SLOTS);
  if (building.kind === 'agora') return bundleKey(building.stores, AGORA_SLOTS);
  return '';
}

export class CityScene {
  readonly scenery: IslandScenery;
  private readonly buildings = new Map<number, BuildingEntry>();
  private readonly walkers = new Map<number, WalkerEntry>();
  private readonly walkerTemplates = new Map<string, T.Group>();
  private readonly animals = new Map<number, AnimalEntry>();
  private readonly wildlife: WildlifeField;
  private readonly departures: Departure[] = [];
  private readonly dust: DustField;
  private readonly roads = new T.Group();
  private readonly hoverMark = new T.Mesh(new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({ color: 0xffefae, transparent: true, opacity: .18, depthWrite: false }));
  private primed = false;
  private readonly selection = new T.Mesh(new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({ color: 0xffefae, transparent: true, opacity: .4, depthWrite: false }));
  private readonly preview = new T.Group();
  private roadKey = '';
  private stairs = new Map<number, Stair>();
  private stairMeshes: T.Object3D[] = [];
  private previewKey = '';
  private ghost: T.Group | null = null;
  private selectedWalker: number | null = null;
  private lastWorld: World | null = null;
  private readonly logistics: LogisticsOverlay;
  private readonly validMaterial = new T.MeshBasicMaterial({ color: 0x79b58b, transparent: true, opacity: .38, depthWrite: false });
  private readonly invalidMaterial = new T.MeshBasicMaterial({ color: 0xd3664e, transparent: true, opacity: .45, depthWrite: false });
  private readonly validStairMaterial = this.validMaterial.clone();
  private readonly invalidStairMaterial = this.invalidMaterial.clone();
  private readonly tileGeometry = new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

  constructor(private readonly stage: Stage, readonly map: IslandMap, private readonly motion = true) {
    this.validStairMaterial.depthTest = false;
    this.invalidStairMaterial.depthTest = false;
    this.scenery = new IslandScenery(stage.scene, map);
    this.wildlife = new WildlifeField(stage.scene);
    this.logistics = new LogisticsOverlay(stage.scene, map);
    this.dust = new DustField(stage.scene);
    this.selection.visible = false;
    this.hoverMark.visible = false;
    stage.scene.add(this.roads, this.selection, this.hoverMark, this.preview);
  }

  private roadModels(world: World): void {
    const key = world.roads.join(',');
    if (key === this.roadKey) return;
    this.roadKey = key;
    this.stairs = stairLayout(this.map, new Set(world.roads));
    this.scenery.setStairs(this.stairs);
    disposeModel(this.roads);
    this.roads.clear();
    const roads = buildRoads(this.map, world.roads);
    this.stairMeshes = roads.children.filter((model) => model.userData.stairs === true);
    this.roads.add(roads);
    this.stage.shadows();
  }

  reload(world: World): void {
    for (const entry of this.walkers.values()) entry.model.removeFromParent();
    this.walkers.clear();
    for (const departure of this.departures) {
      departure.model.removeFromParent();
      disposeModel(departure.model);
    }
    this.departures.length = 0;
    this.dust.clear();
    const ids = new Set([...world.buildings, world.harbour].map((building) => building.id));
    for (const [id, entry] of this.buildings) {
      entry.construction?.settle();
      entry.construction = null;
      if (ids.has(id)) continue;
      this.buildings.delete(id);
      entry.model.removeFromParent();
      disposeModel(entry.model);
    }
    this.primed = false;
    this.sync(world);
    this.stage.shadows();
  }

  sync(world: World): void {
    this.lastWorld = world;
    this.roadModels(world);
    const allBuildings = [...world.buildings, world.harbour];
    const ids = new Set(allBuildings.map((building) => building.id));
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
    for (const building of allBuildings) {
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
      const state = { tier: building.tier, vendorEnabled: building.vendorEnabled, stage, stores: building.stores };
      const finished = getBuildingModel(building.kind, state);
      const animated = this.motion && this.primed && (!existing || existing.tier !== building.tier);
      const assembling = animated || (existing?.construction && existing.tier === building.tier);
      const assembly = assembling ? getBuildingAssembly(building.kind, state) : null;
      const plot = footprint(building.kind, 0);
      const site = { width: plot.width * CELL_SIZE, depth: plot.depth * CELL_SIZE, dust: this.dust };
      const construction = assembly ? new BuildingConstruction(finished, assembly, site) : null;
      if (construction && existing?.construction) construction.advance(existing.construction.elapsed);
      const model = construction?.model ?? finished;
      const point = worldPositionOn(this.map, building.x + width / 2, building.z + depth / 2);
      model.position.set(point.x, groundHeight(this.map, building.x, building.z), point.z);
      model.rotation.y = -building.rotation * Math.PI / 2;
      model.userData.buildingId = building.id;
      this.stage.scene.add(model);
      const entry = { key, tier: building.tier, model, intro: animated && !construction ? 0 : INTRO_SECONDS, from: existing ? .85 : .4, construction };
      this.buildings.set(building.id, entry);
      if (animated) this.settle(entry);
      this.stage.shadows();
    }
    for (const building of world.buildings) {
      const entry = this.buildings.get(building.id);
      if (!entry) continue;
      syncHouseSupplies(entry.model, building);
      syncDisconnectedMark(entry.model, building);
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
    for (const id of [...this.animals.keys()]) {
      if (animalIds.has(id)) continue;
      this.wildlife.remove(id);
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
    const entry = this.animals.get(animal.id);
    if (!entry) {
      const fresh: AnimalEntry = {
        kind: animal.kind,
        position: target.clone(),
        from: target.clone(),
        target,
        heading: animal.heading,
        facing: -animal.heading + Math.PI / 2,
        roll: 0,
        phase: 0,
        elapsed: .25,
        moving: false,
        dying: 0,
        visible: animal.respawn === 0,
      };
      this.animals.set(animal.id, fresh);
      this.wildlife.add(animal.id, animal.kind);
      this.writeAnimal(animal.id, fresh);
      return;
    }
    if (animal.respawn > 0 && entry.visible && entry.dying === 0) entry.dying = .01;
    if (animal.respawn === 0 && !entry.visible) {
      entry.visible = true;
      entry.roll = 0;
      entry.dying = 0;
    }
    entry.from.copy(entry.position);
    entry.target.copy(target);
    entry.heading = animal.heading;
    entry.elapsed = 0;
    entry.moving = entry.from.distanceToSquared(target) > 1e-5;
  }

  private writeAnimal(id: number, entry: AnimalEntry): void {
    if (!entry.visible) {
      this.wildlife.conceal(id);
      return;
    }
    this.wildlife.pose(id, entry.kind, { position: entry.position, facing: entry.facing, roll: entry.roll, phase: entry.phase, moving: entry.moving });
  }

  private walkerModel(kind: WalkerKind, load: Resource | null): T.Group {
    const key = `${kind}:${load ?? ''}`;
    const existing = this.walkerTemplates.get(key);
    if (existing) return existing.clone();
    const colour: Record<WalkerKind, number> = { cart: colors.gold, buyer: colors.roof, vendor: colors.blue, water: colors.blueLight, maintenance: colors.oliveDark, immigrant: colors.linen, hunter: 0x6f5a3c, woodcutter: 0x8a5a3a, porter: colors.wood };
    const gatherer = kind === 'hunter' || kind === 'woodcutter';
    const cartLike = kind === 'cart' || kind === 'porter';
    const carries = kind === 'water' || (load !== null && !cartLike && !gatherer);
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
    if (cartLike) {
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
    const stepped = this.stairs.has(tileIndexOn(this.map, current.x, current.z)) || this.stairs.has(tileIndexOn(this.map, next.x, next.z));
    let y = rampHeight(groundHeight(this.map, current.x, current.z), groundHeight(this.map, next.x, next.z), walker.progress);
    if (stepped) y = roadHeight(this.map, this.stairs, T.MathUtils.lerp(current.x, next.x, walker.progress) + .5, T.MathUtils.lerp(current.z, next.z, walker.progress) + .5);
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
      entry = { key, kind: walker.kind, model, from: target.clone(), target, elapsed: .25, moving: false, working: false, heading: 0, stepped };
      this.walkers.set(walker.id, entry);
    } else {
      entry.from.copy(entry.model.position);
      entry.target.copy(target);
      entry.elapsed = 0;
      entry.moving = entry.from.distanceToSquared(target) > 1e-6;
    }
    entry.stepped = stepped;
    entry.working = walker.working > 0;
    let facing: number | null = null;
    if (entry.working && walker.quarry !== null) {
      const quarry = walker.kind === 'hunter' ? this.animals.get(walker.quarry)?.position : null;
      const tile = walker.kind === 'woodcutter' ? tileAtOn(this.map, walker.quarry) : null;
      const goal = quarry ?? (tile ? new T.Vector3(worldPositionOn(this.map, tile.x + .5, tile.z + .5).x, 0, worldPositionOn(this.map, tile.x + .5, tile.z + .5).z) : null);
      if (goal) facing = Math.atan2(goal.x - target.x, goal.z - target.z);
    }
    if (facing !== null) entry.heading = facing;
    else if (a.x !== b.x || a.z !== b.z) entry.heading = Math.atan2(b.x - a.x, b.z - a.z);
    if (fresh) {
      entry.model.rotation.y = entry.heading;
      this.groundCompanions(entry);
    }
  }

  private groundCompanions(walker: WalkerEntry): void {
    for (const companion of walker.model.children.slice(5)) {
      if (companion.children.length < 5) continue;
      if (!walker.stepped) {
        companion.position.y = 0;
        continue;
      }
      const point = companion.getWorldPosition(new T.Vector3());
      const height = roadHeight(this.map, this.stairs, point.x / CELL_SIZE + this.map.width / 2, point.z / CELL_SIZE + this.map.depth / 2);
      companion.position.y = (height + .08 - walker.model.position.y) / walker.model.scale.y;
    }
  }

  animate(time: number, delta: number, speed: number): void {
    this.scenery.update(time);
    for (const [id, walker] of this.walkers) {
      walker.elapsed += delta * speed;
      walker.model.position.lerpVectors(walker.from, walker.target, Math.min(1, walker.elapsed / .25));
      if (walker.stepped) {
        const position = walker.model.position;
        position.y = roadHeight(this.map, this.stairs, position.x / CELL_SIZE + this.map.width / 2, position.z / CELL_SIZE + this.map.depth / 2) + .08;
      }
      walker.model.rotation.y = turnToward(walker.model.rotation.y, walker.heading, delta * speed);
      const stride = walker.moving ? .55 : 0;
      const phase = time * 9 * Math.max(1, speed) + id;
      if (walker.working) animateWork(walker.model, time * Math.max(1, speed) + id, walker.kind === 'hunter' ? 'thrust' : 'chop');
      else animateFigure(walker.model, phase, stride);
      for (const companion of walker.model.children.slice(5)) {
        if (companion.children.length >= 5) animateFigure(companion, phase + 1.3, stride);
      }
      this.groundCompanions(walker);
    }
    for (const [id, animal] of this.animals) {
      animal.elapsed += delta * speed;
      animal.position.lerpVectors(animal.from, animal.target, Math.min(1, animal.elapsed / .25));
      animal.facing = turnToward(animal.facing, -animal.heading + Math.PI / 2, delta * speed);
      if (animal.dying > 0) {
        animal.dying += delta * speed;
        const t = Math.min(1, animal.dying / .9);
        animal.roll = t * Math.PI / 2;
        animal.position.y = animal.target.y + Math.sin(t * Math.PI) * .12;
        animal.moving = false;
        if (t >= 1) {
          animal.visible = false;
          animal.dying = 0;
        }
        this.writeAnimal(id, animal);
        continue;
      }
      animal.phase = time * Math.max(1, speed) + id;
      this.writeAnimal(id, animal);
    }
    if (this.scenery.animateFalls(delta * speed)) this.stage.shadowsFromMotion();
    this.followSelection();
    this.stage.invalidate();
  }

  private depart(model: T.Group): void {
    const size = new T.Box3().setFromObject(model).getSize(new T.Vector3());
    this.dust.puff(model.position.clone(), size.x, size.z);
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
      if (entry.construction) {
        if (entry.construction.advance(delta)) {
          entry.construction.settle();
          entry.construction = null;
        }
        active = true;
      }
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
    if (this.dust.advance(delta)) active = true;
    if (active) this.stage.shadowsFromMotion();
    return active;
  }

  private moverPosition(id: number | null): T.Vector3 | null {
    if (id === null) return null;
    const walker = this.walkers.get(id);
    if (walker) return walker.model.position;
    return this.animals.get(id)?.position ?? null;
  }

  hover(clientX: number, clientY: number, world: World): boolean {
    const picked = this.pick(clientX, clientY);
    const building = world.buildings.find((candidate) => candidate.id === picked.building);
    const mover = this.moverPosition(picked.walker ?? picked.animal);
    this.hoverMark.visible = building !== undefined || mover !== null;
    if (mover) {
      this.hoverMark.scale.set(1.1, 1, 1.1);
      this.hoverMark.position.set(mover.x, mover.y - .015, mover.z);
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

  select(building: Building | null, walkerId: number | null = null): void {
    this.logistics.update(this.lastWorld, building ? building.id : null, walkerId);
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
    const tiles = new Set(placement.tiles.filter((index) => index >= 0 && index < this.map.width * this.map.depth));
    let stairs = this.stairs;
    if (tool === 'road') {
      stairs = stairLayout(this.map, new Set([...(this.lastWorld?.roads ?? []), ...tiles]));
      for (const stair of stairs.values()) if (this.stairs.get(stair.tile)?.down !== stair.down) tiles.add(stair.tile);
    }
    for (const index of tiles) {
      let material = placement.ok ? this.validMaterial : this.invalidMaterial;
      if (stairs.has(index)) material = placement.ok ? this.validStairMaterial : this.invalidStairMaterial;
      addRoadMark(this.preview, this.map, stairs, index, this.tileGeometry, material, .06);
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
    const position = this.moverPosition(this.selectedWalker);
    if (!position) return;
    this.selection.position.set(position.x, position.y - .015, position.z);
  }

  private pointerRay(clientX: number, clientY: number): T.Raycaster {
    const bounds = this.stage.canvas.getBoundingClientRect();
    const ray = new T.Raycaster();
    ray.setFromCamera(new T.Vector2((clientX - bounds.left) / bounds.width * 2 - 1, -(clientY - bounds.top) / bounds.height * 2 + 1), this.stage.camera);
    return ray;
  }

  tileAtPointer(clientX: number, clientY: number): Tile | null {
    const ray = this.pointerRay(clientX, clientY);
    const hit = ray.intersectObjects(this.stairMeshes, false)[0];
    let stairTile: Tile | null = null;
    if (hit?.face) {
      const position = (hit.object as T.Mesh).geometry.attributes.position;
      const centre = new T.Vector3();
      for (const index of [hit.face.a, hit.face.b, hit.face.c]) centre.add(new T.Vector3().fromBufferAttribute(position, index));
      centre.multiplyScalar(1 / 3).applyMatrix4(hit.object.matrixWorld);
      const normal = hit.face.normal.clone().applyNormalMatrix(new T.Matrix3().getNormalMatrix(hit.object.matrixWorld));
      const point = hit.point.clone().lerp(centre, .0001).addScaledVector(normal, -.0001);
      const x = Math.floor(point.x / CELL_SIZE + this.map.width / 2);
      const z = Math.floor(point.z / CELL_SIZE + this.map.depth / 2);
      if (insideMapOn(this.map, x, z) && this.stairs.has(tileIndexOn(this.map, x, z))) stairTile = { x, z };
    }
    let groundTile: Tile | null = null;
    let groundDistance = Infinity;
    for (let level = 2; level >= 0; level--) {
      const y = GROUND_Y + level * LEVEL_HEIGHT;
      const point = this.stage.pick(clientX, clientY, y);
      if (!point) continue;
      const x = point.x / CELL_SIZE + this.map.width / 2;
      const z = point.z / CELL_SIZE + this.map.depth / 2;
      const tile = { x: Math.floor(x), z: Math.floor(z) };
      if (level === 0 && !insideMapOn(this.map, tile.x, tile.z)) {
        groundTile = tile;
        groundDistance = ray.ray.origin.distanceTo(point);
        break;
      }
      if (!insideMapOn(this.map, tile.x, tile.z)) continue;
      const stair = this.stairs.get(tileIndexOn(this.map, tile.x, tile.z));
      if (stair && Math.abs(-stair.dz * (x - tile.x - .5) + stair.dx * (z - tile.z - .5)) * CELL_SIZE < STAIR_WIDTH / 2) continue;
      if (Math.abs(groundHeight(this.map, tile.x, tile.z) - y) < 1e-6) {
        groundTile = tile;
        groundDistance = ray.ray.origin.distanceTo(point);
        break;
      }
    }
    if (stairTile && hit.distance < groundDistance) return stairTile;
    return groundTile;
  }

  pick(clientX: number, clientY: number): { building: number | null; walker: number | null; animal: number | null } {
    const ray = this.pointerRay(clientX, clientY);
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
      if (!entry.visible) continue;
      centre.copy(entry.position).setY(entry.position.y + .25);
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
    this.animals.clear();
    this.wildlife.dispose();
    for (const template of this.walkerTemplates.values()) disposeModel(template);
    this.walkerTemplates.clear();
    for (const departure of this.departures) {
      departure.model.removeFromParent();
      disposeModel(departure.model);
    }
    this.departures.length = 0;
    this.dust.clear();
    disposeModel(this.roads);
    this.roads.removeFromParent();
    this.logistics.dispose();
    this.selection.removeFromParent();
    this.hoverMark.removeFromParent();
    this.preview.removeFromParent();
    this.tileGeometry.dispose();
    this.validStairMaterial.dispose();
    this.invalidStairMaterial.dispose();
    this.scenery.dispose();
  }

  probe(clientX: number, clientY: number): { color: string; y: number; name: string }[] {
    const ray = this.pointerRay(clientX, clientY);
    return ray.intersectObjects(this.stage.scene.children, true).filter((hit) => hit.object instanceof T.Mesh).slice(0, 4).map((hit) => { const material = (hit.object as T.Mesh).material as T.MeshStandardMaterial; return { color: material.color.getHexString(), y: hit.point.y, name: `${material.type} t=${material.transparent} o=${material.opacity} side=${material.side} vis=${hit.object.visible} normals=${!!(hit.object as T.Mesh).geometry.getAttribute('normal')} n=${Array.from((hit.object as T.Mesh).geometry.getAttribute('normal').array.slice(0, 3)).map((v) => v.toFixed(2))}` }; });
  }
}

import * as T from 'three';
import { animateFigure, animateIdle, animateWork, axe, bake, box, bundle, bundleKey, chopStrikes, CHOP_SET, colors, disposeModel, figure, getBuildingAssembly, getBuildingModel, post, spear, type Idle, type ModelStage } from '../art';
import { footprint } from '../sim/catalog';
import { AGORA_SLOTS, GRANARY_SLOTS, WALKER_SPEED } from '../sim/balance';
import { CELL_SIZE, GROUND_Y, LEVEL_HEIGHT, groundHeight, insideMapOn, tileAtOn, tileIndexOn, worldPositionOn, type IslandMap } from '../sim/island';
import { buildRoads } from '../art/roads';
import { alive, animalAt, animalStride, wildlifeObstacles } from '../sim/wildlife';
import { STAIR_WIDTH } from '../art/stairs';
import { roadHeight, stairLayout, STAIR_STEPS, type Stair } from '../sim/stairs';
import { addRoadMark } from './road-marks';
import { reachOutline } from './reach';
import type { Animal, Building, BuildTool, City, Placement, Resource, Rotation, Tile, Walker, WalkerKind, WalkerTask, World } from '../sim/types';
import type { Stage } from './stage';
import { IslandScenery } from './island';
import { LogisticsOverlay, syncDisconnectedMark, syncHouseSupplies } from './logistics';
import { BuildingConstruction } from './assembly';
import { DustField } from './dust';
import { WildlifeField } from './wildlife';

interface BuildingEntry { key: string; tier: number; model: T.Group; intro: number; from: number; construction: BuildingConstruction | null; }
interface Departure { model: T.Group; elapsed: number; }
interface WalkerEntry { key: string; kind: WalkerKind; model: T.Group; path: number[]; departedAt: number; quarry: number | null; task: WalkerTask | null; strikes: number; moving: boolean; working: boolean; waitingSince: number; spell: number; mood: Idle; aim: number; heading: number; stepped: boolean; stairs: ReadonlyMap<number, Stair>; }
interface AnimalEntry { animal: Animal; position: T.Vector3; facing: number; roll: number; phase: number; moving: boolean; stride: number; dying: number; visible: boolean; drawn: boolean; }

const SIGHT_MARGIN = 1.3;
const ANIMAL_FACING_LOOK = .35;
const IDLE_SETTLE = 1.2;
const IDLE_SPELL = 3.4;
const IDLE_SWEEP = 1.8;
const NEIGHBOUR_REACH = 3.2;
const CHOP_REACH = .9;
const HUNT_REACH = .95;
const WORK_APPROACH = .5;
const WORK_WITHDRAW = .4;

function scatterOf(id: number, spell: number): number {
  const drawn = Math.sin(id * 12.9898 + spell * 78.233) * 43758.5453;
  return drawn - Math.floor(drawn);
}
const REVEAL_SHARE = .9;

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

function visibleBuildings(world: World): Building[] {
  return world.cities.flatMap((city: City) => [...city.buildings, city.harbour]);
}

function allWalkers(world: World): Walker[] {
  return world.cities.flatMap((city) => city.walkers);
}

function findBuilding(world: World, id: number | null): Building | undefined {
  if (id === null) return undefined;
  for (const city of world.cities) {
    const found = city.buildings.find((candidate) => candidate.id === id);
    if (found) return found;
  }
  return undefined;
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
  private stairsByCity = new Map<number, ReadonlyMap<number, Stair>>();
  private stairMeshes: T.Object3D[] = [];
  private previewKey = '';
  private ghost: T.Group | null = null;
  private reachMark: T.Mesh | null = null;
  private selectedWalker: number | null = null;
  private focus: T.Vector3 | null = null;
  private sight = 60;
  private lastWorld: World | null = null;
  private syncedWildlife: readonly Animal[] | null = null;
  private wildlifeObstacles: ReadonlySet<number> = new Set();
  private worldTime = 0;
  private turnedAt = 0;
  private readonly logistics: LogisticsOverlay;
  private readonly validMaterial = new T.MeshBasicMaterial({ color: 0x79b58b, transparent: true, opacity: .38, depthWrite: false });
  private readonly invalidMaterial = new T.MeshBasicMaterial({ color: 0xd3664e, transparent: true, opacity: .45, depthWrite: false });
  private readonly validStairMaterial = this.validMaterial.clone();
  private readonly invalidStairMaterial = this.invalidMaterial.clone();
  private readonly tileGeometry = new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

  constructor(private readonly stage: Stage, readonly map: IslandMap, private readonly motion = true) {
    this.roads.name = 'roads';
    this.validStairMaterial.depthTest = false;
    this.invalidStairMaterial.depthTest = false;
    this.dust = new DustField(stage.scene);
    this.scenery = new IslandScenery(stage.scene, map, this.dust, this.motion);
    this.wildlife = new WildlifeField(stage.scene);
    this.logistics = new LogisticsOverlay(stage.scene, map);
    this.selection.visible = false;
    this.hoverMark.visible = false;
    stage.scene.add(this.roads, this.selection, this.hoverMark, this.preview);
  }

  private roadModels(world: World): void {
    const key = world.cities.map((city) => `${city.id}:${city.roads.join(',')}`).join('|');
    if (key === this.roadKey) return;
    this.roadKey = key;
    const stairsByCity = new Map<number, ReadonlyMap<number, Stair>>();
    const combinedStairs = new Map<number, Stair>();
    const stairMeshes: T.Object3D[] = [];
    disposeModel(this.roads);
    this.roads.clear();
    for (const city of world.cities) {
      const cityStairs = stairLayout(this.map, new Set(city.roads));
      stairsByCity.set(city.id, cityStairs);
      for (const [tile, stair] of cityStairs) combinedStairs.set(tile, stair);
      const cityRoadModels = buildRoads(this.map, city.roads);
      stairMeshes.push(...cityRoadModels.children.filter((model) => model.userData.stairs === true));
      this.roads.add(cityRoadModels);
    }
    this.stairsByCity = stairsByCity;
    this.stairs = combinedStairs;
    this.stairMeshes = stairMeshes;
    this.scenery.setStairs(this.stairs);
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
    const buildings = visibleBuildings(world);
    const ids = new Set(buildings.map((building) => building.id));
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

  setWorldTime(time: number): void {
    this.worldTime = time;
  }

  sync(world: World): void {
    this.lastWorld = world;
    this.roadModels(world);
    const buildings = visibleBuildings(world);
    const ids = new Set(buildings.map((building) => building.id));
    const occupied = new Set(world.cities.flatMap((city) => city.roads));
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
    for (const building of buildings) {
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
    for (const building of world.cities.flatMap((candidate) => candidate.buildings)) {
      const entry = this.buildings.get(building.id);
      if (!entry) continue;
      syncHouseSupplies(entry.model, building);
      syncDisconnectedMark(entry.model, building);
    }
    this.primed = true;
    this.scenery.clearDecor(occupied, new Set(world.felled));
    const walkerIds = new Set(allWalkers(world).map((walker) => walker.id));
    for (const [id, entry] of this.walkers) {
      if (walkerIds.has(id)) continue;
      entry.model.removeFromParent();
      this.walkers.delete(id);
    }
    for (const city of world.cities) {
      const stairs = this.stairsByCity.get(city.id) ?? new Map<number, Stair>();
      for (const walker of city.walkers) this.syncWalker(walker, stairs);
    }
    this.wildlifeObstacles = wildlifeObstacles(world);
    if (world.wildlife !== this.syncedWildlife) {
      this.syncedWildlife = world.wildlife;
      const animalIds = new Set(world.wildlife.map((animal) => animal.id));
      for (const id of [...this.animals.keys()]) {
        if (animalIds.has(id)) continue;
        this.wildlife.remove(id);
        this.animals.delete(id);
      }
      for (const animal of world.wildlife) this.syncAnimal(animal);
    }
    this.stage.invalidate();
  }

  private animalPosition(entry: AnimalEntry, at: number): T.Vector3 {
    const place = animalAt(this.map, this.wildlifeObstacles, entry.animal, at);
    const point = worldPositionOn(this.map, place.x, place.z);
    if (entry.animal.kind === 'fish') return new T.Vector3(point.x, -.03, point.z);
    if (entry.animal.kind === 'gull') return new T.Vector3(point.x, 7.5 + Math.sin(at * .8 + entry.animal.drift) * .6, point.z);
    return new T.Vector3(point.x, groundHeight(this.map, Math.floor(place.x), Math.floor(place.z)), point.z);
  }

  private syncAnimal(animal: Animal): void {
    const entry = this.animals.get(animal.id);
    if (!entry) {
      const fresh: AnimalEntry = {
        animal,
        position: new T.Vector3(),
        facing: 0,
        roll: 0,
        phase: 0,
        moving: true,
        stride: 0,
        dying: 0,
        visible: alive(animal, this.worldTime),
        drawn: false,
      };
      fresh.position.copy(this.animalPosition(fresh, this.worldTime));
      this.animals.set(animal.id, fresh);
      this.writeAnimal(animal.id, fresh);
      return;
    }
    entry.animal = animal;
    const living = alive(animal, this.worldTime);
    if (!living && entry.visible && entry.dying === 0) entry.dying = .01;
    if (living && !entry.visible) {
      entry.visible = true;
      entry.roll = 0;
      entry.dying = 0;
    }
  }

  private placeAnimal(entry: AnimalEntry, delta: number): void {
    const ahead = this.animalPosition(entry, this.worldTime + ANIMAL_FACING_LOOK);
    entry.position.copy(this.animalPosition(entry, this.worldTime));
    const towards = Math.atan2(ahead.x - entry.position.x, ahead.z - entry.position.z);
    entry.stride = animalStride(this.map, this.wildlifeObstacles, entry.animal, this.worldTime);
    entry.moving = ahead.distanceToSquared(entry.position) > 1e-6;
    if (entry.moving) entry.facing = turnToward(entry.facing, towards, delta);
  }

  private withinSight(entry: AnimalEntry): boolean {
    if (!this.focus) return true;
    const reach = this.sight * (entry.drawn ? SIGHT_MARGIN : 1);
    const dx = entry.position.x - this.focus.x;
    const dz = entry.position.z - this.focus.z;
    return dx * dx + dz * dz <= reach * reach;
  }

  private writeAnimal(id: number, entry: AnimalEntry): boolean {
    const sighted = this.withinSight(entry);
    if (!sighted) {
      if (!entry.drawn) return false;
      this.wildlife.remove(id);
      entry.drawn = false;
      return true;
    }
    if (!entry.drawn) {
      this.wildlife.add(id, entry.animal.kind);
      entry.drawn = true;
    }
    if (!entry.visible) {
      this.wildlife.conceal(id);
      return true;
    }
    this.wildlife.pose(id, entry.animal.kind, { position: entry.position, facing: entry.facing, roll: entry.roll, phase: entry.phase, moving: entry.moving, stride: entry.stride });
    return true;
  }

  watch(focus: T.Vector3, span: number): void {
    const sight = Math.max(60, span);
    if (this.focus && this.sight === sight && this.focus.distanceToSquared(focus) < 1) return;
    this.focus = focus.clone();
    this.sight = sight;
    this.scenery.reveal(this.focus, span * REVEAL_SHARE);
    let changed = false;
    for (const [id, entry] of this.animals) {
      const drawn = entry.drawn;
      if (this.writeAnimal(id, entry) !== drawn) changed = true;
    }
    if (changed) this.stage.invalidate();
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
    if (gatherer) model.add(kind === 'hunter' ? spear() : axe());
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

  private syncWalker(walker: Walker, stairs: ReadonlyMap<number, Stair>): void {
    const load: Resource | null = walker.cargo > 0 ? walker.food : null;
    const key = `${walker.kind}:${load ?? ''}`;
    let entry = this.walkers.get(walker.id);
    if (entry && entry.key !== key) {
      const replacement = this.walkerModel(walker.kind, load);
      replacement.userData.walkerId = walker.id;
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
      model.userData.walkerId = walker.id;
      this.stage.scene.add(model);
      entry = { key, kind: walker.kind, model, path: walker.path, departedAt: walker.departedAt, quarry: walker.quarry, task: walker.task, strikes: 0, moving: false, working: false, waitingSince: walker.departedAt, spell: -1, mood: 'breathe', aim: 0, heading: 0, stepped: false, stairs };
      this.walkers.set(walker.id, entry);
    }
    entry.path = walker.path;
    entry.departedAt = walker.departedAt;
    entry.quarry = walker.quarry;
    entry.stairs = stairs;
    if (entry.task?.since !== walker.task?.since) entry.strikes = 0;
    entry.task = walker.task;
    this.placeWalker(entry);
    if (fresh) {
      entry.model.rotation.y = entry.heading;
      this.groundCompanions(entry);
    }
  }

  private placeWalker(entry: WalkerEntry): void {
    const last = entry.path.length - 1;
    const travelled = Math.min(Math.max(WALKER_SPEED * (this.worldTime - entry.departedAt), 0), last);
    const index = Math.min(Math.floor(travelled), Math.max(0, last - 1));
    const fraction = travelled - index;
    const current = tileAtOn(this.map, entry.path[index]);
    const next = tileAtOn(this.map, entry.path[Math.min(index + 1, last)]);
    const a = worldPositionOn(this.map, current.x + .5, current.z + .5);
    const b = worldPositionOn(this.map, next.x + .5, next.z + .5);
    entry.stepped = entry.stairs.has(tileIndexOn(this.map, current.x, current.z)) || entry.stairs.has(tileIndexOn(this.map, next.x, next.z));
    let y = rampHeight(groundHeight(this.map, current.x, current.z), groundHeight(this.map, next.x, next.z), fraction);
    if (entry.stepped) y = roadHeight(this.map, entry.stairs, T.MathUtils.lerp(current.x, next.x, fraction) + .5, T.MathUtils.lerp(current.z, next.z, fraction) + .5);
    entry.model.position.set(T.MathUtils.lerp(a.x, b.x, fraction), y + .08, T.MathUtils.lerp(a.z, b.z, fraction));
    entry.working = entry.task !== null && this.worldTime >= entry.task.since && this.worldTime < entry.task.until;
    entry.moving = !entry.working && travelled < last;
    if (entry.moving || entry.working) entry.waitingSince = this.worldTime;
    const goal = entry.working && entry.quarry !== null ? this.quarryPoint(entry) : null;
    if (goal) {
      const felling = entry.kind === 'woodcutter';
      if (entry.task) this.stepUpTo(entry, entry.task, goal, felling ? CHOP_REACH : HUNT_REACH);
      const towards = Math.atan2(goal.x - entry.model.position.x, goal.z - entry.model.position.z);
      entry.heading = felling ? towards - CHOP_SET : towards;
    } else if (a.x !== b.x || a.z !== b.z) entry.heading = Math.atan2(b.x - a.x, b.z - a.z);
  }

  private treeFoot(tile: number): { x: number; z: number } {
    const { x, z } = tileAtOn(this.map, tile);
    return this.scenery.decorFoot(tile) ?? worldPositionOn(this.map, x + .5, z + .5);
  }

  private quarryPoint(entry: WalkerEntry): { x: number; z: number } | null {
    if (entry.quarry === null) return null;
    if (entry.kind === 'hunter') return this.animals.get(entry.quarry)?.position ?? null;
    if (entry.kind !== 'woodcutter') return null;
    return this.treeFoot(entry.quarry);
  }

  private stepUpTo(entry: WalkerEntry, task: WalkerTask, quarry: { x: number; z: number }, reach: number): void {
    const closeness = Math.min(1, (this.worldTime - task.since) / WORK_APPROACH, Math.max(0, (task.until - this.worldTime) / WORK_WITHDRAW));
    const position = entry.model.position;
    const gap = Math.hypot(quarry.x - position.x, quarry.z - position.z);
    if (closeness <= 0 || gap <= reach) return;
    const step = (gap - reach) / gap * closeness;
    position.x += (quarry.x - position.x) * step;
    position.z += (quarry.z - position.z) * step;
  }

  private idling(id: number, walker: WalkerEntry): void {
    const waited = this.worldTime - walker.waitingSince;
    if (waited < IDLE_SETTLE) {
      walker.spell = -1;
      walker.mood = 'breathe';
      walker.aim = walker.heading;
      return;
    }
    const spell = Math.floor((waited - IDLE_SETTLE) / IDLE_SPELL);
    if (spell === walker.spell) return;
    walker.spell = spell;
    const humour = scatterOf(id, spell);
    walker.mood = humour < .18 ? 'stretch' : humour < .5 ? 'shift' : 'breathe';
    const neighbour = scatterOf(id, spell + .5) < .45 ? this.neighbourOf(id, walker) : null;
    if (neighbour) {
      walker.aim = Math.atan2(neighbour.x - walker.model.position.x, neighbour.z - walker.model.position.z);
      return;
    }
    walker.aim = walker.heading + (scatterOf(id, spell + .25) - .5) * IDLE_SWEEP;
  }

  private chopping(walker: WalkerEntry, spent: number): void {
    const strikes = chopStrikes(spent);
    if (strikes <= walker.strikes) return;
    walker.strikes = strikes;
    if (walker.quarry === null) return;
    const tile = tileAtOn(this.map, walker.quarry);
    const trunk = this.treeFoot(walker.quarry);
    if (this.motion) this.dust.puff(new T.Vector3(trunk.x, groundHeight(this.map, tile.x, tile.z) + .12, trunk.z), .55, .55, .34);
    this.scenery.struck(walker.quarry, walker.model.position);
  }

  private neighbourOf(id: number, walker: WalkerEntry): T.Vector3 | null {
    let nearest: T.Vector3 | null = null;
    let closest = NEIGHBOUR_REACH * NEIGHBOUR_REACH;
    for (const [other, entry] of this.walkers) {
      if (other === id || entry.moving || entry.working) continue;
      const gap = entry.model.position.distanceToSquared(walker.model.position);
      if (gap >= closest || gap < 1e-6) continue;
      closest = gap;
      nearest = entry.model.position;
    }
    return nearest;
  }

  private groundCompanions(walker: WalkerEntry): void {
    for (const companion of walker.model.children.slice(5)) {
      if (companion.children.length < 5) continue;
      if (!walker.stepped) {
        companion.position.y = 0;
        continue;
      }
      const point = companion.getWorldPosition(new T.Vector3());
      const height = roadHeight(this.map, walker.stairs, point.x / CELL_SIZE + this.map.width / 2, point.z / CELL_SIZE + this.map.depth / 2);
      companion.position.y = (height + .08 - walker.model.position.y) / walker.model.scale.y;
    }
  }

  animate(time: number, delta: number, speed: number): void {
    this.scenery.update(time, this.focus);
    const turning = Math.max(0, this.worldTime - this.turnedAt) * Math.max(1, speed);
    this.turnedAt = this.worldTime;
    for (const [id, walker] of this.walkers) {
      this.placeWalker(walker);
      const idle = !walker.moving && !walker.working;
      if (idle) this.idling(id, walker);
      walker.model.rotation.y = turnToward(walker.model.rotation.y, idle ? walker.aim : walker.heading, turning);
      const stride = walker.moving ? .55 : 0;
      const phase = this.worldTime * 9 * Math.max(1, speed) + id;
      if (walker.working && walker.task) {
        const spent = (this.worldTime - walker.task.since) * Math.max(1, speed);
        animateWork(walker.model, spent, walker.task.kind === 'hunt' ? 'thrust' : 'chop');
        if (walker.task.kind === 'chop') this.chopping(walker, spent);
      } else if (walker.moving) animateFigure(walker.model, phase, stride);
      else animateIdle(walker.model, (this.worldTime - walker.waitingSince) * Math.max(1, speed) + id, walker.mood);
      for (const companion of walker.model.children.slice(5)) {
        if (companion.children.length >= 5) animateFigure(companion, phase + 1.3, stride);
      }
      this.groundCompanions(walker);
    }
    for (const [id, animal] of this.animals) {
      this.placeAnimal(animal, turning);

      if (animal.dying > 0) {
        animal.dying += delta * speed;
        const t = Math.min(1, animal.dying / .9);
        animal.roll = t * Math.PI / 2;
        animal.position.y += Math.sin(t * Math.PI) * .12;
        animal.moving = false;
        if (t >= 1) {
          animal.visible = false;
          animal.dying = 0;
        }
        this.writeAnimal(id, animal);
        continue;
      }
      animal.phase = this.worldTime * Math.max(1, speed) + id;
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

  moverPoint(id: number): T.Vector3 | null {
    return this.moverPosition(id);
  }

  private moverPosition(id: number | null): T.Vector3 | null {
    if (id === null) return null;
    const walker = this.walkers.get(id);
    if (walker) return walker.model.position;
    return this.animals.get(id)?.position ?? null;
  }

  hover(clientX: number, clientY: number, world: World): boolean {
    const picked = this.pick(clientX, clientY);
    const building = findBuilding(world, picked.building);
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

  showPreview(tool: BuildTool | 'harbour' | 'demolish', x: number, z: number, rotation: Rotation, placement: Placement, homeRoads: readonly number[] = [], reach: readonly number[] = []): void {
    this.preview.clear();
    this.setReach(reach);
    const tiles = new Set(placement.tiles.filter((index) => index >= 0 && index < this.map.width * this.map.depth));
    let stairs = this.stairs;
    if (tool === 'road') {
      stairs = stairLayout(this.map, new Set([...homeRoads, ...tiles]));
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
    this.setReach([]);
    this.stage.invalidate();
  }

  private setReach(reach: readonly number[]): void {
    if (this.reachMark) {
      this.reachMark.removeFromParent();
      this.reachMark.geometry.dispose();
      this.reachMark = null;
    }
    if (reach.length === 0) return;
    this.reachMark = reachOutline(this.map, reach);
    if (this.reachMark) this.preview.add(this.reachMark);
  }

  private followSelection(): void {
    if (this.selectedWalker === null) return;
    const position = this.moverPosition(this.selectedWalker);
    if (!position) return;
    this.selection.position.set(position.x, position.y - .015, position.z);
  }

  tileAtPointer(clientX: number, clientY: number): Tile | null {
    const ray = this.stage.pointerRay(clientX, clientY);
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
    let nearestLevel: Tile | null = null;
    let nearestGap = Infinity;
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
      const gap = Math.abs(groundHeight(this.map, tile.x, tile.z) - y);
      if (gap < 1e-6) {
        groundTile = tile;
        groundDistance = ray.ray.origin.distanceTo(point);
        break;
      }
      if (gap < nearestGap) {
        nearestGap = gap;
        nearestLevel = tile;
      }
    }
    if (stairTile && hit.distance < groundDistance) return stairTile;
    return groundTile ?? nearestLevel;
  }

  pick(clientX: number, clientY: number): { building: number | null; walker: number | null; animal: number | null } {
    const ray = this.stage.pointerRay(clientX, clientY);
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
    const ray = this.stage.pointerRay(clientX, clientY);
    return ray.intersectObjects(this.stage.scene.children, true).filter((hit) => hit.object instanceof T.Mesh).slice(0, 4).map((hit) => { const material = (hit.object as T.Mesh).material as T.MeshStandardMaterial; return { color: material.color.getHexString(), y: hit.point.y, name: `${material.type} t=${material.transparent} o=${material.opacity} side=${material.side} vis=${hit.object.visible} normals=${!!(hit.object as T.Mesh).geometry.getAttribute('normal')} n=${Array.from((hit.object as T.Mesh).geometry.getAttribute('normal').array.slice(0, 3)).map((v) => v.toFixed(2))}` }; });
  }
}

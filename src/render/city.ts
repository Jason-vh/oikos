import * as T from 'three';
import { animateFigure, animateHauling, animateIdle, animateWork, axe, bake, box, bundle, bundleKey, chopStrikes, CHOP_SET, colors, disposeModel, figure, getBuildingAssembly, getBuildingModel, post, spear, workPeriod, type Idle, type ModelStage } from '../art';
import { footprint } from '../sim/catalog';
import { AGORA_SLOTS, GRANARY_SLOTS, walkerSpeed } from '../sim/balance';
import { CELL_SIZE, GROUND_Y, LEVEL_HEIGHT, groundHeight, insideMapOn, tileAtOn, tileIndexOn, worldPositionOn, type IslandMap } from '../sim/island';
import { buildRoads } from '../art/roads';
import { alive, animalAt, animalStride, SPECIES, wildlifeObstacles } from '../sim/wildlife';
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
import { CloudLayer } from './clouds';
import { worldSpan } from './extent';
import { glowStrength, GLOW_SWELL, ModelGlow } from './emphasis';

export const gait = { stepsPerTile: 5.5, swing: .55 };

export type HoverTarget = { kind: 'building' | 'walker' | 'animal'; id: number };

function sameTarget(one: HoverTarget | null, other: HoverTarget | null): boolean {
  if (!one || !other) return one === other;
  return one.kind === other.kind && one.id === other.id;
}

function selectionTarget(building: Building | null, walkerId: number | null): HoverTarget | null {
  if (walkerId !== null) return { kind: 'walker', id: walkerId };
  if (building) return { kind: 'building', id: building.id };
  return null;
}

interface BuildingEntry { key: string; tier: number; model: T.Group; intro: number; from: number; construction: BuildingConstruction | null; }
interface Departure { model: T.Group; elapsed: number; }
interface WalkerExit { model: T.Group; elapsed: number; scale: number; }
interface WalkerEntry { id: number; intro: number; key: string; kind: WalkerKind; model: T.Group; cart: T.Object3D | null; cartBed: T.Object3D | null; wheels: T.Object3D[]; path: number[]; departedAt: number; quarry: number | null; task: WalkerTask | null; strikes: number; moving: boolean; working: boolean; waitingSince: number; spell: number; mood: Idle; aim: number; heading: number; turn: number; pace: number; travelled: number; cadence: number; bounce: number; side: number; stepped: boolean; stairs: ReadonlyMap<number, Stair>; }
interface AnimalEntry { animal: Animal; home: T.Vector3; roam: number; position: T.Vector3; facing: number; roll: number; phase: number; moving: boolean; stride: number; dying: number; visible: boolean; drawn: boolean; }

const SIGHT_MARGIN = 1.3;
const WILDLIFE_SIGHT = 220;
const SMOOTH_HERD = 500;
const ANIMAL_PICK_SPAN = 120;
const ANIMAL_FACING_LOOK = .35;
const GLOW_FADE_SECONDS = .16;
const WALKER_SCALE = .83;
const WALKER_INTRO = .28;
const WALKER_PUFF = .42;
const WALKER_PUFF_RISE = .26;
const WALKER_INTRO_FROM = .35;
const WALKER_EXIT = .22;
const IDLE_SETTLE = 1.2;
const IDLE_SPELL = 3.4;
const IDLE_SWEEP = 1.8;
const NEIGHBOUR_REACH = 3.2;
const CHOP_REACH = .9;
const HUNT_REACH = .95;
const WORK_APPROACH = .5;
const WORK_SCATTER = 5.7;
const WORK_WITHDRAW = .4;

function scatterOf(id: number, spell: number): number {
  const drawn = Math.sin(id * 12.9898 + spell * 78.233) * 43758.5453;
  return drawn - Math.floor(drawn);
}
const REVEAL_SHARE = .9;

const TURN_RATE = 14;
const CORNER_REACH = .45;
const STRIDE_RAMP = .5;
const TURN_GAIN = 1.5;
const TURN_LIMIT = .16;
const CART_TRAIL = 1.4;
const CART_ROCK = .035;
const AXLE = { y: .24, z: -.78 };
const WHEEL_RADIUS = .19;
const WHEEL_SPIN = CELL_SIZE / WHEEL_RADIUS;
const GRIP = { x: .21, y: .076, z: .7 };
const CADENCE_SPREAD = .24;
const BOUNCE_SPREAD = .45;
const CADENCE_SEED = 3.1;
const LANE_SEED = 5.3;
const LANE_WIDTH = .2;
const LANE_RAMP = .8;
const PASSING_REACH = 1.1;
const PASSING_ROOM = .34;
const PASSING_LIMIT = .42;
const SETTLE_RAMP = .7;
const SETTLE_EASE = .55;
const CORNER_SLOW = .22;

const BOUNCE_SEED = 7.7;
const INTRO_SECONDS = .45;
const EXIT_SECONDS = .3;


function arrivalScale(intro: number): number {
  if (intro >= WALKER_INTRO) return 1;
  return WALKER_INTRO_FROM + (1 - WALKER_INTRO_FROM) * backOut(intro / WALKER_INTRO);
}

function backOut(t: number): number {
  const overshoot = 1.6;
  const shifted = t - 1;
  return 1 + shifted * shifted * ((overshoot + 1) * shifted + overshoot);
}

function wheelsOf(model: T.Object3D): T.Object3D[] {
  return model.getObjectByName('cart')?.children.filter((part) => part.name === 'wheel') ?? [];
}

function headingOf(step: T.Vector3): number | null {
  if (step.x * step.x + step.z * step.z < 1e-8) return null;
  return Math.atan2(step.x, step.z);
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
  private readonly cornerBack = new T.Vector3();
  private readonly cornerMid = new T.Vector3();
  private readonly cornerAhead = new T.Vector3();
  private readonly sampleStep = new T.Vector3();
  private readonly curveTangent = new T.Vector3();
  private readonly lane = new T.Vector3();
  private readonly edgeIn = new T.Vector3();
  private readonly edgeOut = new T.Vector3();
  private curveTurn = 0;
  private readonly animals = new Map<number, AnimalEntry>();
  private readonly drawnAnimals = new Set<number>();
  private readonly wildlife: WildlifeField;
  private readonly departures: Departure[] = [];
  private readonly walkerExits: WalkerExit[] = [];
  private readonly dust: DustField;
  private readonly roads = new T.Group();
  private readonly hoverGlow = new ModelGlow('hover');
  private readonly selectGlow = new ModelGlow('select');
  private hovered: HoverTarget | null = null;
  private emphasised: HoverTarget | null = null;
  private emphasisLevel = 0;
  private primed = false;
  private readonly preview = new T.Group();
  private roadKey = '';
  private stairs = new Map<number, Stair>();
  private stairsByCity = new Map<number, ReadonlyMap<number, Stair>>();
  private stairMeshes: T.Object3D[] = [];
  private previewKey = '';
  private ghost: T.Group | null = null;
  private reachMark: T.Mesh | null = null;
  private selected: HoverTarget | null = null;
  private focus: T.Vector3 | null = null;
  private sight = 60;
  private span = 60;
  private planting = false;
  private lastWorld: World | null = null;
  private syncedWildlife: readonly Animal[] | null = null;
  private wildlifeObstacles: ReadonlySet<number> = new Set();
  private worldTime = 0;
  private turnedAt = 0;
  private walkedAt = 0;
  private readonly logistics: LogisticsOverlay;
  private readonly clouds: CloudLayer;
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
    this.logistics = new LogisticsOverlay(stage.scene, map, (id) => this.buildingTop(id));
    const span = worldSpan(map);
    this.clouds = new CloudLayer(stage.scene, span, map.seed);
    stage.world(span);
    stage.scene.add(this.roads, this.preview);
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
    for (const exit of this.walkerExits) exit.model.removeFromParent();
    this.walkerExits.length = 0;
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
    const settled = this.primed;
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
      this.walkers.delete(id);
      if (!this.motion || !settled) {
        entry.model.removeFromParent();
        continue;
      }
      this.walkerExits.push({ model: entry.model, elapsed: 0, scale: entry.model.scale.x });
    }
    for (const city of world.cities) {
      const stairs = this.stairsByCity.get(city.id) ?? new Map<number, Stair>();
      for (const walker of city.walkers) this.syncWalker(walker, stairs, settled);
    }
    this.wildlifeObstacles = wildlifeObstacles(world);
    if (world.wildlife !== this.syncedWildlife) {
      this.syncedWildlife = world.wildlife;
      const animalIds = new Set(world.wildlife.map((animal) => animal.id));
      for (const id of [...this.animals.keys()]) {
        if (animalIds.has(id)) continue;
        this.wildlife.remove(id);
        this.drawnAnimals.delete(id);
        this.animals.delete(id);
      }
      for (const animal of world.wildlife) this.syncAnimal(animal);
    }
    this.applyGlow();
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
      const home = worldPositionOn(this.map, animal.homeX, animal.homeZ);
      const fresh: AnimalEntry = {
        animal,
        home: new T.Vector3(home.x, 0, home.z),
        roam: SPECIES[animal.kind].range * CELL_SIZE,
        position: new T.Vector3(home.x, 0, home.z),
        facing: 0,
        roll: 0,
        phase: 0,
        moving: true,
        stride: 0,
        dying: 0,
        visible: alive(animal, this.worldTime),
        drawn: false,
      };
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
    const reach = this.sight * (entry.drawn ? SIGHT_MARGIN : 1) + entry.roam;
    const dx = entry.home.x - this.focus.x;
    const dz = entry.home.z - this.focus.z;
    return dx * dx + dz * dz <= reach * reach;
  }

  private showAnimal(id: number, entry: AnimalEntry): boolean {
    if (!this.withinSight(entry)) {
      if (!entry.drawn) return false;
      this.wildlife.remove(id);
      this.drawnAnimals.delete(id);
      entry.drawn = false;
      return true;
    }
    if (entry.drawn) return false;
    this.placeAnimal(entry, 0);
    this.wildlife.add(id, entry.animal.kind);
    this.drawnAnimals.add(id);
    entry.drawn = true;
    this.poseAnimal(id, entry);
    return true;
  }

  private poseAnimal(id: number, entry: AnimalEntry): void {
    if (!entry.drawn) return;
    if (!entry.visible) {
      this.wildlife.conceal(id);
      return;
    }
    const level = this.emphasisOf('animal', id);
    this.wildlife.pose(id, entry.animal.kind, { position: entry.position, facing: entry.facing, roll: entry.roll, phase: entry.phase, moving: entry.moving, stride: entry.stride, swell: 1 + GLOW_SWELL * level });
  }

  private writeAnimal(id: number, entry: AnimalEntry): boolean {
    const changed = this.showAnimal(id, entry);
    this.poseAnimal(id, entry);
    return changed;
  }

  get growing(): boolean {
    return this.planting;
  }

  watch(focus: T.Vector3, span: number): void {
    this.span = span;
    this.scenery.detail(span);
    if (this.clouds.fade(span)) this.stage.invalidate();
    const sight = Math.min(Math.max(60, span), WILDLIFE_SIGHT);
    const settled = this.focus && this.sight === sight && this.focus.distanceToSquared(focus) < 1;
    if (settled && !this.planting) return;
    this.focus = focus.clone();
    this.sight = sight;
    this.planting = this.scenery.reveal(this.focus, span * REVEAL_SHARE);
    if (this.planting) this.stage.invalidate();
    let changed = false;
    for (const [id, entry] of this.animals) {
      if (this.showAnimal(id, entry)) changed = true;
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
      cart.name = 'cart';
      const wheels = [-1, 1].map((side) => {
        const wheel = new T.Group();
        wheel.name = 'wheel';
        wheel.position.set(side * .36, AXLE.y, AXLE.z);
        post(wheel, colors.dark, 0, 0, 0, WHEEL_RADIUS, .09).rotation.z = Math.PI / 2;
        bake(wheel);
        return wheel;
      });
      const bed = new T.Group();
      bed.name = 'bed';
      bed.position.set(0, AXLE.y, AXLE.z);
      box(bed, colors.wood, 0, .16, 0, .62, .38, .68);
      for (const side of [-1, 1]) {
        box(bed, colors.wood, side * GRIP.x, GRIP.y, (GRIP.z + .34) / 2, .07, .07, GRIP.z - .34, .02);
        box(bed, colors.dark, side * GRIP.x, GRIP.y, GRIP.z, .105, .1, .1, .03);
      }
      if (load) {
        const heap = new T.Group();
        heap.position.set(0, .24, 0);
        heap.scale.setScalar(.8);
        bundle(heap, load, 0, 0, 0, 1);
        bed.add(heap);
      }
      bake(bed);
      cart.add(...wheels, bed);
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
    model.scale.setScalar(WALKER_SCALE);
    this.walkerTemplates.set(key, model);
    return model.clone();
  }

  private syncWalker(walker: Walker, stairs: ReadonlyMap<number, Stair>, settled: boolean): void {
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
      entry.cart = replacement.getObjectByName('cart') ?? null;
      entry.cartBed = replacement.getObjectByName('bed') ?? null;
      entry.wheels = wheelsOf(replacement);
      entry.key = key;
      this.stage.scene.add(replacement);
    }
    const fresh = !entry;
    if (!entry) {
      const model = this.walkerModel(walker.kind, load);
      model.userData.walkerId = walker.id;
      this.stage.scene.add(model);
      entry = { id: walker.id, intro: this.motion && settled ? 0 : WALKER_INTRO, key, kind: walker.kind, model, cart: model.getObjectByName('cart') ?? null, cartBed: model.getObjectByName('bed') ?? null, wheels: wheelsOf(model), path: walker.path, departedAt: walker.departedAt, quarry: walker.quarry, task: walker.task, strikes: 0, moving: false, working: false, waitingSince: walker.departedAt, spell: -1, mood: 'breathe', aim: 0, heading: 0, turn: 0, pace: 0, travelled: 0, side: scatterOf(walker.id, LANE_SEED) * 2 - 1, cadence: 1 + (scatterOf(walker.id, CADENCE_SEED) - .5) * CADENCE_SPREAD, bounce: 1 + (scatterOf(walker.id, BOUNCE_SEED) - .5) * BOUNCE_SPREAD, stepped: false, stairs };
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
      this.swellWalker(entry);
      if (entry.intro === 0) this.dust.puff(entry.model.position.clone(), WALKER_PUFF, WALKER_PUFF, WALKER_PUFF_RISE);
    }
  }

  private pathSample(entry: WalkerEntry, travelled: number, out: T.Vector3): boolean {
    const last = entry.path.length - 1;
    const clamped = Math.min(Math.max(travelled, 0), last);
    const index = Math.min(Math.floor(clamped), Math.max(0, last - 1));
    const fraction = clamped - index;
    const current = tileAtOn(this.map, entry.path[index]);
    const next = tileAtOn(this.map, entry.path[Math.min(index + 1, last)]);
    const a = worldPositionOn(this.map, current.x + .5, current.z + .5);
    const b = worldPositionOn(this.map, next.x + .5, next.z + .5);
    const stepped = entry.stairs.has(tileIndexOn(this.map, current.x, current.z)) || entry.stairs.has(tileIndexOn(this.map, next.x, next.z));
    let y = rampHeight(groundHeight(this.map, current.x, current.z), groundHeight(this.map, next.x, next.z), fraction);
    if (stepped) y = roadHeight(this.map, entry.stairs, T.MathUtils.lerp(current.x, next.x, fraction) + .5, T.MathUtils.lerp(current.z, next.z, fraction) + .5);
    out.set(T.MathUtils.lerp(a.x, b.x, fraction), y + .08, T.MathUtils.lerp(a.z, b.z, fraction));
    this.sampleStep.set(b.x - a.x, 0, b.z - a.z);
    return stepped;
  }

  private roundedPoint(entry: WalkerEntry, travelled: number, out: T.Vector3): boolean {
    const corner = Math.round(travelled);
    const offset = travelled - corner;
    this.curveTurn = 0;
    if (corner <= 0 || corner >= entry.path.length - 1 || Math.abs(offset) >= CORNER_REACH) {
      const straight = this.pathSample(entry, travelled, out);
      this.curveTangent.copy(this.sampleStep);
      return straight;
    }
    this.pathSample(entry, corner - CORNER_REACH, this.cornerBack);
    const stepped = this.pathSample(entry, corner, this.cornerMid);
    this.pathSample(entry, corner + CORNER_REACH, this.cornerAhead);
    const t = (offset + CORNER_REACH) / (2 * CORNER_REACH);
    const u = 1 - t;
    out.copy(this.cornerBack).multiplyScalar(u * u).addScaledVector(this.cornerMid, 2 * u * t).addScaledVector(this.cornerAhead, t * t);
    if (stepped) out.y = roadHeight(this.map, entry.stairs, out.x / CELL_SIZE + this.map.width / 2, out.z / CELL_SIZE + this.map.depth / 2) + .08;
    this.edgeIn.subVectors(this.cornerMid, this.cornerBack).setY(0);
    this.edgeOut.subVectors(this.cornerAhead, this.cornerMid).setY(0);
    this.curveTangent.copy(this.edgeIn).multiplyScalar(u).addScaledVector(this.edgeOut, t);
    const inbound = headingOf(this.edgeIn);
    const outbound = headingOf(this.edgeOut);
    if (inbound !== null && outbound !== null) {
      const turned = Math.atan2(Math.sin(outbound - inbound), Math.cos(outbound - inbound));
      this.curveTurn = turned * (1 - Math.abs(offset) / CORNER_REACH);
    }
    return stepped;
  }

  private turnsAt(entry: WalkerEntry, corner: number): boolean {
    const back = tileAtOn(this.map, entry.path[corner - 1]);
    const here = tileAtOn(this.map, entry.path[corner]);
    const ahead = tileAtOn(this.map, entry.path[corner + 1]);
    return here.x - back.x !== ahead.x - here.x || here.z - back.z !== ahead.z - here.z;
  }

  private easedTravel(entry: WalkerEntry, covered: number, last: number): number {
    const fromStart = covered / SETTLE_RAMP;
    const toEnd = (last - covered) / SETTLE_RAMP;
    let paced = covered;
    if (fromStart < 1) paced -= SETTLE_RAMP * SETTLE_EASE * fromStart * (1 - fromStart) * (1 - fromStart);
    if (toEnd < 1) paced += SETTLE_RAMP * SETTLE_EASE * toEnd * (1 - toEnd) * (1 - toEnd);
    const corner = Math.round(paced);
    if (corner <= 0 || corner >= last) return paced;
    const u = (paced - corner) / CORNER_REACH;
    if (Math.abs(u) >= 1 || !this.turnsAt(entry, corner)) return paced;
    const bump = 1 - u * u;
    return corner + CORNER_REACH * (u - CORNER_SLOW * u * bump * bump);
  }

  private placeWalker(entry: WalkerEntry): void {
    const last = entry.path.length - 1;
    const covered = Math.min(Math.max(walkerSpeed(entry.kind) * (this.worldTime - entry.departedAt), 0), last);
    const travelled = this.easedTravel(entry, covered, last);
    entry.travelled = travelled;
    entry.stepped = this.roundedPoint(entry, travelled, entry.model.position);
    entry.pace = Math.min(1, travelled / STRIDE_RAMP, (last - travelled) / STRIDE_RAMP);
    entry.working = entry.task !== null && this.worldTime >= entry.task.since && this.worldTime < entry.task.until;
    entry.moving = !entry.working && travelled < last;
    if (entry.moving || entry.working) entry.waitingSince = this.worldTime;
    const goal = entry.working && entry.quarry !== null ? this.quarryPoint(entry) : null;
    if (goal) {
      const felling = entry.kind === 'woodcutter';
      if (entry.task) this.stepUpTo(entry, entry.task, goal, felling ? CHOP_REACH : HUNT_REACH);
      const towards = Math.atan2(goal.x - entry.model.position.x, goal.z - entry.model.position.z);
      entry.heading = felling ? towards - CHOP_SET : towards;
      entry.turn = 0;
      return;
    }
    const heading = headingOf(this.curveTangent);
    if (heading !== null) entry.heading = heading;
    entry.turn = T.MathUtils.clamp(this.curveTurn * TURN_GAIN, -TURN_LIMIT, TURN_LIMIT) * entry.pace;
    this.keepLane(entry, travelled, last);
  }

  private keepLane(entry: WalkerEntry, travelled: number, last: number): void {
    if (entry.stepped) return;
    const taper = Math.min(1, travelled / LANE_RAMP, (last - travelled) / LANE_RAMP);
    if (taper <= 0) return;
    this.lane.set(Math.cos(entry.heading), 0, -Math.sin(entry.heading));
    const aside = entry.side * LANE_WIDTH + this.roomFor(entry);
    entry.model.position.addScaledVector(this.lane, aside * taper);
  }

  private roomFor(entry: WalkerEntry): number {
    let aside = 0;
    for (const other of this.walkers.values()) {
      if (other === entry) continue;
      const gap = other.model.position.distanceTo(entry.model.position);
      if (gap >= PASSING_REACH) continue;
      const crowding = 1 - gap / PASSING_REACH;
      const oncoming = Math.cos(other.heading - entry.heading) < 0;
      const yields = entry.side > other.side || (entry.side === other.side && entry.id > other.id);
      aside += (yields ? 1 : -1) * crowding * crowding * PASSING_ROOM * (oncoming ? 1 : .6);
    }
    return T.MathUtils.clamp(aside, -PASSING_LIMIT, PASSING_LIMIT);
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

  private chopping(walker: WalkerEntry, spent: number, drift: number): void {
    const strikes = chopStrikes(spent) - chopStrikes(drift);
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

  stepMovers(): boolean {
    const turning = Math.max(0, this.worldTime - this.walkedAt);
    this.walkedAt = this.worldTime;
    this.stepAnimals(turning);
    for (const [id, walker] of this.walkers) {
      this.placeWalker(walker);
      const idle = !walker.moving && !walker.working;
      if (idle) this.idling(id, walker);
      walker.model.rotation.y = turnToward(walker.model.rotation.y, idle ? walker.aim : walker.heading, turning);
      this.groundCompanions(walker);
      this.swellWalker(walker);
    }
    return this.walkers.size > 0 || this.drawnAnimals.size > 0;
  }

  private stepAnimals(turning: number): void {
    if (this.drawnAnimals.size > SMOOTH_HERD) return;
    for (const id of this.drawnAnimals) {
      const entry = this.animals.get(id);
      if (!entry || !entry.visible || entry.dying > 0) continue;
      this.placeAnimal(entry, turning);
      entry.phase = this.worldTime + id;
      this.poseAnimal(id, entry);
    }
  }

  animate(time: number, delta: number, speed: number): void {
    this.scenery.update(time, this.focus);
    this.clouds.drift(time);
    const turning = Math.max(0, this.worldTime - this.turnedAt) * Math.max(1, speed);
    this.turnedAt = this.worldTime;
    this.stepMovers();
    for (const [id, walker] of this.walkers) {
      const stride = walker.moving ? gait.swing * walker.pace : 0;
      const phase = walker.travelled * gait.stepsPerTile * walker.cadence + id;
      if (walker.working && walker.task) {
        const drift = scatterOf(id, WORK_SCATTER) * workPeriod('chop');
        const spent = (this.worldTime - walker.task.since) * Math.max(1, speed) + drift;
        animateWork(walker.model, spent, walker.task.kind === 'hunt' ? 'thrust' : 'chop');
        if (walker.task.kind === 'chop') this.chopping(walker, spent, drift);
      } else if (walker.moving && walker.cart) animateHauling(walker.model, phase, stride, walker.bounce);
      else if (walker.moving) animateFigure(walker.model, phase, stride, walker.bounce);
      else animateIdle(walker.model, (this.worldTime - walker.waitingSince) * Math.max(1, speed) + id, walker.mood);
      if (walker.cart) walker.cart.rotation.y = -walker.turn * CART_TRAIL;
      if (walker.cartBed) walker.cartBed.rotation.x = -Math.cos(phase * 2) * CART_ROCK * (stride / .55);
      for (const wheel of walker.wheels) wheel.rotation.x = walker.travelled * WHEEL_SPIN;
      for (const companion of walker.model.children.slice(5)) {
        if (companion.children.length >= 5) animateFigure(companion, phase + 1.3, stride, walker.bounce);
      }
    }
    for (const [id, animal] of this.animals) {
      if (!this.withinSight(animal)) {
        this.showAnimal(id, animal);
        continue;
      }
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
    if (this.scenery.animateFalls(delta * speed)) this.stage.shadows();
    if (this.motion) this.logistics.bob(this.worldTime);
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

  setGrid(wanted: boolean): void {
    this.scenery.showGrid(wanted);
    this.stage.invalidate();
  }

  transitions(delta: number): boolean {
    let active = this.scenery.fadeGrid(delta, this.span);
    if (active) this.stage.invalidate();
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
    for (const entry of this.walkers.values()) {
      if (entry.intro >= WALKER_INTRO) continue;
      entry.intro = Math.min(WALKER_INTRO, entry.intro + delta);
      active = true;
    }
    if (this.motion && this.stepMovers()) this.stage.invalidate();
    for (const exit of [...this.walkerExits]) {
      exit.elapsed += delta;
      const t = Math.min(1, exit.elapsed / WALKER_EXIT);
      exit.model.scale.setScalar(exit.scale * (1 - t * t));
      if (t >= 1) {
        exit.model.removeFromParent();
        this.walkerExits.splice(this.walkerExits.indexOf(exit), 1);
      }
      active = true;
    }
    if (this.fadeEmphasis(delta)) {
      this.stage.invalidate();
      active = true;
    }
    if (this.dust.advance(delta)) active = true;
    if (active) this.stage.shadows();
    return active;
  }

  private buildingTop(id: number): number {
    const entry = this.buildings.get(id);
    if (!entry) return 0;
    return new T.Box3().setFromObject(entry.model).max.y;
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

  hover(clientX: number, clientY: number, world: World): HoverTarget | null {
    const picked = this.pick(clientX, clientY);
    if (picked.walker !== null) return { kind: 'walker', id: picked.walker };
    if (picked.animal !== null) return { kind: 'animal', id: picked.animal };
    const building = findBuilding(world, picked.building);
    if (building) return { kind: 'building', id: building.id };
    return null;
  }

  clearHover(): void {
    this.emphasise(null);
  }

  emphasise(target: HoverTarget | null): void {
    if (sameTarget(target, this.hovered)) return;
    this.hovered = target;
    if (target) {
      const released = this.emphasised;
      this.emphasised = target;
      this.emphasisLevel = 0;
      this.applyGlow();
      if (released) this.poseTarget(released);
    }
    this.stage.invalidate();
  }

  private emphasisOf(kind: HoverTarget['kind'], id: number): number {
    if (!this.emphasised || this.emphasised.kind !== kind || this.emphasised.id !== id) return 0;
    return this.emphasisLevel;
  }

  private swellWalker(entry: WalkerEntry): void {
    const walker: HoverTarget = { kind: 'walker', id: entry.id };
    const level = sameTarget(walker, this.selected) ? 1 : this.emphasisOf('walker', entry.id);
    entry.model.scale.setScalar(WALKER_SCALE * (1 + GLOW_SWELL * level) * arrivalScale(entry.intro));
  }

  private modelOf(target: HoverTarget | null): T.Object3D | null {
    if (!target) return null;
    if (target.kind === 'walker') return this.walkers.get(target.id)?.model ?? null;
    if (target.kind === 'building') return this.buildings.get(target.id)?.model ?? null;
    return null;
  }

  private applyGlow(): void {
    const lit = this.emphasised && !sameTarget(this.emphasised, this.selected) ? this.emphasised : null;
    this.hoverGlow.attach(this.modelOf(lit));
    this.wildlife.emphasise(lit?.kind === 'animal' ? lit.id : null);
  }

  private poseTarget(target: HoverTarget): void {
    if (target.kind === 'building') return;
    if (target.kind === 'walker') {
      const entry = this.walkers.get(target.id);
      if (!entry) return;
      this.placeWalker(entry);
      this.groundCompanions(entry);
      this.swellWalker(entry);
      return;
    }
    const entry = this.animals.get(target.id);
    if (entry) this.poseAnimal(target.id, entry);
  }

  private emphasisWanted(): boolean {
    if (!this.hovered || !sameTarget(this.hovered, this.emphasised)) return false;
    if (this.hovered.kind === 'walker') return this.walkers.has(this.hovered.id);
    if (this.hovered.kind === 'building') return this.buildings.has(this.hovered.id);
    return this.animals.get(this.hovered.id)?.visible === true;
  }

  private fadeEmphasis(delta: number): boolean {
    const wanted = this.emphasisWanted() ? 1 : 0;
    const step = delta / GLOW_FADE_SECONDS;
    const previous = this.emphasisLevel;
    const level = wanted > previous ? Math.min(wanted, previous + step) : Math.max(wanted, previous - step);
    if (level === previous) {
      if (level > 0 || !this.emphasised) return false;
      const released = this.emphasised;
      this.emphasised = null;
      this.applyGlow();
      this.poseTarget(released);
      return true;
    }
    this.emphasisLevel = level;
    glowStrength('hover', level);
    this.applyGlow();
    if (this.emphasised) this.poseTarget(this.emphasised);
    return true;
  }

  select(building: Building | null, walkerId: number | null = null): void {
    this.logistics.update(this.lastWorld, building ? building.id : null, walkerId);
    const target = selectionTarget(building, walkerId);
    const changed = !sameTarget(target, this.selected);
    this.selected = target;
    this.applyGlow();
    this.selectGlow.attach(this.modelOf(target));
    const walker = target?.kind === 'walker' ? this.walkers.get(target.id) : undefined;
    if (walker) this.swellWalker(walker);
    if (!changed) return;
    this.stage.shadows();
    this.stage.invalidate();
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
    if (this.span <= ANIMAL_PICK_SPAN) {
      for (const [id, entry] of this.animals) {
        if (!entry.visible) continue;
        centre.copy(entry.position).setY(entry.position.y + .25);
        const distance = ray.ray.distanceToPoint(centre);
        if (distance < .7 && (!nearestAnimal || distance < nearestAnimal.distance)) nearestAnimal = { id, distance };
      }
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
    for (const exit of this.walkerExits) exit.model.removeFromParent();
    this.walkerExits.length = 0;
    this.animals.clear();
    this.drawnAnimals.clear();
    this.wildlife.dispose();
    for (const template of this.walkerTemplates.values()) disposeModel(template);
    this.walkerTemplates.clear();
    for (const departure of this.departures) {
      departure.model.removeFromParent();
      disposeModel(departure.model);
    }
    this.departures.length = 0;
    this.dust.clear();
    this.clouds.dispose();
    disposeModel(this.roads);
    this.roads.removeFromParent();
    this.logistics.dispose();
    this.hoverGlow.detach();
    this.selectGlow.detach();
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

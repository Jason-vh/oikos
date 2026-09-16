import * as T from 'three';
import { box, colors, disposeModel, litterFor, lump, stump, tree, type Litter } from '../art';
import type { Stair } from '../sim/stairs';
import { CELL_SIZE, buildable, groundHeight, levelOn, terrainOn, worldPositionOn, type IslandMap } from '../sim/island';
import { fractal } from '../sim/island';
import { buildTerrain } from './terrain';
import { CoastalFoam } from '../art/foam';
import { cliffOutcrop } from '../art/cliffs';
import { bushForTile } from '../art/bushes';
import { hide, InstanceField, piecesAround, release, write, type InstanceSlot } from './instances';
import type { DustField } from './dust';

function seeded(map: IslandMap, x: number, z: number, salt: number): number {
  return fractal(x * 3.7 + salt, z * 2.9 - salt, map.seed + salt, 1, 1);
}

const DECOR_HEIGHT = 12;
const DECOR_CHUNK = 24;

const SHUDDER_SECONDS = .3;
const SHUDDER_ANGLE = .03;
const FALL_SECONDS = 1.9;
const FALL_NOD = .07;
const FALL_LANDING = .7;
const FALL_BOUNCE = .81;
const FALL_LEAN = Math.PI * .47;

interface DecorPiece { slot: InstanceSlot; local: T.Matrix4; geometry: T.BufferGeometry; }
interface Trunk { x: number; y: number; z: number; scale: number; lie: number; litter: Litter; }
interface DecorEntry {
  pivot: T.Matrix4;
  pieces: DecorPiece[];
  remains: DecorPiece[];
  trunks: Trunk[];
  turn: T.Quaternion;
  drop: number;
  hidden: boolean;
  settled: boolean;
}

function fallLean(t: number): number {
  if (t < FALL_NOD) return -.05 * Math.sin(t / FALL_NOD * Math.PI);
  if (t < FALL_LANDING) return FALL_LEAN * (1 - Math.cos((t - FALL_NOD) / (FALL_LANDING - FALL_NOD) * Math.PI / 2));
  if (t < FALL_BOUNCE) return FALL_LEAN - Math.sin((t - FALL_LANDING) / (FALL_BOUNCE - FALL_LANDING) * Math.PI) * .11;
  return FALL_LEAN;
}

export class IslandScenery {
  readonly root = new T.Group();
  readonly grid = new T.Group();
  readonly foam: CoastalFoam;
  readonly terrain = new T.Group();
  private stairKey = '';
  private stairs: ReadonlyMap<number, Stair> = new Map();
  private readonly waterTime = { value: 0 };
  private readonly fields = new Map<number, InstanceField>();
  private readonly decor = new Map<number, DecorEntry>();
  private readonly falling = new Map<number, number>();
  private readonly shaking = new Map<number, number>();
  private readonly toppleYaw = new Map<number, number>();
  private readonly hinge = new T.Vector3();
  private readonly pose = new T.Matrix4();
  private readonly base = new T.Matrix4();
  private readonly scratch = new T.Matrix4();
  private readonly unrevealed = new Map<number, number[]>();
  private occupied = new Set<number>();
  private felled = new Set<number>();

  constructor(scene: T.Scene, readonly map: IslandMap, private readonly dust: DustField | null = null, private readonly motion = true) {
    this.foam = new CoastalFoam(map);
    this.terrain.add(buildTerrain(map));
    this.root.add(this.terrain, this.foam.mesh);
    const gridPoints: number[] = [];
    for (let z = 0; z < map.depth; z++) {
      for (let x = 0; x < map.width; x++) {
        const terrain = terrainOn(map, x, z);
        if (terrain === 'water') continue;
        const origin = worldPositionOn(map, x, z);
        const y = groundHeight(map, x, z);
        if (buildable(terrain)) {
          gridPoints.push(origin.x, y + .025, origin.z, origin.x + CELL_SIZE, y + .025, origin.z);
          gridPoints.push(origin.x, y + .025, origin.z, origin.x, y + .025, origin.z + CELL_SIZE);
        }
        if (terrain === 'forest' || terrain === 'scrub' || terrain === 'cliff' || terrain === 'rock' || terrain === 'fertile' || (terrain === 'grass' && levelOn(map, x, z) >= 1 && seeded(map, x, z, 18) > .93)) {
          const tile = z * map.width + x;
          const key = this.chunkKey(x, z);
          const waiting = this.unrevealed.get(key);
          if (waiting) waiting.push(tile);
          else this.unrevealed.set(key, [tile]);
        }
      }
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(gridPoints, 3));
    this.grid.add(new T.LineSegments(geometry, new T.LineBasicMaterial({ color: 0xfff1c9, transparent: true, opacity: .34, depthWrite: false })));
    this.grid.visible = false;
    this.root.add(this.grid);
    scene.add(this.root);
    const waterMaterial = new T.MeshStandardMaterial({ color: 0x559fa5, roughness: .48, metalness: .12 });
    waterMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.seaTime = this.waterTime;
      shader.vertexShader = `varying vec3 seaPosition;\n${shader.vertexShader}`.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nseaPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = `uniform float seaTime;\nvarying vec3 seaPosition;\n${shader.fragmentShader}`.replace('#include <color_fragment>', `#include <color_fragment>
        float swell = sin(seaPosition.x * 1.4 + seaPosition.z * .8 + seaTime * .5);
        float crossWave = sin(seaPosition.z * 3.4 - seaPosition.x * .35 + seaTime * .7);
        float ripple = smoothstep(.91, 1.0, swell) * smoothstep(.6, 1.0, crossWave);
        diffuseColor.rgb += ripple * .065 + sin(seaPosition.x * .13 + seaPosition.z * .2) * .018;
      `);
    };
    const water = new T.Mesh(new T.PlaneGeometry(2000, 2000), waterMaterial);
    water.rotation.x = -Math.PI / 2;
    water.position.y = -.08;
    water.receiveShadow = true;
    this.root.add(water);
  }

  setStairs(stairs: ReadonlyMap<number, Stair>): void {
    const key = [...stairs.values()].sort((a, b) => a.tile - b.tile).map((stair) => `${stair.tile}:${stair.down}`).join(',');
    if (key === this.stairKey) return;
    this.stairKey = key;
    this.stairs = stairs;
    this.rebuildTerrain();
  }

  private rebuildTerrain(): void {
    const terrain = buildTerrain(this.map, this.stairs);
    disposeModel(this.terrain);
    this.terrain.clear();
    this.terrain.add(terrain);
  }

  private settle(tile: number, x: number, y: number, z: number, source: T.Group): void {
    const pivot = new T.Matrix4().makeTranslation(x, y, z);
    const field = this.fieldFor(tile);
    for (const piece of piecesAround(source, pivot)) {
      write(field.reserve(piece.geometry, piece.material), this.scratch.multiplyMatrices(pivot, piece.local));
    }
  }

  private reservePieces(tile: number, source: T.Group, pivot: T.Matrix4): DecorPiece[] {
    const field = this.fieldFor(tile);
    return piecesAround(source, pivot).map((piece) => ({
      slot: field.reserve(piece.geometry, piece.material),
      local: piece.local,
      geometry: piece.geometry,
    }));
  }

  private absorb(tile: number, x: number, y: number, z: number, source: T.Group, trunks: Trunk[] = []): void {
    const pivot = new T.Matrix4().makeTranslation(x, y, z);
    const pieces = this.reservePieces(tile, source, pivot);
    this.decor.set(tile, { pivot, pieces, remains: [], trunks, turn: new T.Quaternion(), drop: 0, hidden: false, settled: false });
    this.writeDecor(tile);
  }

  private leaveStump(tile: number, entry: DecorEntry): void {
    if (entry.remains.length > 0 || entry.trunks.length === 0) return;
    const source = new T.Group();
    for (const trunk of entry.trunks) stump(source, trunk.x, trunk.y, trunk.z, trunk.scale, trunk.lie, trunk.litter);
    entry.remains = this.reservePieces(tile, source, entry.pivot);
  }

  private releaseRemains(entry: DecorEntry): void {
    for (const piece of entry.remains) release(piece.slot);
    entry.remains = [];
  }

  private chunkKey(x: number, z: number): number {
    return Math.floor(z / DECOR_CHUNK) * this.map.width + Math.floor(x / DECOR_CHUNK);
  }

  private chunkCentre(key: number): { x: number; z: number } {
    const chunkX = key % this.map.width;
    const chunkZ = Math.floor(key / this.map.width);
    return worldPositionOn(this.map, (chunkX + .5) * DECOR_CHUNK, (chunkZ + .5) * DECOR_CHUNK);
  }

  reveal(focus: { x: number; z: number } | null, radius = 0): void {
    const span = DECOR_CHUNK * CELL_SIZE / 2;
    const reach = radius + span;
    for (const [key, tiles] of [...this.unrevealed]) {
      if (focus) {
        const centre = this.chunkCentre(key);
        if (Math.hypot(centre.x - focus.x, centre.z - focus.z) > reach) continue;
      }
      this.unrevealed.delete(key);
      for (const tile of tiles) this.plant(tile);
    }
    if (!focus) return;
    for (const [key, field] of this.fields) {
      const centre = this.chunkCentre(key);
      field.root.visible = Math.hypot(centre.x - focus.x, centre.z - focus.z) <= reach;
    }
  }

  private plant(tile: number): void {
    const map = this.map;
    const x = tile % map.width;
    const z = Math.floor(tile / map.width);
    const terrain = terrainOn(map, x, z);
    const origin = worldPositionOn(map, x, z);
    const y = groundHeight(map, x, z);
    const cx = origin.x + CELL_SIZE / 2;
    const cz = origin.z + CELL_SIZE / 2;
    const jitterX = (seeded(map, x, z, 1) - .5) * .5;
    const jitterZ = (seeded(map, x, z, 2) - .5) * .5;
    if (terrain === 'forest') {
      const plant = new T.Group();
      const cypress = seeded(map, x, z, 3) > .7;
      const trunks: Trunk[] = [{ x: cx + jitterX, y, z: cz + jitterZ, scale: .62 + seeded(map, x, z, 4) * .3, lie: seeded(map, x, z, 8) * Math.PI * 2, litter: litterFor(seeded(map, x, z, 10)) }];
      if (seeded(map, x, z, 5) > .55) trunks.push({ x: cx - jitterX * 1.4, y, z: cz - jitterZ * 1.2, scale: .5 + seeded(map, x, z, 6) * .2, lie: seeded(map, x, z, 9) * Math.PI * 2, litter: litterFor(seeded(map, x, z, 11), trunks[0].litter !== 'logged') });
      tree(plant, trunks[0].x, y, trunks[0].z, trunks[0].scale, cypress);
      if (trunks[1]) tree(plant, trunks[1].x, y, trunks[1].z, trunks[1].scale, !cypress && seeded(map, x, z, 7) > .6);
      this.absorb(tile, trunks[0].x, y, trunks[0].z, plant, trunks);
    } else if (terrain === 'scrub') {
      const bush = bushForTile(map, x, z);
      if (!bush) return;
      bush.position.set(cx, y, cz);
      this.absorb(tile, cx, y, cz, bush);
    } else if (terrain === 'rock') {
      if (seeded(map, x, z, 13) <= .45) return;
      const rubble = new T.Group();
      lump(rubble, seeded(map, x, z, 14) > .5 ? colors.stone : colors.cream, cx + jitterX, y + .18, cz + jitterZ, .3 + seeded(map, x, z, 15) * .3, .22 + seeded(map, x, z, 16) * .2, .28 + seeded(map, x, z, 17) * .3);
      this.settle(tile, cx, y, cz, rubble);
      return;
    } else if (terrain === 'fertile') {
      const stripes = new T.Group();
      box(stripes, (x + z) % 2 === 0 ? 0xb9b47a : 0xb2ad74, cx, y - .03, cz, CELL_SIZE, .04, CELL_SIZE, 0);
      this.settle(tile, cx, y, cz, stripes);
      return;
    } else if (terrain === 'cliff') {
      const outcrops = fractal(x, z, map.seed + 967, 2, 4);
      const rocks = new T.Group();
      if (outcrops > .59 && seeded(map, x, z, 20) > .45) {
        const outcrop = cliffOutcrop();
        outcrop.position.set(cx, y, cz);
        outcrop.rotation.y = seeded(map, x, z, 21) * Math.PI * 2;
        outcrop.scale.setScalar(.75 + seeded(map, x, z, 22) * .25);
        rocks.add(outcrop);
      }
      const bush = bushForTile(map, x, z);
      if (bush) {
        bush.position.set(cx, y, cz);
        rocks.add(bush);
      }
      if (!rocks.children.length) return;
      this.absorb(tile, cx, y, cz, rocks);
    } else {
      const plant = new T.Group();
      tree(plant, cx + jitterX, y, cz + jitterZ, .6, seeded(map, x, z, 19) > .5);
      this.absorb(tile, cx + jitterX, y, cz + jitterZ, plant, [{ x: cx + jitterX, y, z: cz + jitterZ, scale: .6, lie: seeded(map, x, z, 8) * Math.PI * 2, litter: litterFor(seeded(map, x, z, 10)) }]);
    }
    const entry = this.decor.get(tile)!;
    entry.hidden = this.occupied.has(tile);
    if (this.felled.has(tile)) {
      entry.settled = true;
      this.leaveStump(tile, entry);
    }
    this.writeDecor(tile);
  }

  private fieldFor(tile: number): InstanceField {
    const chunkX = Math.floor(tile % this.map.width / DECOR_CHUNK);
    const chunkZ = Math.floor(Math.floor(tile / this.map.width) / DECOR_CHUNK);
    const key = chunkZ * this.map.width + chunkX;
    let field = this.fields.get(key);
    if (!field) {
      field = new InstanceField();
      const corner = worldPositionOn(this.map, chunkX * DECOR_CHUNK, chunkZ * DECOR_CHUNK);
      const far = worldPositionOn(this.map, (chunkX + 1) * DECOR_CHUNK, (chunkZ + 1) * DECOR_CHUNK);
      const centre = new T.Vector3((corner.x + far.x) / 2, DECOR_HEIGHT / 2, (corner.z + far.z) / 2);
      field.confine(centre, Math.hypot(far.x - corner.x, far.z - corner.z) / 2 + DECOR_HEIGHT);
      this.fields.set(key, field);
      this.root.add(field.root);
    }
    return field;
  }

  private writeDecor(tile: number): void {
    const entry = this.decor.get(tile);
    if (!entry) return;
    const standing = !entry.hidden && !entry.settled;
    this.pose.makeRotationFromQuaternion(entry.turn).setPosition(0, entry.drop, 0);
    this.base.multiplyMatrices(entry.pivot, this.pose);
    for (const piece of entry.pieces) {
      if (standing) write(piece.slot, this.scratch.multiplyMatrices(this.base, piece.local));
      else hide(piece.slot);
    }
    for (const piece of entry.remains) {
      if (entry.hidden) hide(piece.slot);
      else write(piece.slot, this.scratch.multiplyMatrices(entry.pivot, piece.local));
    }
  }

  decorFoot(tile: number): T.Vector3 | null {
    const entry = this.decor.get(tile);
    if (!entry) return null;
    return new T.Vector3().setFromMatrixPosition(entry.pivot);
  }

  struck(tile: number, from: T.Vector3): void {
    const entry = this.decor.get(tile);
    if (!entry || entry.hidden || entry.settled || this.falling.has(tile)) return;
    const foot = this.decorFoot(tile)!;
    this.toppleYaw.set(tile, Math.atan2(foot.x - from.x, foot.z - from.z));
    if (this.motion) this.shaking.set(tile, 0);
  }

  private hingeFor(tile: number): T.Vector3 {
    const yaw = this.toppleYaw.get(tile) ?? (tile * 7919 % 360) * Math.PI / 180;
    return this.hinge.set(Math.cos(yaw), 0, -Math.sin(yaw));
  }

  decorTiles(): number[] {
    return [...this.decor.keys()];
  }

  decorHidden(tile: number): boolean {
    const entry = this.decor.get(tile);
    if (!entry) return true;
    return entry.hidden || entry.settled;
  }

  stumpBounds(tile: number): T.Box3 | null {
    const entry = this.decor.get(tile);
    if (!entry || entry.remains.length === 0) return null;
    const bounds = new T.Box3();
    for (const piece of entry.remains) {
      if (!piece.geometry.boundingBox) piece.geometry.computeBoundingBox();
      const part = piece.geometry.boundingBox!.clone();
      part.applyMatrix4(this.scratch.multiplyMatrices(entry.pivot, piece.local));
      bounds.union(part);
    }
    return bounds;
  }

  decorBounds(tile: number): T.Box3 | null {
    const entry = this.decor.get(tile);
    if (!entry) return null;
    this.pose.makeRotationFromQuaternion(entry.turn).setPosition(0, entry.drop, 0);
    this.base.multiplyMatrices(entry.pivot, this.pose);
    const bounds = new T.Box3();
    for (const piece of entry.pieces) {
      if (!piece.geometry.boundingBox) piece.geometry.computeBoundingBox();
      const part = piece.geometry.boundingBox!.clone();
      part.applyMatrix4(this.scratch.multiplyMatrices(this.base, piece.local));
      bounds.union(part);
    }
    return bounds;
  }

  clearDecor(occupied: Set<number>, felled: Set<number>): void {
    this.occupied = occupied;
    this.felled = felled;
    for (const [tile, entry] of this.decor) {
      const hidden = occupied.has(tile);
      if (felled.has(tile)) {
        if (!this.falling.has(tile) && !entry.hidden && !entry.settled) this.falling.set(tile, 0);
        if (entry.hidden === hidden) continue;
        entry.hidden = hidden;
        this.writeDecor(tile);
        continue;
      }
      const posed = entry.drop !== 0 || entry.turn.w !== 1;
      const changed = entry.hidden !== hidden || posed || entry.settled || entry.remains.length > 0;
      entry.hidden = hidden;
      entry.turn.identity();
      entry.drop = 0;
      entry.settled = false;
      this.releaseRemains(entry);
      this.falling.delete(tile);
      this.shaking.delete(tile);
      this.toppleYaw.delete(tile);
      if (changed) this.writeDecor(tile);
    }
  }

  animateFalls(delta: number): boolean {
    let active = false;
    for (const [tile, elapsed] of this.shaking) {
      const entry = this.decor.get(tile);
      if (!entry || entry.hidden || entry.settled || this.falling.has(tile)) { this.shaking.delete(tile); continue; }
      const next = elapsed + delta;
      const t = next / SHUDDER_SECONDS;
      if (t >= 1) {
        this.shaking.delete(tile);
        entry.turn.identity();
      } else {
        this.shaking.set(tile, next);
        entry.turn.setFromAxisAngle(this.hingeFor(tile), Math.sin(t * Math.PI * 3) * (1 - t) * SHUDDER_ANGLE);
        active = true;
      }
      this.writeDecor(tile);
    }
    for (const [tile, elapsed] of this.falling) {
      const entry = this.decor.get(tile);
      if (!entry || entry.hidden) { this.falling.delete(tile); continue; }
      const next = elapsed + delta;
      const t = Math.min(1, next / FALL_SECONDS);
      entry.turn.setFromAxisAngle(this.hingeFor(tile), fallLean(t));
      if (elapsed / FALL_SECONDS < FALL_LANDING && t >= FALL_LANDING) this.thud(tile, entry);
      if (t >= 1) {
        entry.settled = true;
        this.leaveStump(tile, entry);
        this.falling.delete(tile);
      } else {
        this.falling.set(tile, next);
        active = true;
      }
      this.writeDecor(tile);
    }
    return active;
  }

  private thud(tile: number, entry: DecorEntry): void {
    if (!this.dust || !this.motion) return;
    const yaw = this.toppleYaw.get(tile) ?? (tile * 7919 % 360) * Math.PI / 180;
    const reach = CELL_SIZE * 1.3;
    const crown = new T.Vector3().setFromMatrixPosition(entry.pivot);
    crown.x += Math.sin(yaw) * reach;
    crown.z += Math.cos(yaw) * reach;
    this.dust.puff(crown, reach * .7, reach * .7, .45);
  }

  update(time: number, focus?: { x: number; z: number } | null): void {
    this.waterTime.value = time;
    this.foam.update(time, focus);
  }

  dispose(): void {
    for (const field of this.fields.values()) field.dispose();
    this.fields.clear();
    this.decor.clear();
    this.falling.clear();
    this.shaking.clear();
    this.toppleYaw.clear();
    this.root.removeFromParent();
    this.root.traverse((child) => {
      if (child instanceof T.Mesh || child instanceof T.LineSegments) child.geometry.dispose();
    });
  }
}

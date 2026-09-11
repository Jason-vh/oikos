import * as T from 'three';
import { bake, boat, box, colors, disposeModel, lump, post, tree } from '../art';
import type { Stair } from '../sim/stairs';
import { CELL_SIZE, buildable, groundHeight, levelOn, terrainOn, worldPositionOn, type IslandMap } from '../sim/island';
import { fractal } from '../sim/island';
import { buildTerrain } from './terrain';
import { CoastalFoam } from '../art/foam';
import { cliffOutcrop } from '../art/cliffs';
import { bushForTile } from '../art/bushes';
import { hide, InstanceField, piecesAround, write, type InstanceSlot } from './instances';

function seeded(map: IslandMap, x: number, z: number, salt: number): number {
  return fractal(x * 3.7 + salt, z * 2.9 - salt, map.seed + salt, 1, 1);
}

const DECOR_HEIGHT = 12;
const DECOR_CHUNK = 24;

interface DecorPiece { slot: InstanceSlot; local: T.Matrix4; geometry: T.BufferGeometry; }
interface DecorEntry {
  pivot: T.Matrix4;
  pieces: DecorPiece[];
  tilt: T.Euler;
  drop: number;
  hidden: boolean;
  settled: boolean;
}

export class IslandScenery {
  readonly root = new T.Group();
  readonly grid = new T.Group();
  readonly foam: CoastalFoam;
  readonly terrain = new T.Group();
  private stairKey = '';
  private readonly waterTime = { value: 0 };
  private readonly ship = boat(colors.blue, false);
  private readonly fields = new Map<number, InstanceField>();
  private readonly decor = new Map<number, DecorEntry>();
  private readonly falling = new Map<number, number>();
  private readonly pose = new T.Matrix4();
  private readonly base = new T.Matrix4();
  private readonly scratch = new T.Matrix4();
  private readonly unrevealed = new Map<number, number[]>();
  private occupied = new Set<number>();
  private felled = new Set<number>();

  constructor(scene: T.Scene, readonly map: IslandMap) {
    this.foam = new CoastalFoam(map);
    this.terrain.add(buildTerrain(map));
    this.root.add(this.terrain, this.foam.mesh);
    const props = new T.Group();
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
    const entrance = worldPositionOn(map, map.entry.x + .5, map.entry.z + .5);
    box(props, colors.stone, entrance.x, .47, entrance.z + 3, 7, 1.24, 2.3);
    box(props, colors.paving, entrance.x, 1.12, entrance.z + 3, 7.1, .15, 2.4);
    box(props, colors.stone, entrance.x + 2.5, .41, entrance.z + 5, 1.4, 1.12, 5.8);
    box(props, colors.paving, entrance.x + 2.5, 1.04, entrance.z + 5, 1.5, .17, 5.85);
    box(props, colors.paving, entrance.x, 1.12, entrance.z + 1.3, 1.4, .15, 3);
    for (const z of [3.5, 5.5, 7.3]) {
      for (const x of [1.9, 3.1]) post(props, colors.wood, entrance.x + x, 1.32, entrance.z + z, .09, .46);
    }
    post(props, colors.wood, entrance.x - .85, 2.2, entrance.z + .2, .055, 2.15);
    box(props, colors.blue, entrance.x - .5, 3.08, entrance.z + .2, .7, .4, .035);
    this.ship.position.set(entrance.x + .5, 0, entrance.z + 5.5);
    bake(props);
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(gridPoints, 3));
    this.grid.add(new T.LineSegments(geometry, new T.LineBasicMaterial({ color: 0xfff1c9, transparent: true, opacity: .34, depthWrite: false })));
    this.grid.visible = false;
    this.root.add(props, this.grid, this.ship);
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
    const terrain = buildTerrain(this.map, stairs);
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

  private absorb(tile: number, x: number, y: number, z: number, source: T.Group): void {
    const pivot = new T.Matrix4().makeTranslation(x, y, z);
    const field = this.fieldFor(tile);
    const pieces = piecesAround(source, pivot).map((piece) => ({
      slot: field.reserve(piece.geometry, piece.material),
      local: piece.local,
      geometry: piece.geometry,
    }));
    this.decor.set(tile, { pivot, pieces, tilt: new T.Euler(), drop: 0, hidden: false, settled: false });
    this.writeDecor(tile);
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
      tree(plant, cx + jitterX, y, cz + jitterZ, .62 + seeded(map, x, z, 4) * .3, cypress);
      if (seeded(map, x, z, 5) > .55) tree(plant, cx - jitterX * 1.4, y, cz - jitterZ * 1.2, .5 + seeded(map, x, z, 6) * .2, !cypress && seeded(map, x, z, 7) > .6);
      this.absorb(tile, cx, y, cz, plant);
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
      this.absorb(tile, cx, y, cz, plant);
    }
    const entry = this.decor.get(tile)!;
    if (this.felled.has(tile)) {
      entry.hidden = true;
      entry.settled = true;
      this.writeDecor(tile);
      return;
    }
    if (!this.occupied.has(tile)) return;
    entry.hidden = true;
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
    if (entry.hidden) {
      for (const piece of entry.pieces) hide(piece.slot);
      return;
    }
    this.pose.makeRotationFromEuler(entry.tilt).setPosition(0, entry.drop, 0);
    this.base.multiplyMatrices(entry.pivot, this.pose);
    for (const piece of entry.pieces) write(piece.slot, this.scratch.multiplyMatrices(this.base, piece.local));
  }

  decorTiles(): number[] {
    return [...this.decor.keys()];
  }

  decorHidden(tile: number): boolean {
    return this.decor.get(tile)?.hidden ?? true;
  }

  decorBounds(tile: number): T.Box3 | null {
    const entry = this.decor.get(tile);
    if (!entry) return null;
    this.pose.makeRotationFromEuler(entry.tilt).setPosition(0, entry.drop, 0);
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
      if (felled.has(tile)) {
        if (!this.falling.has(tile) && !entry.hidden && !entry.settled) this.falling.set(tile, 0);
        continue;
      }
      const hidden = occupied.has(tile);
      const posed = entry.tilt.x !== 0 || entry.tilt.z !== 0 || entry.drop !== 0;
      const changed = entry.hidden !== hidden || posed;
      entry.hidden = hidden;
      entry.tilt.set(0, 0, 0);
      entry.drop = 0;
      entry.settled = false;
      this.falling.delete(tile);
      if (changed) this.writeDecor(tile);
    }
  }

  animateFalls(delta: number): boolean {
    let active = false;
    for (const [tile, elapsed] of this.falling) {
      const entry = this.decor.get(tile);
      if (!entry) { this.falling.delete(tile); continue; }
      const next = elapsed + delta;
      const t = Math.min(1, next / 2.2);
      const eased = t * t * (3 - 2 * t);
      const lean = eased * Math.PI * .48;
      const seed = (tile * 7919) % 360;
      entry.tilt.set(Math.cos(seed) * lean, 0, Math.sin(seed) * lean);
      entry.drop = t > .85 ? -(t - .85) * 4 : 0;
      if (t >= 1) {
        entry.hidden = true;
        entry.drop = 0;
        entry.settled = true;
        this.falling.delete(tile);
      } else {
        this.falling.set(tile, next);
        active = true;
      }
      this.writeDecor(tile);
    }
    return active;
  }

  update(time: number, focus?: { x: number; z: number } | null): void {
    this.waterTime.value = time;
    this.foam.update(time, focus);
    this.ship.position.y = Math.sin(time * 1.4) * .045;
    this.ship.rotation.z = Math.sin(time * 1.1) * .018;
  }

  dispose(): void {
    for (const field of this.fields.values()) field.dispose();
    this.fields.clear();
    this.decor.clear();
    this.root.removeFromParent();
    this.root.traverse((child) => {
      if (child instanceof T.Mesh || child instanceof T.LineSegments) child.geometry.dispose();
    });
  }
}

import * as T from 'three';
import { cityColors } from '../art/primitives';
import { CELL_SIZE, groundHeight, terrainOn, worldPositionOn, type IslandMap } from '../sim/island';
import type { CityColor } from '../sim/colors';
import type { City, World } from '../sim/types';
import type { Stage } from './stage';

const LIFT = .05;
const GLAZE_OPACITY = .5;
const EDGE_OPACITY = .88;
const EDGE_TILES = 2;
const FADE_FROM = 240;
const FADE_TO = 700;
const RENDER_ORDER = -1;

function tileQuad(positions: number[], map: IslandMap, x: number, z: number): void {
  const origin = worldPositionOn(map, x, z);
  const top = groundHeight(map, x, z) + LIFT;
  const x1 = origin.x + CELL_SIZE;
  const z1 = origin.z + CELL_SIZE;
  positions.push(
    origin.x, top, origin.z, x1, top, z1, x1, top, origin.z,
    origin.x, top, origin.z, origin.x, top, z1, x1, top, z1,
  );
}

function nearWater(map: IslandMap, x: number, z: number): boolean {
  for (let dz = -EDGE_TILES; dz <= EDGE_TILES; dz++) {
    for (let dx = -EDGE_TILES; dx <= EDGE_TILES; dx++) {
      if (terrainOn(map, x + dx, z + dz) === 'water') return true;
    }
  }
  return false;
}

function geometryOf(positions: number[]): T.BufferGeometry {
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  return geometry;
}

export class ClaimOverlay {
  private readonly group = new T.Group();
  private readonly paints = new Map<string, T.MeshBasicMaterial>();
  private signature = '';
  private marks = 0;
  private lit = 0;

  constructor(private readonly stage: Stage, private readonly map: IslandMap) {
    this.group.visible = false;
    stage.scene.add(this.group);
  }

  update(world: World, shown: boolean): void {
    const signature = shown ? world.cities.map((city) => `${city.home}:${city.color}`).sort().join(';') : '';
    if (signature === this.signature) return;
    this.signature = signature;
    this.clearMarks();
    if (shown) for (const city of world.cities) this.addMark(city);
    this.group.visible = shown && this.lit > 0;
    this.stage.invalidate();
  }

  fade(span: number): boolean {
    const wanted = T.MathUtils.smoothstep(span, FADE_FROM, FADE_TO);
    if (Math.abs(wanted - this.lit) < .001) return false;
    this.lit = wanted;
    for (const [key, material] of this.paints) material.opacity = wanted * (key.endsWith(':edge') ? EDGE_OPACITY : GLAZE_OPACITY);
    this.group.visible = this.marks > 0 && wanted > 0;
    return true;
  }

  dispose(): void {
    this.clearMarks();
    for (const material of this.paints.values()) material.dispose();
    this.paints.clear();
    this.group.removeFromParent();
    this.stage.invalidate();
  }

  get strength(): number {
    return this.lit;
  }

  get claimedIslands(): number {
    return this.marks;
  }

  private addMark(city: City): void {
    const island = this.map.islands[city.home];
    if (!island) return;
    const land: number[] = [];
    const edge: number[] = [];
    for (let z = island.z; z < island.z + island.depth; z++) {
      for (let x = island.x; x < island.x + island.width; x++) {
        if (terrainOn(this.map, x, z) === 'water') continue;
        tileQuad(nearWater(this.map, x, z) ? edge : land, this.map, x, z);
      }
    }
    if (land.length === 0 && edge.length === 0) return;
    for (const [positions, kind] of [[land, 'glaze'], [edge, 'edge']] as const) {
      if (positions.length === 0) continue;
      const mesh = new T.Mesh(geometryOf(positions), this.paint(city.color, kind));
      mesh.renderOrder = RENDER_ORDER;
      this.group.add(mesh);
    }
    this.marks += 1;
  }

  private paint(color: CityColor, kind: 'glaze' | 'edge'): T.MeshBasicMaterial {
    const key = `${color}:${kind}`;
    let material = this.paints.get(key);
    if (!material) {
      material = new T.MeshBasicMaterial({
        color: cityColors[color],
        transparent: true,
        opacity: this.lit * (kind === 'edge' ? EDGE_OPACITY : GLAZE_OPACITY),
        depthWrite: false,
        depthTest: false,
      });
      this.paints.set(key, material);
    }
    return material;
  }

  private clearMarks(): void {
    for (const child of this.group.children) (child as T.Mesh).geometry.dispose();
    this.group.clear();
    this.marks = 0;
  }
}

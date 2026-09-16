import * as T from 'three';
import { cityColors } from '../art/primitives';
import { CELL_SIZE, groundHeight, terrainOn, worldPositionOn, type IslandMap } from '../sim/island';
import type { CityColor } from '../sim/colors';
import type { City, World } from '../sim/types';
import type { Stage } from './stage';

const LIFT = .05;
const FULL_OPACITY = .5;
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

export class ClaimOverlay {
  private readonly group = new T.Group();
  private readonly glazes = new Map<CityColor, T.MeshBasicMaterial>();
  private signature = '';
  private opacity = 0;

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
    this.group.visible = shown && this.opacity > 0;
    this.stage.invalidate();
  }

  fade(span: number): boolean {
    const wanted = FULL_OPACITY * T.MathUtils.smoothstep(span, FADE_FROM, FADE_TO);
    if (Math.abs(wanted - this.opacity) < .001) return false;
    this.opacity = wanted;
    for (const material of this.glazes.values()) material.opacity = wanted;
    this.group.visible = this.group.children.length > 0 && wanted > 0;
    return true;
  }

  dispose(): void {
    this.clearMarks();
    for (const material of this.glazes.values()) material.dispose();
    this.glazes.clear();
    this.group.removeFromParent();
    this.stage.invalidate();
  }

  get claimedIslands(): number {
    return this.group.children.length;
  }

  private addMark(city: City): void {
    const island = this.map.islands[city.home];
    if (!island) return;
    const positions: number[] = [];
    for (let z = island.z; z < island.z + island.depth; z++) {
      for (let x = island.x; x < island.x + island.width; x++) {
        if (terrainOn(this.map, x, z) !== 'water') tileQuad(positions, this.map, x, z);
      }
    }
    if (positions.length === 0) return;
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    const mark = new T.Mesh(geometry, this.glaze(city.color));
    mark.renderOrder = RENDER_ORDER;
    this.group.add(mark);
  }

  private glaze(color: CityColor): T.MeshBasicMaterial {
    let material = this.glazes.get(color);
    if (!material) {
      material = new T.MeshBasicMaterial({
        color: cityColors[color],
        transparent: true,
        opacity: this.opacity,
        depthWrite: false,
        depthTest: false,
      });
      this.glazes.set(color, material);
    }
    return material;
  }

  private clearMarks(): void {
    for (const child of this.group.children) (child as T.Mesh).geometry.dispose();
    this.group.clear();
  }
}

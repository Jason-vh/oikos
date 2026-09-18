import * as T from 'three';
import { bake, disposeModel } from '../art';
import { wheatRows } from '../art/vegetation';
import { oliveSapling } from '../art/olives';
import { CELL_SIZE, groundHeight, tileAtOn, worldPositionOn, type IslandMap } from '../sim/island';
import type { Crop, CropKind, World } from '../sim/types';

const STAGES = 4;

function ripeness(crop: Crop): number {
  return Math.min(STAGES - 1, Math.floor(crop.progress * STAGES));
}

function template(kind: CropKind, stage: number, turn: number): T.Group {
  const model = kind === 'wheat' ? wheatRows(stage, turn) : oliveSapling(stage, turn);
  bake(model);
  return model;
}

interface Planted { key: string; model: T.Group; }

const PICK_RADIUS = .55;

export class CropField {
  private readonly root = new T.Group();
  private readonly planted = new Map<number, Planted>();
  private readonly templates = new Map<string, T.Group>();

  constructor(private readonly scene: T.Scene, private readonly map: IslandMap) {
    scene.add(this.root);
  }

  sync(world: World): void {
    const wanted = new Map<number, Crop>();
    for (const city of world.cities) {
      for (const crop of city.crops) wanted.set(crop.tile, crop);
    }
    for (const [tile, entry] of this.planted) {
      if (wanted.has(tile)) continue;
      entry.model.removeFromParent();
      this.planted.delete(tile);
    }
    for (const [tile, crop] of wanted) {
      const turn = tile % 4;
      const key = `${crop.kind}:${ripeness(crop)}:${turn}`;
      const existing = this.planted.get(tile);
      if (existing?.key === key) continue;
      if (existing) existing.model.removeFromParent();
      const model = this.clone(key, crop.kind, ripeness(crop), turn);
      const { x, z } = tileAtOn(this.map, tile);
      const centre = worldPositionOn(this.map, x + .5, z + .5);
      model.position.set(centre.x, groundHeight(this.map, x, z), centre.z);
      model.scale.setScalar(CELL_SIZE / 1.25);
      this.root.add(model);
      this.planted.set(tile, { key, model });
    }
  }

  private clone(key: string, kind: CropKind, stage: number, turn: number): T.Group {
    let source = this.templates.get(key);
    if (!source) {
      source = template(kind, stage, turn);
      this.templates.set(key, source);
    }
    const copy = new T.Group();
    for (const child of source.children) {
      if (!(child instanceof T.Mesh)) continue;
      const mesh = new T.Mesh(child.geometry, child.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      copy.add(mesh);
    }
    return copy;
  }

  pick(ray: T.Raycaster): number | null {
    let nearest: { tile: number; distance: number } | null = null;
    const centre = new T.Vector3();
    for (const [tile, entry] of this.planted) {
      centre.copy(entry.model.position).setY(entry.model.position.y + .2);
      const distance = ray.ray.distanceToPoint(centre);
      if (distance < PICK_RADIUS && (!nearest || distance < nearest.distance)) nearest = { tile, distance };
    }
    return nearest?.tile ?? null;
  }

  modelOf(tile: number): T.Object3D | null {
    return this.planted.get(tile)?.model ?? null;
  }

  get count(): number {
    return this.planted.size;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.planted.clear();
    for (const source of this.templates.values()) disposeModel(source);
    this.templates.clear();
    this.scene.remove(this.root);
  }
}

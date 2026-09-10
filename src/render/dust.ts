import * as T from 'three';
import { colors } from '../art';

const PUFF_SECONDS = .7;
const PUFF_GEOMETRY = new T.DodecahedronGeometry(1, 0);
const CLOUD_COUNT = 7;

PUFF_GEOMETRY.userData.sharedPrimitive = true;

interface Puff {
  model: T.Group;
  material: T.MeshStandardMaterial;
  elapsed: number;
  rise: number;
}

export class DustField {
  private readonly puffs: Puff[] = [];

  constructor(private readonly scene: T.Object3D) {}

  puff(position: T.Vector3, width: number, depth: number, scale = 1): void {
    const model = new T.Group();
    const material = new T.MeshStandardMaterial({ color: colors.cream, roughness: .88, transparent: true, opacity: .75, depthWrite: false });
    for (let index = 0; index < CLOUD_COUNT; index++) {
      const angle = index / CLOUD_COUNT * Math.PI * 2;
      const cloud = new T.Mesh(PUFF_GEOMETRY, material);
      cloud.position.set(Math.cos(angle) * width * .38, .15 * scale, Math.sin(angle) * depth * .38);
      cloud.scale.setScalar((.22 + (index % 3) * .08) * scale);
      model.add(cloud);
    }
    model.position.copy(position);
    this.scene.add(model);
    this.puffs.push({ model, material, elapsed: 0, rise: scale });
  }

  advance(delta: number): boolean {
    const active = this.puffs.length > 0;
    for (const puff of [...this.puffs]) {
      puff.elapsed += delta;
      const t = Math.min(1, puff.elapsed / PUFF_SECONDS);
      const spread = 1 + t * 1.6;
      puff.model.scale.set(spread, 1 + t * .8, spread);
      puff.model.position.y += delta * .35 * puff.rise;
      puff.material.opacity = .75 * (1 - t) * (1 - t);
      if (t < 1) continue;
      this.remove(puff);
    }
    return active;
  }

  clear(): void {
    for (const puff of [...this.puffs]) this.remove(puff);
  }

  get count(): number {
    return this.puffs.length;
  }

  private remove(puff: Puff): void {
    puff.model.removeFromParent();
    puff.material.dispose();
    this.puffs.splice(this.puffs.indexOf(puff), 1);
  }
}

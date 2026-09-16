import * as T from 'three';
import { CLOUD_SHAPES, cloudGeometry } from '../art/clouds';
import { shadowLean, SUN_OFFSET } from './sun';

const COUNT = 22;
const COLOR = 0xfff8ec;
const SHADOW_COLOR = 0x2f6d80;
const SHADOW_OPACITY = .4;
const SHADOW_SPREAD = 1.05;
const LOWEST = 52;
const HIGHEST = 72;
const SMALLEST = 9;
const LARGEST = 16;
const LEAN = shadowLean(SUN_OFFSET);
const WIND = new T.Vector2(1, .34).normalize();
const WIND_SPEED = 1.4;
const FADE_FROM = 300;
const FADE_TO = 560;
const FULL_OPACITY = .95;
const UP = new T.Vector3(0, 1, 0);
const SHADOW_HEIGHT = .04;

interface Cloud { batch: number; slot: number; x: number; z: number; y: number; scale: number; turn: number; }

function wrap(value: number, field: number): number {
  const shifted = (value + field / 2) % field;
  return (shifted < 0 ? shifted + field : shifted) - field / 2;
}

function shadowTexture(): T.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x / (size - 1) - .5, y / (size - 1) - .5) * 2;
      const falloff = Math.round(Math.max(0, 1 - distance * distance) * 255);
      data.fill(falloff, (y * size + x) * 4, (y * size + x) * 4 + 4);
    }
  }
  const texture = new T.DataTexture(data, size, size);
  texture.minFilter = T.LinearFilter;
  texture.magFilter = T.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export class CloudLayer {
  readonly root = new T.Group();
  private readonly material = new T.MeshStandardMaterial({ color: COLOR, roughness: .95, transparent: true, opacity: 0 });
  private readonly shadowTint = shadowTexture();
  private readonly shadowMaterial: T.MeshBasicMaterial;
  private readonly batches: T.InstancedMesh[] = [];
  private readonly shadows: T.InstancedMesh;
  private readonly clouds: Cloud[] = [];
  private readonly pose = new T.Matrix4();
  private readonly position = new T.Vector3();
  private readonly turn = new T.Quaternion();
  private readonly spread = new T.Vector3();
  private opacity = 0;

  constructor(scene: T.Scene, private readonly field: number, seed: number) {
    const counts = new Array<number>(CLOUD_SHAPES).fill(0);
    let value = seed % 2147483647 || 1;
    const random = (): number => {
      value = value * 48271 % 2147483647;
      return value / 2147483647;
    };
    for (let index = 0; index < COUNT; index++) {
      const batch = index % CLOUD_SHAPES;
      this.clouds.push({
        batch,
        slot: counts[batch]++,
        x: (random() - .5) * field,
        z: (random() - .5) * field,
        y: LOWEST + random() * (HIGHEST - LOWEST),
        scale: SMALLEST + random() * (LARGEST - SMALLEST),
        turn: random() * Math.PI * 2,
      });
    }
    for (let variant = 0; variant < CLOUD_SHAPES; variant++) {
      const mesh = new T.InstancedMesh(cloudGeometry(variant), this.material, counts[variant]);
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      this.batches.push(mesh);
      this.root.add(mesh);
    }
    this.shadowMaterial = new T.MeshBasicMaterial({ color: SHADOW_COLOR, alphaMap: this.shadowTint, transparent: true, opacity: 0, depthWrite: false, depthTest: false });
    this.shadows = new T.InstancedMesh(new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.shadowMaterial, COUNT);
    this.shadows.frustumCulled = false;
    this.root.add(this.shadows);
    this.root.visible = false;
    scene.add(this.root);
    this.drift(0);
  }

  drift(time: number): void {
    const travel = time * WIND_SPEED;
    this.clouds.forEach((cloud, index) => {
      const x = wrap(cloud.x + WIND.x * travel, this.field);
      const z = wrap(cloud.z + WIND.y * travel, this.field);
      this.position.set(x, cloud.y, z);
      this.turn.setFromAxisAngle(UP, cloud.turn);
      this.spread.setScalar(cloud.scale);
      this.pose.compose(this.position, this.turn, this.spread);
      this.batches[cloud.batch].setMatrixAt(cloud.slot, this.pose);
      this.position.set(x + LEAN.x * cloud.y, SHADOW_HEIGHT, z + LEAN.y * cloud.y);
      this.spread.set(cloud.scale * SHADOW_SPREAD * 4.5, 1, cloud.scale * SHADOW_SPREAD * 3.2);
      this.pose.compose(this.position, this.turn, this.spread);
      this.shadows.setMatrixAt(index, this.pose);
    });
    for (const batch of this.batches) batch.instanceMatrix.needsUpdate = true;
    this.shadows.instanceMatrix.needsUpdate = true;
  }

  fade(span: number): boolean {
    const wanted = FULL_OPACITY * T.MathUtils.smoothstep(span, FADE_FROM, FADE_TO);
    if (Math.abs(wanted - this.opacity) < .001) return false;
    this.opacity = wanted;
    this.material.opacity = wanted;
    this.shadowMaterial.opacity = wanted * SHADOW_OPACITY;
    this.root.visible = wanted > 0;
    return true;
  }

  dispose(): void {
    for (const batch of this.batches) batch.geometry.dispose();
    this.batches.length = 0;
    this.shadows.geometry.dispose();
    this.shadowTint.dispose();
    this.shadowMaterial.dispose();
    this.material.dispose();
    this.root.clear();
    this.root.removeFromParent();
  }
}

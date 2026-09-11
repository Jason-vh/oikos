import * as T from 'three';
import { fractal, hash, type IslandMap } from '../sim/island';
import { coastalSegments, type CoastalSegment } from './coast';
import { colors, material } from './primitives';

const STATIONS = [0, .18, .5, .82, 1];
const TAPER = [0, .8, 1, .8, 0];
const PERIOD = 6;

interface Ribbon { segment: CoastalSegment; phase: number; start: number; length: number; }

export class CoastalFoam {
  readonly mesh: T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>;
  private readonly ribbons: Ribbon[] = [];
  private readonly positions: T.BufferAttribute;
  private lastTime = NaN;

  constructor(map: IslandMap) {
    const bounds = new T.Box3();
    for (const segment of coastalSegments(map)) {
      const x = (segment.start.foot[0] + segment.end.foot[0]) / 2;
      const z = (segment.start.foot[2] + segment.end.foot[2]) / 2;
      const variation = hash(Math.round(x * 100), Math.round(z * 100), map.seed + 853);
      if (variation < .28) continue;
      this.ribbons.push({
        segment,
        phase: fractal(x, z, map.seed + 947, 2, 4) * 3 + x * .035 + z * .027,
        start: .06 + variation * .06,
        length: .68 + variation * .14,
      });
      for (const profile of [segment.start, segment.end]) {
        for (const point of [profile.foot, profile.shallows]) bounds.expandByPoint(new T.Vector3(point[0], point[1] + .025, point[2]));
      }
    }
    const count = this.ribbons.length * STATIONS.length * 2;
    this.positions = new T.BufferAttribute(new Float32Array(count * 3), 3).setUsage(T.DynamicDrawUsage);
    const normals = new Float32Array(count * 3);
    for (let index = 0; index < count; index++) normals[index * 3 + 1] = 1;
    const indices: number[] = [];
    for (let ribbon = 0; ribbon < this.ribbons.length; ribbon++) {
      const offset = ribbon * STATIONS.length * 2;
      for (let station = 0; station < STATIONS.length - 1; station++) {
        const a = offset + station * 2;
        indices.push(a, a + 2, a + 3, a, a + 3, a + 1);
      }
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', this.positions);
    geometry.setAttribute('normal', new T.BufferAttribute(normals, 3));
    geometry.setIndex(indices);
    geometry.boundingBox = bounds;
    geometry.boundingSphere = bounds.getBoundingSphere(new T.Sphere());
    this.mesh = new T.Mesh(geometry, material(colors.cream));
    this.mesh.name = 'coastal-foam';
    this.mesh.receiveShadow = true;
    this.update(0);
  }

  update(time: number): void {
    if (time === this.lastTime) return;
    this.lastTime = time;
    for (let index = 0; index < this.ribbons.length; index++) {
      const ribbon = this.ribbons[index];
      const cycle = time / PERIOD + ribbon.phase;
      const phase = cycle - Math.floor(cycle);
      const progress = Math.min(1, phase / .7);
      const swell = Math.sin(progress * Math.PI) ** 2;
      const distance = .82 - progress * .68;
      const halfWidth = swell * .25;
      for (let station = 0; station < STATIONS.length; station++) {
        const along = ribbon.start + STATIONS[station] * ribbon.length;
        const { start, end } = ribbon.segment;
        const footX = T.MathUtils.lerp(start.foot[0], end.foot[0], along);
        const footZ = T.MathUtils.lerp(start.foot[2], end.foot[2], along);
        const shelfX = T.MathUtils.lerp(start.shallows[0], end.shallows[0], along);
        const shelfZ = T.MathUtils.lerp(start.shallows[2], end.shallows[2], along);
        for (let side = 0; side < 2; side++) {
          const across = distance + (side * 2 - 1) * halfWidth * TAPER[station];
          const vertex = (index * STATIONS.length + station) * 2 + side;
          this.positions.setXYZ(vertex, T.MathUtils.lerp(footX, shelfX, across), start.foot[1] + .025, T.MathUtils.lerp(footZ, shelfZ, across));
        }
      }
    }
    this.positions.needsUpdate = true;
  }
}

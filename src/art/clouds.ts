import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

interface Puff { x: number; y: number; z: number; width: number; height: number; depth: number; }

const SHAPES: Puff[][] = [
  [
    { x: 0, y: 0, z: 0, width: 1.9, height: .46, depth: 1.5 },
    { x: 1.6, y: -.04, z: .3, width: 1.2, height: .34, depth: 1.1 },
    { x: -1.55, y: -.06, z: -.28, width: 1.3, height: .32, depth: 1.15 },
    { x: .5, y: -.02, z: -1.2, width: 1.1, height: .3, depth: .9 },
    { x: -.6, y: .26, z: .2, width: 1.15, height: .4, depth: .95 },
  ],
  [
    { x: 0, y: 0, z: 0, width: 2.5, height: .4, depth: 1.25 },
    { x: 2.2, y: -.05, z: .35, width: 1.25, height: .28, depth: .95 },
    { x: -2.1, y: -.05, z: -.3, width: 1.4, height: .3, depth: 1 },
    { x: -.9, y: .04, z: .85, width: 1.1, height: .26, depth: .8 },
    { x: .9, y: .2, z: -.15, width: 1.05, height: .34, depth: .85 },
  ],
  [
    { x: 0, y: 0, z: 0, width: 1.45, height: .48, depth: 1.4 },
    { x: 1.15, y: -.04, z: .45, width: 1, height: .34, depth: 1 },
    { x: -1.1, y: -.05, z: -.45, width: 1.1, height: .32, depth: 1.05 },
    { x: .35, y: -.03, z: -1.15, width: .9, height: .28, depth: .85 },
    { x: -.2, y: .3, z: .1, width: .95, height: .42, depth: .9 },
  ],
];

export const CLOUD_SHAPES = SHAPES.length;

export function cloudGeometry(variant: number): T.BufferGeometry {
  const puff = new T.DodecahedronGeometry(1, 0);
  const parts = SHAPES[variant % SHAPES.length].map((shape) => {
    const part = puff.clone();
    part.scale(shape.width, shape.height, shape.depth);
    part.translate(shape.x, shape.y, shape.z);
    return part;
  });
  puff.dispose();
  const merged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  if (!merged) throw new Error('Could not combine cloud geometry');
  return merged;
}

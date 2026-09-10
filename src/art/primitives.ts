import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const colors = {
  plaster: 0xf3dfb5, cream: 0xffefcb, stone: 0xc9b689, paving: 0xe1d0a7,
  roof: 0xb85e41, roofLight: 0xcf7851, roofDark: 0x9c503b,
  blue: 0x426f83, blueLight: 0x68919c, dark: 0x364d48, wood: 0x846347,
  olive: 0x879557, oliveLight: 0xa2ae70, oliveDark: 0x627a50,
  grass: 0xa7ac73, earth: 0xb0a17b, gold: 0xd6ab53, linen: 0xffedc5,
};

const materials = new Map<number, T.MeshStandardMaterial>();
const geometries = new Map<string, T.BufferGeometry>();
const cylinder = new T.CylinderGeometry(1, 1, 1, 8);
const foliage = new T.DodecahedronGeometry(1, 0);
cylinder.userData.sharedPrimitive = true;
foliage.userData.sharedPrimitive = true;

export function material(color: number): T.MeshStandardMaterial {
  let result = materials.get(color);
  if (!result) {
    result = new T.MeshStandardMaterial({ color, roughness: 0.88 });
    materials.set(color, result);
  }
  return result;
}

export function mesh(parent: T.Object3D, geometry: T.BufferGeometry, color: number, x: number, y: number, z: number): T.Mesh {
  const result = new T.Mesh(geometry, material(color));
  result.position.set(x, y, z);
  result.castShadow = true;
  result.receiveShadow = true;
  parent.add(result);
  return result;
}

export function box(parent: T.Object3D, color: number, x: number, y: number, z: number, w: number, h: number, d: number, bevel = 0.045): T.Mesh {
  const key = `${w}:${h}:${d}:${bevel}`;
  let geometry = geometries.get(key);
  if (!geometry) {
    geometry = new RoundedBoxGeometry(w, h, d, 1, Math.min(bevel, w / 4, h / 4, d / 4));
    geometry.userData.sharedPrimitive = true;
    geometries.set(key, geometry);
  }
  return mesh(parent, geometry, color, x, y, z);
}

export function post(parent: T.Object3D, color: number, x: number, y: number, z: number, radius: number, height: number): T.Mesh {
  const result = mesh(parent, cylinder, color, x, y, z);
  result.scale.set(radius, height, radius);
  return result;
}

export function lump(parent: T.Object3D, color: number, x: number, y: number, z: number, sx: number, sy: number, sz: number): T.Mesh {
  const result = mesh(parent, foliage, color, x, y, z);
  result.scale.set(sx, sy, sz);
  return result;
}

export function group(parent: T.Object3D, x: number, y: number, z: number, rotation = 0): T.Group {
  const result = new T.Group();
  result.position.set(x, y, z);
  result.rotation.y = rotation;
  parent.add(result);
  return result;
}

export function bake(source: T.Group): void {
  source.updateWorldMatrix(true, true);
  const inverse = source.matrixWorld.clone().invert();
  const batches = new Map<T.Material, T.BufferGeometry[]>();
  source.traverse((child) => {
    if (!(child instanceof T.Mesh) || Array.isArray(child.material)) return;
    let geometry = child.geometry.clone();
    if (geometry.index) {
      const indexed = geometry;
      geometry = indexed.toNonIndexed();
      indexed.dispose();
    }
    for (const attribute of Object.keys(geometry.attributes)) {
      if (attribute !== 'position' && attribute !== 'normal') geometry.deleteAttribute(attribute);
    }
    geometry.applyMatrix4(new T.Matrix4().multiplyMatrices(inverse, child.matrixWorld));
    const list = batches.get(child.material) ?? [];
    list.push(geometry);
    batches.set(child.material, list);
  });
  disposeModel(source);
  source.clear();
  for (const [surface, parts] of batches) {
    const geometry = mergeGeometries(parts);
    for (const part of parts) part.dispose();
    if (!geometry) throw new Error('Could not combine model geometry');
    const result = new T.Mesh(geometry, surface);
    result.castShadow = true;
    result.receiveShadow = true;
    source.add(result);
  }
}


export function disposeModel(model: T.Object3D): void {
  model.traverse((child) => {
    if (!(child instanceof T.Mesh) || Array.isArray(child.material)) return;
    if (child.geometry.userData.sharedPrimitive) return;
    child.geometry.dispose();
  });
}

export function roof(parent: T.Object3D, width: number, depth: number, y: number, rise: number, color = colors.roof): void {
  const outline = new T.Shape();
  outline.moveTo(-width / 2, 0);
  outline.lineTo(width / 2, 0);
  outline.lineTo(0, rise);
  outline.closePath();
  const geometry = new T.ExtrudeGeometry(outline, { depth, bevelEnabled: false, steps: 1 });
  geometry.translate(0, 0, -depth / 2);
  mesh(parent, geometry, color, 0, y, 0);
  const angle = Math.atan2(rise, width / 2);
  const slope = Math.hypot(width / 2, rise);
  for (const side of [-1, 1]) {
    for (let z = -depth / 2 + .15; z < depth / 2; z += .32) {
      const tile = box(parent, colors.roofLight, side * width / 4, y + rise / 2 + .035, z, slope, .065, .07, .02);
      tile.rotation.z = -side * angle;
    }
    for (let row = 1; row <= 3; row++) {
      const fraction = row / 4;
      box(parent, color, side * width / 2 * fraction, y + rise * (1 - fraction) + .05, 0, .055, .035, depth, .01);
    }
  }
  box(parent, colors.roofLight, 0, y + rise + .04, 0, .18, .13, depth + .1);
}

export function pot(parent: T.Object3D, x: number, y: number, z: number, scale = 1, color = colors.roof): void {
  const vessel = group(parent, x, y, z);
  vessel.scale.setScalar(scale);
  lump(vessel, color, 0, .26, 0, .24, .32, .24);
  post(vessel, color, 0, .55, 0, .115, .16);
  post(vessel, colors.dark, 0, .637, 0, .075, .008);
  for (const side of [-1, 1]) {
    const handle = new T.TorusGeometry(.09, .025, 4, 8);
    mesh(vessel, handle, color, side * .2, .43, 0);
  }
}

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
  source.clear();
  for (const [surface, parts] of batches) {
    const geometry = mergeGeometries(parts);
    for (const part of parts) part.dispose();
    if (!geometry) throw new Error('Could not combine miniature geometry');
    const result = new T.Mesh(geometry, surface);
    result.castShadow = true;
    result.receiveShadow = true;
    source.add(result);
  }
}

export function releaseModelGeometries(): void {
  for (const geometry of geometries.values()) geometry.dispose();
  geometries.clear();
  cylinder.dispose();
  foliage.dispose();
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

export function tree(parent: T.Object3D, x: number, y: number, z: number, scale = 1, cypress = false): void {
  const plant = group(parent, x, y, z, x * 5 + z);
  plant.scale.setScalar(scale);
  post(plant, colors.wood, 0, .7, 0, .13, 1.4);
  if (cypress) {
    lump(plant, colors.oliveDark, 0, 1.75, 0, .53, 1.45, .53);
    lump(plant, colors.olive, .04, 2.6, 0, .34, .9, .35);
    return;
  }
  const branch = post(plant, colors.wood, .25, 1.3, 0, .09, .9);
  branch.rotation.z = -.55;
  lump(plant, colors.oliveDark, -.4, 1.65, .04, .83, .65, .72);
  lump(plant, colors.olive, .38, 1.9, .12, .91, .72, .83);
  lump(plant, colors.oliveLight, -.05, 2.17, -.27, .75, .61, .76);
}

function windowFrame(parent: T.Object3D, x: number, y: number, z: number): void {
  box(parent, colors.cream, x, y, z, .69, .79, .13);
  box(parent, colors.dark, x, y, z + .08, .43, .56, .06);
  for (const side of [-1, 1]) box(parent, colors.blue, x + side * .27, y, z + .14, .2, .6, .09);
  box(parent, colors.stone, x, y - .4, z + .13, .82, .13, .23);
}

export function house(parent: T.Object3D, x: number, y: number, z: number, variant = 0, rotation = 0): void {
  const home = group(parent, x, y, z, rotation);
  const tall = variant % 3 === 1;
  const width = 2.6;
  const depth = 2.55;
  const height = tall ? 3.25 : 1.95;
  box(home, colors.stone, 0, .13, 0, width + .25, .26, depth + .25);
  box(home, variant % 3 === 2 ? 0xe2cfa7 : colors.plaster, 0, height / 2 + .2, 0, width, height, depth, .07);
  box(home, colors.cream, 0, height + .15, 0, width + .15, .2, depth + .15);
  roof(home, width + .55, depth + .6, height + .22, .86);
  box(home, colors.cream, -.45, .82, depth / 2 + .02, .88, 1.5, .15);
  box(home, colors.wood, -.45, .78, depth / 2 + .115, .64, 1.37, .08);
  box(home, colors.gold, -.25, .77, depth / 2 + .17, .06, .06, .04);
  box(home, colors.paving, -.45, .12, depth / 2 + .32, 1.03, .22, .64);
  windowFrame(home, .73, 1.25, depth / 2 + .01);
  if (tall) {
    windowFrame(home, -.65, 2.58, depth / 2 + .01);
    windowFrame(home, .73, 2.58, depth / 2 + .01);
    box(home, colors.blue, 0, 1.94, depth / 2 + .12, width + .04, .12, .18);
  }
  for (const [sx, sz, angle] of [[width / 2 + .01, -.2, Math.PI / 2], [-width / 2 - .01, .2, -Math.PI / 2], [.2, -depth / 2 - .01, Math.PI]]) {
    const side = group(home, sx, 0, sz, angle);
    windowFrame(side, 0, 1.2, 0);
    if (tall) windowFrame(side, 0, 2.58, 0);
  }
  box(home, colors.plaster, .72, height + .6, -.62, .43, 1.1, .43);
  box(home, colors.cream, .72, height + 1.16, -.62, .54, .15, .54);
  if (variant % 2 === 0) {
    for (let stripe = 0; stripe < 5; stripe++) {
      const cloth = box(home, stripe % 2 ? colors.linen : colors.blue, -.75 + stripe * .3, 1.91, depth / 2 + .57, .3, .055, 1.1, .02);
      cloth.rotation.x = .15;
    }
    for (const px of [-.92, .63]) post(home, colors.wood, px, .95, depth / 2 + 1.07, .045, 1.9);
  }
  pot(home, 1.1, .2, depth / 2 + .45, .8);
  if (variant % 3 === 2) {
    box(home, colors.paving, -2.08, .08, .1, 1.5, .16, 2.6);
    box(home, colors.plaster, -2.8, .47, .1, .16, .94, 2.6);
    box(home, colors.plaster, -2.05, .47, -1.12, 1.6, .94, .16);
    tree(home, -2.05, .16, -.48, .62);
  }
}

export function temple(parent: T.Object3D, x: number, y: number, z: number): void {
  const shrine = group(parent, x, y, z);
  for (let step = 0; step < 3; step++) {
    box(shrine, colors.cream, 0, step * .22 + .11, 0, 7.7 - step * .45, .22, 8.3 - step * .45);
  }
  box(shrine, colors.plaster, 0, 2.1, -.5, 3.25, 2.9, 4.55);
  box(shrine, colors.dark, 0, 1.88, 1.81, 1.4, 2.35, .1);
  for (const cx of [-2.85, -1.71, -.57, .57, 1.71, 2.85]) {
    for (const cz of [-3.05, 3.05]) {
      post(shrine, colors.stone, cx, .8, cz, .36, .25);
      post(shrine, colors.cream, cx, 2.19, cz, .24, 2.65);
      post(shrine, colors.plaster, cx, 3.49, cz, .33, .2);
      box(shrine, colors.cream, cx, 3.66, cz, .72, .2, .72);
    }
  }
  for (const cx of [-2.85, 2.85]) {
    for (const cz of [-1.52, 0, 1.52]) {
      post(shrine, colors.stone, cx, .8, cz, .36, .25);
      post(shrine, colors.cream, cx, 2.19, cz, .24, 2.65);
      box(shrine, colors.cream, cx, 3.61, cz, .72, .3, .72);
    }
  }
  box(shrine, colors.cream, 0, 3.92, 0, 6.75, .37, 7.2);
  box(shrine, colors.blue, 0, 4.1, 3.63, 6.6, .21, .12);
  for (let cx = -2.9; cx < 3; cx += .58) box(shrine, colors.gold, cx, 4.1, 3.71, .12, .18, .07);
  roof(shrine, 7.25, 7.8, 4.23, 1.55);
  const pediment = new T.Shape();
  pediment.moveTo(-3.12, 0);
  pediment.lineTo(3.12, 0);
  pediment.lineTo(0, 1.28);
  pediment.closePath();
  mesh(shrine, new T.ShapeGeometry(pediment), colors.cream, 0, 4.28, 3.915);
  const medallion = post(shrine, colors.gold, 0, 4.74, 3.95, .29, .08);
  medallion.rotation.x = Math.PI / 2;
  for (const cx of [-3.45, 0, 3.45]) {
    const top = cx === 0 ? 6 : 4.52;
    lump(shrine, colors.gold, cx, top, 0, .15, .31, .15);
  }
}

export function stall(parent: T.Object3D, x: number, y: number, z: number, color: number): void {
  const shop = group(parent, x, y, z);
  box(shop, colors.wood, 0, .49, 0, 1.9, .85, 1.05);
  box(shop, colors.plaster, 0, .94, 0, 2.05, .12, 1.13);
  for (const px of [-.95, .95]) {
    for (const pz of [-.48, .6]) post(shop, colors.wood, px, 1.05, pz, .05, 2.1);
  }
  for (let stripe = 0; stripe < 7; stripe++) {
    const cloth = box(shop, stripe % 2 ? colors.linen : color, -.93 + stripe * .31, 2.04, .03, .31, .07, 1.5, .025);
    cloth.rotation.x = .12;
    box(shop, stripe % 2 ? colors.linen : color, -.93 + stripe * .31, 1.88, .78, .31, .2, .06);
  }
  for (let i = 0; i < 3; i++) {
    box(shop, colors.wood, -.6 + i * .6, 1.07, 0, .5, .16, .7);
    for (let j = 0; j < 3; j++) lump(shop, i === 1 ? colors.olive : colors.gold, -.65 + i * .6 + j % 2 * .15, 1.23, -.18 + j * .15, .12, .12, .12);
  }
}

export function boat(color: number, large = true): T.Group {
  const ship = new T.Group();
  const hull = new T.Shape();
  hull.moveTo(0, -2.2);
  hull.lineTo(.75, -1.25);
  hull.lineTo(.85, 1.2);
  hull.quadraticCurveTo(0, 2.25, -.85, 1.2);
  hull.lineTo(-.75, -1.25);
  hull.closePath();
  const hullGeometry = new T.ExtrudeGeometry(hull, { depth: .5, bevelEnabled: true, bevelSize: .14, bevelThickness: .12, bevelSegments: 1, curveSegments: 4 });
  hullGeometry.rotateX(-Math.PI / 2);
  mesh(ship, hullGeometry, colors.wood, 0, .1, 0);
  const deck = new T.ShapeGeometry(hull, 4);
  deck.rotateX(-Math.PI / 2);
  mesh(ship, deck, colors.gold, 0, .62, 0);
  for (const side of [-1, 1]) box(ship, color, side * .8, .7, -.05, .13, .25, 2.5);
  post(ship, colors.wood, 0, 2.25, .15, .075, 3.5);
  const yard = post(ship, colors.wood, 0, 3.82, .15, .055, 2.8);
  yard.rotation.z = Math.PI / 2;
  const sail = new T.BufferGeometry();
  const vertices: number[] = [];
  const sailColors: number[] = [];
  for (let stripe = 0; stripe < 7; stripe++) {
    const left = -1.3 + stripe * 2.6 / 7;
    const right = left + 2.6 / 7;
    const tint = new T.Color(stripe % 2 === 0 ? color : colors.linen);
    for (let row = 0; row < 6; row++) {
      const points = [[left, row / 6], [right, row / 6], [right, (row + 1) / 6], [left, (row + 1) / 6]];
      for (const index of [0, 1, 2, 0, 2, 3]) {
        const [px, t] = points[index];
        vertices.push(px * (1 - t * .12), 3.72 - t * 1.9, .18 + Math.sin(t * Math.PI) * .45);
        sailColors.push(tint.r, tint.g, tint.b);
      }
    }
  }
  sail.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
  sail.setAttribute('color', new T.Float32BufferAttribute(sailColors, 3));
  sail.computeVertexNormals();
  const cloth = new T.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: T.DoubleSide });
  const canvas = new T.Mesh(sail, cloth);
  canvas.castShadow = true;
  canvas.receiveShadow = true;
  box(ship, color, .31, 4.04, .15, .65, .28, .035, .01);
  for (const px of [-.4, .4]) pot(ship, px, .64, -1.1, .8);
  bake(ship);
  ship.add(canvas);
  if (!large) ship.scale.setScalar(.72);
  return ship;
}

export function citizen(color: number, cargo: boolean): T.Group {
  const person = new T.Group();
  box(person, color, 0, .48, 0, .32, .49, .25, .065);
  box(person, colors.linen, 0, .26, 0, .36, .12, .29);
  lump(person, 0xc9966b, 0, .91, .01, .19, .2, .18);
  lump(person, colors.wood, 0, 1.02, -.025, .19, .1, .18);
  for (const side of [-1, 1]) {
    box(person, 0xc9966b, side * .21, .49, .02, .1, .37, .12);
    box(person, colors.wood, side * .095, .1, .04, .115, .2, .19);
  }
  if (cargo) pot(person, .32, .39, .13, 1.05);
  bake(person);
  return person;
}

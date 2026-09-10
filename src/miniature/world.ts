import * as T from 'three';
import { animateFigure, bake, boat, box, citizen, colors, group, house, lump, mesh, post, pot, releaseModelGeometries, stall, temple, tree } from '../art';

const shoreline: [number, number][] = [
  [-22, -1], [-21, -5], [-18, -9], [-13, -12], [-8, -12.8], [-4, -11.5],
  [1, -12], [5, -10.5], [10, -10], [14, -7], [16, -3], [15, 0],
  [13, 3], [11, 5.3], [8, 6.9], [3, 7.1], [-1, 7.8], [-6, 7.3],
  [-10, 6.5], [-14, 5.6], [-17, 4.1], [-20, 2.5],
];

function outline(points: [number, number][], scale = 1): T.Shape {
  const shape = new T.Shape();
  points.forEach(([x, z], index) => {
    if (index === 0) shape.moveTo(x * scale, -z * scale);
    else shape.lineTo(x * scale, -z * scale);
  });
  shape.closePath();
  return shape;
}

function land(parent: T.Object3D, points: [number, number][], scale: number, bottom: number, height: number, color: number): void {
  const geometry = new T.ExtrudeGeometry(outline(points, scale), { depth: height, bevelEnabled: true, bevelSegments: 1, bevelSize: .12, bevelThickness: .1, curveSegments: 1 });
  geometry.rotateX(-Math.PI / 2);
  mesh(parent, geometry, color, 0, bottom, 0);
}

function flat(parent: T.Object3D, points: [number, number][], scale: number, y: number, color: number): void {
  const geometry = new T.ShapeGeometry(outline(points, scale));
  geometry.rotateX(-Math.PI / 2);
  const surface = mesh(parent, geometry, color, 0, y, 0);
  surface.castShadow = false;
}

function island(parent: T.Object3D, x: number, z: number, size: number): T.Group {
  const result = group(parent, x, 0, z);
  result.scale.set(size, 1, size);
  flat(result, shoreline, 1.2, -.065, 0x73b9b1);
  flat(result, shoreline, 1.13, -.055, 0x89c6b5);
  flat(result, shoreline, 1.065, -.045, 0xa4ccba);
  land(result, shoreline, 1.02, -.55, .82, colors.stone);
  land(result, shoreline, .99, .25, .7, colors.earth);
  land(result, shoreline, .965, .92, .12, colors.grass);
  return result;
}

function wall(parent: T.Object3D, x: number, z: number, width: number, depth: number, y = 1.15): void {
  box(parent, colors.stone, x, y + .34, z, width, .68, depth);
  box(parent, colors.cream, x, y + .7, z, width + .09, .12, depth + .09);
}

function fountain(parent: T.Object3D, x: number, y: number, z: number): void {
  const basin = group(parent, x, y, z);
  post(basin, colors.stone, 0, .13, 0, 1.05, .25);
  post(basin, colors.cream, 0, .34, 0, .9, .28);
  post(basin, 0x77b9b0, 0, .49, 0, .73, .04);
  post(basin, colors.plaster, 0, .94, 0, .19, .95);
  post(basin, colors.cream, 0, 1.4, 0, .48, .13);
  post(basin, 0x99d1c6, 0, 1.48, 0, .38, .04);
  lump(basin, colors.gold, 0, 1.7, 0, .16, .25, .16);
}

function quay(parent: T.Object3D): void {
  box(parent, colors.stone, 4.5, .47, 7.8, 16, 1.24, 2.35, .1);
  box(parent, colors.paving, 4.5, 1.12, 7.8, 16.15, .15, 2.45);
  for (let x = -3; x < 13; x += .8) box(parent, colors.cream, x, 1.24, 8.95, .74, .16, .27);
  for (const x of [.8, 9.8]) {
    box(parent, colors.stone, x, .41, 10.75, 1.55, 1.12, 5.8);
    box(parent, colors.paving, x, 1.04, 10.75, 1.65, .17, 5.85);
    for (const z of [8.9, 10.9, 12.9]) {
      for (const side of [-1, 1]) post(parent, colors.wood, x + side * .67, 1.32, z, .1, .48);
    }
  }
  for (let x = -2; x < 12; x += 1.15) {
    for (const z of [7.15, 7.94, 8.52]) box(parent, 0xe8d7b1, x, 1.208, z, 1.06, .015, .53, .008);
  }
  const crane = group(parent, 9.8, 1.2, 8.8);
  box(crane, colors.wood, 0, 1.1, 0, .22, 2.2, .22);
  box(crane, colors.wood, -.58, 2.18, 0, 1.65, .18, .2);
  const support = box(crane, colors.wood, -.35, 1.75, 0, .12, 1.1, .12);
  support.rotation.z = -.65;
  post(crane, colors.linen, -1.2, 1.55, 0, .024, 1.25);
  box(crane, colors.wood, -1.2, .84, 0, .58, .48, .58);
  for (let i = 0; i < 7; i++) pot(parent, 6.4 + i % 3 * .46, 1.2, 7.3 + Math.floor(i / 3) * .43, .9);
  for (const [x, z] of [[-2, 8.15], [-1.4, 8.15], [-2, 7.55], [11, 7.7]]) {
    box(parent, colors.wood, x, 1.49, z, .53, .6, .53);
    box(parent, colors.gold, x, 1.49, z + .28, .06, .61, .035);
  }
}

interface Walker { body: T.Group; path: T.Vector3[]; distance: number; speed: number; length: number; }
interface Ship { body: T.Group; phase: number; moving: boolean; }

export interface MiniatureWorld {
  scenery: T.Group;
  water: T.Mesh;
  update: (time: number, delta: number) => void;
}

export function createWorld(scene: T.Scene): MiniatureWorld {
  const scenery = new T.Group();
  scene.add(scenery);
  const main = island(scenery, 0, 0, 1);
  const terrace: [number, number][] = [[-16, -9], [-11, -11], [-5, -10], [-3.8, -6], [-5, -2.4], [-12, -2.1], [-16, -4]];
  land(main, terrace, 1, 1.05, 1.6, colors.stone);
  land(main, terrace, .97, 2.63, .18, colors.grass);
  box(main, colors.paving, -9.5, 2.89, -6.45, 8.8, .14, 9);
  temple(main, -9.5, 2.99, -6.45);
  for (let step = 0; step < 9; step++) {
    box(main, colors.cream, -8.8, 1.12 + (step + 1) * .1, .55 - step * .32, 2.5, (step + 1) * .2, .36);
  }
  for (const x of [-14.2, -4.7]) tree(main, x, 2.85, -6.8, 1.05, true);
  wall(main, -14.05, -3, 2.1, .3, 2.85);
  wall(main, -5.4, -3, 1.7, .3, 2.85);
  box(main, colors.paving, -.9, 1.125, 3.7, 26, .07, 2.4);
  box(main, colors.paving, .7, 1.126, -2.5, 2.15, .07, 14.6);
  box(main, colors.paving, 5.1, 1.127, 5.95, 10, .07, 3.1);
  box(main, colors.paving, -3.4, 1.126, -.65, 6, .07, 3.5);
  for (let i = 0; i < 35; i++) {
    const x = -13 + i * .72;
    box(main, i % 3 === 0 ? colors.cream : 0xd8c8a0, x, 1.17, 3.1 + i % 3 * .59, .6, .025, .47, .02);
  }
  const homes = [
    [-3.15, .25, 1, 0], [3.5, .25, 0, 0], [7.35, .1, 1, 0],
    [10.5, -3.6, 2, .08], [5.75, -4.25, 2, 0], [1.8, -7.7, 0, 0],
    [-2.3, -5.8, 1, Math.PI / 2], [10.2, -7.25, 0, .08],
    [-11.4, 1.25, 0, 0], [-15.2, .2, 2, .15], [-5.1, 5.9, 0, Math.PI],
  ];
  for (const [x, z, variant, rotation] of homes) house(main, x, 1.16, z, variant, rotation);
  house(main, 11.5, 1.16, 3.7, 1, Math.PI / 2);
  box(main, colors.blue, 11.65, 2.85, 5.1, 2.1, .22, .12);
  stall(main, 3.3, 1.18, 5.75, colors.blue);
  stall(main, 6.05, 1.18, 5.75, colors.roof);
  fountain(main, -4.6, 1.17, 2.1);
  tree(main, -6.8, 1.15, .9, 1.05);
  tree(main, 3.1, 1.15, -7.7, .9, true);
  tree(main, 13.4, 1.15, -.5, 1, true);
  tree(main, 7.5, 1.15, -7.8, .85, true);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const x = -18.4 + col * 1.85 + row * .35;
      const z = -5.5 + row * 1.95;
      post(main, colors.earth, x, 1.14, z, .68, .035);
      tree(main, x, 1.16, z, .7 + (row + col) % 3 * .09);
    }
  }
  wall(main, -17, 1.35, 4.3, .2);
  for (const [x, z, scale] of [[-18, 2.2, .7], [-20, -1, .55], [13, -5, .8], [7, -9, .55], [-2, -10, .7], [-11.5, 5.5, .8]]) {
    lump(main, colors.oliveDark, x, 1.44, z, scale, .37, scale * .7);
  }
  for (let i = 0; i < shoreline.length; i += 2) {
    const [x, z] = shoreline[i];
    lump(main, i % 4 === 0 ? colors.cream : colors.stone, x * .99, .45, z * .99, .65, .5, .48);
  }
  quay(main);
  const distant = island(scenery, 8, -43, 1.13);
  const mountain: [number, number][] = [[-13, -5], [-8, -9], [-3, -9], [4, -7], [9, -3], [7, 2], [0, 4], [-8, 1]];
  land(distant, mountain, 1, 1.06, 1.5, colors.stone);
  land(distant, mountain, .93, 2.54, .15, colors.grass);
  land(distant, mountain, .58, 2.68, 1.7, colors.stone);
  land(distant, mountain, .54, 4.32, .16, colors.grass);
  for (const [x, z] of [[-8, 4], [-4, 4.9], [0, 5.6]]) house(distant, x, 1.14, z, 0);
  for (const [x, z, y] of [[-9, -3, 2.81], [-10, -4, 2.81], [-8, -6, 2.81], [5, -3, 2.81], [5, 0, 2.81], [-4, -2, 4.59], [0, -2, 4.59], [-1, 0, 4.59]]) {
    tree(distant, x, y, z, .8, x % 2 === 0);
  }
  for (let row = 0; row < 6; row++) {
    box(distant, colors.earth, -14.5, 1.16, -1.8 + row * .57, 5.5, .08, .4);
    box(distant, row % 2 ? colors.gold : 0xc9b572, -14.5, 1.29, -1.8 + row * .57, 5.35, .18, .28);
  }
  for (const [x, z] of [[-17, -3.5], [-15, -5], [-13, -6.5], [-18, -1.5], [-12, 3.5]]) tree(distant, x, 1.15, z, .8);
  box(distant, colors.paving, -5.2, 1.17, 6.65, 11, .08, 1.2);
  box(distant, colors.stone, -5, .48, 8.5, 1.3, 1.15, 3.7);
  box(distant, colors.paving, -5, 1.12, 8.5, 1.4, .14, 3.8);
  for (const x of [-5.5, -4.5]) post(distant, colors.wood, x, 1.34, 9.7, .08, .45);
  const rock = island(scenery, 31, -15, .22);
  rock.scale.y = 1.25;
  const lighthouse = group(scenery, 31, 1.5, -15);
  post(lighthouse, colors.cream, 0, 1.7, 0, .8, 3.4);
  post(lighthouse, colors.blue, 0, 2.6, 0, .81, .35);
  post(lighthouse, colors.cream, 0, 3.5, 0, 1.03, .25);
  for (const x of [-.52, .52]) {
    for (const z of [-.52, .52]) post(lighthouse, colors.wood, x, 4, z, .055, .85);
  }
  lump(lighthouse, colors.gold, 0, 3.99, 0, .28, .44, .28);
  post(lighthouse, colors.roof, 0, 4.5, 0, .91, .2);
  bake(scenery);

  const waterTime = { value: 0 };
  const waterMaterial = new T.MeshStandardMaterial({ color: 0x559fa5, roughness: .48, metalness: .12 });
  waterMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.studyTime = waterTime;
    shader.vertexShader = `varying vec3 seaPosition;\n${shader.vertexShader}`.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nseaPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = `uniform float studyTime;\nvarying vec3 seaPosition;\n${shader.fragmentShader}`.replace('#include <color_fragment>', `#include <color_fragment>
      float swell = sin(seaPosition.x * 1.4 + seaPosition.z * .8 + studyTime * .5);
      float crossWave = sin(seaPosition.z * 3.4 - seaPosition.x * .35 + studyTime * .7);
      float ripple = smoothstep(.91, 1.0, swell) * smoothstep(.6, 1.0, crossWave);
      diffuseColor.rgb += ripple * .065;
      diffuseColor.rgb += sin(seaPosition.x * .13 + seaPosition.z * .2) * .018;
    `);
  };
  const water = new T.Mesh(new T.PlaneGeometry(2000, 2000), waterMaterial);
  water.rotation.x = -Math.PI / 2;
  water.position.y = -.08;
  water.receiveShadow = true;
  scene.add(water);

  const ships: Ship[] = [];
  for (const [x, z, color, angle, large] of [[3.05, 11.65, colors.blue, .06, 1], [7.55, 10.7, colors.roof, Math.PI, 0], [22, 4, colors.linen, -.8, 1]]) {
    const body = boat(color, Boolean(large));
    body.position.set(x, 0, z);
    body.rotation.y = angle;
    scene.add(body);
    ships.push({ body, phase: x, moving: x === 22 });
  }
  const walkers: Walker[] = [];
  const routes = [
    [[-12, 3.7], [.6, 3.7], [8.6, 3.7], [8.6, 7.9], [-1.4, 7.9], [.6, 3.7]],
    [[.7, 3.8], [.7, -4.8], [.7, -8.6], [.7, -4.8]],
    [[-6.5, 3.8], [8.7, 3.8], [8.7, 7.9], [1.1, 7.9], [1.1, 12.7], [1.1, 7.9], [8.7, 7.9], [8.7, 3.8]],
  ];
  for (let i = 0; i < 16; i++) {
    const body = citizen([colors.blue, colors.linen, colors.roof, colors.oliveDark][i % 4], i % 3 === 0);
    scene.add(body);
    const path = routes[i % routes.length].map(([x, z]) => new T.Vector3(x, 1.23, z));
    const length = path.reduce((sum, point, index) => sum + point.distanceTo(path[(index + 1) % path.length]), 0);
    walkers.push({ body, path, length, distance: i / 16 * length, speed: .43 + i % 3 * .06 });
  }
  const birds: T.Group[] = [];
  for (let i = 0; i < 5; i++) {
    const bird = new T.Group();
    box(bird, colors.linen, 0, 0, 0, .12, .12, .32);
    for (const side of [-1, 1]) {
      const wing = box(bird, colors.linen, side * .25, .04, 0, .5, .065, .17, .025);
      wing.rotation.z = side * .2;
    }
    bake(bird);
    scene.add(bird);
    birds.push(bird);
  }
  releaseModelGeometries();

  function update(time: number, delta: number): void {
    waterTime.value = time;
    for (const ship of ships) {
      ship.body.position.y = Math.sin(time * 1.4 + ship.phase) * .045;
      ship.body.rotation.z = Math.sin(time * 1.1 + ship.phase) * .018;
      if (ship.moving) {
        const angle = time * .023 + .7;
        ship.body.position.x = 22 + Math.cos(angle) * 5;
        ship.body.position.z = -9 + Math.sin(angle) * 15;
        ship.body.rotation.y = Math.atan2(-5 * Math.sin(angle), 15 * Math.cos(angle));
      }
    }
    for (const walker of walkers) {
      walker.distance = (walker.distance + delta * walker.speed) % walker.length;
      let remaining = walker.distance;
      for (let i = 0; i < walker.path.length; i++) {
        const start = walker.path[i];
        const end = walker.path[(i + 1) % walker.path.length];
        const length = start.distanceTo(end);
        if (remaining <= length) {
          walker.body.position.lerpVectors(start, end, remaining / length);
          animateFigure(walker.body, time * 4.5 + walker.speed * 20, .5);
          walker.body.rotation.y = Math.atan2(end.x - start.x, end.z - start.z);
          break;
        }
        remaining -= length;
      }
    }
    birds.forEach((bird, index) => {
      const angle = time * .15 + index * 1.2;
      bird.position.set(7 + Math.cos(angle) * (6 + index), 9 + Math.sin(angle * 2) * .4 + index * .6, 7 + Math.sin(angle) * 5);
      bird.rotation.set(Math.sin(angle) * .1, -angle, Math.cos(angle) * .18);
    });
  }
  update(0, 0);
  return { scenery, water, update };
}

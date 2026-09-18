import * as T from 'three';
import { bake, box, colors, mesh, post, pot } from './primitives';

export function skiff(color: number): T.Group {
  const hull = new T.Group();
  const outline = new T.Shape();
  outline.moveTo(0, -.95);
  outline.lineTo(.42, -.45);
  outline.lineTo(.46, .5);
  outline.quadraticCurveTo(0, 1.05, -.46, .5);
  outline.lineTo(-.42, -.45);
  outline.closePath();
  const shell = new T.ExtrudeGeometry(outline, { depth: .42, bevelEnabled: true, bevelSize: .08, bevelThickness: .07, bevelSegments: 1, curveSegments: 3 });
  shell.rotateX(-Math.PI / 2);
  mesh(hull, shell, colors.wood, 0, -.08, 0);
  const deck = new T.ShapeGeometry(outline, 3);
  deck.rotateX(-Math.PI / 2);
  mesh(hull, deck, colors.cream, 0, .2, 0);
  for (const side of [-1, 1]) box(hull, color, side * .44, .26, 0, .08, .16, 1.3, .03);
  box(hull, colors.wood, 0, .28, -.5, .8, .07, .22, .02);
  bake(hull);
  return hull;
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

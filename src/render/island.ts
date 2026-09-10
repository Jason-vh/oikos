import * as T from 'three';
import { bake, boat, box, colors, group, lump, mesh, post, temple, tree } from '../art';
import { CELL_SIZE, COAST, ENTRY, GROUND_Y, HILL, MAP_DEPTH, MAP_WIDTH, terrainAt, worldPosition } from '../sim/island';

function shape(points: [number, number][], scale = 1): T.Shape {
  const result = new T.Shape();
  points.forEach(([x, z], index) => {
    const position = worldPosition(x, z);
    if (index === 0) result.moveTo(position.x * scale, -position.z * scale);
    else result.lineTo(position.x * scale, -position.z * scale);
  });
  result.closePath();
  return result;
}

function land(parent: T.Group, points: [number, number][], scale: number, bottom: number, height: number, color: number): void {
  const geometry = new T.ExtrudeGeometry(shape(points, scale), { depth: height, bevelEnabled: true, bevelSegments: 1, bevelSize: .1, bevelThickness: .07, curveSegments: 1 });
  geometry.rotateX(-Math.PI / 2);
  mesh(parent, geometry, color, 0, bottom, 0);
}

export class IslandScenery {
  readonly root = new T.Group();
  readonly grid = new T.Group();
  private readonly waterTime = { value: 0 };
  private readonly ship = boat(colors.blue, false);
  private readonly trees = new Map<number, T.Group>();

  constructor(scene: T.Scene) {
    const coast = new T.Group();
    for (const [scale, y, color] of [[1.13, -.065, 0x73b9b1], [1.08, -.055, 0x89c6b5], [1.035, -.045, 0xa4ccba]]) {
      const geometry = new T.ShapeGeometry(shape(COAST, scale));
      geometry.rotateX(-Math.PI / 2);
      mesh(coast, geometry, color, 0, y, 0).castShadow = false;
    }
    land(coast, COAST, 1, -.55, .85, colors.stone);
    land(coast, COAST, .996, .3, .65, colors.earth);
    land(coast, COAST, .993, .95, .13, colors.grass);
    land(coast, HILL, 1, 1.05, 1.65, colors.stone);
    land(coast, HILL, 1, 2.7, .15, colors.grass);
    const sanctuaryPosition = worldPosition(13, 7.7);
    const sanctuary = group(coast, sanctuaryPosition.x, 2.95, sanctuaryPosition.z);
    sanctuary.scale.setScalar(.7);
    temple(sanctuary, 0, 0, 0);
    const entrance = worldPosition(ENTRY.x + .5, ENTRY.z + .5);
    box(coast, colors.stone, entrance.x, .47, entrance.z + 3, 7, 1.24, 2.3);
    box(coast, colors.paving, entrance.x, 1.12, entrance.z + 3, 7.1, .15, 2.4);
    box(coast, colors.stone, entrance.x + 2.5, .41, entrance.z + 5, 1.4, 1.12, 5.8);
    box(coast, colors.paving, entrance.x + 2.5, 1.04, entrance.z + 5, 1.5, .17, 5.85);
    box(coast, colors.paving, entrance.x, 1.12, entrance.z + 1.3, 1.4, .15, 3);
    for (const z of [3.5, 5.5, 7.3]) {
      for (const x of [1.9, 3.1]) post(coast, colors.wood, entrance.x + x, 1.32, entrance.z + z, .09, .46);
    }
    post(coast, colors.wood, entrance.x - .85, 2.2, entrance.z + .2, .055, 2.15);
    box(coast, colors.blue, entrance.x - .5, 3.08, entrance.z + .2, .7, .4, .035);
    this.ship.position.set(entrance.x + .5, 0, entrance.z + 5.5);
    for (let i = 0; i < COAST.length; i += 2) {
      const point = worldPosition(...COAST[i]);
      lump(coast, colors.stone, point.x, .42, point.z, .65, .43, .6);
    }
    const gridPoints: number[] = [];
    for (let z = 0; z < MAP_DEPTH; z++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        const terrain = terrainAt(x, z);
        if (terrain === 'water' || terrain === 'hill') continue;
        const point = worldPosition(x, z);
        if (terrain === 'fertile') {
          box(coast, (x + z) % 4 === 0 ? 0xb6b278 : 0xb2af74, point.x + CELL_SIZE / 2, 1.09, point.z + CELL_SIZE / 2, CELL_SIZE, .04, CELL_SIZE, 0);
        }
        gridPoints.push(point.x, 1.175, point.z, point.x + CELL_SIZE, 1.175, point.z);
        gridPoints.push(point.x, 1.175, point.z, point.x, 1.175, point.z + CELL_SIZE);
        if (terrain === 'grass' && (x * 7 + z * 13) % 37 === 0 && z < 19 && (x < 10 || z < 12)) {
          const plant = new T.Group();
          tree(plant, point.x + CELL_SIZE / 2, GROUND_Y, point.z + CELL_SIZE / 2, .72, x % 3 === 0);
          bake(plant);
          this.trees.set(z * MAP_WIDTH + x, plant);
          this.root.add(plant);
        }
      }
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(gridPoints, 3));
    this.grid.add(new T.LineSegments(geometry, new T.LineBasicMaterial({ color: 0xfff1c9, transparent: true, opacity: .34, depthWrite: false })));
    this.grid.visible = false;
    bake(coast);
    this.root.add(coast, this.grid, this.ship);
    scene.add(this.root);
    const waterMaterial = new T.MeshStandardMaterial({ color: 0x559fa5, roughness: .48, metalness: .12 });
    waterMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.seaTime = this.waterTime;
      shader.vertexShader = `varying vec3 seaPosition;\n${shader.vertexShader}`.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nseaPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = `uniform float seaTime;\nvarying vec3 seaPosition;\n${shader.fragmentShader}`.replace('#include <color_fragment>', `#include <color_fragment>
        float swell = sin(seaPosition.x * 1.4 + seaPosition.z * .8 + seaTime * .5);
        float crossWave = sin(seaPosition.z * 3.4 - seaPosition.x * .35 + seaTime * .7);
        float ripple = smoothstep(.91, 1.0, swell) * smoothstep(.6, 1.0, crossWave);
        diffuseColor.rgb += ripple * .065 + sin(seaPosition.x * .13 + seaPosition.z * .2) * .018;
      `);
    };
    const water = new T.Mesh(new T.PlaneGeometry(2000, 2000), waterMaterial);
    water.rotation.x = -Math.PI / 2;
    water.position.y = -.08;
    water.receiveShadow = true;
    this.root.add(water);
  }

  clearTrees(occupied: Set<number>): void {
    for (const [tile, plant] of this.trees) plant.visible = !occupied.has(tile);
  }

  update(time: number): void {
    this.waterTime.value = time;
    this.ship.position.y = Math.sin(time * 1.4) * .045;
    this.ship.rotation.z = Math.sin(time * 1.1) * .018;
  }
}

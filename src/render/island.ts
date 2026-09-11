import * as T from 'three';
import { bake, boat, box, colors, lump, post, tree } from '../art';
import { CELL_SIZE, buildable, groundHeight, levelOn, terrainOn, worldPositionOn, type IslandMap } from '../sim/island';
import { fractal } from '../sim/island';
import { buildTerrain } from './terrain';
import { CoastalFoam } from '../art/foam';
import { cliffOutcrop } from '../art/cliffs';

function seeded(map: IslandMap, x: number, z: number, salt: number): number {
  return fractal(x * 3.7 + salt, z * 2.9 - salt, map.seed + salt, 1, 1);
}

export class IslandScenery {
  readonly root = new T.Group();
  readonly grid = new T.Group();
  readonly foam: CoastalFoam;
  private readonly waterTime = { value: 0 };
  private readonly ship = boat(colors.blue, false);
  private readonly decor = new Map<number, T.Group>();
  private readonly falling = new Map<number, number>();

  constructor(scene: T.Scene, readonly map: IslandMap) {
    this.foam = new CoastalFoam(map);
    this.root.add(buildTerrain(map), this.foam.mesh);
    const props = new T.Group();
    const gridPoints: number[] = [];
    for (let z = 0; z < map.depth; z++) {
      for (let x = 0; x < map.width; x++) {
        const terrain = terrainOn(map, x, z);
        if (terrain === 'water') continue;
        const origin = worldPositionOn(map, x, z);
        const y = groundHeight(map, x, z);
        const cx = origin.x + CELL_SIZE / 2;
        const cz = origin.z + CELL_SIZE / 2;
        if (buildable(terrain)) {
          gridPoints.push(origin.x, y + .025, origin.z, origin.x + CELL_SIZE, y + .025, origin.z);
          gridPoints.push(origin.x, y + .025, origin.z, origin.x, y + .025, origin.z + CELL_SIZE);
        }
        const jitterX = (seeded(map, x, z, 1) - .5) * .5;
        const jitterZ = (seeded(map, x, z, 2) - .5) * .5;
        if (terrain === 'forest') {
          const plant = new T.Group();
          const cypress = seeded(map, x, z, 3) > .7;
          tree(plant, cx + jitterX, y, cz + jitterZ, .62 + seeded(map, x, z, 4) * .3, cypress);
          if (seeded(map, x, z, 5) > .55) tree(plant, cx - jitterX * 1.4, y, cz - jitterZ * 1.2, .5 + seeded(map, x, z, 6) * .2, !cypress && seeded(map, x, z, 7) > .6);
          bake(plant);
          this.decor.set(z * map.width + x, plant);
          this.root.add(plant);
        } else if (terrain === 'scrub') {
          if (seeded(map, x, z, 8) > .35) {
            const bush = new T.Group();
            lump(bush, seeded(map, x, z, 9) > .5 ? colors.oliveDark : colors.olive, cx + jitterX, y + .16, cz + jitterZ, .32 + seeded(map, x, z, 10) * .2, .22, .3 + seeded(map, x, z, 11) * .2);
            if (seeded(map, x, z, 12) > .6) lump(bush, colors.oliveLight, cx - jitterX, y + .12, cz - jitterZ, .22, .16, .2);
            bake(bush);
            this.decor.set(z * map.width + x, bush);
            this.root.add(bush);
          }
        } else if (terrain === 'rock') {
          if (seeded(map, x, z, 13) > .45) {
            lump(props, seeded(map, x, z, 14) > .5 ? colors.stone : colors.cream, cx + jitterX, y + .18, cz + jitterZ, .3 + seeded(map, x, z, 15) * .3, .22 + seeded(map, x, z, 16) * .2, .28 + seeded(map, x, z, 17) * .3);
          }
        } else if (terrain === 'cliff') {
          const outcrops = fractal(x, z, map.seed + 967, 2, 4);
          const rocks = new T.Group();
          if (outcrops > .59 && seeded(map, x, z, 20) > .45) {
            const outcrop = cliffOutcrop();
            outcrop.position.set(cx, y, cz);
            outcrop.rotation.y = seeded(map, x, z, 21) * Math.PI * 2;
            outcrop.scale.setScalar(.75 + seeded(map, x, z, 22) * .25);
            rocks.add(outcrop);
          }
          if (seeded(map, x, z, 25) > .8) lump(rocks, colors.oliveDark, cx - jitterX, y + .1, cz - jitterZ, .2, .12, .18);
          if (rocks.children.length) {
            bake(rocks);
            this.decor.set(z * map.width + x, rocks);
            this.root.add(rocks);
          }
        } else if (terrain === 'fertile') {
          box(props, (x + z) % 2 === 0 ? 0xb9b47a : 0xb2ad74, cx, y - .03, cz, CELL_SIZE, .04, CELL_SIZE, 0);
        } else if (terrain === 'grass' && levelOn(map, x, z) >= 1 && seeded(map, x, z, 18) > .93) {
          const plant = new T.Group();
          tree(plant, cx + jitterX, y, cz + jitterZ, .6, seeded(map, x, z, 19) > .5);
          bake(plant);
          this.decor.set(z * map.width + x, plant);
          this.root.add(plant);
        }
      }
    }
    const entrance = worldPositionOn(map, map.entry.x + .5, map.entry.z + .5);
    box(props, colors.stone, entrance.x, .47, entrance.z + 3, 7, 1.24, 2.3);
    box(props, colors.paving, entrance.x, 1.12, entrance.z + 3, 7.1, .15, 2.4);
    box(props, colors.stone, entrance.x + 2.5, .41, entrance.z + 5, 1.4, 1.12, 5.8);
    box(props, colors.paving, entrance.x + 2.5, 1.04, entrance.z + 5, 1.5, .17, 5.85);
    box(props, colors.paving, entrance.x, 1.12, entrance.z + 1.3, 1.4, .15, 3);
    for (const z of [3.5, 5.5, 7.3]) {
      for (const x of [1.9, 3.1]) post(props, colors.wood, entrance.x + x, 1.32, entrance.z + z, .09, .46);
    }
    post(props, colors.wood, entrance.x - .85, 2.2, entrance.z + .2, .055, 2.15);
    box(props, colors.blue, entrance.x - .5, 3.08, entrance.z + .2, .7, .4, .035);
    this.ship.position.set(entrance.x + .5, 0, entrance.z + 5.5);
    bake(props);
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(gridPoints, 3));
    this.grid.add(new T.LineSegments(geometry, new T.LineBasicMaterial({ color: 0xfff1c9, transparent: true, opacity: .34, depthWrite: false })));
    this.grid.visible = false;
    this.root.add(props, this.grid, this.ship);
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

  clearDecor(occupied: Set<number>, felled: Set<number>): void {
    for (const [tile, plant] of this.decor) {
      if (felled.has(tile)) {
        if (!this.falling.has(tile) && plant.visible && plant.userData.settled !== true) this.falling.set(tile, 0);
        continue;
      }
      plant.visible = !occupied.has(tile);
      plant.rotation.set(0, 0, 0);
      plant.userData.settled = false;
      this.falling.delete(tile);
    }
  }

  animateFalls(delta: number): boolean {
    let active = false;
    for (const [tile, elapsed] of this.falling) {
      const plant = this.decor.get(tile);
      if (!plant) { this.falling.delete(tile); continue; }
      const next = elapsed + delta;
      const t = Math.min(1, next / 2.2);
      const eased = t * t * (3 - 2 * t);
      const lean = eased * Math.PI * .48;
      const seed = (tile * 7919) % 360;
      plant.rotation.set(Math.cos(seed) * lean, 0, Math.sin(seed) * lean);
      plant.position.y = t > .85 ? -(t - .85) * 4 : 0;
      if (t >= 1) {
        plant.visible = false;
        plant.position.y = 0;
        plant.userData.settled = true;
        this.falling.delete(tile);
      } else {
        this.falling.set(tile, next);
        active = true;
      }
    }
    return active;
  }

  update(time: number): void {
    this.waterTime.value = time;
    this.foam.update(time);
    this.ship.position.y = Math.sin(time * 1.4) * .045;
    this.ship.rotation.z = Math.sin(time * 1.1) * .018;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.root.traverse((child) => {
      if (child instanceof T.Mesh || child instanceof T.LineSegments) child.geometry.dispose();
    });
  }
}

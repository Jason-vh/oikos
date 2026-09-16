import * as T from 'three';
import { CELL_SIZE, terrainOn, worldPositionOn, type IslandMap } from '../sim/island';

export const SHALLOW = 0x559fa5;
export const DEEP = 0x3a7e93;
const SHALLOW_CELLS = 46;
const DIAGONAL = Math.SQRT2;

function landDistance(map: IslandMap): Float32Array {
  const distance = new Float32Array(map.width * map.depth);
  const limit = SHALLOW_CELLS + 1;
  for (let z = 0; z < map.depth; z++) {
    for (let x = 0; x < map.width; x++) {
      distance[z * map.width + x] = terrainOn(map, x, z) === 'water' ? limit : 0;
    }
  }
  const step = (index: number, from: number, cost: number): void => {
    const candidate = distance[from] + cost;
    if (candidate < distance[index]) distance[index] = candidate;
  };
  for (let z = 0; z < map.depth; z++) {
    for (let x = 0; x < map.width; x++) {
      const index = z * map.width + x;
      if (x > 0) step(index, index - 1, 1);
      if (z > 0) step(index, index - map.width, 1);
      if (x > 0 && z > 0) step(index, index - map.width - 1, DIAGONAL);
      if (x < map.width - 1 && z > 0) step(index, index - map.width + 1, DIAGONAL);
    }
  }
  for (let z = map.depth - 1; z >= 0; z--) {
    for (let x = map.width - 1; x >= 0; x--) {
      const index = z * map.width + x;
      if (x < map.width - 1) step(index, index + 1, 1);
      if (z < map.depth - 1) step(index, index + map.width, 1);
      if (x < map.width - 1 && z < map.depth - 1) step(index, index + map.width + 1, DIAGONAL);
      if (x > 0 && z < map.depth - 1) step(index, index + map.width - 1, DIAGONAL);
    }
  }
  return distance;
}

export function shoreTexture(map: IslandMap): T.DataTexture {
  const distance = landDistance(map);
  const data = new Uint8Array(distance.length);
  for (let index = 0; index < distance.length; index++) {
    data[index] = Math.round(Math.max(0, 1 - distance[index] / SHALLOW_CELLS) * 255);
  }
  const texture = new T.DataTexture(data, map.width, map.depth, T.RedFormat);
  texture.minFilter = T.LinearFilter;
  texture.magFilter = T.LinearFilter;
  texture.wrapS = T.ClampToEdgeWrapping;
  texture.wrapT = T.ClampToEdgeWrapping;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

const SEA_HEAD = `
uniform float seaTime;
uniform float seaDetail;
uniform sampler2D seaShore;
uniform vec2 seaOrigin;
uniform vec2 seaExtent;
uniform float seaReach;
uniform vec3 seaDeep;
varying vec3 seaPosition;

vec2 seaHash(vec2 cell) {
  float seed = dot(cell, vec2(127.1, 311.7));
  return fract(sin(vec2(seed, seed + 74.7)) * 43758.5453);
}

float seaCrests(vec2 place, float moment) {
  vec2 grain = floor(place);
  float brightest = 0.0;
  for (int down = -1; down <= 1; down++) {
    for (int across = -1; across <= 1; across++) {
      vec2 cell = grain + vec2(float(across), float(down));
      vec2 where = seaHash(cell);
      vec2 when = seaHash(cell + 41.7);
      if (when.x > .46) continue;
      vec2 offset = (place - cell - .15 - where * .7) * vec2(1.0, 2.7);
      vec2 turned = vec2(offset.x * .94 - offset.y * .34, offset.x * .34 + offset.y * .94);
      float age = fract(moment * .09 + when.y);
      float life = smoothstep(0.0, .18, age) * (1.0 - smoothstep(.6, .9, age));
      float mark = smoothstep(.42, .16, length(turned)) * life;
      brightest = max(brightest, mark * (.6 + where.y * .4));
    }
  }
  return brightest;
}
`;

const SEA_BODY = `
  vec2 shoreUv = (seaPosition.xz - seaOrigin) / seaExtent;
  vec2 beyondMap = max(-shoreUv, shoreUv - vec2(1.0)) * seaExtent;
  float beyond = length(max(beyondMap, vec2(0.0))) / seaReach;
  float shallow = texture2D(seaShore, clamp(shoreUv, 0.0, 1.0)).r * max(0.0, 1.0 - beyond);
  diffuseColor.rgb = mix(seaDeep, diffuseColor.rgb, shallow * shallow);
  float swell = sin(seaPosition.x * .13 + seaPosition.z * .2 + seaTime * .06) * .016;
  float crests = seaCrests(seaPosition.xz / 3.4 + vec2(seaTime * .012, 0.0), seaTime);
  diffuseColor.rgb += (crests * .075 + swell) * seaDetail;
`;

function seaMaterial(map: IslandMap, shore: T.DataTexture, time: { value: number }, detail: { value: number }): T.MeshStandardMaterial {
  const origin = worldPositionOn(map, 0, 0);
  const material = new T.MeshStandardMaterial({ color: SHALLOW, roughness: .48, metalness: .12 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.seaTime = time;
    shader.uniforms.seaDetail = detail;
    shader.uniforms.seaShore = { value: shore };
    shader.uniforms.seaOrigin = { value: new T.Vector2(origin.x, origin.z) };
    shader.uniforms.seaExtent = { value: new T.Vector2(map.width * CELL_SIZE, map.depth * CELL_SIZE) };
    shader.uniforms.seaReach = { value: SHALLOW_CELLS * CELL_SIZE };
    shader.uniforms.seaDeep = { value: new T.Color(DEEP) };
    shader.vertexShader = `varying vec3 seaPosition;\n${shader.vertexShader}`.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nseaPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = `${SEA_HEAD}\n${shader.fragmentShader}`.replace('#include <color_fragment>', `#include <color_fragment>\n${SEA_BODY}`);
  };
  return material;
}

export class Sea {
  readonly mesh: T.Mesh;
  private readonly shore: T.DataTexture;

  constructor(map: IslandMap, span: number, time: { value: number }, detail: { value: number }) {
    this.shore = shoreTexture(map);
    this.mesh = new T.Mesh(new T.PlaneGeometry(span, span), seaMaterial(map, this.shore, time, detail));
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = -.08;
    this.mesh.receiveShadow = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as T.Material).dispose();
    this.shore.dispose();
  }
}

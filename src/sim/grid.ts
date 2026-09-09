export const TERRAIN_GRASS = 0;
export const TERRAIN_MEADOW = 1;
export const TERRAIN_WATER = 2;
export const TERRAIN_ROCK = 3;
export const TERRAIN_SAND = 4;

export const NO_BUILDING = -1;
export const MAX_HEIGHT = 4;

export class Grid {
  readonly size: number;
  readonly terrain: Uint8Array;
  readonly height: Uint8Array;
  readonly road: Uint8Array;
  readonly roadblock: Uint8Array;
  readonly wall: Uint8Array;
  readonly occupant: Int32Array;
  readonly appeal: Int16Array;
  readonly decor: Uint8Array;

  constructor(size: number) {
    this.size = size;
    const cells = size * size;
    this.terrain = new Uint8Array(cells);
    this.height = new Uint8Array(cells);
    this.road = new Uint8Array(cells);
    this.roadblock = new Uint8Array(cells);
    this.wall = new Uint8Array(cells);
    this.occupant = new Int32Array(cells).fill(NO_BUILDING);
    this.appeal = new Int16Array(cells);
    this.decor = new Uint8Array(cells);
  }

  heightAt(x: number, y: number): number {
    if (!this.contains(x, y)) return 0;
    return this.height[this.index(x, y)];
  }

  isFlat(x: number, y: number, size: number): boolean {
    const reference = this.heightAt(x, y);
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        if (this.heightAt(x + dx, y + dy) !== reference) return false;
      }
    }
    return true;
  }

  terrainAt(x: number, y: number): number {
    if (!this.contains(x, y)) return -1;
    return this.terrain[this.index(x, y)];
  }

  index(x: number, y: number): number {
    return y * this.size + x;
  }

  tileX(index: number): number {
    return index % this.size;
  }

  tileY(index: number): number {
    return Math.floor(index / this.size);
  }

  contains(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.size && y < this.size;
  }

  isLand(x: number, y: number): boolean {
    if (!this.contains(x, y)) return false;
    const terrain = this.terrain[this.index(x, y)];
    return terrain !== TERRAIN_WATER && terrain !== TERRAIN_ROCK;
  }

  isFree(x: number, y: number): boolean {
    if (!this.isLand(x, y)) return false;
    const i = this.index(x, y);
    return this.occupant[i] === NO_BUILDING && this.road[i] === 0 && this.wall[i] === 0;
  }

  isRoad(index: number): boolean {
    return this.road[index] === 1;
  }

  isRoadblock(index: number): boolean {
    return this.roadblock[index] === 1;
  }

  hasNear(resource: 'woods' | 'rock' | 'water', x: number, y: number, size: number, range: number): boolean {
    for (let dy = -range; dy < size + range; dy++) {
      for (let dx = -range; dx < size + range; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (!this.contains(nx, ny)) continue;
        const index = this.index(nx, ny);
        if (resource === 'rock' && this.terrain[index] === TERRAIN_ROCK) return true;
        if (resource === 'woods' && this.decor[index] !== 0 && this.terrain[index] !== TERRAIN_ROCK) return true;
        if (resource === 'water' && this.terrain[index] === TERRAIN_WATER) return true;
      }
    }
    return false;
  }

  isWall(index: number): boolean {
    return this.wall[index] === 1;
  }

  *footprint(x: number, y: number, size: number): Generator<number> {
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        yield this.index(x + dx, y + dy);
      }
    }
  }

  *perimeter(x: number, y: number, size: number): Generator<number> {
    for (let d = 0; d < size; d++) {
      const ring = [
        [x + d, y - 1],
        [x + d, y + size],
        [x - 1, y + d],
        [x + size, y + d],
      ];
      for (const [nx, ny] of ring) {
        if (this.contains(nx, ny)) yield this.index(nx, ny);
      }
    }
  }

  neighbours(index: number): number[] {
    const x = this.tileX(index);
    const y = this.tileY(index);
    const result: number[] = [];
    if (x > 0) result.push(index - 1);
    if (x < this.size - 1) result.push(index + 1);
    if (y > 0) result.push(index - this.size);
    if (y < this.size - 1) result.push(index + this.size);
    return result;
  }
}

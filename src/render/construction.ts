import * as T from 'three';
import { colors } from '../art';
import { CELL_SIZE, groundHeight, worldPositionOn, type IslandMap } from '../sim/island';
import type { Tile } from '../sim/types';
import { stairLayout, type Stair } from '../sim/stairs';
import { addRoadMark } from './road-marks';
import type { Stage } from './stage';

const TILE_GEOMETRY = new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

function tileKey(tiles: Tile[]): string {
  return tiles.map((tile) => `${tile.x},${tile.z}`).join(';');
}

export class ConstructionOverlay {
  private readonly fertileGroup = new T.Group();
  private readonly blockedGroup = new T.Group();
  private readonly routeGroup = new T.Group();
  private readonly demolitionGroup = new T.Group();
  private readonly fertileMaterial = new T.MeshBasicMaterial({ color: colors.blueLight, transparent: true, opacity: .48, depthWrite: false });
  private readonly blockedMaterial = new T.MeshBasicMaterial({ color: 0xd3664e, transparent: true, opacity: .5, depthWrite: false });
  private readonly routeMaterial = new T.MeshBasicMaterial({ color: colors.gold, transparent: true, opacity: .58, depthWrite: false });
  private readonly demolitionMaterial = new T.MeshBasicMaterial({ color: colors.roofDark, transparent: true, opacity: .55, depthWrite: false });
  private fertileKey = '';
  private roadKey = '';
  private stairs = new Map<number, Stair>();

  constructor(private readonly stage: Stage, private readonly map: IslandMap) {
    stage.scene.add(this.fertileGroup, this.routeGroup, this.blockedGroup, this.demolitionGroup);
  }

  setRoads(roads: readonly number[]): void {
    const key = roads.join(',');
    if (key === this.roadKey) return;
    this.roadKey = key;
    this.stairs = stairLayout(this.map, new Set(roads));
  }

  setFertileGround(tiles: Tile[] | null): void {
    const key = tiles ? tileKey(tiles) : '';
    if (key === this.fertileKey) return;
    this.fertileKey = key;
    this.fertileGroup.clear();
    if (tiles) for (const tile of tiles) this.fertileGroup.add(this.tileMesh(tile.x, tile.z, this.fertileMaterial, .07));
    this.stage.invalidate();
  }

  setBlockedTiles(tiles: Tile[]): void {
    this.blockedGroup.clear();
    for (const tile of tiles) this.blockedGroup.add(this.tileMesh(tile.x, tile.z, this.blockedMaterial, .11));
    this.stage.invalidate();
  }

  setHarbourRoute(path: number[] | null): void {
    this.routeGroup.clear();
    if (path) for (const index of path) addRoadMark(this.routeGroup, this.map, this.stairs, index, TILE_GEOMETRY, this.routeMaterial, .06);
    this.stage.invalidate();
  }

  setDemolitionTarget(tileIndices: number[]): void {
    this.demolitionGroup.clear();
    for (const index of tileIndices) addRoadMark(this.demolitionGroup, this.map, this.stairs, index, TILE_GEOMETRY, this.demolitionMaterial, .06);
    this.stage.invalidate();
  }

  clear(): void {
    this.fertileKey = '';
    this.fertileGroup.clear();
    this.blockedGroup.clear();
    this.routeGroup.clear();
    this.demolitionGroup.clear();
    this.stage.invalidate();
  }

  private tileMesh(x: number, z: number, material: T.MeshBasicMaterial, lift: number): T.Mesh {
    const mesh = new T.Mesh(TILE_GEOMETRY, material);
    mesh.scale.set(CELL_SIZE - .06, 1, CELL_SIZE - .06);
    const point = worldPositionOn(this.map, x + .5, z + .5);
    mesh.position.set(point.x, groundHeight(this.map, x, z) + lift, point.z);
    return mesh;
  }

  dispose(): void {
    this.clear();
    this.fertileGroup.removeFromParent();
    this.blockedGroup.removeFromParent();
    this.routeGroup.removeFromParent();
    this.demolitionGroup.removeFromParent();
  }

  get counts(): { fertile: number; blocked: number; route: number; demolition: number } {
    return { fertile: this.fertileGroup.children.length, blocked: this.blockedGroup.children.length, route: this.routeGroup.children.length, demolition: this.demolitionGroup.children.length };
  }
}

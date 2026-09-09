import { UNITS, type Army, type UnitKind } from './military';
import type { Grid } from './grid';

export type Side = 'city' | 'invader';

export interface Unit {
  id: number;
  side: Side;
  kind: UnitKind;
  x: number;
  y: number;
  hitPoints: number;
  progress: number;
  fromX: number;
  fromY: number;
}

export const UNIT_TILES_PER_TICK = 0.02;
export const MELEE_RANGE = 1;
const INVADER_KIND: UnitKind = 'hoplite';

export function landInvaders(grid: Grid, companies: number, nextId: () => number): Unit[] {
  const units: Unit[] = [];
  const edge = Math.floor(grid.size / 2) - companies;

  for (let index = 0; index < companies; index++) {
    const y = Math.max(1, Math.min(grid.size - 2, edge + index * 2));
    units.push(newUnit(nextId(), 'invader', INVADER_KIND, 0, y));
  }
  return units;
}

export function musterDefenders(army: Army, x: number, y: number, nextId: () => number): Unit[] {
  const units: Unit[] = [];

  for (const kind of Object.keys(UNITS) as UnitKind[]) {
    for (let index = 0; index < army[kind]; index++) {
      units.push(newUnit(nextId(), 'city', kind, x, y + (index % 3)));
    }
  }
  return units;
}

export function stepBattle(units: Unit[], palace: { x: number; y: number }, grid: Grid): Unit[] {
  for (const unit of units) {
    const enemy = nearestEnemy(unit, units);
    const target = enemy ?? (unit.side === 'invader' ? palace : unit);
    if (enemy && distance(unit, enemy) <= MELEE_RANGE) {
      enemy.hitPoints -= UNITS[unit.kind].attack;
      continue;
    }
    advance(unit, target, grid);
  }

  return units.filter((unit) => unit.hitPoints > 0);
}

export function reachedPalace(units: Unit[], palace: { x: number; y: number }): boolean {
  return units.some((unit) => unit.side === 'invader' && distance(unit, palace) <= MELEE_RANGE);
}

function newUnit(id: number, side: Side, kind: UnitKind, x: number, y: number): Unit {
  return { id, side, kind, x, y, hitPoints: UNITS[kind].hitPoints, progress: 1, fromX: x, fromY: y };
}

function advance(unit: Unit, target: { x: number; y: number }, grid: Grid): void {
  const dx = Math.sign(target.x - unit.x);
  const dy = Math.sign(target.y - unit.y);
  if (dx === 0 && dy === 0) return;

  unit.progress = Math.min(1, unit.progress + UNIT_TILES_PER_TICK);
  if (unit.progress < 1) return;

  const nextX = unit.x + dx;
  const nextY = unit.y + dy;
  if (!grid.contains(nextX, nextY)) return;

  unit.fromX = unit.x;
  unit.fromY = unit.y;
  unit.x = nextX;
  unit.y = nextY;
  unit.progress = 0;
}

function nearestEnemy(unit: Unit, units: Unit[]): Unit | null {
  let best: Unit | null = null;
  let bestRange = Infinity;

  for (const other of units) {
    if (other.side === unit.side || other.hitPoints <= 0) continue;
    const range = distance(unit, other);
    if (range >= bestRange) continue;
    best = other;
    bestRange = range;
  }
  return best;
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

import type { Database } from 'bun:sqlite';
import { deserializeSharedWorld } from '../sim/save';
import { randomCityColor, type CityColor } from '../sim/colors';
import { EARLIEST_SCHEMA, SCHEMA_HISTORY } from './schema-history';

interface Step {
  to: number;
  apply: (db: Database) => void;
}

function rows<T>(db: Database, sql: string): T[] {
  const statement = db.prepare<T, []>(sql);
  try {
    return statement.all();
  } finally {
    statement.finalize();
  }
}

function rebuildTable(db: Database, table: string, version: number, refill: (source: string) => void): void {
  const source = `${table}_superseded`;
  db.run('PRAGMA legacy_alter_table = ON;');
  try {
    db.run(`ALTER TABLE ${table} RENAME TO ${source};`);
    db.run(`${SCHEMA_HISTORY[version][table]};`);
    refill(source);
    db.run(`DROP TABLE ${source};`);
  } finally {
    db.run('PRAGMA legacy_alter_table = OFF;');
  }
}

function colorForEachActor(db: Database): Map<number, CityColor> {
  const stored = rows<{ data: string }>(db, 'SELECT data FROM world WHERE id = 1;')[0];
  const world = stored ? deserializeSharedWorld(stored.data) : null;
  if (!world) throw new Error('Authority store cannot be migrated: its world does not load.');
  const colorByCity = new Map(world.cities.map((city) => [city.id, city.color]));
  const chosen = new Map<number, CityColor>();
  for (const row of rows<{ city_id: number; actor_id: number }>(db, 'SELECT city_id, actor_id FROM ownership;')) {
    const color = colorByCity.get(row.city_id);
    if (color) chosen.set(row.actor_id, color);
  }
  for (const actor of rows<{ id: number }>(db, 'SELECT id FROM actors ORDER BY id;')) {
    if (chosen.has(actor.id)) continue;
    chosen.set(actor.id, randomCityColor([...chosen.values()]));
  }
  return chosen;
}

function actorsKeepAColor(db: Database): void {
  const colors = colorForEachActor(db);
  rebuildTable(db, 'actors', 3, (source) => {
    for (const actor of rows<{ id: number; name: string; created_at: number }>(db, `SELECT id, name, created_at FROM ${source};`)) {
      db.run('INSERT INTO actors (id, name, color, created_at) VALUES (?, ?, ?, ?);', [actor.id, actor.name, colors.get(actor.id)!, actor.created_at]);
    }
  });
}

export const STEPS: Step[] = [
  { to: 3, apply: actorsKeepAColor },
];

export function migrateStore(db: Database, from: number, to: number, path: string): void {
  if (from < EARLIEST_SCHEMA) throw new Error(`Authority store at ${path} predates every migration: stored schema ${from}, the oldest that can be raised is ${EARLIEST_SCHEMA}.`);
  const pending = STEPS.filter((step) => step.to > from && step.to <= to);
  if (pending.length !== to - from) throw new Error(`Authority store at ${path} has no migration path from schema ${from} to ${to}.`);
  db.run('PRAGMA foreign_keys = OFF;');
  try {
    for (const step of pending) {
      const raise = db.transaction(() => {
        step.apply(db);
        db.run('UPDATE meta SET format_version = ? WHERE id = 1;', [step.to]);
      });
      raise.exclusive();
    }
  } finally {
    db.run('PRAGMA foreign_keys = ON;');
  }
}

import type { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initStore, selectAll, type AuthorityDb } from './store';
import { Authority } from './authority';
import type { CityColor } from '../sim/colors';
import { islandFor, tileAtOn } from '../sim/island';
import { findHarbourSite, harbourApron } from '../sim/founding';
import type { ClaimRequest } from './authority';

export function freshPath(cleanups: Array<() => void>): string {
  const dir = mkdtempSync(join(tmpdir(), 'authority-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'world.db');
}

export function freshAuthority(cleanups: Array<() => void>): { path: string; authority: Authority } {
  const path = freshPath(cleanups);
  initStore(path);
  const authority = Authority.open(path);
  cleanups.push(() => {
    try {
      authority.close();
    } catch {}
  });
  return { path, authority };
}

export function rid(seed: number): string {
  return seed.toString(16).padStart(32, '0');
}

export function rawDb(authority: Authority): Database {
  return (authority as unknown as { store: AuthorityDb }).store.db;
}

export function claimFor(home: number): ClaimRequest {
  const site = findHarbourSite(islandFor(1), home);
  if (!site) throw new Error('no harbour site');
  return { kind: 'claim', x: site.x, z: site.z, rotation: site.rotation };
}

export function cityNames(authority: Authority): string[] {
  return selectAll<{ name: string }>(rawDb(authority), 'SELECT name FROM actors ORDER BY id;').map((row) => row.name);
}

export function actorColors(authority: Authority): string[] {
  return selectAll<{ color: string }>(rawDb(authority), 'SELECT color FROM actors ORDER BY id;').map((row) => row.color);
}

export function admit(authority: Authority, name = 'Tycho', color: CityColor = 'terracotta'): string {
  const admission = authority.admit(name, color);
  if (!admission.ok) throw new Error(admission.reason);
  return admission.credential;
}

export function foundedActor(authority: Authority, home: number): { credential: string; cityId: number } {
  const credential = admit(authority);
  const claim = authority.submit(credential, 1, rid(1), claimFor(home));
  const cityId = claim.cityId!;
  const harbour = authority.snapshot().cities.find((city) => city.id === cityId)!.harbour;
  const apron = harbourApron(harbour.x, harbour.z, harbour.rotation);
  authority.submit(credential, 2, rid(2), { kind: 'command', cityId, command: { type: 'roadPath', tiles: apron } });
  return { credential, cityId };
}

export function roadTileOf(authority: Authority, cityId: number): { x: number; z: number; index: number } {
  const world = authority.snapshot();
  const city = world.cities.find((c) => c.id === cityId)!;
  const index = city.roads[0];
  return { ...tileAtOn(islandFor(world.seed, city.home), index), index };
}

export function sequenceRow(authority: Authority, credential: string): { watermark: number; receiptCount: number } {
  const actorId = authority.authenticate(credential)!.actorId;
  const watermark = rawDb(authority).query<{ high_watermark: number }, [number]>('SELECT high_watermark FROM sequences WHERE actor_id = ?;').get(actorId)!.high_watermark;
  const receiptCount = rawDb(authority).query<{ count: number }, [number]>('SELECT COUNT(*) as count FROM receipts WHERE actor_id = ?;').get(actorId)!.count;
  return { watermark, receiptCount };
}

export function revisionOf(authority: Authority): number {
  return rawDb(authority).query<{ revision: number }, []>('SELECT revision FROM world WHERE id = 1;').get()!.revision;
}

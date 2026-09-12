import type { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initStore, type AuthorityDb } from './store';
import { Authority } from './authority';
import { islandFor, tileAtOn } from '../sim/island';

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

export function admit(authority: Authority): string {
  const admission = authority.admitInvite(authority.issueInvite());
  if (!admission.ok) throw new Error(admission.reason);
  return admission.credential;
}

export function foundedActor(authority: Authority, home: number): { credential: string; cityId: number } {
  const credential = admit(authority);
  const claim = authority.submit(credential, 1, rid(1), { kind: 'claim', home });
  const cityId = claim.cityId!;
  const harbour = authority.snapshot().cities.find((city) => city.id === cityId)!.harbour;
  authority.submit(credential, 2, rid(2), { kind: 'command', cityId, command: { type: 'foundHarbour', x: harbour.x, z: harbour.z } });
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

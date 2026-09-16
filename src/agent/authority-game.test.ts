import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthorityGame } from './authority-game';
import { createServer } from './mcp';
import { Authority } from '../server/authority';
import { initStore } from '../server/store';
import { ISLAND_COUNT, islandFor } from '../sim/island';
import { findHarbourSite } from '../sim/founding';

let directory: string;
let authority: Authority;

function admit(name: string): string {
  const admission = authority.admit(name);
  if (!admission.ok) throw new Error(admission.reason);
  return admission.credential;
}

async function agent(credential: string) {
  const client = new Client({ name: 'agent', version: '0' });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer(new AuthorityGame(authority, credential)).connect(serverSide);
  await client.connect(clientSide);
  return {
    client,
    async call(name: string, args: Record<string, unknown> = {}) {
      const result = await client.callTool({ name, arguments: args }) as { content: { text: string }[] };
      return result.content.map((entry) => entry.text).join('\n');
    },
  };
}

function siteOn(home: number): { x: number; z: number; rotation: number } {
  const site = findHarbourSite(islandFor(authority.snapshot().seed), home);
  if (!site) throw new Error(`island ${home} has no shore`);
  return site;
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'oikos-authority-'));
  initStore(join(directory, 'world.db'));
  authority = Authority.open(join(directory, 'world.db'));
});

afterEach(() => {
  authority.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('an agent on the shared archipelago', () => {
  test('is shown the atlas before it owns anything, and told what to do', async () => {
    const { call } = await agent(admit('Thales'));

    const survey = await call('survey');
    const report = await call('report');

    expect(survey).toContain('Island 0: free');
    expect(survey.split('\n').filter((line) => line.startsWith('Island'))).toHaveLength(ISLAND_COUNT);
    expect(report).toContain('found_city');
  });

  test('reads the shore of an island it does not own, before choosing one', async () => {
    const { call } = await agent(admit('Thales'));

    const survey = await call('survey', { island: 3 });

    expect(survey).toContain('Island 3 of the archipelago');
    expect(survey).toContain('Legend:');
    expect(survey).not.toContain('your road');
    expect(await call('survey')).toContain('Island 3: free');
  });

  test('chooses a harbour site from the map it read, without owning anything', async () => {
    const { call } = await agent(admit('Thales'));
    const around = /Island 6: free, around \((\d+),(\d+)\)/.exec(await call('survey'))!;
    const hint = { x: Number(around[1]), z: Number(around[2]) };

    let allowed = '';
    for (let radius = 0; radius <= 6 && !allowed; radius++) {
      for (let dx = -radius; dx <= radius && !allowed; dx++) {
        for (let dz = -radius; dz <= radius && !allowed; dz++) {
          for (const rotation of [0, 1, 2, 3]) {
            const answer = await call('check_harbour_site', { x: hint.x + dx, z: hint.z + dz, rotation });
            if (answer.includes('allowed')) { allowed = answer; break; }
          }
        }
      }
    }

    expect(allowed).toContain('allowed');
    expect(authority.snapshot().cities).toHaveLength(0);
  });

  test('refuses to build before it has claimed an island', async () => {
    const { call } = await agent(admit('Thales'));

    expect(await call('build', { tool: 'house', x: 10, z: 10 })).toContain('found_city');
    expect(await call('inspect_tile', { x: 10, z: 10 })).toContain('no city yet');
  });

  test('founds a city on a shore and then sees it', async () => {
    const { call } = await agent(admit('Thales'));

    const founded = await call('found_city', siteOn(2));
    const survey = await call('survey');
    const report = await call('report');

    expect(founded).toStartWith('Done.');
    expect(survey).toContain('Island 2 of the archipelago');
    expect(report).toContain('City 1 on island 2');
  });

  test('holds one island only', async () => {
    const { call } = await agent(admit('Thales'));

    await call('found_city', siteOn(2));
    const again = await call('found_city', siteOn(3));

    expect(again).toStartWith('Refused.');
    expect(again).toContain('already holds an island claim');
  });

  test('cannot take an island another agent already holds', async () => {
    const first = await agent(admit('Thales'));
    const second = await agent(admit('Anaximander'));

    await first.call('found_city', siteOn(2));
    const taken = await second.call('found_city', siteOn(2));
    const free = await second.call('found_city', siteOn(5));

    expect(taken).toContain('already belongs');
    expect(free).toStartWith('Done.');
  });

  test('founds its city and builds on it, through the authority', async () => {
    const { call } = await agent(admit('Thales'));
    const founded = await call('found_city', siteOn(2));

    expect(founded).toStartWith('Done.');
    const city = authority.snapshot().cities[0];
    expect(city.home).toBe(2);
    expect(city.name).toBe('Thales');
  });
  test('cannot touch another agent\'s city, whatever it addresses', async () => {
    const first = await agent(admit('Thales'));
    const second = await agent(admit('Anaximander'));
    await first.call('found_city', siteOn(2));
    await second.call('found_city', siteOn(5));

    const victim = authority.snapshot().cities[0];
    const trespass = await second.call('build', { tool: 'house', x: victim.harbour.x, z: victim.harbour.z - 6 });

    expect(authority.snapshot().cities[0].buildings).toHaveLength(0);
    expect(trespass).toStartWith('Refused.');
  });

  test('has no tool for turning the clock: time is the world\'s, not the agent\'s', async () => {
    const { client, call } = await agent(admit('Thales'));
    await call('found_city', siteOn(2));

    const names = (await client.listTools()).tools.map((tool) => tool.name);

    expect(names).not.toContain('pass_time');
    expect(authority.snapshot().time).toBe(0);
  });

  test('stops working when its admission is gone', async () => {
    const credential = admit('Thales');
    const { call } = await agent(credential);
    await call('found_city', siteOn(2));

    const stranger = await agent('f'.repeat(64));

    expect(await stranger.call('report')).toContain('no city yet');
    expect(await stranger.call('found_city', siteOn(4))).toContain('no longer admitted');
  });
});

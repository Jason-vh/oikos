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
import { mapOf } from '../sim/grid';
import { ISLAND_COUNT } from '../sim/island';

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
    expect(report).toContain('claim_island');
  });

  test('refuses to build before it has claimed an island', async () => {
    const { call } = await agent(admit('Thales'));

    expect(await call('build', { tool: 'house', x: 10, z: 10 })).toContain('Claim an island');
    expect(await call('inspect_tile', { x: 10, z: 10 })).toContain('no island yet');
  });

  test('claims an island and then sees its own city', async () => {
    const { call } = await agent(admit('Thales'));

    const claimed = await call('claim_island', { home: 2 });
    const survey = await call('survey');
    const report = await call('report');

    expect(claimed).toStartWith('Done.');
    expect(survey).toContain('Island 2 of the Kalliste archipelago');
    expect(report).toContain('is not founded yet');
  });

  test('holds one island only', async () => {
    const { call } = await agent(admit('Thales'));

    await call('claim_island', { home: 2 });
    const again = await call('claim_island', { home: 3 });

    expect(again).toStartWith('Refused.');
    expect(again).toContain('already holds an island claim');
  });

  test('cannot take an island another agent already holds', async () => {
    const first = await agent(admit('Thales'));
    const second = await agent(admit('Anaximander'));

    await first.call('claim_island', { home: 2 });
    const taken = await second.call('claim_island', { home: 2 });
    const free = await second.call('claim_island', { home: 5 });

    expect(taken).toContain('already claimed');
    expect(free).toStartWith('Done.');
  });

  test('founds its city and builds on it, through the authority', async () => {
    const { call } = await agent(admit('Thales'));
    await call('claim_island', { home: 2 });
    const entry = mapOf(authority.snapshot(), authority.snapshot().cities[0]).entry;

    let founded = '';
    for (let dz = 1; dz <= 6 && !founded.startsWith('Done.'); dz++) {
      for (let dx = -3; dx <= 3; dx++) {
        const site = { x: entry.x + dx, z: entry.z - dz };
        if (!(await call('check_found_city', site)).includes('allowed')) continue;
        founded = await call('found_city', site);
        break;
      }
    }

    expect(founded).toStartWith('Done.');
    expect(authority.snapshot().cities[0].founded).toBe(true);

    const built = await call('build', { tool: 'house', x: entry.x + 2, z: entry.z - 6 });
    expect(built === 'Refused.' ? '' : built).toContain('Treasury');
  });

  test('cannot touch another agent\'s city, whatever it addresses', async () => {
    const first = await agent(admit('Thales'));
    const second = await agent(admit('Anaximander'));
    await first.call('claim_island', { home: 2 });
    await second.call('claim_island', { home: 5 });

    const trespass = await second.call('build', { tool: 'house', x: mapOf(authority.snapshot(), authority.snapshot().cities[0]).entry.x, z: 40 });

    expect(authority.snapshot().cities[0].buildings).toHaveLength(0);
    expect(trespass).toStartWith('Refused.');
  });

  test('has no tool for turning the clock: time is the world\'s, not the agent\'s', async () => {
    const { client, call } = await agent(admit('Thales'));
    await call('claim_island', { home: 2 });

    const names = (await client.listTools()).tools.map((tool) => tool.name);

    expect(names).not.toContain('pass_time');
    expect(authority.snapshot().time).toBe(0);
  });

  test('stops working when its admission is gone', async () => {
    const credential = admit('Thales');
    const { call } = await agent(credential);
    await call('claim_island', { home: 2 });

    const stranger = await agent('f'.repeat(64));

    expect(await stranger.call('report')).toContain('no island yet');
    expect(await stranger.call('claim_island', { home: 4 })).toContain('no longer admitted');
  });
});

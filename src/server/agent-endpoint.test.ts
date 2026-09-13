import { afterEach, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Authority } from './authority';
import { admit, foundedActor } from './authority-fixtures.test';
import { AGENT_PRESENCE_MS } from './runtime';
import { fixture } from './transport-fixtures.test';
import type { World } from '../sim/types';
import { findHarbourSite } from '../sim/founding';
import { islandFor } from '../sim/island';

const cleanups: Array<() => unknown> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function agent(base: string, credential: string) {
  const client = new Client({ name: 'agent', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${credential}` } },
  }));
  return {
    client,
    async call(name: string, args: Record<string, unknown> = {}) {
      const result = await client.callTool({ name, arguments: args }) as { content: { text: string }[] };
      return result.content.map((entry) => entry.text).join('\n');
    },
  };
}

async function worldAfterStop(f: Awaited<ReturnType<typeof fixture>>): Promise<World> {
  await f.runtime.stop();
  const authority = Authority.open(f.path);
  try {
    return authority.snapshot();
  } finally {
    authority.close();
  }
}

test('an admitted agent plays the shared world over HTTP, and a stranger cannot', async () => {
  let credential = '';
  const f = await fixture(cleanups, (authority) => { credential = admit(authority, 'Thales'); });

  const unauthenticated = await fetch(`${f.base}/mcp`, { method: 'POST' });
  expect(unauthenticated.status).toBe(401);
  expect(unauthenticated.headers.get('www-authenticate')).toContain('Bearer');
  expect((await fetch(`${f.base}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${'a'.repeat(64)}` } })).status).toBe(401);
  expect((await fetch(`${f.base}/mcp`, { method: 'POST', headers: { Authorization: 'Bearer nonsense' } })).status).toBe(401);

  const { client, call } = await agent(f.base, credential);
  expect(client.getServerVersion()?.name).toBe('oikos');
  expect((await client.listTools()).tools.map((tool) => tool.name)).toContain('found_city');
  expect(await call('survey')).toContain('Island 0: free');
  const site = findHarbourSite(islandFor(1), 4)!;
  expect(await call('found_city', { x: site.x, z: site.z, rotation: site.rotation })).toStartWith('Done.');
  expect(await call('report')).toContain('City 1 on island 4');
  await client.close();

  const world = await worldAfterStop(f);
  expect(world.cities).toHaveLength(1);
  expect(world.cities[0].home).toBe(4);
});

test('refuses a browser origin it does not serve', async () => {
  let credential = '';
  const f = await fixture(cleanups, (authority) => { credential = admit(authority, 'Thales'); });

  const foreign = await fetch(`${f.base}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${credential}`, Origin: 'https://foreign.example' } });
  const own = await fetch(`${f.base}/mcp`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${credential}`, Origin: f.origin, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c', version: '0' } } }),
  });

  expect(foreign.status).toBe(403);
  expect(own.status).toBe(200);
});

test('agent traffic runs the shared clock while a browser holds no socket', async () => {
  let credential = '';
  const f = await fixture(cleanups, (authority) => { foundedActor(authority, 1); credential = admit(authority, 'Thales'); });
  const { client, call } = await agent(f.base, credential);

  await call('report');
  f.clock.step(1000);
  f.clock.step(1000);
  await client.close();

  const world = await worldAfterStop(f);
  expect(world.time).toBeGreaterThan(1.5);
  expect(world.time).toBeLessThan(3);
});

test('the world stops again once the agent has gone quiet', async () => {
  let credential = '';
  const f = await fixture(cleanups, (authority) => { foundedActor(authority, 1); credential = admit(authority, 'Thales'); });
  const { client, call } = await agent(f.base, credential);

  await call('report');
  await client.close();
  for (let elapsed = 0; elapsed < AGENT_PRESENCE_MS + 4000; elapsed += 250) f.clock.step(250);

  const world = await worldAfterStop(f);
  expect(world.time).toBeGreaterThan(AGENT_PRESENCE_MS / 1000 - 1);
  expect(world.time).toBeLessThan(AGENT_PRESENCE_MS / 1000 + 1);
});

test('one agent cannot command another agent\'s city', async () => {
  let owner = { credential: '', cityId: -1 };
  let intruder = '';
  const f = await fixture(cleanups, (authority) => {
    owner = foundedActor(authority, 1);
    intruder = admit(authority, 'Anaximander');
  });

  const { client, call } = await agent(f.base, intruder);
  await call('claim_island', { home: 6 });
  const refused = await call('build', { tool: 'house', x: 10, z: 10 });
  await client.close();

  const world = await worldAfterStop(f);
  expect(refused).toStartWith('Refused.');
  expect(world.cities.find((city) => city.id === owner.cityId)!.buildings).toHaveLength(0);
});

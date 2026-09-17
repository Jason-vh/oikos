import { describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalGame } from './game';
import { INSTRUCTIONS, SERVER_NAME, createServer } from './mcp';
import { saveFile } from './save-file';
import { TOOLS } from './tools';
import { primaryCity } from '../sim/city';
import { mapOf } from '../sim/grid';
import { spotFor } from '../sim/testing';

const REPOSITORY = join(import.meta.dir, '..', '..');

async function connected(game = LocalGame.start()) {
  const client = new Client({ name: 'test', version: '0' });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer(game).connect(serverSide);
  await client.connect(clientSide);
  return { client, game };
}

function textOf(result: unknown): string {
  const content = (result as { content: { type: string; text: string }[] }).content;
  return content.map((entry) => entry.text).join('\n');
}

describe('the MCP server', () => {
  test('introduces itself and its tools', async () => {
    const { client } = await connected();

    expect(client.getServerVersion()?.name).toBe(SERVER_NAME);
    expect(client.getInstructions()).toBe(INSTRUCTIONS);

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual(TOOLS.map((tool) => tool.name).sort());
    expect(listed.tools.every((tool) => tool.description && tool.inputSchema.type === 'object')).toBe(true);
  });

  test('answers a survey with a map an agent can read', async () => {
    const { client } = await connected();

    const survey = textOf(await client.callTool({ name: 'survey', arguments: {} }));

    expect(survey).toContain('Legend:');
    expect(survey).toContain('A harbour needs two rows');
  });

  test('builds through a tool call and charges the treasury', async () => {
    const { client, game } = await connected();
    const spot = spotFor(game.view().world, 'granary')!;
    const before = game.view().city!.money;

    const checked = textOf(await client.callTool({ name: 'check_build', arguments: { sites: [{ tool: 'granary', x: spot.x, z: spot.z }] } }));
    const built = textOf(await client.callTool({ name: 'build', arguments: { tool: 'granary', x: spot.x, z: spot.z } }));

    expect(checked).toContain('allowed, costs 120 dr');
    expect(built).toStartWith('Done.');
    expect(game.view().city!.money).toBe(before - 120);
    expect(game.view().city!.buildings).toHaveLength(1);
  });

  test('checks a whole quarter of sites in one call', async () => {
    const { client, game } = await connected();
    const spot = spotFor(game.view().world, 'granary')!;
    const sites = [
      { tool: 'granary', x: spot.x, z: spot.z },
      { tool: 'farm', x: 0, z: 0 },
      { tool: 'house', x: spot.x, z: spot.z },
    ];

    const lines = textOf(await client.callTool({ name: 'check_build', arguments: { sites } })).split('\n');

    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('allowed');
    expect(lines[1]).toContain('refused.');
    expect(game.view().city!.buildings).toHaveLength(0);
  });

  test('reports a refused command as an answer, not a failure', async () => {
    const { client } = await connected();

    const result = await client.callTool({ name: 'build', arguments: { tool: 'farm', x: 0, z: 0 } });

    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toStartWith('Refused.');
  });

  test('marks a malformed argument as an error the agent can correct', async () => {
    const { client } = await connected();

    const badTool = await client.callTool({ name: 'build', arguments: { tool: 'palace', x: 1, z: 1 } });
    const badTile = await client.callTool({ name: 'inspect_tile', arguments: { x: 'here', z: 1 } });
    const badBend = await client.callTool({ name: 'lay_road', arguments: { from: { x: 1, z: 1 }, to: { x: 2, z: 2 }, bend: 'diagonal' } });

    expect(badTool.isError).toBe(true);
    expect(textOf(badTool)).toContain('tool');
    expect(badTile.isError).toBe(true);
    expect(textOf(badTile)).toContain('x');
    expect(badBend.isError).toBe(true);
  });

  test('turns a road one corner, either way round, and charges what it quoted', async () => {
    const { client, game } = await connected();
    const grid = mapOf(game.view().world, game.view().city!);
    const from = { x: grid.entry.x, z: grid.entry.z - 4 };
    const to = { x: from.x + 4, z: from.z - 3 };

    const quoted = textOf(await client.callTool({ name: 'check_road', arguments: { from, to } }));
    const before = game.view().city!.money;
    const laid = textOf(await client.callTool({ name: 'lay_road', arguments: { from, to } }));

    expect(quoted).toContain('8 tiles of which 8 are new, costs 16 dr');
    expect(laid).toStartWith('Done.');
    expect(game.view().city!.money).toBe(before - 16);
    expect(game.view().city!.roads).toContain(to.x + to.z * grid.width);

    await client.callTool({ name: 'lay_road', arguments: { from, to: { x: from.x - 3, z: from.z - 3 }, bend: 'z-first' } });
    expect(game.view().city!.roads).toContain(from.x + (from.z - 3) * grid.width);
  });

  test('refuses a tool it does not have', async () => {
    const { client } = await connected();

    const result = await client.callTool({ name: 'summon_zeus', arguments: {} });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('summon_zeus not found');
  });

  test('runs the city between calls, with no tool for the clock', async () => {
    let time = 1000;
    const { client, game } = await connected(LocalGame.start({ now: () => time }));

    expect((await client.listTools()).tools.map((tool) => tool.name)).not.toContain('pass_time');
    time += 3000;
    const report = textOf(await client.callTool({ name: 'report', arguments: {} }));

    expect(report).toContain('of simulated time');
    expect(game.view().world.time).toBeGreaterThan(2.5);
  });
});

describe('the server as an agent runs it', () => {
  test('serves over stdio under Bun and keeps the city between runs', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'oikos-agent-'));
    const save = join(directory, 'city.json');
    const spawn = async () => {
      const client = new Client({ name: 'test', version: '0' });
      await client.connect(new StdioClientTransport({
        command: 'bun',
        args: [join(REPOSITORY, 'scripts', 'mcp.ts')],
        cwd: REPOSITORY,
        env: { ...process.env, OIKOS_AGENT_SAVE: save },
      }));
      return client;
    };

    try {
      const first = await spawn();
      expect(first.getServerVersion()?.name).toBe(SERVER_NAME);

      const spot = spotFor(LocalGame.start({ slot: saveFile(save) }).view().world, 'granary')!;
      const built = textOf(await first.callTool({ name: 'build', arguments: { tool: 'granary', x: spot.x, z: spot.z } }));
      expect(built).toStartWith('Done.');
      await first.close();

      const second = await spawn();
      const report = textOf(await second.callTool({ name: 'report', arguments: {} }));
      expect(report).toContain(`granary #`);
      expect(report).toContain(`at (${spot.x},${spot.z})`);
      await second.close();

      expect(primaryCity(LocalGame.start({ slot: saveFile(save) }).view().world).buildings).toHaveLength(1);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 30000);
});

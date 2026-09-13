import { LocalGame } from '../src/agent/game';
import { serveStdio } from '../src/agent/mcp';
import { saveFile } from '../src/agent/save-file';
import { ISLAND_COUNT } from '../src/sim/island';

function number(name: string, limit?: number): number | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || (limit !== undefined && value >= limit)) {
    console.error(`${name} must be a whole number${limit === undefined ? '' : ` below ${limit}`}.`);
    process.exit(1);
  }
  return value;
}

const path = process.env.OIKOS_AGENT_SAVE;

try {
  const game = LocalGame.start({
    seed: number('OIKOS_AGENT_SEED'),
    home: number('OIKOS_AGENT_ISLAND', ISLAND_COUNT),
    founded: process.env.OIKOS_AGENT_FOUNDING !== '1',
    slot: path ? saveFile(path) : undefined,
  });
  await serveStdio(game);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'The city could not be opened.');
  process.exit(1);
}

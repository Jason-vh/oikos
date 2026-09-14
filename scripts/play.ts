import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Authority } from '../src/server/authority';
import { startServer } from '../src/server/runtime';
import { initStore } from '../src/server/store';

const args = process.argv.slice(2);
const fresh = args.includes('--fresh');
const agentNames = args.flatMap((value, index) => (args[index - 1] === '--agent' ? [value] : []));
const dbPath = resolve(process.env.OIKOS_DB ?? 'artifacts/dev/world.db');
const authorityPort = Number(process.env.OIKOS_AUTHORITY_PORT ?? 3000);
const vitePort = Number(process.env.PORT ?? 5180);
const publicOrigin = `http://localhost:${vitePort}`;

if (fresh) rmSync(dbPath, { force: true });
if (!existsSync(dbPath)) {
  mkdirSync(dirname(dbPath), { recursive: true });
  initStore(dbPath);
  console.log(`Fresh world at ${dbPath}.`);
}

if (agentNames.length > 0) {
  const authority = Authority.open(dbPath);
  try {
    for (const name of agentNames) {
      const admission = authority.admit(name);
      if (!admission.ok) {
        console.error(`Could not admit ${name}: ${admission.reason}`);
        process.exit(1);
      }
      console.log(`Agent ${name}: ${admission.credential}`);
    }
  } finally {
    authority.close();
  }
}

let runtime: ReturnType<typeof startServer>;
try {
  runtime = startServer({ path: dbPath, publicOrigin, port: authorityPort });
} catch (error) {
  console.error(`Authority could not start on ${dbPath}.`);
  console.error(error instanceof Error ? error.message : error);
  console.error('Another `npm run play` may already hold the world; stop it or pass OIKOS_DB.');
  process.exit(1);
}

const vite = spawn('npx', ['vite', '--port', String(vitePort), '--strictPort'], {
  stdio: 'inherit',
  env: { ...process.env, OIKOS_AUTHORITY_PORT: String(authorityPort) },
});

console.log(`Authority on :${authorityPort}, world ${dbPath}.`);
console.log(`Play at ${publicOrigin}/  ·  scripting seam at ${publicOrigin}/?debug`);

let shuttingDown = false;
async function shutdown(code: number): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  vite.kill('SIGTERM');
  await runtime.stop().catch(() => {});
  process.exit(code);
}

runtime.failed.then(() => {
  console.error('Authority unavailable; stopping.');
  void shutdown(1);
});
vite.on('exit', (code) => { void shutdown(code ?? 0); });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void shutdown(0); });

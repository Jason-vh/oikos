import { startServer } from '../src/server/runtime';

const path = process.env.OIKOS_DB;
const publicOrigin = process.env.OIKOS_PUBLIC_ORIGIN;
const port = Number(process.env.PORT ?? 3000);
if (!path || !publicOrigin || !Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('Set OIKOS_DB, OIKOS_PUBLIC_ORIGIN and optional PORT/OIKOS_HOST.');
  process.exit(1);
}

try {
  const runtime = startServer({ path, publicOrigin, port, hostname: process.env.OIKOS_HOST });
  runtime.failed.then(() => {
    console.error('Authority unavailable; stopping.');
    void runtime.stop().finally(() => process.exit(1));
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => { void runtime.stop().then(() => { process.exitCode = 0; }); });
  }
  console.log('Authority listening.');
} catch {
  console.error('Authority startup failed.');
  process.exit(1);
}

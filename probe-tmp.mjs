import { chromium } from 'playwright';

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
await page.goto('http://localhost:5180/', { waitUntil: 'domcontentloaded' });
await page.getByRole('textbox').fill(`Probe${Date.now() % 100000}`);
await page.getByRole('button', { name: 'Join' }).click();
await page.waitForTimeout(2500);
console.log('cookie:', (await context.cookies()).map((c) => c.name).join(',') || 'NONE');
await page.close();

const inert = await context.newPage();
await inert.route('http://localhost:5180/__probe', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>probe</title>' }));
await inert.goto('http://localhost:5180/__probe');

const result = await inert.evaluate(async (urls) => {
  async function trial(url) {
    const t0 = Date.now();
    const log = [];
    const at = () => `${Date.now() - t0}ms`;
    return await new Promise((resolve) => {
      const socket = new WebSocket(url);
      socket.binaryType = 'arraybuffer';
      socket.onopen = () => {
        log.push(`${at()} open`);
        setTimeout(() => {
          log.push(`${at()} send text request (bad binding -> expect text reject)`);
          socket.send(JSON.stringify({ type: 'request', binding: 'nope', requestId: '0'.repeat(32), seq: 1, operation: { kind: 'claim', home: 0 } }));
        }, 300);
      };
      socket.onmessage = (e) => log.push(typeof e.data === 'string' ? `${at()} TEXT ${e.data.slice(0, 90)}` : `${at()} BIN ${e.data.byteLength}`);
      socket.onerror = () => log.push(`${at()} error`);
      socket.onclose = (e) => log.push(`${at()} close ${e.code}`);
      setTimeout(() => { try { socket.close(); } catch {} resolve({ url, log }); }, 5000);
    });
  }
  const out = [];
  for (const url of urls) out.push(await trial(url));
  return out;
}, ['ws://localhost:3000/api/world', 'ws://localhost:5180/api/world']);

for (const r of result) {
  console.log(`\n${r.url.includes('3000') ? 'DIRECT to Bun' : 'THROUGH Vite proxy'}  ${r.url}`);
  for (const line of r.log) console.log('   ', line);
}
await browser.close();

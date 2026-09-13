import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const [base = 'http://127.0.0.1:3010', invite = ''] = process.argv.slice(2);
assert.ok(invite, 'usage: deployment-smoke.ts <base> <invite>');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 880 }, reducedMotion: 'reduce' });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  const local = await page.goto(`${base}/?debug`);
  assert.equal(local?.status(), 200, 'the local game is served');
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  assert.equal((await page.evaluate(() => (window as any).oikos.state)).cities.length, 1, 'the local game still opens its own island');

  const health = await page.request.get(`${base}/healthz`);
  assert.equal(health.status(), 200, 'the authority answers through the proxy');

  await page.goto(`${base}/shared.html?debug`);
  await page.getByTestId('invite-form').locator('input').fill(invite);
  const redeemed = page.waitForResponse((response) => response.url().endsWith('/api/session/redeem'));
  await page.getByTestId('invite-form').getByRole('button', { name: 'Join' }).click();
  assert.equal((await redeemed).status(), 200, 'the invite is redeemed through the proxy');
  await page.waitForFunction(() => document.body.dataset.ready === 'true', undefined, { timeout: 45000 });

  const cookie = (await page.context().cookies()).find((candidate) => candidate.name === '__Host-oikos');
  assert.ok(cookie?.httpOnly && cookie.sameSite === 'Strict', 'the session cookie stays HttpOnly and same-site');
  assert.equal(await page.evaluate(() => document.cookie), '', 'scripts cannot read the session');

  await page.getByTestId('claim-available').click({ noWaitAfter: true });
  const home = await page.evaluate(() => {
    const claimed = new Set((window as any).oikos.state.cities.map((city: any) => city.home));
    for (let candidate = 0; candidate < 8; candidate++) if (!claimed.has(candidate)) return candidate;
    throw new Error('every island is claimed');
  });
  await page.getByTestId('claim-select').selectOption(String(home));
  await page.getByTestId('claim-dialog').locator('button[value="confirm"]').click({ noWaitAfter: true });
  await page.waitForFunction(() => (window as any).oikos.cityContext.activeId !== null, undefined, { timeout: 45000 });

  const claimed = await page.evaluate(() => {
    const game = (window as any).oikos;
    return game.state.cities.find((city: any) => city.id === game.cityContext.activeId);
  });
  assert.equal(claimed.home, home, 'the deployed authority recorded the chosen island');
  assert.equal(claimed.founded, false, 'a fresh claim still awaits its harbour');
  assert.deepEqual(errors, [], `no page errors: ${errors.join(' | ')}`);
  console.log(`Deployment smoke passed: static game, proxied health, real invite and a claim on island ${home + 1} through ${base}.`);
} finally {
  await browser.close();
}

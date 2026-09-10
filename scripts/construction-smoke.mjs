import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const [base = 'http://localhost:5180', output = 'artifacts/construction'] = process.argv.slice(2);
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const errors = [];

async function open(route, reducedMotion = 'no-preference') {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(new URL(route, base).href, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.dataset.ready || document.body.dataset.error);
  assert.equal(await page.locator('body').getAttribute('data-ready'), 'true');
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  return page;
}

async function scrub(page, progress) {
  await page.getByLabel('Assembly progress', { exact: true }).evaluate((input, value) => {
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, progress);
  await page.clock.runFor(50);
}

try {
  const atelier = await open('/art.html?model=house:1');
  await atelier.evaluate(() => localStorage.setItem('construction-sentinel', 'untouched'));
  for (const [name, progress] of [['foundation', 0], ['walls', 350], ['roof', 650], ['finished', 1000]]) {
    await scrub(atelier, progress);
    await atelier.screenshot({ path: path.join(output, `atelier-${name}.png`) });
  }
  for (let rotation = 1; rotation <= 4; rotation++) {
    await atelier.getByRole('button', { name: 'Turn model', exact: true }).click();
    await scrub(atelier, 450);
    await atelier.screenshot({ path: path.join(output, `atelier-walls-rotation-${rotation}.png`) });
  }
  await atelier.getByRole('button', { name: 'Replay construction', exact: true }).click();
  await atelier.clock.runFor(500);
  const midProgress = Number(await atelier.getByLabel('Assembly progress', { exact: true }).inputValue());
  assert(midProgress > 0 && midProgress < 1000, 'Replay did not animate');
  await atelier.clock.runFor(1500);
  assert.equal(await atelier.getByLabel('Assembly progress', { exact: true }).inputValue(), '1000');
  const frames = await atelier.evaluate(() => window.artStudy.frames);
  await atelier.clock.runFor(300);
  assert.equal(await atelier.evaluate(() => window.artStudy.frames), frames, 'Completed construction keeps rendering');
  await atelier.getByRole('button', { name: 'Replay construction', exact: true }).click();
  await atelier.clock.runFor(200);
  for (const model of ['granary:1:mixed', 'agora:2:mixed', 'woodcutter:1', 'fountain:1', 'farm:1:0']) {
    await atelier.getByLabel('Model', { exact: true }).selectOption(model);
    await atelier.clock.runFor(100);
    assert.equal(await atelier.locator('#construction').isVisible(), true, `${model} has no construction`);
    await scrub(atelier, 550);
    await atelier.screenshot({ path: path.join(output, `atelier-${model.split(':')[0]}-midway.png`) });
  }
  await atelier.getByLabel('Model', { exact: true }).selectOption('house:3');
  await atelier.clock.runFor(100);
  assert.equal(await atelier.locator('#construction').isVisible(), false);
  assert.deepEqual(await atelier.evaluate(() => ({ ...localStorage })), { 'construction-sentinel': 'untouched' });
  await atelier.close();

  const reduced = await open('/art.html?model=house:1', 'reduce');
  assert.equal(await reduced.getByRole('button', { name: 'Replay construction', exact: true }).isDisabled(), true);
  assert.equal(await reduced.getByLabel('Assembly progress', { exact: true }).inputValue(), '1000');
  await scrub(reduced, 350);
  const reducedFrames = await reduced.evaluate(() => window.artStudy.frames);
  await reduced.clock.runFor(300);
  assert.equal(await reduced.evaluate(() => window.artStudy.frames), reducedFrames, 'Reduced-motion scrubbing should stay still');
  await reduced.close();

  const game = await open('/?debug');
  await game.getByRole('button', { name: /pause/i }).first().click();
  const house = await game.evaluate(() => window.oikos.plan.buildings.find((building) => building.kind === 'house'));
  await game.evaluate(({ x, z }) => window.oikos.focusTile(x, z), house);
  await game.clock.runFor(50);
  const before = await game.evaluate(() => window.oikos.state.time);
  assert.equal(await game.evaluate(({ x, z }) => window.oikos.build('house', x, z).ok, house), true);
  await game.clock.runFor(400);
  await game.screenshot({ path: path.join(output, 'city-walls.png') });
  await game.clock.runFor(500);
  await game.screenshot({ path: path.join(output, 'city-roof.png') });
  await game.clock.runFor(700);
  await game.screenshot({ path: path.join(output, 'city-finished.png') });
  assert.equal(await game.evaluate(() => window.oikos.state.time), before, 'Construction advanced the paused simulation');
  assert.equal(await game.evaluate(() => window.oikos.state.buildings.length), 1);
  const nextHouse = await game.evaluate(() => window.oikos.plan.buildings.find((building) => building.kind === 'house'));
  assert.equal(await game.evaluate(({ x, z }) => window.oikos.build('house', x, z).ok, nextHouse), true);
  await game.clock.runFor(200);
  const saved = await game.evaluate(() => window.oikos.state);
  const camera = await game.evaluate(() => window.oikos.camera);
  await game.getByTestId('menu').click();
  await game.getByTestId('load').click();
  await game.clock.runFor(100);
  assert.deepEqual(await game.evaluate(() => window.oikos.state), saved, 'Same-seed restore changed the saved world');
  const restoredCamera = await game.evaluate(() => window.oikos.camera);
  camera.forEach((value, index) => assert(Math.abs(value - restoredCamera[index]) < .00001, 'Same-seed restore moved the camera'));
  const restoredFrames = await game.evaluate(() => window.oikos.frames);
  await game.clock.runFor(500);
  assert.equal(await game.evaluate(() => window.oikos.frames), restoredFrames, 'Same-seed restore retained construction transitions');
  await game.close();
  assert.deepEqual(errors, []);
  console.log(`Construction checks passed. Captures: ${output}`);
} finally {
  await browser.close();
}

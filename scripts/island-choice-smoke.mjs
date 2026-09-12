import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const [url = 'http://localhost:5180/?debug', output = 'artifacts/island-choice'] = process.argv.slice(2);
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const paint = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const saves = (page) => page.evaluate(() => [localStorage.getItem(window.oikos.saveKey), localStorage.getItem('oikos.checkpoint.v1')]);
const openChoice = async (page) => {
  await page.getByTestId('menu').click();
  await page.getByTestId('new-island').click();
  await paint(page);
};

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  await page.getByRole('button', { name: /pause/i }).first().click();
  await page.getByTestId('menu').click();
  await page.getByTestId('save').click();
  await paint(page);
  const before = await page.evaluate(() => window.oikos.state);
  const savedBefore = await saves(page);
  await openChoice(page);
  await page.getByLabel('Starting island').selectOption('0');
  assert.match(await page.getByTestId('island-facts').textContent(), /^Island 1: .* land tiles .* fertile .* forest$/);
  assert.match(await page.getByTestId('island-preview').getAttribute('aria-label'), /Island 1 selected/);
  await page.screenshot({ path: path.join(output, '01-island-atlas.png') });

  const candidate = await page.evaluate(() => {
    const world = window.oikos.freshWorld(2, 7);
    return { x: world.cities[0].harbour.x + .5, z: world.cities[0].harbour.z + .5 };
  });
  const canvas = page.getByTestId('island-preview');
  const size = await canvas.evaluate((element) => ({ width: element.width, height: element.height }));
  let bounds = await canvas.boundingBox();
  assert(bounds);
  await page.mouse.click(bounds.x + candidate.x / size.width * bounds.width, bounds.y + candidate.z / size.height * bounds.height);
  assert.equal(await page.getByLabel('Starting island').inputValue(), '7');
  assert.match(await page.getByTestId('island-facts').textContent(), /^Island 8:/);
  await page.mouse.click(bounds.x + 1, bounds.y + 1);
  assert.equal(await page.getByLabel('Starting island').inputValue(), '7', 'Clicking open sea changed the choice');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await paint(page);
  assert.deepEqual(await page.evaluate(() => window.oikos.state), before, 'Browsing the atlas changed the city');
  assert.deepEqual(await saves(page), savedBefore, 'Browsing the atlas wrote a save');

  await page.setViewportSize({ width: 390, height: 844 });
  await openChoice(page);
  bounds = await page.getByTestId('new-island-dialog').boundingBox();
  assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390, 'The atlas overflows the mobile viewport');
  await page.screenshot({ path: path.join(output, '02-mobile-atlas.png') });
  await page.getByRole('button', { name: 'New island', exact: true }).click();
  await page.waitForFunction(() => window.oikos.state.seed === 2 && window.oikos.state.cities[0].home === 7);
  assert.equal(await page.evaluate(() => window.oikos.state.cities[0].founded), false);
  assert.equal((await saves(page))[1], savedBefore[1], 'Starting from the atlas replaced the checkpoint');

  const fallback = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  fallback.on('pageerror', (error) => errors.push(error.message));
  await fallback.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      if (kind === '2d') return null;
      return Reflect.apply(getContext, this, [kind, ...args]);
    };
  });
  await fallback.goto(url, { waitUntil: 'networkidle' });
  await fallback.waitForFunction(() => document.body.dataset.ready === 'true');
  await fallback.getByRole('button', { name: /pause/i }).first().click();
  await openChoice(fallback);
  assert.equal(await fallback.getByTestId('island-preview').count(), 0);
  await fallback.getByLabel('Starting island').selectOption('7');
  assert.match(await fallback.getByTestId('island-facts').textContent(), /^Island 8:/);
  await fallback.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.deepEqual(errors, []);
  console.log('Island atlas smoke passed: terrain facts, map and select choices, sea clicks, save isolation, mobile fit, matching settlement, and canvas fallback.');
} finally {
  await browser.close();
}

import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const [base = 'http://127.0.0.1:5203', output = 'artifacts/city-context'] = process.argv.slice(2);
const url = `${base}/city-context.html`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch();

const fixture = (page) => page.evaluate(() => window.cityContextFixture);
const cities = (page) => page.evaluate(() => window.cityContextFixture.cities);
const context = (page) => page.evaluate(() => window.cityContextFixture.context);
const visit = (page, id) => page.evaluate((cityId) => window.cityContextFixture.visit(cityId), id);
const select = (page, id) => page.evaluate((buildingId) => window.cityContextFixture.select(buildingId), id);
const paint = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.dataset.ready === 'true');

  const both = await cities(page);
  assert.equal(both.length, 2, 'the fixture must load exactly two founded cities');
  const [city1, city2] = both;

  assert.deepEqual(await context(page), { viewedId: city1.id, activeId: city1.id }, 'bootstrap views the active city');
  const home = await page.evaluate(() => window.cityContextFixture.state.cities[0].money);
  const homePopulation = await page.evaluate(() => window.cityContextFixture.state.cities[0].buildings.filter((b) => b.kind === 'house').reduce((sum, b) => sum + b.residents, 0));
  const treasuryField = page.locator('[data-field="treasury"]');
  await paint(page);
  assert.equal(await treasuryField.textContent(), `${Math.round(home).toLocaleString('en-US')} dr`, 'summary reflects the active/viewed city before visiting');
  void homePopulation;

  const cityButtonsBefore = page.locator('[data-testid="cities"] button');
  assert.equal(await cityButtonsBefore.count(), 2, 'a read-only visit control appears once a second city exists');

  await cityButtonsBefore.nth(1).focus();
  const focusedLabelBefore = await page.evaluate(() => document.activeElement?.textContent);
  for (let i = 0; i < 5; i++) await select(page, null);
  const focusedLabelAfter = await page.evaluate(() => document.activeElement === document.activeElement && document.activeElement?.textContent);
  assert.equal(focusedLabelAfter, focusedLabelBefore, 'repeated HUD refreshes must not rebuild the city buttons under a focused control');

  await visit(page, city2.id);
  assert.deepEqual(await context(page), { viewedId: city2.id, activeId: city1.id }, 'visiting only changes the viewed city');
  const worldAfterVisit = await page.evaluate(() => window.cityContextFixture.state);
  assert.equal(worldAfterVisit.cities.length, 2);
  assert.equal(worldAfterVisit.cities[0].id, city1.id, 'visiting never reorders World.cities');

  const city2Money = worldAfterVisit.cities.find((c) => c.id === city2.id).money;
  await paint(page);
  assert.equal(await treasuryField.textContent(), `${Math.round(city2Money).toLocaleString('en-US')} dr`, 'summary follows the viewed city while visiting');

  const toolButtons = page.locator('.hud-toolbar .hud-tool');
  const toolCount = await toolButtons.count();
  assert.ok(toolCount > 0, 'toolbar renders');
  for (let i = 0; i < toolCount; i++) assert.equal(await toolButtons.nth(i).isDisabled(), true, 'every build tool is disabled while visiting');

  const foreignHouse = await page.evaluate((cityId) => window.cityContextFixture.state.cities.find((c) => c.id === cityId).buildings.find((b) => b.kind === 'agora')?.id ?? null, city2.id);
  assert.notEqual(foreignHouse, null, 'the second city has an agora to inspect');
  await select(page, foreignHouse);
  const vendorButton = page.locator('[data-testid="vendor-toggle"]');
  await vendorButton.waitFor({ state: 'visible' });
  assert.equal(await vendorButton.isDisabled(), true, 'the vendor control is disabled while visiting, even for the viewed city\'s own building');

  await visit(page, city1.id);
  assert.deepEqual(await context(page), { viewedId: city1.id, activeId: city1.id }, 'returning to the active city restores full context');
  await select(page, foreignHouse);

  await page.setViewportSize({ width: 390, height: 780 });
  await paint(page);
  const citiesPanelBox = await page.locator('[data-testid="cities"]').boundingBox();
  assert.ok(citiesPanelBox, 'the visit control has a real layout box');
  assert.ok(citiesPanelBox.x >= 0 && citiesPanelBox.x + citiesPanelBox.width <= 390 + 1, 'the visit control stays within the mobile viewport');

  await page.setViewportSize({ width: 1280, height: 900 });
  await visit(page, city2.id);
  await paint(page);
  await page.screenshot({ path: path.join(output, 'visiting-second-city.png') });

  assert.deepEqual(errors, [], `no console errors: ${errors.join(' | ')}`);
  console.log('City-context smoke passed: two-city summary, disabled controls while visiting, focus stability, mobile layout.');
} finally {
  await browser.close();
}

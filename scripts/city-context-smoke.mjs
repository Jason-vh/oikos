import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const [base = 'http://127.0.0.1:5203', output = 'artifacts/city-context'] = process.argv.slice(2);
const url = `${base}/city-context.html`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch();

const cities = (page) => page.evaluate(() => window.cityContextFixture.cities);
const context = (page) => page.evaluate(() => window.cityContextFixture.context);
const state = (page) => page.evaluate(() => window.cityContextFixture.state);
const select = (page, id) => page.evaluate((buildingId) => window.cityContextFixture.select(buildingId), id);
const paint = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const visitViaButton = async (page, index) => {
  await page.locator('[data-testid="cities"] button').nth(index).click();
  await paint(page);
};

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
  const treasuryField = page.locator('[data-field="treasury"]');
  const homeMoney = (await state(page)).cities[0].money;
  await paint(page);
  assert.equal(await treasuryField.textContent(), `${Math.round(homeMoney).toLocaleString('en-US')} dr`, 'summary reflects the active/viewed city before visiting');

  const cityButtons = page.locator('[data-testid="cities"] button');
  assert.equal(await cityButtons.count(), 2, 'a read-only visit control appears once a second city exists');

  const secondButton = await cityButtons.nth(1).elementHandle();
  await secondButton.focus();
  for (let i = 0; i < 5; i++) await select(page, null);
  const stillFocused = await page.evaluate((el) => el === document.activeElement, secondButton);
  assert.equal(stillFocused, true, 'repeated HUD refreshes must not rebuild the city buttons under a focused control');

  const worldBeforeVisit = await state(page);
  await visitViaButton(page, 1);
  assert.deepEqual(await context(page), { viewedId: city2.id, activeId: city1.id }, 'visiting only changes the viewed city');
  const worldAfterVisit = await state(page);
  assert.deepEqual(worldAfterVisit, worldBeforeVisit, 'visiting a city mutates nothing in World, not even its order');

  const city2Money = worldAfterVisit.cities.find((c) => c.id === city2.id).money;
  assert.equal(await treasuryField.textContent(), `${Math.round(city2Money).toLocaleString('en-US')} dr`, 'summary follows the viewed city while visiting');

  const toolButtons = page.locator('.hud-toolbar .hud-tool');
  const toolCount = await toolButtons.count();
  assert.ok(toolCount > 0, 'toolbar renders');
  for (let i = 0; i < toolCount; i++) assert.equal(await toolButtons.nth(i).isDisabled(), true, 'every build tool is disabled while visiting');

  const foreignAgora = worldAfterVisit.cities.find((c) => c.id === city2.id).buildings.find((b) => b.kind === 'agora');
  assert.ok(foreignAgora, 'the second city has a developed agora to inspect');
  await select(page, foreignAgora.id);
  const vendorButton = page.locator('[data-testid="vendor-toggle"]');
  await vendorButton.waitFor({ state: 'visible' });
  assert.equal(await vendorButton.isDisabled(), true, 'the vendor control is disabled while visiting, even for the viewed city\'s own building');
  const beforeGuardedClick = await state(page);
  await vendorButton.click({ force: true });
  assert.deepEqual(await state(page), beforeGuardedClick, 'a disabled vendor control cannot mutate a foreign city even when forced');

  await visitViaButton(page, 0);
  assert.deepEqual(await context(page), { viewedId: city1.id, activeId: city1.id }, 'returning to the active city restores full context');

  const homeAgora = worldBeforeVisit.cities[0].buildings.find((b) => b.kind === 'agora' && b.vendorInstalled);
  assert.ok(homeAgora, 'the active city has its own vendor-installed agora');
  await select(page, homeAgora.id);
  await vendorButton.waitFor({ state: 'visible' });
  assert.equal(await vendorButton.isDisabled(), false, 'the vendor control is editable for the active city\'s own building');
  const enabledBefore = (await state(page)).cities[0].buildings.find((b) => b.id === homeAgora.id).vendorEnabled;
  await vendorButton.click();
  const enabledAfter = (await state(page)).cities[0].buildings.find((b) => b.id === homeAgora.id).vendorEnabled;
  assert.notEqual(enabledAfter, enabledBefore, 'a real click on an editable vendor control dispatches through submitCityCommand and actually toggles it');

  await page.setViewportSize({ width: 390, height: 780 });
  await paint(page);
  const citiesPanelBox = await page.locator('[data-testid="cities"]').boundingBox();
  assert.ok(citiesPanelBox, 'the visit control has a real layout box');
  assert.ok(citiesPanelBox.x >= 0 && citiesPanelBox.x + citiesPanelBox.width <= 390 + 1, 'the visit control stays within the mobile viewport');
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.screenshot({ path: path.join(output, 'own-city-developed.png') });
  await visitViaButton(page, 1);
  await page.screenshot({ path: path.join(output, 'visiting-second-city.png') });

  assert.deepEqual(errors, [], `no console errors: ${errors.join(' | ')}`);
  console.log('City-context smoke passed: two-city summary, disabled controls while visiting, real guarded vendor dispatch, focus stability, mobile layout.');
} finally {
  await browser.close();
}

import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const [base = 'http://localhost:5180', output = 'artifacts/play'] = process.argv.slice(2);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium' }).catch((error) => {
  throw new Error(`The play smoke needs the full Chromium, not the headless shell: npx playwright install chromium\n${error.message}`);
});
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

try {
  await page.goto(new URL('/?debug', base).href, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="join-form"]:visible');
  assert.equal(await page.evaluate(() => document.querySelectorAll('canvas').length), 1, 'The world was not rendered behind the join modal');
  await page.getByRole('textbox').fill('   ');
  await page.getByRole('button', { name: 'Join' }).click();
  await page.waitForTimeout(200);
  assert.equal(await page.locator('[data-testid="join-form"]').isVisible(), true, 'A blank city name was accepted');
  await page.getByRole('textbox').fill(`Smoke ${Date.now() % 1000000}`);
  const preselected = await page.evaluate(() => document.querySelector('input[name="color"]:checked')?.value ?? null);
  assert.notEqual(preselected, null, 'No city colour was preselected');
  await page.getByRole('button', { name: 'Join' }).click();
  await page.waitForFunction(() => document.body.dataset.ready === 'true' || document.body.dataset.error === 'true');
  assert.equal(await page.locator('body').getAttribute('data-error'), null, 'The shared game failed to boot');
  await page.waitForFunction(() => 'oikos' in window);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.evaluate(() => window.oikos.settled());

  const site = await page.evaluate(() => {
    const { width, depth } = window.oikos.map;
    for (let z = 0; z < depth; z++) {
      for (let x = 0; x < width; x++) {
        if (window.oikos.checkClaim(x, z, 0).ok) return { x, z, rotation: 0 };
      }
    }
    return null;
  });
  assert.notEqual(site, null, 'No unclaimed shore was found; the world needs resetting');

  await page.evaluate((where) => window.oikos.focusTile(where.x, where.z), site);
  await page.getByRole('button', { name: /Harbour/ }).click();
  const point = await page.evaluate((where) => window.oikos.projectTile(where.x, where.z), site);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.waitForTimeout(400);
  await page.mouse.up();
  await page.evaluate(() => window.oikos.settled());
  const founded = await page.evaluate(() => window.oikos.session);
  assert.notEqual(founded.activeCityId, null, 'A held click did not found a city');
  const foundedColor = await page.evaluate(() => window.oikos.state.cities.find((city) => city.id === window.oikos.session.activeCityId).color);
  assert.equal(foundedColor, preselected, 'The city was not founded in the colour chosen at the gate');
  assert.equal(await page.evaluate(() => window.oikos.state.cities.length >= 1), true);
  await page.screenshot({ path: path.join(output, 'founded.png') });

  const tools = await page.evaluate(() => [...document.querySelectorAll('.hud-tool')].filter((button) => button.offsetParent !== null).map((button) => button.dataset.tool ?? `open:${button.dataset.opener}`));
  assert.equal(tools.includes('road') && tools.includes('house') && tools.includes('demolish'), true, 'The always-available tools are missing from the toolbar');
  assert.equal(tools.includes('farm'), false, 'A grouped tool is shown before its group is opened');
  assert.equal(tools.includes('open:food'), true, 'The food group has no button');
  assert.equal(await page.locator('.hud-tool-group[data-group="goods"]').isVisible(), false, 'A group with only locked tools is still shown');

  await page.keyboard.press('x');
  assert.equal(await page.locator('.hud-tool[data-tool="demolish"]').getAttribute('aria-pressed'), 'true', 'X did not arm the demolish tool');
  await page.keyboard.press('b');
  assert.equal(await page.locator('.hud-tool[data-tool="road"]').getAttribute('aria-pressed'), 'true', 'B did not arm the road tool');

  await page.locator('[data-opener="food"]').click();
  assert.equal(await page.locator('.hud-tool[data-tool="farm"]').isVisible(), true, 'The food group did not expand');
  await page.locator('.hud-tool[data-tool="farm"]').click();
  assert.equal(await page.locator('.hud-tool[data-tool="farm"]').getAttribute('aria-pressed'), 'true', 'The chosen tool is not marked as armed');
  assert.equal(await page.locator('.hud-tool[data-tool="farm"]').isVisible(), true, 'The group folded away while its tool was armed');
  assert.equal(await page.locator('[data-opener="food"]').getAttribute('aria-pressed'), 'true', 'The group button does not carry its armed tool');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-opener="food"]').getAttribute('aria-pressed'), 'false', 'Escape did not disarm the grouped tool');
  await page.waitForSelector('.hud-tool[data-tool="farm"]', { state: 'hidden' });

  const plot = await page.evaluate(() => {
    const harbour = window.oikos.state.cities.find((city) => city.id === window.oikos.session.activeCityId).harbour;
    for (let radius = 2; radius < 14; radius++) {
      for (let z = harbour.z - radius; z <= harbour.z + radius; z++) {
        for (let x = harbour.x - radius; x <= harbour.x + radius; x++) {
          if (window.oikos.checkBuild('house', x, z).ok) return { x, z };
        }
      }
    }
    return null;
  });
  assert.notEqual(plot, null, 'No buildable dwelling plot beside the harbour');

  const built = await page.evaluate((where) => window.oikos.build('house', where.x, where.z), plot);
  assert.equal(built.ok, true, `Build refused: ${built.reason}`);
  await page.evaluate(() => window.oikos.settled());
  const houses = await page.evaluate(() => window.oikos.state.cities.find((city) => city.id === window.oikos.session.activeCityId).buildings.filter((building) => building.kind === 'house').length);
  assert.equal(houses, 1, 'The dwelling did not reach the authority');

  const lane = await page.evaluate(() => {
    const harbour = window.oikos.state.cities.find((city) => city.id === window.oikos.session.activeCityId).harbour;
    for (let radius = 1; radius < 14; radius++) {
      for (let z = harbour.z - radius; z <= harbour.z + radius; z++) {
        for (let x = harbour.x - radius; x <= harbour.x + radius; x++) {
          if (window.oikos.checkBuild('road', x, z).ok && window.oikos.checkBuild('road', x + 1, z).ok) return { x, z };
        }
      }
    }
    return null;
  });
  assert.notEqual(lane, null, 'No free pair of tiles to lay a road on');
  const road = await page.evaluate((where) => window.oikos.road([{ x: where.x, z: where.z }, { x: where.x + 1, z: where.z }]), lane);
  assert.equal(road.ok, true, `Road refused: ${road.reason}`);
  await page.evaluate(() => window.oikos.settled());
  const roads = await page.evaluate(() => window.oikos.state.cities.find((city) => city.id === window.oikos.session.activeCityId).roads.length);
  assert.equal(roads >= 2, true, 'The road did not reach the authority');

  const selected = await page.evaluate((where) => window.oikos.select(where.x, where.z), plot);
  assert.notEqual(selected, null, 'Selecting the new dwelling picked nothing');

  await page.evaluate(() => window.oikos.home());
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(output, 'village.png') });

  const log = await page.evaluate(() => window.oikos.log);
  assert.equal(log.some((entry) => entry.direction === 'sent' && entry.kind === 'request'), true, 'No request left the client');
  assert.equal(log.some((entry) => entry.direction === 'received' && entry.kind === 'receipt'), true, 'No receipt reached the client');
  assert.equal(log.some((entry) => entry.direction === 'received' && entry.kind === 'snapshot'), true, 'No snapshot reached the client');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => 'oikos' in window);
  assert.equal(await page.locator('[data-testid="join-form"]').count(), 0, 'A known player was asked to join again');
  assert.equal(await page.evaluate(() => document.querySelectorAll('canvas').length), 1, 'The reloaded game left a stray canvas');

  assert.deepEqual(errors, []);
  console.log(`Play loop passed: claimed ${site.x},${site.z}, built at ${plot.x},${plot.z}. Captures: ${output}`);
} finally {
  await browser.close();
}

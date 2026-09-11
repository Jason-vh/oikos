import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const [url = 'http://localhost:5180/?debug', output = 'artifacts/foam'] = process.argv.slice(2);
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const paint = (page, frames = 35) => page.evaluate((count) => new Promise((resolve) => {
  function frame() {
    if (--count === 0) resolve();
    else requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}), frames);
const foamVersion = (page) => page.evaluate(() => window.oikos.foamVersion);

try {
  const errors = [];
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(url);
    await page.waitForFunction(() => document.body.dataset.ready);
    await page.getByRole('button', { name: /Pause, shortcut/ }).click();
    await paint(page);
    const pausedFoam = await foamVersion(page);
    const pausedFrames = await page.evaluate(() => window.oikos.frames);
    const pausedWorld = await page.evaluate(() => window.oikos.state);
    await paint(page);
    assert.equal(await foamVersion(page), pausedFoam, 'Paused foam changed');
    assert.equal(await page.evaluate(() => window.oikos.frames), pausedFrames, 'Paused foam keeps rendering');
    assert.deepEqual(await page.evaluate(() => window.oikos.state), pausedWorld);
    await page.screenshot({ path: `${output}/${reducedMotion}-paused.png` });
    await page.getByRole('button', { name: 'Normal speed', exact: true }).click();
    for (let phase = 0; phase < 4; phase++) {
      await paint(page, 60);
      await page.screenshot({ path: `${output}/${reducedMotion}-wave-${phase}.png` });
    }
    assert((await page.evaluate(() => window.oikos.state.time)) > pausedWorld.time, 'City did not resume');
    if (reducedMotion === 'reduce') assert.equal(await foamVersion(page), pausedFoam, 'Reduced-motion foam animated');
    else assert((await foamVersion(page)) > pausedFoam, 'Foam did not resume');
    await page.getByTestId('menu').click();
    await paint(page, 3);
    const menuFoam = await foamVersion(page);
    await paint(page);
    assert.equal(await foamVersion(page), menuFoam, 'Foam animated behind the menu');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /Pause, shortcut/ }).click();
    await paint(page, 3);
    const stoppedFoam = await foamVersion(page);
    await paint(page);
    assert.equal(await foamVersion(page), stoppedFoam, 'Foam did not freeze after running');
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(`Foam smoke passed: animation, pause/resume, menu, reduced motion, idle rendering. ${output}`);
} finally {
  await browser.close();
}

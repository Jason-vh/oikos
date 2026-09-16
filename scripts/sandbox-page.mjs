import { chromium } from 'playwright';

export function launchGameBrowser() {
  return chromium.launch({ channel: 'chromium' }).catch((error) => {
    throw new Error(`The archipelago is too heavy for the headless shell: npx playwright install chromium\n${error.message}`);
  });
}

export const paint = (page, frames = 3) => page.evaluate((count) => new Promise((resolve) => {
  function frame() {
    if (--count === 0) resolve();
    else requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}), frames);

export async function openSandbox(browser, base, { reducedMotion = 'reduce', errors = [] } = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(new URL('/sandbox.html', base).href);
  await page.waitForFunction(() => document.body.dataset.ready);
  return page;
}

export async function settle(page, seed, { plan = false, seconds = 0 } = {}) {
  await page.evaluate((value) => window.oikos.setSeed(value), seed);
  if (plan) await page.evaluate(() => window.oikos.buildPlan());
  if (seconds > 0) await page.evaluate((value) => window.oikos.advance(value), seconds);
  await paint(page, 3);
}

import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { launchGameBrowser, openSandbox, paint } from './sandbox-page.mjs';

const [base = 'http://localhost:5180', output = 'artifacts/foam'] = process.argv.slice(2);
await mkdir(output, { recursive: true });
const browser = await launchGameBrowser();
const foamVersion = (page) => page.evaluate(() => window.oikos.foamVersion);

try {
  const errors = [];
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const page = await openSandbox(browser, base, { reducedMotion, errors });
    const start = await foamVersion(page);
    for (let phase = 0; phase < 4; phase++) {
      await paint(page, 60);
      await page.screenshot({ path: `${output}/${reducedMotion}-wave-${phase}.png` });
    }
    if (reducedMotion === 'reduce') {
      assert.equal(await foamVersion(page), start, 'Reduced-motion foam animated');
      const frames = await page.evaluate(() => window.oikos.frames);
      await paint(page, 20);
      assert.equal(await page.evaluate(() => window.oikos.frames), frames, 'A still sea keeps rendering');
    } else {
      assert((await foamVersion(page)) > start, 'Foam did not animate');
    }
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(`Foam smoke passed: breakers animate, reduced motion stays still, idle rendering. ${output}`);
} finally {
  await browser.close();
}

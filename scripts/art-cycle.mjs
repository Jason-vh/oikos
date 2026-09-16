import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const [base = 'http://localhost:5180', model = 'person:axe', frames = '10', turns = '0'] = process.argv.slice(2);
const output = path.resolve('artifacts/cycles', model.replaceAll(':', '-'));
const count = Number(frames);
const columns = Math.min(5, count);
await mkdir(output, { recursive: true });

const browser = await chromium.launch({ channel: 'chromium' }).catch((error) => {
  throw new Error(`The cycle capture needs the full Chromium, not the headless shell: npx playwright install chromium\n${error.message}`);
});
const page = await browser.newPage({ viewport: { width: 760, height: 620 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

async function paint(times = 3) {
  for (let index = 0; index < times; index++) await page.evaluate(() => new Promise(requestAnimationFrame));
}

try {
  await page.goto(new URL('/art.html', base).href, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.dataset.ready || document.body.dataset.error);
  await page.getByLabel('Model', { exact: true }).selectOption(model);
  await page.getByLabel('Citizen for scale', { exact: true }).uncheck();
  for (let turn = 0; turn < Number(turns); turn++) await page.getByRole('button', { name: 'Turn model', exact: true }).click();
  await paint();

  const span = await page.evaluate(() => window.artStudy.span);
  assert.ok(span > 0, `${model} has no animation to walk through`);

  await page.addStyleTag({ content: '.masthead, .atelier, footer, #status { display: none }' });
  const viewport = page.viewportSize();
  const framed = await page.evaluate(() => window.artStudy.frame);
  const margin = Math.max(framed.right - framed.left, framed.bottom - framed.top) * .18;
  const clip = {
    x: Math.max(0, Math.round(framed.left - margin)),
    y: Math.max(0, Math.round(framed.top - margin)),
    width: Math.round(framed.right - framed.left + margin * 2),
    height: Math.round(framed.bottom - framed.top + margin * 2),
  };
  clip.width = Math.min(clip.width, viewport.width - clip.x);
  clip.height = Math.min(clip.height, viewport.height - clip.y);
  const shots = [];
  for (let frame = 0; frame < count; frame++) {
    const at = span * frame / count;
    await page.evaluate((seconds) => window.artStudy.pose(seconds), at);
    await paint(2);
    const file = `frame-${String(frame).padStart(2, '0')}.png`;
    await page.screenshot({ path: path.join(output, file), clip });
    shots.push({ file, at });
  }

  const cells = shots.map((shot) => `<figure><img src="${shot.file}" /><figcaption>${shot.at.toFixed(3)}s</figcaption></figure>`).join('');
  const sheet = `<!doctype html><meta charset="utf-8" /><style>
    body { margin: 0; background: #dcdcaa; font: 13px/1 system-ui; color: #3d4a33; }
    main { display: grid; grid-template-columns: repeat(${columns}, 1fr); }
    figure { margin: 0; position: relative; }
    img { display: block; width: 100%; }
    figcaption { position: absolute; left: 8px; bottom: 6px; opacity: .65; }
  </style><main>${cells}</main>`;
  await writeFile(path.join(output, 'cycle.html'), sheet);
  await page.goto(`file://${path.join(output, 'cycle.html')}`, { waitUntil: 'load' });
  await page.setViewportSize({ width: 420 * columns, height: Math.round(420 * clip.height / clip.width) * Math.ceil(count / columns) });
  await paint();
  await page.screenshot({ path: path.join(output, 'cycle.png'), fullPage: true });

  assert.deepEqual(errors, []);
  console.log(`Walked ${model} through ${count} frames of a ${span.toFixed(3)}s cycle. Contact sheet: ${path.join(output, 'cycle.png')}`);
} finally {
  await browser.close();
}

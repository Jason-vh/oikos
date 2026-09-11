import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const [before, after] = process.argv.slice(2);
if (!before || !after) {
  console.error('usage: npm run art:diff -- <before dir> <after dir>');
  process.exit(1);
}

const names = (await readdir(before)).filter((name) => name.endsWith('.png')).sort();
const browser = await chromium.launch();
const page = await browser.newPage();
let worstPage = 0;

for (const name of names) {
  const pair = await Promise.all([before, after].map(async (dir) => {
    const file = await readFile(path.join(dir, name)).catch(() => null);
    return file === null ? null : `data:image/png;base64,${file.toString('base64')}`;
  }));
  if (!pair[1]) {
    console.log(`${name}: missing in ${after}`);
    continue;
  }
  const result = await page.evaluate(async ([one, two]) => {
    const load = (source) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = source;
    });
    const [a, b] = await Promise.all([load(one), load(two)]);
    if (a.width !== b.width || a.height !== b.height) return { size: [a.width, a.height, b.width, b.height] };
    const pixelsOf = (image) => {
      const canvas = new OffscreenCanvas(image.width, image.height);
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, image.width, image.height).data;
    };
    const left = pixelsOf(a);
    const right = pixelsOf(b);
    let changed = 0;
    let worst = 0;
    let total = 0;
    for (let index = 0; index < left.length; index += 4) {
      const difference = Math.max(Math.abs(left[index] - right[index]), Math.abs(left[index + 1] - right[index + 1]), Math.abs(left[index + 2] - right[index + 2]));
      if (difference > 8) changed++;
      if (difference > worst) worst = difference;
      total += difference;
    }
    const pixels = left.length / 4;
    return { changed: changed / pixels * 100, worst, mean: total / pixels };
  }, pair);
  if (result.size) {
    console.log(`${name}: size ${result.size[0]}x${result.size[1]} vs ${result.size[2]}x${result.size[3]}`);
    continue;
  }
  worstPage = Math.max(worstPage, result.changed);
  console.log(`${name}: ${result.changed.toFixed(2)}% of pixels differ, worst channel ${result.worst}, mean ${result.mean.toFixed(2)}`);
}

await browser.close();
console.log(`largest change: ${worstPage.toFixed(2)}% of pixels`);

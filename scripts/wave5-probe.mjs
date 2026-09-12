import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const [url = 'http://127.0.0.1:5183/?debug', output = 'artifacts/wave5'] = process.argv.slice(2);
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const paint = (page, frames = 3) => page.evaluate((count) => new Promise((resolve) => {
  const next = () => { if (--count === 0) resolve(); else requestAnimationFrame(next); };
  requestAnimationFrame(next);
}), frames);

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => document.body.dataset.ready);
  await page.getByRole('button', { name: 'Pause, shortcut Space', exact: true }).click();

  await page.keyboard.press('3');
  await paint(page);
  const fertile = await page.evaluate(() => window.oikos.overlayCounts);
  assert(fertile.fertile > 20, `fertile highlight missing: ${JSON.stringify(fertile)}`);
  await page.screenshot({ path: `${output}/01-farm-tool.png` });
  await page.keyboard.press('Escape');

  const plan = await page.evaluate(() => window.oikos.plan);
  await page.evaluate(() => window.oikos.buildPlan());
  await page.evaluate(() => window.oikos.advance(120));

  const house = await page.evaluate(() => {
    const state = window.oikos.state;
    const map = window.oikos.map;
    const occupied = new Set(state.cities[0].roads);
    const mark = (building, width, depth) => {
      for (let z = building.z; z < building.z + depth; z++) for (let x = building.x; x < building.x + width; x++) occupied.add(z * map.width + x);
    };
    for (const building of state.cities[0].buildings) mark(building, building.kind === 'farm' ? 4 : 3, building.kind === 'farm' ? 4 : 3);
    mark(state.cities[0].harbour, 3, 2);
    const buildable = new Set(['grass', 'sand', 'scrub', 'fertile']);
    const fits = (x, z) => {
      for (let dz = 0; dz < 3; dz++) for (let dx = 0; dx < 3; dx++) {
        const nx = x + dx;
        const nz = z + dz;
        if (nx <= 0 || nz <= 0 || nx >= map.width - 1 || nz >= map.depth - 1) return false;
        const index = nz * map.width + nx;
        if (occupied.has(index) || !buildable.has(map.terrain[index])) return false;
      }
      return true;
    };
    for (const tile of state.cities[0].roads) {
      for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 2], [-2, -2]]) {
        const nx = (tile % map.width) + dx;
        const nz = Math.floor(tile / map.width) + dz;
        if (fits(nx, nz)) return { x: nx, z: nz };
      }
    }
    return null;
  });
  assert(house, 'no free spot beside a road');
  await page.keyboard.press('2');
  await page.evaluate(([x, z]) => window.oikos.focusTile(x, z), [house.x, house.z]);
  await paint(page);
  const spot = await page.evaluate(([x, z]) => window.oikos.projectTile(x, z), [house.x, house.z]);
  await page.mouse.click(spot.x, spot.y);
  assert.equal(await page.evaluate(() => window.oikos.state.cities[0].buildings.filter((building) => building.kind === 'house').length), 5);
  await page.keyboard.press('Escape');
  await paint(page);
  const blocked = await page.evaluate(() => window.oikos.overlayCounts);
  assert(blocked.blocked === 0 && blocked.fertile === 0, `overlay did not clear: ${JSON.stringify(blocked)}`);

  const run = await page.evaluate(() => {
    const state = window.oikos.state;
    const map = window.oikos.map;
    const occupied = new Set(state.cities[0].roads);
    const mark = (building, width, depth) => {
      for (let z = building.z; z < building.z + depth; z++) for (let x = building.x; x < building.x + width; x++) occupied.add(z * map.width + x);
    };
    for (const building of state.cities[0].buildings) mark(building, building.kind === 'farm' ? 4 : 3, building.kind === 'farm' ? 4 : 3);
    mark(state.cities[0].harbour, 3, 2);
    const buildable = new Set(['grass', 'sand', 'scrub', 'fertile']);
    const free = (x, z) => {
      const index = z * map.width + x;
      return x > 0 && z > 0 && x < map.width - 1 && z < map.depth - 1 && !occupied.has(index) && buildable.has(map.terrain[index]);
    };
    for (const tile of state.cities[0].roads) {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = (tile % map.width) + dx;
        const z = Math.floor(tile / map.width) + dz;
        if (free(x, z) && free(x, z - 1) && free(x, z - 2) && free(x, z - 3)) return { x, z };
      }
    }
    return null;
  });
  assert(run, 'no clear north run beside a road');
  await page.keyboard.press('1');
  await page.evaluate(([x, z]) => window.oikos.focusTile(x, z), [run.x, run.z]);
  await paint(page);
  const start = await page.evaluate(([x, z]) => window.oikos.projectTile(x, z), [run.x, run.z]);
  const end = await page.evaluate(([x, z]) => window.oikos.projectTile(x, z), [run.x, run.z - 3]);
  const roadsBefore = await page.evaluate(() => window.oikos.state.cities[0].roads.length);
  await page.keyboard.down('Shift');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await paint(page);
  const dragOverlay = await page.evaluate(() => window.oikos.overlayCounts);
  assert(dragOverlay.blocked === 0, `drag preview marks blocked tiles: ${JSON.stringify(dragOverlay)}`);
  await page.screenshot({ path: `${output}/02-road-bend.png` });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await paint(page);
  const roadsAfter = await page.evaluate(() => window.oikos.state.cities[0].roads.length);
  assert(roadsAfter === roadsBefore + 4, `road drag placed ${roadsAfter - roadsBefore} tiles`);
  await page.getByTestId('undo').click();
  const roadsUndone = await page.evaluate(() => window.oikos.state.cities[0].roads.length);
  assert.equal(roadsUndone, roadsBefore, 'undo did not restore roads');

  await page.keyboard.press('Escape');
  const gathering = await page.evaluate(() => {
    const state = window.oikos.state;
    const map = window.oikos.map;
    const occupied = new Set(state.cities[0].roads);
    const mark = (building, width, depth) => {
      for (let z = building.z; z < building.z + depth; z++) for (let x = building.x; x < building.x + width; x++) occupied.add(z * map.width + x);
    };
    for (const building of state.cities[0].buildings) mark(building, building.kind === 'farm' ? 4 : 3, building.kind === 'farm' ? 4 : 3);
    mark(state.cities[0].harbour, 3, 2);
    const forests = [];
    for (let z = 0; z < map.depth; z++) for (let x = 0; x < map.width; x++) if (map.terrain[z * map.width + x] === 'forest') forests.push([x, z]);
    const distanceToForest = (x, z) => Math.min(...forests.map(([fx, fz]) => Math.abs(fx - x) + Math.abs(fz - z)));
    const free = (x, z, width, depth) => {
      for (let dz = 0; dz < depth; dz++) for (let dx = 0; dx < width; dx++) {
        const nx = x + dx;
        const nz = z + dz;
        const index = nz * map.width + nx;
        if (nx <= 0 || nz <= 0 || nx >= map.width - 1 || nz >= map.depth - 1) return false;
        if (occupied.has(index) || !['grass', 'sand', 'scrub', 'fertile'].includes(map.terrain[index])) return false;
      }
      return true;
    };
    const besideRoad = (x, z, width, depth) => {
      for (let dz = -1; dz <= depth && !0; dz++) for (let dx = -1; dx <= width; dx++) {
        if ((dx === -1 || dx === width) && (dz === -1 || dz === depth)) continue;
        if (state.cities[0].roads.includes((z + dz) * map.width + (x + dx))) return true;
      }
      return false;
    };
    let cabin = null;
    for (let z = 1; z < map.depth - 3; z++) for (let x = 1; x < map.width - 3; x++) {
      if (free(x, z, 2, 2) && besideRoad(x, z, 2, 2) && (!cabin || distanceToForest(x, z) < cabin.distance)) cabin = { x, z, distance: distanceToForest(x, z) };
    }
    if (!cabin || cabin.distance > 12) return null;
    let pile = null;
    for (let z = Math.max(1, cabin.z - 6); z < Math.min(map.depth - 4, cabin.z + 6); z++) for (let x = Math.max(1, cabin.x - 6); x < Math.min(map.width - 4, cabin.x + 6); x++) {
      if (free(x, z, 3, 3) && besideRoad(x, z, 3, 3)) { pile = { x, z }; break; }
    }
    return pile ? { cabin: { x: cabin.x, z: cabin.z }, pile } : null;
  });
  if (gathering) {
    await page.evaluate(({ cabin, pile }) => {
      window.oikos.build('woodcutter', cabin.x, cabin.z);
      window.oikos.build('stockpile', pile.x, pile.z);
    }, gathering);
    await page.evaluate(() => window.oikos.advance(600));
    const harbour = await page.evaluate(() => window.oikos.state.cities[0].harbour);
    console.log('harbour with lumber supply:', JSON.stringify({ tier: harbour.tier, stores: harbour.stores }));
    await page.evaluate(([x, z]) => window.oikos.focusTile(x, z), [harbour.x, harbour.z]);
    await paint(page);
    await page.screenshot({ path: `${output}/03-harbour.png` });
  }

  const stockpile = await page.evaluate(() => window.oikos.state.cities[0].buildings.find((building) => building.kind === 'stockpile'));
  if (stockpile) {
    await page.evaluate(([x, z]) => window.oikos.focusTile(x, z), [stockpile.x, stockpile.z]);
    await paint(page);
    await page.screenshot({ path: `${output}/04-stockpile-selected.png` });
  }
  assert.deepEqual(errors, []);
  console.log(`Wave5 probe passed. overlays=${JSON.stringify(fertile)}`);
} finally {
  await browser.close();
}

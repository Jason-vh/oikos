import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Authority } from '../src/server/authority';
import { initStore } from '../src/server/store';
import { applyCommand, type CityCommand } from '../src/sim/commands';
import { claimIsland } from '../src/sim/claims';
import { advance, roadPathPlacement } from '../src/sim/world';
import { islandFor } from '../src/sim/island';
import type { Tile } from '../src/sim/types';
import { Fixture, Connection, baselineCameraReload, clickTile, origin, paint, pendingKey, point, tool, world } from './shared-browser-fixture';
import { chooseDiscard, observeBlocked, pageReady } from './shared-browser-controls';

const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const baselineWorkaround = baselineCameraReload();
const fixture = new Fixture();
const output = fixture.artifactDirectory;
const results: Array<{ name: string; ok: boolean; evidence?: string }> = [];
async function check(name: string, action: () => Promise<void>) {
  try { await action(); results.push({ name, ok: true }); console.log(`PASS ${name}`); }
  catch (error) {
    const evidence = error instanceof Error ? error.message : String(error);
    results.push({ name, ok: false, evidence }); console.error(`FAIL ${name}: ${evidence}`);
    for (const [index, peer] of fixture.peers.entries()) await peer.page.screenshot({ path: `${output}/recovery-${results.length}-${index}.png` }).catch(() => {});
  }
}
async function command(peer: Connection, command: CityCommand, action: () => Promise<unknown>) {
  const expected = await world(peer.page);
  assert.equal(applyCommand(expected, peer.snapshot.session.ownedCityIds[0], command).ok, true);
  assert.notDeepEqual(expected, await world(peer.page));
  const result = await fixture.action(peer, action);
  assert.ok(result.type === 'receipt' && result.result.ok);
  advance(expected, .25);
  for (const peer of fixture.peers.filter((peer) => !peer.blocked)) assert.deepEqual(await world(peer.page), expected);
}
async function found(peer: Connection) {
  await peer.page.getByTestId('claim-available').click({ noWaitAfter: true });
  const choice = await peer.page.evaluate(() => {
    const map = (window as any).oikos.map;
    const { entry } = map.islands[1];
    if (map.terrain[(entry.z - 3) * map.width + entry.x] === 'water') throw new Error('Atlas target must be known land');
    const box = document.querySelector('[data-testid="claim-preview"]')!.getBoundingClientRect();
    return { x: box.left + (entry.x + .5) / map.width * box.width, y: box.top + (entry.z - 2.5) / map.depth * box.height };
  });
  await peer.page.mouse.click(choice.x, choice.y);
  assert.equal(await peer.page.getByTestId('claim-select').inputValue(), '1', 'real atlas land click selects its option value');
  await peer.page.getByTestId('claim-select').selectOption('0');
  const receipt = await fixture.action(peer, () => peer.page.getByTestId('claim-dialog').locator('button[value="confirm"]').click({ noWaitAfter: true }));
  assert.ok(receipt.type === 'receipt' && receipt.result.ok);
  if (baselineWorkaround) {
    await peer.page.reload();
    await peer.page.waitForFunction(() => document.body.dataset.ready === 'true');
  }
  const harbour = (await world(peer.page)).cities[0].harbour;
  await command(peer, { type: 'foundHarbour', x: harbour.x, z: harbour.z }, () => clickTile(peer.page, harbour));
}
async function site(peer: Connection): Promise<Tile[]> {
  const state = await world(peer.page);
  const city = state.cities[0];
  const map = islandFor(state.seed, city.home);
  for (let z = city.harbour.z - 6; z <= city.harbour.z + 5; z++) for (let x = city.harbour.x - 7; x <= city.harbour.x + 7; x++) {
    const tiles = [{ x, z }, { x: x + 1, z }];
    if (tiles.some((tile) => city.roads.includes(tile.z * map.width + tile.x)) || !roadPathPlacement(state, city, tiles).ok) continue;
    const exposed = await Promise.all(tiles.map(async (tile) => peer.page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.matches('#app canvas') === true, await point(peer.page, tile))));
    if (exposed.every(Boolean)) return tiles;
  }
  throw new Error('No visible legal mutable road stroke');
}
async function stroke(peer: Connection, tiles: Tile[], release = true) {
  const from = await point(peer.page, tiles[0]);
  const to = await point(peer.page, tiles.at(-1)!);
  await peer.page.mouse.move(from.x, from.y);
  await peer.page.mouse.down();
  await peer.page.mouse.move(to.x, to.y, { steps: 4 });
  if (release) await peer.page.mouse.up();
}
try {
  mkdirSync(output, { recursive: true });
  await fixture.start();
  const [a, b] = fixture.peers;
  await Promise.all(fixture.peers.map((peer, index) => fixture.join(peer, index)));
  await found(a);
  await check('disconnected claim controls deny a valid island and allow a fresh claim after readiness', async () => {
    const before = await world(b.page);
    const expected = structuredClone(before);
    assert.equal(claimIsland(expected, 1).ok, true);
    assert.notDeepEqual(expected, before);
    await b.page.getByTestId('claim-available').click({ noWaitAfter: true });
    await b.page.getByTestId('claim-select').selectOption('1');
    const confirm = b.page.getByTestId('claim-dialog').locator('button[value="confirm"]');
    assert.equal(await confirm.isEnabled(), true);
    b.disconnect();
    await observeBlocked(b);
    const disabled = await b.page.getByTestId('claim-available').isDisabled() && await confirm.isDisabled();
    const sent = b.sent.length;
    const navigations = b.navigations.length;
    const box = await confirm.boundingBox();
    if (box) await b.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await b.page.keyboard.press('Enter');
    await paint(b.page);
    assert.equal(b.sent.length, sent);
    assert.deepEqual(await world(b.page), before);
    await fixture.reconnect(b);
    assert.deepEqual(await world(b.page), before);
    assert.equal(b.sent.length, sent, 'offline intent is not automatically claimed on reconnect');
    assert.equal(b.navigations.length, navigations);
    if (!await b.page.getByTestId('claim-dialog').isVisible()) await b.page.getByTestId('claim-available').click({ noWaitAfter: true });
    await b.page.getByTestId('claim-select').selectOption('1');
    const result = await fixture.action(b, () => confirm.click({ noWaitAfter: true }));
    assert.ok(result.type === 'receipt' && result.result.ok);
    advance(expected, .25);
    assert.deepEqual(await world(b.page), expected);
    assert.equal(disabled, true, 'disconnected claim trigger and confirmation must be disabled');
  });
  let capturedJournal = '';
  const capturedTiles = await site(a);
  await tool(a.page, 'Road').click();
  await command(a, { type: 'roadPath', tiles: capturedTiles }, async () => {
    a.hold = true;
    await stroke(a, capturedTiles);
    await a.until(() => a.held.length === 1);
    capturedJournal = await a.page.evaluate((key) => sessionStorage.getItem(key)!, pendingKey);
    a.release();
  });
  assert.ok(capturedJournal, 'journal bytes came from a real durable UI request');
  await check('fresh SQLite realm cannot inherit a held mutable road gesture', async () => {
    const tiles = await site(a);
    await tool(a.page, 'Road').click();
    const oldRealm = a.snapshot.realmId;
    const oldBinding = a.snapshot.session.binding;
    await stroke(a, tiles, false);
    for (const peer of fixture.peers) peer.disconnect();
    await observeBlocked(a);
    await fixture.runtime!.stop();
    fixture.path = join(fixture.directory, 'replacement.db');
    initStore(fixture.path);
    const operator = Authority.open(fixture.path);
    try { fixture.invites = [operator.issueInvite(), operator.issueInvite()]; }
    finally { operator.close(); }
    fixture.startAuthority();
    await b.page.context().clearCookies();
    b.blocked = false;
    await fixture.join(b, 1);
    await found(b);
    const before = await world(b.page);
    const mutable = structuredClone(before);
    assert.equal(applyCommand(mutable, before.cities[0].id, { type: 'roadPath', tiles }).ok, true);
    assert.notDeepEqual(mutable, before, 'same footprint is genuinely mutable in the fresh realm');
    await a.page.context().addCookies(await b.page.context().cookies());
    const sent = a.sent.length;
    const navigations = a.navigations.length;
    await fixture.reconnect(a);
    assert.notEqual(a.snapshot.realmId, oldRealm);
    assert.notEqual(a.snapshot.session.binding, oldBinding);
    assert.equal(a.snapshot.realmId, b.snapshot.realmId);
    await pageReady(a, true);
    assert.equal(await tool(a.page, 'Road').isEnabled(), true);
    await a.page.mouse.up();
    await paint(a.page);
    if (a.sent.length > sent) {
      await a.until(() => a.packets.some((packet) => packet.type === 'receipt' && packet.requestId === JSON.parse(a.sent.at(-1)!).requestId));
      await fixture.sync();
      advance(mutable, .25);
      assert.deepEqual(await world(a.page), mutable, 'exact forbidden mutation belongs to the new realm');
    }
    assert.equal(a.navigations.length, navigations, 'realm replacement did not reload the browser');
    assert.equal(a.sent.length, sent, 'old gesture did not acquire fresh realm authority');
    assert.deepEqual(await world(a.page), before);
  });
  await check('real mismatched journal outcome survives asynchronous bootstrap visibly without retargeting', async () => {
    const before = await world(a.page);
    const envelope = JSON.parse(capturedJournal);
    assert.notEqual(envelope.realmId, a.snapshot.realmId);
    assert.notEqual(envelope.binding, a.snapshot.session.binding);
    const operation = JSON.parse(envelope.wire).operation;
    const mutable = structuredClone(before);
    assert.equal(applyCommand(mutable, operation.cityId, operation.command).ok, true);
    assert.notDeepEqual(mutable, before, 'captured old intent has a genuinely mutable target in this realm');
    const sent = a.sent.length;
    await a.page.evaluate(({ key, journal }) => sessionStorage.setItem(key, journal), { key: pendingKey, journal: capturedJournal });
    await a.page.reload();
    await a.page.waitForFunction(() => document.body.dataset.ready === 'true');
    await pageReady(a, true);
    assert.deepEqual(await world(a.page), before);
    assert.equal(a.sent.length, sent, 'no old or rewritten intent is sent during bootstrap');
    assert.ok(await a.page.getByText('The realm or login changed. Old intent will never be sent to this session.', { exact: true }).filter({ visible: true }).count(), 'preboot recovery outcome must be visible');
  });
  await check('failed confirmed journal removal preserves bytes and World until a verified fresh retry', async () => {
    const tiles = await site(a);
    const before = await world(a.page);
    await tool(a.page, 'Road').click();
    a.hold = true;
    await stroke(a, tiles);
    await a.until(() => a.held.length === 1);
    const journal = await a.page.evaluate((key) => sessionStorage.getItem(key), pendingKey);
    assert.ok(journal);
    a.disconnect(); a.held = []; a.hold = false;
    await a.page.evaluate((key) => {
      const remove = Storage.prototype.removeItem;
      (window as any).restoreRemoval = () => { Storage.prototype.removeItem = remove; };
      Storage.prototype.removeItem = function(candidate) {
        if (this === sessionStorage && candidate === key) throw new DOMException('Injected pending removal failure', 'SecurityError');
        remove.call(this, candidate);
      };
    }, pendingKey);
    try {
      await fixture.reconnect(a, 'snapshot');
      await chooseDiscard(a, true);
      assert.equal(await a.page.evaluate((key) => sessionStorage.getItem(key), pendingKey), journal);
      assert.deepEqual(await world(a.page), before);
      const disabled = await tool(a.page, 'Road').isDisabled();
      const sent = a.sent.length;
      await a.page.keyboard.press('1');
      await stroke(a, tiles);
      await paint(a.page);
      assert.equal(a.sent.length, sent);
      assert.deepEqual(await world(a.page), before, 'failed removal never enables a valid pending target');
      assert.equal(await a.page.evaluate((key) => sessionStorage.getItem(key), pendingKey), journal);
      await a.page.evaluate(() => (window as any).restoreRemoval());
      const count = a.packets.length;
      await chooseDiscard(a, true);
      await a.until(() => a.packets.slice(count).some((packet) => packet.type === 'snapshot'));
      await pageReady(a, true);
      assert.equal(await a.page.evaluate((key) => sessionStorage.getItem(key), pendingKey), null);
      await tool(a.page, 'Road').click();
      await command(a, { type: 'roadPath', tiles }, () => stroke(a, tiles));
      assert.notEqual(JSON.parse(a.sent.at(-1)!).requestId, JSON.parse(journal).requestId);
      assert.equal(disabled, true, 'failed removal leaves construction controls disabled');
    } finally { await a.page.evaluate(() => (window as any).restoreRemoval()); }
  });
  await check('shared menu promises no local durability and exposes no whole-world undo', async () => {
    const before = await world(a.page);
    const sent = a.sent.length;
    await a.page.getByTestId('menu').click({ noWaitAfter: true });
    const menu = a.page.getByTestId('menu-dialog');
    let text = '';
    try {
      text = await menu.innerText();
      for (const name of ['save', 'load', 'export', 'import', 'new-island']) assert.equal(await a.page.getByTestId(name).isVisible(), false);
    } finally { await menu.getByRole('button', { name: 'Close', exact: true }).click({ noWaitAfter: true }); }
    assert.equal(await a.page.getByTestId('undo').isVisible(), false);
    await a.page.keyboard.press('Control+z');
    await paint(a.page);
    assert.deepEqual(await world(a.page), before, 'real shared construction is not rolled back locally');
    assert.equal(a.sent.length, sent);
    assert.equal(/autosaves?\s+locally|checkpoints?\s+stay/i.test(text), false, 'shared menu must not promise local autosaves/checkpoints');
  });
  await check('native reduced motion freezes cosmetics but renders authoritative animal movement', async () => {
    await a.page.reload();
    await a.page.waitForFunction(() => document.body.dataset.ready === 'true');
    await a.page.mouse.move(720, 550);
    await a.page.mouse.wheel(0, 800);
    await paint(a.page, 8);
    const before = await world(a.page);
    const frozenCamera = await a.page.evaluate(() => (window as any).oikos.camera);
    const initial = await a.page.evaluate((animals) => animals.filter((animal) => ['boar', 'rabbit'].includes(animal.kind) && animal.respawn === 0).flatMap((animal) => {
      const expected = (window as any).oikos.projectPoint(animal.x, animal.z, .5);
      if (expected.y < 200 || expected.y > innerHeight - 150 || !document.elementFromPoint(expected.x, expected.y)?.matches('#app canvas')) return [];
      return [{ id: animal.id, actual: (window as any).oikos.projectWalker(animal.id), expected }];
    }), before.wildlife);
    assert.ok(initial.length > 0, 'land animals are visible at normal city zoom');
    const foam = await a.page.evaluate(() => (window as any).oikos.foamVersion);
    await paint(a.page, 12);
    assert.equal(await a.page.evaluate(() => (window as any).oikos.foamVersion), foam);
    for (let tick = 0; tick < 8; tick++) await fixture.sync();
    const after = await world(a.page);
    const moved = after.wildlife.filter((animal) => animal.respawn === 0 && initial.some((pose) => pose.id === animal.id) && before.wildlife.some((old) => old.id === animal.id && Math.hypot(old.x - animal.x, old.z - animal.z) > .5));
    await paint(a.page, 6);
    const positions = await a.page.evaluate((animals) => {
      for (const animal of animals) {
        const expected = (window as any).oikos.projectPoint(animal.x, animal.z, .5);
        if (expected.y >= 200 && expected.y < innerHeight - 150 && document.elementFromPoint(expected.x, expected.y)?.matches('#app canvas')) return { id: animal.id, actual: (window as any).oikos.projectWalker(animal.id), expected };
      }
      return null;
    }, moved);
    assert.ok(positions?.actual, 'visible authoritative land animal moved at least half a tile over eight real ticks');
    const baseline = initial.find((pose) => pose.id === positions.id)!;
    assert.ok(Math.hypot(baseline.actual.x - baseline.expected.x, baseline.actual.y - baseline.expected.y) < .1, 'initial rendered pose aligns with the same projection');
    assert.deepEqual(await a.page.evaluate(() => (window as any).oikos.camera), frozenCamera, 'camera stayed frozen');
    assert.ok(Math.hypot(positions.expected.x - baseline.expected.x, positions.expected.y - baseline.expected.y) > 5, 'authoritative movement exceeds five pixels');
    assert.ok(Math.hypot(positions.actual.x - positions.expected.x, positions.actual.y - positions.expected.y) < .1, `rendered animal must follow authoritative snapshot: ${JSON.stringify({ baseline, ...positions })}`);
    const stopped = await a.page.evaluate(() => (window as any).oikos.foamVersion);
    await paint(a.page, 12);
    assert.equal(await a.page.evaluate(() => (window as any).oikos.foamVersion), stopped);
  });
  await check('desktop and mobile shared scenes preserve World and usable viewport', async () => {
    await a.page.mouse.wheel(0, -800);
    await paint(a.page, 8);
    const before = await world(a.page);
    await a.page.keyboard.press('Escape');
    await a.page.screenshot({ path: `${output}/recovery-desktop.png` });
    await a.page.setViewportSize({ width: 390, height: 844 });
    await a.page.keyboard.press('h');
    await paint(a.page, 8);
    assert.equal(await a.page.getByTestId('menu').isVisible(), true);
    assert.equal(await a.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(await world(a.page), before);
    await a.page.screenshot({ path: `${output}/recovery-mobile.png` });
  });
  await check('asynchronous renderer bootstrap failure remains visible and handled', async () => {
    const page = await a.page.context().newPage();
    page.setDefaultTimeout(12000);
    const peer = new Connection(page);
    await peer.install(true);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const canvas = HTMLCanvasElement.prototype as any;
      const getContext = canvas.getContext;
      canvas.getContext = function(this: HTMLCanvasElement, kind: string, ...args: unknown[]) {
        if (kind === 'webgl2') {
          (window as any).bootFailureInjected = true;
          throw new Error('Injected asynchronous WebGL bootstrap failure');
        }
        return getContext.call(this, kind, ...args);
      };
    });
    try {
      await page.goto(`${origin}/shared.html?debug`);
      await peer.until(() => peer.packets.some((packet) => packet.type === 'snapshot'));
      assert.deepEqual(peer.snapshot.world, await world(a.page), 'real authoritative snapshot reached the failing bootstrap');
      await page.waitForFunction(() => (window as any).bootFailureInjected === true);
      await paint(page);
      assert.deepEqual(errors, [], 'async bootstrap failure must not escape its callback');
      await page.getByText(/could not|WebGL|failed/i).filter({ visible: true }).first().waitFor();
      assert.notEqual(await page.getAttribute('body', 'data-ready'), 'true');
    } finally {
      await page.screenshot({ path: `${output}/async-boot-error.png` }).catch(() => {});
      await page.close();
    }
  });
} catch (error) {
  results.push({ name: 'fixture/setup', ok: false, evidence: error instanceof Error ? error.stack : String(error) });
  console.error(error);
} finally {
  await fixture.close();
  const report = JSON.stringify({ revision, artifacts: output, baselineCameraReload: baselineWorkaround, results }, null, 2);
  writeFileSync(`${output}/recovery-report.json`, report);
  writeFileSync('artifacts/shared-browser/recovery-report.json', report);
}
if (results.some((result) => !result.ok)) process.exitCode = 1;

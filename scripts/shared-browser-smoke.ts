import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { advance, createWorld, placement, roadPathPlacement } from '../src/sim/world';
import { applyCommand, type CityCommand } from '../src/sim/commands';
import { claimIsland } from '../src/sim/claims';
import { islandFor } from '../src/sim/island';
import { serializeWorld } from '../src/sim/save';
import type { Tile } from '../src/sim/types';
import { Fixture, type Connection, baselineCameraReload, clickTile, paint, pendingKey, point, tool, world } from './shared-browser-fixture';
import { chooseDiscard, observeBlocked, pageReady } from './shared-browser-controls';

const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const baselineWorkaround = baselineCameraReload();
const fixture = new Fixture();
const output = fixture.artifactDirectory;
const results: Array<{ name: string; ok: boolean; evidence?: string }> = [];
async function check(name: string, run: () => Promise<void>) {
  try { await run(); results.push({ name, ok: true }); console.log(`PASS ${name}`); }
  catch (error) {
    const evidence = error instanceof Error ? error.message : String(error);
    results.push({ name, ok: false, evidence }); console.error(`FAIL ${name}: ${evidence}`);
    for (const [index, peer] of fixture.peers.entries()) await peer.page.screenshot({ path: `${output}/${results.length}-${index}.png` }).catch(() => {});
  }
}
async function claimForm(peer: Connection, home: number) {
  if (!await peer.page.getByTestId('claim-dialog').isVisible()) await peer.page.getByTestId('claim-available').click();
  await peer.page.getByTestId('claim-select').selectOption(String(home));
}
async function submitClaim(peer: Connection) { await peer.page.getByTestId('claim-dialog').locator('button[type="submit"][value="confirm"]').click(); }
async function exactCommand(peer: Connection, cityId: number, command: CityCommand, action: () => Promise<unknown>) {
  const expected = await world(peer.page);
  const result = applyCommand(expected, cityId, command);
  assert.equal(result.ok, true, `known valid mutable target: ${result.reason}`);
  const before = await world(peer.page);
  assert.notDeepEqual(expected, before, 'baseline command actually changes World');
  const receipt = await fixture.action(peer, action);
  assert.ok(receipt.type === 'receipt' && receipt.result.ok, JSON.stringify(receipt));
  const request = JSON.parse(peer.sent.at(-1)!);
  assert.deepEqual(request.operation, { kind: 'command', cityId, command });
  advance(expected, .25);
  for (const other of fixture.peers.filter((other) => !other.blocked)) assert.deepEqual(await world(other.page), expected, 'exact authoritative World delta in both render clients');
}
async function ownId(peer: Connection) { return peer.snapshot.session.ownedCityIds[0]; }
async function camera(peer: Connection) { return peer.page.evaluate(() => (window as any).oikos.camera); }
async function home(peer: Connection) { await peer.page.keyboard.press('h'); await paint(peer.page, 8); }
async function roadSite(peer: Connection, cityId: number): Promise<Tile[]> {
  const state = await world(peer.page);
  const city = state.cities.find((city) => city.id === cityId)!;
  const map = islandFor(state.seed, city.home);
  for (let z = city.harbour.z - 6; z <= city.harbour.z + 5; z++) for (let x = city.harbour.x - 7; x <= city.harbour.x + 7; x++) {
    const tiles = [{ x, z }, { x: x + 1, z }];
    if (tiles.some((tile) => city.roads.includes(tile.z * map.width + tile.x))) continue;
    if (!roadPathPlacement(state, city, tiles).ok) continue;
    const visible = await Promise.all(tiles.map(async (tile) => {
      const p = await point(peer.page, tile);
      return peer.page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.matches('#app canvas') === true, p);
    }));
    if (visible.every(Boolean)) return tiles;
  }
  throw new Error('No legal exposed two-tile road stroke');
}
async function drag(peer: Connection, tiles: Tile[], release = true) {
  const start = await point(peer.page, tiles[0]);
  const end = await point(peer.page, tiles.at(-1)!);
  await peer.page.mouse.move(start.x, start.y);
  await peer.page.mouse.down();
  await peer.page.mouse.move(end.x, end.y, { steps: 4 });
  if (release) await peer.page.mouse.up();
}
async function confirmDiscard(peer: Connection, journal: string) {
  const navigations = peer.navigations.length;
  assert.equal(await peer.page.getByTestId('discard-pending').isVisible(), true, 'blocked session exposes recovery');
  await chooseDiscard(peer, false);
  assert.equal(await peer.page.evaluate((key) => sessionStorage.getItem(key), pendingKey), journal, 'cancel preserves exact pending bytes');
  const packets = peer.packets.length;
  await chooseDiscard(peer, true);
  await peer.until(() => peer.packets.slice(packets).some((packet) => packet.type === 'snapshot'));
  await peer.page.waitForFunction((key) => sessionStorage.getItem(key) === null, pendingKey);
  await pageReady(peer, true);
  assert.equal(peer.navigations.length, navigations, 'confirmed recovery did not navigate');
}

try {
  mkdirSync(output, { recursive: true });
  await fixture.start();
  const [a, b] = fixture.peers;
  const local = createWorld(2);
  const localSave = serializeWorld(local);
  const localView = JSON.stringify({ seed: 2, home: local.cities[0].home, view: { target: [12, 1.15, 9], offset: [35, 38, 48], size: 36, zoom: 1.4 } });
  await a.page.addInitScript(({ localSave, localView }) => {
    if (localStorage.getItem('oikos.island.v1') === null) {
      localStorage.setItem('oikos.island.v1', localSave);
      localStorage.setItem('oikos.checkpoint.v1', localSave);
      localStorage.setItem('oikos.view.v1', localView);
    }
  }, { localSave, localView });
  await Promise.all(fixture.peers.map((peer, index) => fixture.join(peer, index)));
  await check('secure independent real invites and protocol 2', async () => {
    assert.equal(a.snapshot.realmId, b.snapshot.realmId);
    assert.notEqual(a.snapshot.session.binding, b.snapshot.session.binding);
    assert.deepEqual(await world(a.page), await world(b.page));
    assert.equal(a.snapshot.world.cities.length, 0);
    assert.notEqual((await a.page.context().cookies())[0].value, (await b.page.context().cookies())[0].value);
  });
  await check('shared HUD actually hides local pause controls and the ready connection panel', async () => {
    assert.equal(await a.page.locator('.hud-speed').isVisible(), false, 'hidden attribute must win over HUD display styles');
    assert.equal(await a.page.getByTestId('connection').isVisible(), false, 'ready connection panel is not an empty visible strip');
    await a.page.keyboard.press('Escape');
    for (const name of ['save', 'load', 'export', 'import', 'new-island']) assert.equal(await a.page.getByTestId(name).isVisible(), false);
    await a.page.keyboard.press('Escape');
  });
  let claimControlsDisabled: boolean[] = [];
  await check('two actors race the same selectable unclaimed island atomically', async () => {
    const before = await world(a.page);
    const navigations = fixture.peers.map((peer) => peer.navigations.length);
    await Promise.all(fixture.peers.map((peer) => claimForm(peer, 0)));
    for (const peer of fixture.peers) peer.hold = true;
    await Promise.all(fixture.peers.map(submitClaim));
    await Promise.all(fixture.peers.map((peer) => peer.until(() => peer.held.length === 1)));
    claimControlsDisabled = await Promise.all(fixture.peers.map(async (peer) => await peer.page.getByTestId('claim-available').isDisabled() && await peer.page.getByTestId('claim-dialog').locator('button[value="confirm"]').isDisabled()));
    const counts = fixture.peers.map((peer) => peer.packets.length);
    for (const peer of fixture.peers) peer.release();
    await Promise.all(fixture.peers.map((peer, index) => peer.until(() => peer.packets.slice(counts[index]).some((packet) => packet.type === 'receipt'))));
    const receipts = fixture.peers.map((peer, index) => peer.packets.slice(counts[index]).find((packet) => packet.type === 'receipt')!);
    assert.equal(receipts.filter((receipt) => receipt.type === 'receipt' && receipt.result.ok).length, 1);
    assert.equal(claimIsland(before, 0).ok, true);
    assert.equal(claimIsland(before, 0).ok, false);
    await fixture.sync();
    for (const peer of fixture.peers) assert.deepEqual(await world(peer.page), before, 'one city and exact allocator/World delta, loser adds nothing');
    assert.equal(fixture.peers.filter((peer) => peer.snapshot.session.ownedCityIds.length === 1).length, 1);
    assert.deepEqual(fixture.peers.map((peer) => peer.navigations.length), navigations, 'claim submissions did not navigate');
  });
  await check('in-flight claim trigger and confirmation are disabled in both browsers', async () => {
    assert.deepEqual(claimControlsDisabled, [true, true]);
  });
  const winner = fixture.peers.find((peer) => peer.snapshot.session.ownedCityIds.length === 1)!;
  assert.ok(winner, 'race setup produced one winner');
  const loser = fixture.peers.find((peer) => peer !== winner)!;
  await check('claim loser sees rejection without automatic repick or second claim', async () => {
    const before = await world(loser.page);
    const sent = loser.sent.length;
    const receipt = loser.packets.findLast((packet) => packet.type === 'receipt');
    assert.ok(receipt?.type === 'receipt' && !receipt.result.ok);
    await fixture.sync();
    assert.deepEqual(await world(loser.page), before);
    assert.equal(loser.sent.length, sent);
    assert.equal(loser.snapshot.session.ownedCityIds.length, 0);
    assert.equal(await loser.page.getByTestId('claim-select').inputValue(), '0', 'loser selection is not silently repicked');
    assert.ok(await loser.page.getByText(receipt.result.reason, { exact: true }).filter({ visible: true }).count(), 'claim rejection must be visible outside a closed dialog');
  });
  await check('claimed island option and its confirmation are unavailable', async () => {
    assert.equal(await loser.page.getByTestId('claim-select').locator('option[value="0"]').evaluate((option) => (option as HTMLOptionElement).disabled), true, 'the claimed island stays unselectable');
    assert.equal(await loser.page.getByTestId('claim-dialog').locator('button[value="confirm"]').isDisabled(), true, 'confirmation is unavailable while a claimed island is selected');
  });
  await check('first claim focuses the actual harbour without debug camera setters', async () => {
    const claimed = (await world(winner.page)).cities[0];
    const p = await point(winner.page, claimed.harbour);
    assert.equal(await winner.page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.matches('#app canvas') === true, p), true, `new harbour must be visible, projected ${JSON.stringify(p)}`);
    const initial = await camera(winner);
    assert.ok(initial[1] - initial[4] > 10 && Math.hypot(initial[0] - initial[3], initial[2] - initial[5]) > 10, 'first claim has an elevated isometric view');
    await home(winner);
    assert.deepEqual(initial, await camera(winner), 'first claim starts at the same useful village camera as H');
  });
  await home(winner);
  await claimForm(loser, 1);
  await fixture.action(loser, () => submitClaim(loser));
  await check('nonzero-home claim aligns scene map and landing with the active city', async () => {
    const context = await loser.page.evaluate(() => {
      const game = (window as any).oikos;
      const city = game.state.cities.find((candidate: any) => candidate.id === game.cityContext.activeId);
      return { map: { home: game.map.home, entry: game.map.entry }, home: city.home, landing: { x: city.harbour.x, z: city.harbour.z } };
    });
    assert.notEqual(context.home, 0);
    assert.equal(context.map.home, context.home, 'the scene map follows the newly owned island');
    const island = await loser.page.evaluate((home) => (window as any).oikos.map.islands[home], context.home);
    assert.ok(
      context.landing.x >= island.x && context.landing.x < island.x + island.width && context.landing.z >= island.z && context.landing.z < island.z + island.depth,
      `the landing ${JSON.stringify(context.landing)} sits on the owned island ${JSON.stringify(island)}`,
    );
  });
  await home(loser);
  for (const peer of fixture.peers) {
    if (baselineWorkaround) {
      await peer.page.reload();
      await peer.page.waitForFunction(() => document.body.dataset.ready === 'true');
    }
    const id = await ownId(peer);
    const city = (await world(peer.page)).cities.find((city) => city.id === id)!;
    if (peer === a) await check('offline inspect gesture cannot become founding after reconnect', async () => {
      const before = await world(peer.page);
      const mutable = structuredClone(before);
      assert.equal(applyCommand(mutable, id, { type: 'foundHarbour', x: city.harbour.x, z: city.harbour.z }).ok, true);
      assert.notDeepEqual(mutable, before);
      peer.disconnect();
      await observeBlocked(peer);
      const p = await point(peer.page, city.harbour);
      const sent = peer.sent.length;
      await peer.page.mouse.move(p.x, p.y);
      await peer.page.mouse.down();
      await fixture.reconnect(peer);
      await pageReady(peer, true);
      assert.equal(await peer.page.evaluate(({ x, z }) => (window as any).oikos.foundingPlacement(x, z).ok, city.harbour), true);
      await peer.page.mouse.up();
      await paint(peer.page);
      if (peer.sent.length > sent) {
        await peer.until(() => peer.packets.some((packet) => packet.type === 'receipt' && packet.requestId === JSON.parse(peer.sent.at(-1)!).requestId));
        await fixture.sync();
        advance(mutable, .25);
        assert.deepEqual(await world(peer.page), mutable);
      }
      assert.equal(peer.sent.length, sent, 'offline inspection must not gain founding authority at pointerup');
      assert.deepEqual(await world(peer.page), before);
    });
    if (!(await world(peer.page)).cities.find((city) => city.id === id)!.founded) await exactCommand(peer, id, { type: 'foundHarbour', x: city.harbour.x, z: city.harbour.z }, () => clickTile(peer.page, city.harbour));
    if (peer === a) await check('same-realm actor replacement cannot promote a foreign inspection gesture to founding', async () => {
      const originalCookies = await a.page.context().cookies();
      const originalBinding = a.snapshot.session.binding;
      const otherId = await ownId(b);
      const other = (await world(a.page)).cities.find((city) => city.id === otherId)!;
      assert.equal(other.founded, false);
      await a.page.getByTestId('cities').getByRole('button', { name: `City ${otherId}`, exact: true }).click();
      await paint(a.page, 8);
      const visitingCamera = await camera(a);
      const before = await world(a.page);
      const mutable = structuredClone(before);
      assert.equal(applyCommand(mutable, otherId, { type: 'foundHarbour', x: other.harbour.x, z: other.harbour.z }).ok, true);
      try {
        a.disconnect();
        await observeBlocked(a);
        const p = await point(a.page, other.harbour);
        await a.page.mouse.move(p.x, p.y);
        await a.page.mouse.down();
        await a.page.context().addCookies(await b.page.context().cookies());
        const sent = a.sent.length;
        await fixture.reconnect(a);
        assert.equal(a.snapshot.realmId, b.snapshot.realmId);
        assert.notEqual(a.snapshot.session.binding, originalBinding);
        assert.deepEqual(a.snapshot.session.ownedCityIds, [otherId]);
        await pageReady(a, true);
        assert.equal(await a.page.evaluate(({ x, z }) => (window as any).oikos.foundingPlacement(x, z).ok, other.harbour), true);
        await a.page.mouse.up();
        await paint(a.page);
        if (a.sent.length > sent) {
          await a.until(() => a.packets.some((packet) => packet.type === 'receipt' && packet.requestId === JSON.parse(a.sent.at(-1)!).requestId));
          await fixture.sync();
          advance(mutable, .25);
          assert.deepEqual(await world(a.page), mutable);
        }
        assert.equal(a.sent.length, sent, 'foreign read-only drag cannot acquire replacement login authority');
        assert.deepEqual(await world(a.page), before);
      } finally {
        await a.page.mouse.up();
        a.disconnect();
        await a.page.context().addCookies(originalCookies);
        await fixture.reconnect(a);
        await check('same-realm login change preserves the existing viewed city and camera', async () => {
          const context = await a.page.evaluate(() => (window as any).oikos.cityContext);
          assert.equal(context.activeId, id);
          assert.equal(context.viewedId, otherId);
          assert.deepEqual(await camera(a), visitingCamera);
        });
        await a.page.getByTestId('cities').getByRole('button', { name: 'Your city', exact: true }).click();
        await home(a);
      }
    });
  }
  await check('toolbar road stroke has exact World delta in both browsers', async () => {
    const id = await ownId(a);
    const tiles = await roadSite(a, id);
    await tool(a.page, 'Road').click();
    await exactCommand(a, id, { type: 'roadPath', tiles }, () => drag(a, tiles));
  });
  await check('actual toolbar building and inspector vendor mutate exact World', async () => {
    const id = await ownId(b);
    const before = await world(b.page);
    const city = before.cities.find((city) => city.id === id)!;
    let site: Tile | undefined;
    for (let z = city.harbour.z - 7; z < city.harbour.z + 5 && !site; z++) for (let x = city.harbour.x - 6; x < city.harbour.x + 6; x++) {
      if (!placement(before, city, 'agora', x, z, 0).ok) continue;
      const p = await point(b.page, { x, z });
      if (await b.page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.matches('#app canvas') === true, p)) { site = { x, z }; break; }
    }
    assert.ok(site, 'legal visible agora footprint');
    await tool(b.page, 'Agora').click();
    await exactCommand(b, id, { type: 'build', tool: 'agora', ...site, rotation: 0 }, () => clickTile(b.page, site!));
    const building = (await world(b.page)).cities.find((city) => city.id === id)!.buildings.find((building) => building.kind === 'agora')!;
    if (await b.page.getByTestId('toolbar').locator('[aria-pressed="true"]').count()) await b.page.keyboard.press('Escape');
    assert.equal(await b.page.getByTestId('menu-dialog').isVisible(), false, 'inspection does not open the menu');
    const p = await b.page.evaluate((id) => (window as any).oikos.projectBuilding(id), building.id);
    await b.page.mouse.click(p.x, p.y);
    await exactCommand(b, id, { type: 'vendor', id: building.id, enabled: true }, () => b.page.getByTestId('vendor-toggle').click());
  });
  await check('visiting foreign city denies a known mutable road; owner can remove it', async () => {
    const id = await ownId(b);
    const tiles = await roadSite(b, id);
    await tool(b.page, 'Road').click();
    await exactCommand(b, id, { type: 'roadPath', tiles }, () => drag(b, tiles));
    const before = await world(a.page);
    const valid = structuredClone(before);
    assert.equal(applyCommand(valid, id, { type: 'demolish', ...tiles[0] }).ok, true);
    assert.notDeepEqual(valid, before, 'foreign target is a removable existing road');
    await a.page.getByTestId('cities').getByRole('button', { name: `City ${id}`, exact: true }).click();
    await paint(a.page, 8);
    const sent = a.sent.length;
    assert.equal(await tool(a.page, 'Demolish').isDisabled(), true);
    await a.page.keyboard.press('x');
    await clickTile(a.page, tiles[0]);
    await fixture.sync();
    advance(before, .25);
    assert.deepEqual(await world(a.page), before, 'foreign visit changes no World field beyond scheduled simulation');
    assert.equal(a.sent.length, sent);
    await tool(b.page, 'Demolish').click();
    await exactCommand(b, id, { type: 'demolish', ...tiles[0] }, () => clickTile(b.page, tiles[0]));
    await a.page.getByTestId('cities').getByRole('button', { name: 'Your city', exact: true }).click();
    await paint(a.page, 8);
    const atHome = await camera(a);
    await a.page.keyboard.press('q');
    await paint(a.page, 8);
    assert.notDeepEqual(await camera(a), atHome, 'actual Q changes camera');
    await home(a);
  });
  await check('disconnected write controls disable and valid intent cannot mutate', async () => {
    const id = await ownId(a);
    const tiles = await roadSite(a, id);
    await tool(a.page, 'Road').click();
    const before = await world(a.page);
    const sent = a.sent.length;
    a.disconnect();
    await observeBlocked(a);
    const disabled = await a.page.getByTestId('toolbar').locator('button').evaluateAll((buttons) => buttons.every((button) => (button as HTMLButtonElement).disabled));
    await drag(a, tiles);
    assert.deepEqual(await world(a.page), before);
    assert.equal(a.sent.length, sent, 'offline valid construction was not transmitted');
    await fixture.reconnect(a);
    assert.deepEqual(await world(a.page), before, 'denied intent never reappears on reconnect');
    assert.equal(await tool(a.page, 'Road').isEnabled(), true);
    assert.equal(disabled, true, 'road construction control must be disabled while disconnected');
  });
  await check('disconnected inspector vendor is disabled and cannot change a live market', async () => {
    const id = await ownId(b);
    const state = await world(b.page);
    const market = state.cities.find((city) => city.id === id)!.buildings.find((building) => building.kind === 'agora')!;
    assert.ok(market?.vendorEnabled, 'known active vendor can be paused');
    const expected = structuredClone(state);
    assert.equal(applyCommand(expected, id, { type: 'vendor', id: market.id, enabled: false }).ok, true);
    assert.notDeepEqual(expected, state);
    if (await b.page.getByTestId('toolbar').locator('[aria-pressed="true"]').count()) await b.page.keyboard.press('Escape');
    assert.equal(await b.page.getByTestId('menu-dialog').isVisible(), false, 'inspection does not open the menu');
    const p = await b.page.evaluate((id) => (window as any).oikos.projectBuilding(id), market.id);
    await b.page.mouse.click(p.x, p.y);
    b.disconnect();
    await observeBlocked(b);
    await b.page.mouse.click(p.x, p.y);
    await paint(b.page);
    const vendor = b.page.getByTestId('vendor-toggle');
    const disabled = await vendor.isDisabled();
    const box = await vendor.boundingBox();
    assert.ok(box);
    const sent = b.sent.length;
    await b.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await paint(b.page);
    assert.equal(b.sent.length, sent);
    assert.deepEqual(await world(b.page), state);
    await fixture.reconnect(b);
    await b.page.mouse.click(p.x, p.y);
    await paint(b.page);
    assert.equal(await vendor.isEnabled(), true);
    assert.deepEqual(await world(b.page), state);
    assert.equal(disabled, true, 'disconnected market inspector cannot advertise a writable vendor');
    await exactCommand(b, id, { type: 'vendor', id: market.id, enabled: false }, () => vendor.click());
  });
  await check('stale road drag cannot commit after disconnect and reconnect', async () => {
    const id = await ownId(a);
    const tiles = await roadSite(a, id);
    await tool(a.page, 'Road').click();
    const before = await world(a.page);
    const sent = a.sent.length;
    await drag(a, tiles, false);
    a.disconnect();
    await observeBlocked(a);
    await fixture.reconnect(a);
    await pageReady(a, true);
    assert.equal(await tool(a.page, 'Road').isEnabled(), true);
    await a.page.mouse.up();
    await paint(a.page);
    const staleSent = a.sent.length > sent;
    if (staleSent) {
      await a.until(() => a.packets.some((packet) => packet.type === 'receipt' && packet.requestId === JSON.parse(a.sent.at(-1)!).requestId));
      await fixture.sync();
      const committed = structuredClone(before);
      assert.equal(applyCommand(committed, id, { type: 'roadPath', tiles }).ok, true);
      advance(committed, .25);
      assert.deepEqual(await world(a.page), committed, 'stale gesture caused the exact forbidden construction delta');
    }
    const after = await world(a.page);
    assert.ok(JSON.stringify(after) === JSON.stringify(before), `stale drag transmitted=${staleSent}; roads ${before.cities.find((city) => city.id === id)!.roads.length} -> ${after.cities.find((city) => city.id === id)!.roads.length}; mutable road target must remain absent`);
    assert.equal(staleSent, false);
  });
  await check('application-delivery ACK loss survives authority restart and exact replay preserves a rebuilt road', async () => {
    const id = await ownId(a);
    const tiles = await roadSite(a, id);
    await tool(a.page, 'Road').click();
    await exactCommand(a, id, { type: 'roadPath', tiles }, () => drag(a, tiles));
    await tool(a.page, 'Demolish').click();
    const expected = await world(a.page);
    assert.equal(applyCommand(expected, id, { type: 'demolish', ...tiles[0] }).ok, true);
    a.dropReceiptDelivery = true;
    const count = a.packets.length;
    await clickTile(a.page, tiles[0]);
    await a.until(() => a.packets.slice(count).some((packet) => packet.type === 'receipt'));
    const journal = await a.page.evaluate((key) => sessionStorage.getItem(key), pendingKey);
    assert.ok(journal, 'intercepted ACK delivery loss preserves exact durable request');
    const envelope = JSON.parse(journal);
    const oldStream = a.snapshot.streamId;
    const oldRealm = a.snapshot.realmId;
    await fixture.sync();
    advance(expected, .25);
    assert.deepEqual(await world(b.page), expected, 'other actor sees committed mutation despite ACK loss');
    const sent = a.sent.length;
    await fixture.restart();
    await a.until(() => a.packets.some((packet) => packet.type === 'receipt' && packet.requestId === envelope.requestId && packet.result.status === 'replayed'));
    await fixture.sync();
    advance(expected, .25);
    assert.notEqual(a.snapshot.streamId, oldStream);
    assert.equal(a.snapshot.realmId, oldRealm);
    assert.deepEqual(a.sent.slice(sent), [envelope.wire]);
    assert.deepEqual(await world(a.page), expected, 'persisted World continues with no repeated mutation');
    assert.equal(await a.page.evaluate((key) => sessionStorage.getItem(key), pendingKey), null);
    await tool(a.page, 'Road').click();
    await exactCommand(a, id, { type: 'roadPath', tiles: [tiles[0]] }, () => clickTile(a.page, tiles[0]));
    const rebuilt = await world(a.page);
    const countBeforeReload = a.sent.length;
    const packetsBeforeReload = a.packets.length;
    await a.page.evaluate(({ key, journal }) => sessionStorage.setItem(key, journal), { key: pendingKey, journal });
    await a.page.reload();
    await a.page.waitForFunction(() => document.body.dataset.ready === 'true');
    await a.until(() => a.sent.length > countBeforeReload);
    await a.until(() => a.packets.slice(packetsBeforeReload).some((packet) => packet.type === 'receipt' && packet.requestId === envelope.requestId && packet.result.status === 'replayed'));
    await fixture.sync();
    advance(rebuilt, .25);
    assert.deepEqual(a.sent.slice(countBeforeReload), [envelope.wire]);
    assert.deepEqual(await world(a.page), rebuilt, 'old demolition receipt cannot remove known rebuilt mutable road');
    assert.equal(await a.page.evaluate((key) => sessionStorage.getItem(key), pendingKey), null);
  });
  await check('unconsumed indeterminate intent stays read-only until confirmed discard', async () => {
    const id = await ownId(a);
    const tiles = await roadSite(a, id);
    await tool(a.page, 'Road').click();
    const before = await world(a.page);
    a.hold = true;
    await drag(a, tiles);
    await a.until(() => a.held.length === 1);
    const journal = await a.page.evaluate((key) => sessionStorage.getItem(key), pendingKey);
    assert.ok(journal);
    a.disconnect();
    a.held = []; a.hold = false;
    await fixture.reconnect(a, 'snapshot');
    assert.deepEqual(await world(a.page), before, 'unconsumed action is not automatically replayed');
    const blockedSends = a.sent.length;
    const disabled = await tool(a.page, 'Road').isDisabled();
    await a.page.keyboard.press('1');
    await drag(a, tiles);
    await paint(a.page);
    assert.equal(a.sent.length, blockedSends);
    assert.deepEqual(await world(a.page), before);
    assert.equal(await a.page.evaluate((key) => sessionStorage.getItem(key), pendingKey), journal);
    await confirmDiscard(a, journal);
    assert.equal(disabled, true, 'indeterminate construction controls are disabled');
    await tool(a.page, 'Road').click();
    await exactCommand(a, id, { type: 'roadPath', tiles }, () => drag(a, tiles));
    assert.notEqual(JSON.parse(a.sent.at(-1)!).requestId, JSON.parse(journal).requestId, 'confirmed fresh intent gets a new nonce');
  });
  await check('corrupt journal still boots real read-only World and confirmed recovery', async () => {
    await a.page.evaluate((key) => sessionStorage.setItem(key, '{corrupt'), pendingKey);
    await a.page.reload();
    await a.page.waitForFunction(() => document.body.dataset.ready === 'true');
    assert.deepEqual(await world(a.page), b.snapshot.world);
    await paint(a.page);
    const before = await world(a.page);
    const blockedSends = a.sent.length;
    const disabled = await tool(a.page, 'Road').isDisabled();
    const deniedTiles = await roadSite(a, await ownId(a));
    await a.page.keyboard.press('1');
    await drag(a, deniedTiles);
    await paint(a.page);
    assert.equal(a.sent.length, blockedSends);
    assert.deepEqual(await world(a.page), before);
    assert.equal(await a.page.evaluate((key) => sessionStorage.getItem(key), pendingKey), '{corrupt');
    await confirmDiscard(a, '{corrupt');
    assert.equal(disabled, true, 'corrupt-journal construction controls are disabled');
    const id = await ownId(a);
    const tiles = await roadSite(a, id);
    await tool(a.page, 'Road').click();
    await exactCommand(a, id, { type: 'roadPath', tiles }, () => drag(a, tiles));
  });
  await check('throwing sessionStorage getter preserves authenticated read-only game', async () => {
    const before = b.snapshot.world;
    const sent = a.sent.length;
    await a.page.addInitScript(() => {
      Object.defineProperty(window, 'sessionStorage', { get() { throw new DOMException('Storage disabled for browser verification', 'SecurityError'); } });
    });
    await a.page.reload();
    await a.page.waitForFunction(() => document.body.dataset.ready === 'true', undefined, { timeout: 12000 });
    assert.deepEqual(await world(a.page), before);
    assert.equal(await tool(a.page, 'Road').isDisabled(), true);
    await a.page.getByTestId('cities').getByRole('button', { name: `City ${await ownId(b)}`, exact: true }).click();
    await paint(a.page, 6);
    assert.deepEqual(await world(a.page), before);
    assert.equal(a.sent.length, sent, 'unavailable journal sends no intent');
  });
  await check('shared actions and camera leave valid local save/checkpoint/view bytes isolated', async () => {
    await a.page.keyboard.press('q');
    await paint(a.page, 8);
    const stored = await a.page.evaluate(() => ['oikos.island.v1', 'oikos.checkpoint.v1', 'oikos.view.v1'].map((key) => localStorage.getItem(key)));
    assert.deepEqual(stored, [localSave, localSave, localView]);
    await a.page.goto('http://127.0.0.1:5218/?debug');
    await a.page.waitForFunction(() => document.body.dataset.ready === 'true');
    await a.page.keyboard.press('Space');
    assert.equal((await world(a.page)).seed, local.seed);
    assert.equal((await world(a.page)).cities[0].home, local.cities[0].home);
    const restored = await camera(a);
    for (const [index, coordinate] of [12, 1.15, 9].entries()) assert.ok(Math.abs(restored[index + 3] - coordinate) < 1e-9);
    assert.equal(restored[6], 1.4);
  });
  await check('local mode retains local clock controls without a shared connection panel', async () => {
    assert.equal(await a.page.locator('.hud-speed').isVisible(), true);
    assert.equal(await a.page.getByTestId('connection').isVisible(), false);
  });
} catch (error) {
  results.push({ name: 'fixture/setup', ok: false, evidence: error instanceof Error ? error.stack : String(error) });
  console.error(error);
} finally {
  await fixture.close();
  const report = JSON.stringify({ revision, artifacts: output, baselineCameraReload: baselineWorkaround, clock: 'native transport; injected deterministic 250ms authority clock', results }, null, 2);
  writeFileSync(`${output}/report.json`, report);
  writeFileSync('artifacts/shared-browser/report.json', report);
}
if (results.some((result) => !result.ok)) process.exitCode = 1;

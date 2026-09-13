import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Fixture, Connection, baselineCameraReload, clickTile, origin, world } from './shared-browser-fixture';

const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const baselineWorkaround = baselineCameraReload();
const fixture = new Fixture(true);
const evidence: Record<string, unknown> = { artifacts: fixture.artifactDirectory, revision, baselineCameraReload: baselineWorkaround, clock: 'unmodified production monotonic clock and scheduler' };
try {
  evidence.phase = 'start and real invite forms';
  await fixture.start();
  await Promise.all(fixture.peers.map((peer, index) => fixture.join(peer, index)));
  for (const [index, peer] of fixture.peers.entries()) {
    evidence.phase = `claim actor ${index}`;
    await peer.page.getByTestId('claim-available').click({ noWaitAfter: true });
    await peer.page.getByTestId('claim-select').selectOption(String(index));
    await fixture.action(peer, () => peer.page.getByTestId('claim-dialog').locator('button[value="confirm"]').click({ noWaitAfter: true }));
    if (baselineWorkaround) {
      await peer.page.reload();
      await peer.page.waitForFunction(() => document.body.dataset.ready === 'true');
    }
    const city = (await world(peer.page)).cities.find((city) => city.id === peer.snapshot.session.ownedCityIds[0])!;
    evidence.phase = `found actor ${index}`;
    const receipt = await fixture.action(peer, () => clickTile(peer.page, city.harbour));
    assert.ok(receipt.type === 'receipt' && receipt.result.ok, 'real founding succeeds');
  }
  const [a, b] = fixture.peers;
  evidence.phase = 'personal menu clock isolation';
  const bothTime = b.snapshot.world.time;
  await a.page.keyboard.press('Escape');
  assert.equal(await a.page.getByTestId('menu-dialog').isVisible(), true);
  await b.until(() => b.snapshot.world.time > bothTime + .5);
  evidence.personalMenu = { before: bothTime, after: b.snapshot.world.time };
  await a.page.keyboard.press('Escape');
  evidence.phase = 'one remaining socket';
  a.blocked = true;
  await a.page.close();
  const aloneTime = b.snapshot.world.time;
  await b.until(() => b.snapshot.world.time > aloneTime + .5);
  evidence.oneConnection = { before: aloneTime, after: b.snapshot.world.time, cities: b.snapshot.world.cities.map((city) => city.id) };
  assert.equal(b.snapshot.world.cities.length, 2);
  evidence.phase = 'stop, persist and reconnect';
  b.blocked = true;
  await b.page.close();
  const stream = b.snapshot.streamId;
  const realm = b.snapshot.realmId;
  await fixture.runtime!.stop();
  const { Authority } = await import('../src/server/authority');
  const persisted = Authority.open(fixture.path);
  let stopped;
  try { stopped = persisted.snapshot(); }
  finally { persisted.close(); }
  fixture.startAuthority();
  const reconnected = await Promise.all([a, b].map(async (old) => {
    const peer = new Connection(await old.page.context().newPage());
    await peer.install(true);
    await peer.page.goto(`${origin}/shared.html?debug`);
    await peer.until(() => peer.packets.some((packet) => packet.type === 'snapshot'));
    await peer.page.waitForFunction(() => document.body.dataset.ready === 'true');
    return peer;
  }));
  fixture.peers = reconnected;
  for (const peer of reconnected) {
    const snapshot = peer.packets.find((packet) => packet.type === 'snapshot')!;
    assert.ok(snapshot.type === 'snapshot');
    assert.equal(snapshot.realmId, realm);
    assert.notEqual(snapshot.streamId, stream);
    assert.equal(snapshot.world.cities.length, stopped.cities.length);
    assert.deepEqual(snapshot.world.cities.map((city) => ({ id: city.id, home: city.home, roads: city.roads, founded: city.founded })), stopped.cities.map((city) => ({ id: city.id, home: city.home, roads: city.roads, founded: city.founded })));
    assert.ok(snapshot.world.time >= stopped.time, 'later peers observe monotonic simulation time');
  }
  const first = reconnected.map((peer) => peer.packets.find((packet) => packet.type === 'snapshot')!).sort((a, b) => a.serial - b.serial)[0];
  assert.deepEqual(first.world, stopped, 'first native connection resumes the exact persisted World without catch-up');
  evidence.restart = { stopped: stopped.time, resumed: reconnected[0].snapshot.world.time, preservedCityIds: stopped.cities.map((city) => city.id) };
  evidence.ok = true;
  console.log('PASS production clock: actual two-browser founding, personal menu isolation, one remaining connection advances, SQLite restart preserves cities and realm');
} catch (error) {
  evidence.ok = false;
  evidence.error = error instanceof Error ? error.stack : String(error);
  evidence.peers = fixture.peers.map((peer) => ({ navigations: peer.navigations, closes: peer.closes, sent: peer.sent.map((wire) => JSON.parse(wire)), blocked: peer.blocked, packets: peer.packets.map((packet) => {
    if (packet.type === 'snapshot') return { type: packet.type, serial: packet.serial, time: packet.world.time, cities: packet.world.cities.length, session: packet.session };
    return packet;
  }) }));
  evidence.clients = await Promise.all(fixture.peers.map((peer) => Promise.race([
    peer.page.evaluate(() => ({ pending: sessionStorage.getItem('oikos.shared.pending.v1'), status: document.querySelector('[data-field="connection"]')?.textContent, context: (window as any).oikos?.cityContext, time: (window as any).oikos?.state.time })).catch((error) => ({ unavailable: String(error) })),
    new Promise((resolve) => setTimeout(() => resolve({ unavailable: 'Client observation deadline' }), 2000)),
  ])));
  if (fixture.runtime) {
    try {
      const credentials = await Promise.all(fixture.peers.map(async (peer) => (await peer.page.context().cookies()).find((cookie) => cookie.name === '__Host-oikos')?.value));
      await fixture.runtime.stop();
      const { Authority } = await import('../src/server/authority');
      const stored = Authority.open(fixture.path);
      try {
        evidence.database = { world: stored.snapshot(), sessions: credentials.map((credential) => {
          const session = credential ? stored.authenticate(credential) : null;
          return session && { nextSeq: session.nextSeq, ownedCityIds: session.ownedCityIds };
        }) };
      } finally { stored.close(); }
    } catch (error) { evidence.databaseError = String(error); }
  }
  console.error(error);
  process.exitCode = 1;
} finally {
  await fixture.close();
  mkdirSync('artifacts/shared-browser', { recursive: true });
  const report = JSON.stringify(evidence, null, 2);
  writeFileSync('artifacts/shared-browser/live-report.json', report);
  writeFileSync(`${fixture.artifactDirectory}/live-report.json`, report);
}

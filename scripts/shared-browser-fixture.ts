import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { chromium, type Browser, type Page, type WebSocketRoute } from 'playwright';
import { preview, type PreviewServer } from 'vite';
import { Authority } from '../src/server/authority';
import { initStore } from '../src/server/store';
import { startServer, type RuntimeClock } from '../src/server/runtime';
import type { ServerPacket } from '../src/server/protocol';
import type { World } from '../src/sim/types';
import { pageReady } from './shared-browser-controls';

export const origin = 'http://127.0.0.1:5218';
export const pendingKey = 'oikos.shared.pending.v1';
export function baselineCameraReload() {
  if (!process.argv.includes('--baseline-a0')) return false;
  execFileSync('git', ['diff', '--quiet', 'a0d2142', '--', 'src']);
  return true;
}
export class Clock implements RuntimeClock {
  time = 0;
  callback = () => {};
  now = () => this.time;
  schedule(callback: () => void, milliseconds: number) {
    assert.equal(milliseconds, 250);
    this.callback = callback;
    return () => { this.callback = () => {}; };
  }
  step() { this.time += 250; this.callback(); }
}

export class Connection {
  packets: ServerPacket[] = [];
  sent: string[] = [];
  navigations: string[] = [];
  closes: Array<{ side: string; code?: number; reason?: string }> = [];
  held: Array<() => void> = [];
  hold = false;
  blocked = false;
  dropReceiptDelivery = false;
  routes = new Set<WebSocketRoute>();
  listeners = new Set<() => void>();
  constructor(readonly page: Page) {
    page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) this.navigations.push(frame.url()); });
  }
  async install(passive = false) {
    if (passive) {
      this.page.on('websocket', (socket) => {
        socket.on('framesent', ({ payload }) => { this.sent.push(String(payload)); this.notify(); });
        socket.on('framereceived', ({ payload }) => { this.packets.push(JSON.parse(String(payload)) as ServerPacket); this.notify(); });
        socket.on('close', () => { this.closes.push({ side: 'native' }); this.notify(); });
        socket.on('socketerror', (reason) => { this.closes.push({ side: 'native-error', reason }); this.notify(); });
      });
      return;
    }
    await this.page.routeWebSocket('**/api/world', (route) => {
      if (this.blocked) { route.close(); return; }
      this.routes.add(route);
      const server = route.connectToServer();
      route.onMessage((message) => {
        this.sent.push(String(message));
        const send = () => server.send(message);
        if (this.hold) this.held.push(send);
        else send();
        this.notify();
      });
      server.onMessage((message) => {
        const packet = JSON.parse(String(message)) as ServerPacket;
        this.packets.push(packet);
        if (this.dropReceiptDelivery && packet.type === 'receipt') {
          this.dropReceiptDelivery = false;
          this.disconnect();
        } else route.send(message);
        this.notify();
      });
      server.onClose((code, reason) => { this.closes.push({ side: 'server', code, reason }); this.routes.delete(route); route.close(); });
      route.onClose((code, reason) => { this.closes.push({ side: 'client', code, reason }); this.routes.delete(route); server.close(); });
    });
  }
  notify() { for (const listener of this.listeners) listener(); }
  async until(predicate: () => boolean) {
    if (predicate()) return;
    await new Promise<void>((resolve, reject) => {
      const listener = () => {
        if (!predicate()) return;
        clearTimeout(timer); this.listeners.delete(listener); resolve();
      };
      const timer = setTimeout(() => { this.listeners.delete(listener); reject(new Error('Server frame deadline')); }, 30000);
      this.listeners.add(listener);
    });
  }
  get snapshot() {
    const packet = this.packets.findLast((packet) => packet.type === 'snapshot');
    assert.ok(packet?.type === 'snapshot', 'authenticated protocol snapshot');
    return packet;
  }
  disconnect() {
    this.blocked = true;
    for (const route of this.routes) route.close();
    this.routes.clear();
  }
  release() { this.hold = false; for (const send of this.held.splice(0)) send(); }
}

export async function paint(page: Page, frames = 3) {
  await page.evaluate((frames) => new Promise<void>((resolve) => {
    const next = () => { if (--frames <= 0) resolve(); else requestAnimationFrame(next); };
    requestAnimationFrame(next);
  }), frames);
}
export async function world(page: Page): Promise<World> {
  return page.evaluate(() => (window as any).oikos.state);
}
export async function point(page: Page, tile: { x: number; z: number }) {
  return page.evaluate(({ x, z }) => (window as any).oikos.projectTile(x, z), tile) as Promise<{ x: number; y: number }>;
}
export async function clickTile(page: Page, tile: { x: number; z: number }) {
  const p = await point(page, tile);
  assert.ok(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.matches('#app canvas') === true, p), `tile ${JSON.stringify(tile)} is exposed in actual camera`);
  await page.mouse.click(p.x, p.y);
}
export function tool(page: Page, label: string) {
  return page.getByRole('button', { name: new RegExp(`^${label},`) }).first();
}

export class Fixture {
  directory = mkdtempSync(join(tmpdir(), 'oikos-shared-game-'));
  artifactDirectory = join('artifacts/shared-browser/runs', basename(this.directory));
  private readonly artifacts = mkdirSync(this.artifactDirectory, { recursive: true });
  path = join(this.directory, 'world.db');
  clock = new Clock();
  runtime?: ReturnType<typeof startServer>;
  frontend?: PreviewServer;
  browser?: Browser;
  peers: Connection[] = [];
  invites: string[] = [];
  private closing?: Promise<void>;
  private interrupted = () => { void this.close().finally(() => process.exit(130)); };
  readonly tracing = process.env.OIKOS_TRACE === '1';
  constructor(readonly liveClock = false) {
    process.once('SIGINT', this.interrupted);
    process.once('SIGTERM', this.interrupted);
  }
  startAuthority() {
    this.runtime = startServer({ path: this.path, publicOrigin: origin, port: 5219, clock: this.liveClock ? undefined : this.clock });
  }
  async restart() {
    for (const peer of this.peers) peer.disconnect();
    await this.runtime!.stop();
    this.startAuthority();
    await Promise.all(this.peers.map((peer) => this.reconnect(peer, 'snapshot')));
  }
  async start() {
    assert.equal(Bun.version, '1.4.2', 'run with npm-ci pinned Bun');
    initStore(this.path);
    const operator = Authority.open(this.path);
    try { this.invites = [operator.issueInvite(), operator.issueInvite()]; }
    finally { operator.close(); }
    this.startAuthority();
    this.frontend = await preview({ preview: { host: '127.0.0.1', port: 5218, strictPort: true, proxy: { '/api': { target: 'http://127.0.0.1:5219', ws: true, changeOrigin: true } } } });
    this.browser = await chromium.launch();
    for (let index = 0; index < 2; index++) {
      const viewport = this.liveClock ? { width: 900, height: 650 } : { width: 1440, height: 1000 };
      const context = await this.browser.newContext({ viewport, reducedMotion: (process.env.OIKOS_MOTION as 'reduce' | 'no-preference') ?? 'reduce' });
      if (this.tracing) await context.tracing.start({ screenshots: false, snapshots: true, sources: true });
      const page = await context.newPage();
      page.setDefaultTimeout(this.liveClock ? 45000 : 12000);
      const peer = new Connection(page);
      await peer.install(this.liveClock);
      this.peers.push(peer);
    }
  }
  async join(peer: Connection, index: number) {
    await peer.page.goto(`${origin}/shared.html?debug`);
    const form = peer.page.getByTestId('invite-form');
    await form.locator('input').fill(this.invites[index]);
    const response = peer.page.waitForResponse((response) => response.url().endsWith('/api/session/redeem'));
    await form.getByRole('button', { name: 'Join' }).click();
    assert.equal((await response).status(), 200);
    await peer.until(() => peer.packets.some((packet) => packet.type === 'snapshot'));
    await peer.page.waitForFunction(() => document.body.dataset.ready === 'true');
    assert.equal(peer.snapshot.protocol, 2);
    const cookie = (await peer.page.context().cookies()).find((cookie) => cookie.name === '__Host-oikos');
    assert.ok(cookie?.secure && cookie.httpOnly && cookie.sameSite === 'Strict');
    assert.equal(await peer.page.evaluate(() => document.cookie), '');
  }
  async sync() {
    const serials = this.peers.map((peer) => peer.packets.filter((packet) => packet.type === 'snapshot').length);
    if (!this.liveClock) this.clock.step();
    await Promise.all(this.peers.filter((peer) => !peer.blocked).map(async (peer) => {
      await peer.until(() => peer.packets.filter((packet) => packet.type === 'snapshot').length > serials[this.peers.indexOf(peer)]);
      if (this.liveClock) {
        const { time, cities } = peer.snapshot.world;
        await peer.page.waitForFunction(({ time, cities }) => {
          const state = (window as any).oikos?.state;
          return state && state.time >= time && cities.every((expected) => state.cities.some((city: any) => city.id === expected.id && city.founded === expected.founded));
        }, { time, cities: cities.map(({ id, founded }) => ({ id, founded })) });
      } else await peer.page.waitForFunction((expected) => JSON.stringify((window as any).oikos?.state) === expected, JSON.stringify(peer.snapshot.world));
    }));
  }
  async action(peer: Connection, action: () => Promise<unknown>) {
    const count = peer.packets.length;
    const navigations = peer.navigations.length;
    await action();
    await peer.until(() => peer.packets.slice(count).some((packet) => packet.type === 'receipt' || packet.type === 'reject'));
    const result = peer.packets.slice(count).find((packet) => packet.type === 'receipt' || packet.type === 'reject')!;
    await this.sync();
    assert.equal(peer.navigations.length, navigations, 'game command did not navigate');
    return result;
  }
  async reconnect(peer: Connection, readiness: 'ready' | 'snapshot' = 'ready') {
    const count = peer.packets.length;
    peer.blocked = false;
    await peer.until(() => peer.packets.slice(count).some((packet) => packet.type === 'snapshot'));
    if (readiness === 'ready') await pageReady(peer);
    await paint(peer.page);
  }
  close() { return this.closing ??= this.cleanup(); }
  private async cleanup() {
    process.off('SIGINT', this.interrupted);
    process.off('SIGTERM', this.interrupted);
    try {
      if (this.tracing) {
        mkdirSync(this.artifactDirectory, { recursive: true });
        for (const [index, peer] of this.peers.entries()) await peer.page.context().tracing.stop({ path: `${this.artifactDirectory}/live-${index}.zip` });
      }
    } finally {
      try { await this.browser?.close(); }
      finally { await this.closeServers(); }
    }
  }
  private async closeServers() {
    try {
      await new Promise<void>((resolve, reject) => {
        if (!this.frontend) return resolve();
        this.frontend.httpServer.close((error) => error ? reject(error) : resolve());
        if ('closeAllConnections' in this.frontend.httpServer) this.frontend.httpServer.closeAllConnections();
      });
    } finally {
      try { await this.runtime?.stop(); }
      finally { rmSync(this.directory, { recursive: true, force: true }); }
    }
  }
}

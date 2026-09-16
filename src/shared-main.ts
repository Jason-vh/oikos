import { boot, type BootHandles } from './main';
import { CITY_NAME_LIMIT } from './sim/claims';
import { deserializeSharedWorld } from './sim/save';
import type { World } from './sim/types';
import { showBackdrop, type Backdrop } from './ui/backdrop';
import { createBootOverlay } from './ui/boot-overlay';
import { debugEnabled, delaySends, latencyMillis, observe } from './ui/debug';
import { SharedSession, type SharedRequestOutcome, type SharedSessionStatus, type SharedSessionStorage } from './ui/shared-session';
import './ui/style.css';

function safeStorage(): SharedSessionStorage {
  return {
    getItem: (key) => window.sessionStorage.getItem(key),
    setItem: (key, value) => window.sessionStorage.setItem(key, value),
    removeItem: (key) => window.sessionStorage.removeItem(key),
  };
}

function wsUrl(): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/api/world`;
}

function connect(): WebSocket {
  const socket = new WebSocket(wsUrl());
  if (!debugEnabled(location.search)) return socket;
  observe(socket);
  delaySends(socket, latencyMillis(location.search));
  return socket;
}

interface Preview {
  known: boolean;
  canReset: boolean;
  world: World;
}

async function preview(): Promise<Preview | null> {
  try {
    const response = await fetch('/api/world/preview', { cache: 'no-store' });
    if (!response.ok) return null;
    const payload = await response.json() as { known?: unknown; canReset?: unknown; world?: unknown };
    const world = deserializeSharedWorld(JSON.stringify(payload.world));
    if (typeof payload.known !== 'boolean' || typeof payload.canReset !== 'boolean' || !world) return null;
    return { known: payload.known, canReset: payload.canReset, world };
  } catch {
    return null;
  }
}

async function join(name: string): Promise<string> {
  try {
    const response = await fetch('/api/session/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (response.ok) return '';
    if (response.status === 409) return 'Already joined. Reload the page to reconnect.';
    if (response.status === 429) return 'Too many attempts. Wait a moment and try again.';
    if (response.status === 400) return `Choose a city name of up to ${CITY_NAME_LIMIT} characters.`;
    return 'The world could not admit you. Try again.';
  } catch {
    return 'Could not reach the server. Check your connection and try again.';
  }
}

const UNKNOWN_ATTEMPTS = 2;
const RETRY_DELAYS = [1000, 2000, 4000, 8000];
const RAISING = 'Raising the archipelago\u2026';
const ARRIVING = 'Sailing you in\u2026';
const UNREACHED = 'Cannot reach the world. Trying again\u2026';

function statusMessage(status: SharedSessionStatus): string {
  switch (status) {
    case 'connecting': return 'Connecting\u2026';
    case 'open': return 'Connected. Waiting for the world\u2026';
    default: return ARRIVING;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, milliseconds); });
}

function boot_(): void {
  const overlay = createBootOverlay();
  const app = document.querySelector<HTMLElement>('#app')!;
  let session: SharedSession | null = null;
  let handles: BootHandles | null = null;
  let backdrop: Backdrop | null = null;
  let firstSnapshotSeen = false;
  let unreachedHandshakes = 0;
  let canReset = false;
  let recheckInFlight = false;
  let epoch = 0;
  let bufferedOutcomes: SharedRequestOutcome[] = [];

  function fatal(error: unknown): void {
    epoch += 1;
    session?.close();
    session = null;
    backdrop?.dispose();
    backdrop = null;
    overlay.fail('The shared game could not open. Reload to try again.');
    console.error(error);
  }

  async function reachWorld(): Promise<Preview> {
    for (let attempt = 0; ; attempt++) {
      const seen = await preview();
      if (seen) return seen;
      overlay.showLoading(UNREACHED);
      await delay(RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)]);
    }
  }

  async function admit(seen: Preview): Promise<void> {
    canReset = seen.canReset;
    if (!seen.known) {
      backdrop = await showBackdrop(seen.world, app);
      await overlay.askToJoin(join);
      backdrop.dispose();
      backdrop = null;
    }
    overlay.showLoading(ARRIVING);
  }

  async function recheckAdmission(forEpoch: number): Promise<void> {
    if (recheckInFlight) return;
    recheckInFlight = true;
    const seen = await preview();
    recheckInFlight = false;
    if (forEpoch !== epoch || firstSnapshotSeen) return;
    if (!seen) { overlay.showLoading(UNREACHED); return; }
    if (seen.known) { overlay.showLoading(statusMessage('connecting')); return; }
    epoch += 1;
    session?.close();
    session = null;
    await admit(seen);
    startSession();
  }

  function startSession(): void {
    epoch += 1;
    const myEpoch = epoch;
    firstSnapshotSeen = false;
    unreachedHandshakes = 0;
    handles = null;
    bufferedOutcomes = [];
    try {
      session = new SharedSession(
        {
          connect,
          storage: safeStorage(),
        },
        {
          snapshot: (snapshot) => {
            if (myEpoch !== epoch) return;
            try {
              if (!firstSnapshotSeen) {
                handles = boot({ session: session!, initialSnapshot: snapshot, canReset }) ?? null;
                if (!handles) throw new Error('Shared game did not start.');
                handles.onStatus(session!.currentStatus, session!.statusReason);
                for (const result of bufferedOutcomes.splice(0)) handles.onOutcome(result);
                firstSnapshotSeen = true;
                overlay.remove();
                return;
              }
              handles?.onSnapshot(snapshot);
            } catch (error) {
              fatal(error);
            }
          },
          realmChanged: () => { if (myEpoch === epoch) handles?.onRealmChanged(); },
          status: (status, reason) => {
            if (myEpoch !== epoch) return;
            handles?.onStatus(status, reason);
            if (firstSnapshotSeen) return;
            if (status === 'offline' || status === 'closed') unreachedHandshakes += 1;
            if (unreachedHandshakes >= UNKNOWN_ATTEMPTS) void recheckAdmission(myEpoch).catch(fatal);
            else overlay.showLoading(reason.length > 0 ? reason : statusMessage(status));
          },
          outcome: (result) => {
            if (myEpoch !== epoch) return;
            if (handles) { handles.onOutcome(result); return; }
            bufferedOutcomes.push(result);
          },
        },
      );
    } catch (error) {
      fatal(error);
    }
  }

  overlay.showLoading(RAISING);
  reachWorld()
    .then(async (seen) => {
      await admit(seen);
      startSession();
    })
    .catch(fatal);
}

try { boot_(); }
catch (error) {
  document.body.dataset.error = 'true';
  const status = document.querySelector<HTMLElement>('#status')!;
  status.hidden = false;
  status.textContent = 'The shared game could not open. WebGL 2 and hardware acceleration are required.';
  console.error(error);
}

import { boot, type BootHandles } from './main';
import { NAME_LIMIT } from './server/protocol';
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

function buildOverlay(): {
  setStatus(message: string): void;
  showJoinForm(onSubmit: (name: string) => void): void;
  setJoinError(message: string): void;
  setJoinBusy(busy: boolean): void;
  remove(): void;
} {
  const root = document.createElement('div');
  root.className = 'shared-boot-overlay';
  root.innerHTML = `
    <div class="shared-boot-panel">
      <p data-field="shared-status" role="status">Connecting\u2026</p>
      <form data-testid="join-form">
        <label>Your name
          <input type="text" name="name" maxlength="${NAME_LIMIT}" autocomplete="nickname" spellcheck="false" required />
        </label>
        <button type="submit">Join</button>
      </form>
      <p data-field="join-error" role="alert" hidden></p>
    </div>
  `;
  document.body.appendChild(root);
  const statusField = root.querySelector<HTMLElement>('[data-field="shared-status"]')!;
  const form = root.querySelector<HTMLFormElement>('[data-testid="join-form"]')!;
  const input = form.querySelector<HTMLInputElement>('input[name="name"]')!;
  const submitButton = form.querySelector<HTMLButtonElement>('button')!;
  const errorField = root.querySelector<HTMLElement>('[data-field="join-error"]')!;
  return {
    setStatus(message) {
      if (!root.isConnected) document.body.appendChild(root);
      statusField.textContent = message;
    },
    showJoinForm(onSubmit) {
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const name = input.value.trim();
        if (name.length === 0) return;
        onSubmit(name);
      });
    },
    setJoinError(message) {
      errorField.textContent = message;
      errorField.hidden = message.length === 0;
    },
    setJoinBusy(busy) {
      input.disabled = busy;
      submitButton.disabled = busy;
    },
    remove() { root.remove(); },
  };
}

async function join(name: string): Promise<{ ok: boolean; reason: string }> {
  try {
    const response = await fetch('/api/session/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (response.ok) return { ok: true, reason: '' };
    if (response.status === 409) return { ok: false, reason: 'Already joined. Reload the page to reconnect.' };
    if (response.status === 429) return { ok: false, reason: 'Too many attempts. Wait a moment and try again.' };
    if (response.status === 400) return { ok: false, reason: `Choose a name of up to ${NAME_LIMIT} characters.` };
    return { ok: false, reason: 'The world could not admit you. Try again.' };
  } catch {
    return { ok: false, reason: 'Could not reach the server. Check your connection and try again.' };
  }
}

function statusMessage(status: SharedSessionStatus): string {
  switch (status) {
    case 'connecting': return 'Connecting\u2026';
    case 'open': return 'Connected. Waiting for the world\u2026';
    default: return 'Loading your city\u2026';
  }
}

function boot_(): void {
  const overlay = buildOverlay();
  let session: SharedSession | null = null;
  let handles: BootHandles | null = null;
  let firstSnapshotSeen = false;
  let epoch = 0;
  let bufferedOutcomes: SharedRequestOutcome[] = [];

  function fatal(error: unknown): void {
    epoch += 1;
    session?.close();
    session = null;
    overlay.setJoinBusy(true);
    overlay.setStatus('The shared game could not open. Reload to try again.');
    document.body.dataset.error = 'true';
    console.error(error);
  }

  function startSession(): void {
    epoch += 1;
    const myEpoch = epoch;
    firstSnapshotSeen = false;
    handles = null;
    bufferedOutcomes = [];
    try {
      session = new SharedSession(
        {
          connect: () => new WebSocket(wsUrl()),
          storage: safeStorage(),
        },
        {
          snapshot: (snapshot) => {
            if (myEpoch !== epoch) return;
            try {
              if (!firstSnapshotSeen) {
                handles = boot({ session: session!, initialSnapshot: snapshot }) ?? null;
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
            if (!firstSnapshotSeen) overlay.setStatus(reason.length > 0 ? reason : statusMessage(status));
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

  overlay.showJoinForm((name) => {
    if (firstSnapshotSeen) return;
    const submittedAt = epoch;
    overlay.setJoinBusy(true);
    overlay.setJoinError('');
    void join(name)
      .then((result) => {
        if (submittedAt !== epoch || firstSnapshotSeen) return;
        overlay.setJoinBusy(false);
        if (!result.ok) {
          overlay.setJoinError(result.reason);
          return;
        }
        session?.close();
        session = null;
        startSession();
      })
      .catch((error) => {
        if (submittedAt !== epoch || firstSnapshotSeen) return;
        overlay.setJoinBusy(false);
        overlay.setJoinError('Something went wrong joining. Try again.');
        console.error(error);
      });
  });

  startSession();
}

try { boot_(); }
catch (error) {
  document.body.dataset.error = 'true';
  document.querySelector<HTMLElement>('#status')!.textContent = 'The shared game could not open. WebGL 2 and hardware acceleration are required.';
  console.error(error);
}

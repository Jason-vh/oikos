import { NAME_LIMIT } from '../server/protocol';

export type JoinAttempt = (name: string) => Promise<string>;

export interface BootOverlay {
  showLoading(message: string): void;
  askToJoin(attempt: JoinAttempt): Promise<void>;
  fail(message: string): void;
  remove(): void;
}

export function createBootOverlay(): BootOverlay {
  const root = document.createElement('div');
  root.className = 'boot';
  root.innerHTML = `
    <div class="boot-veil" data-panel="loading">
      <h1>Οἶκος</h1>
      <p data-field="shared-status" role="status">Raising the archipelago\u2026</p>
      <div class="boot-progress" aria-hidden="true"><span></span></div>
    </div>
    <div class="boot-scrim" data-panel="join" hidden>
      <form class="boot-card" data-testid="join-form">
        <h2>Welcome to Kalliste</h2>
        <p>Every shore is unclaimed until someone lands on it. Give the archipelago a name to remember you by.</p>
        <label>Your name
          <input type="text" name="name" maxlength="${NAME_LIMIT}" autocomplete="nickname" spellcheck="false" required />
        </label>
        <button type="submit">Join</button>
        <p data-field="join-error" role="alert" hidden></p>
      </form>
    </div>
  `;
  document.body.append(root);
  const status = root.querySelector<HTMLElement>('[data-field="shared-status"]')!;
  const loading = root.querySelector<HTMLElement>('[data-panel="loading"]')!;
  const joining = root.querySelector<HTMLElement>('[data-panel="join"]')!;
  const form = root.querySelector<HTMLFormElement>('[data-testid="join-form"]')!;
  const input = form.querySelector<HTMLInputElement>('input[name="name"]')!;
  const submit = form.querySelector<HTMLButtonElement>('button')!;
  const error = root.querySelector<HTMLElement>('[data-field="join-error"]')!;

  function showPanel(panel: 'loading' | 'join'): void {
    if (!root.isConnected) document.body.append(root);
    loading.hidden = panel !== 'loading';
    joining.hidden = panel !== 'join';
    document.body.dataset.boot = panel;
  }

  function setBusy(busy: boolean): void {
    input.disabled = busy;
    submit.disabled = busy;
  }

  let pending: { attempt: JoinAttempt; resolve: () => void } | null = null;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = input.value.trim();
    if (name.length === 0 || pending === null || submit.disabled) return;
    const request = pending;
    setBusy(true);
    error.hidden = true;
    void request.attempt(name).then((reason) => {
      if (pending !== request) return;
      setBusy(false);
      if (reason.length === 0) {
        pending = null;
        request.resolve();
        return;
      }
      error.textContent = reason;
      error.hidden = false;
      input.focus();
    });
  });

  return {
    showLoading(message) {
      status.textContent = message;
      showPanel('loading');
    },
    askToJoin(attempt) {
      showPanel('join');
      error.hidden = true;
      setBusy(false);
      input.focus();
      return new Promise<void>((resolve) => { pending = { attempt, resolve }; });
    },
    fail(message) {
      pending = null;
      setBusy(true);
      showPanel('loading');
      status.textContent = message;
      document.body.dataset.error = 'true';
    },
    remove() {
      root.remove();
      delete document.body.dataset.boot;
    },
  };
}

import { cityName, CITY_NAME_LIMIT } from '../sim/claims';
import { CITY_COLORS, randomCityColor, type CityColor } from '../sim/colors';
import { cityColors } from '../art/primitives';
import { suggestCityName } from './city-names';

export type JoinAttempt = (name: string, color: CityColor) => Promise<string>;

export interface BootOverlay {
  showLoading(message: string): void;
  askToJoin(attempt: JoinAttempt, taken: readonly CityColor[]): Promise<void>;
  fail(message: string): void;
  remove(): void;
}

function swatchLabel(color: CityColor): string {
  return `${color[0].toUpperCase()}${color.slice(1)}`;
}

function cssColor(value: number): string {
  return `#${value.toString(16).padStart(6, '0')}`;
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
        <h2>Found your city</h2>
        <p>Every shore is unclaimed until someone lands on it. Name the city you are about to found, and choose the colour it flies.</p>
        <label>City name
          <input type="text" name="name" maxlength="${CITY_NAME_LIMIT}" autocomplete="off" spellcheck="false" required />
        </label>
        <fieldset class="boot-colours" data-testid="join-colours">
          <legend>Colour</legend>
          ${CITY_COLORS.map((color) => `
            <label class="boot-swatch" style="--swatch: ${cssColor(cityColors[color])}">
              <input type="radio" name="color" value="${color}" />
              <span>${swatchLabel(color)}</span>
            </label>
          `).join('')}
        </fieldset>
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
  const swatches = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="color"]'));
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
    for (const swatch of swatches) swatch.disabled = busy;
  }

  function chosenColor(): CityColor | null {
    return swatches.find((swatch) => swatch.checked)?.value as CityColor ?? null;
  }

  input.addEventListener('input', () => {
    const chosen = cityName(input.value);
    input.setCustomValidity(chosen === null && input.value.trim().length > 0 ? `A city name of up to ${CITY_NAME_LIMIT} characters.` : '');
    error.hidden = true;
  });

  let pending: { attempt: JoinAttempt; resolve: () => void } | null = null;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = cityName(input.value);
    const color = chosenColor();
    if (name === null || color === null || pending === null || submit.disabled) {
      input.reportValidity();
      return;
    }
    const request = pending;
    setBusy(true);
    error.hidden = true;
    void request.attempt(name, color).then((reason) => {
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
    askToJoin(attempt, taken) {
      showPanel('join');
      error.hidden = true;
      setBusy(false);
      const preselected = randomCityColor(taken);
      for (const swatch of swatches) swatch.checked = swatch.value === preselected;
      input.value = suggestCityName();
      input.setCustomValidity('');
      input.focus();
      input.select();
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

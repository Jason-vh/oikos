import type { Game, Tool } from '../game';
import { BUILDINGS, PLACEABLE, ROADBLOCK_COST, ROAD_COST } from '../sim/buildings';
import { WAGE_LEVELS, type LabourReport } from '../sim/labour';
import { TAX_RATES } from '../sim/taxation';
import { abandonCity } from '../sim/save';

interface ToolButton {
  label: string;
  cost: number | null;
  hint: string;
  shortcut: string;
  tool: Tool;
  group: string;
}

export function createHud(root: HTMLElement, game: Game): { update: () => void } {
  const buttons = toolButtons();

  root.insertAdjacentHTML(
    'beforeend',
    `
    <div class="hud">
      <header class="topbar">
        <span class="brand">Zeus</span>
        <span class="cartouche" data-field="date"></span>
        <span class="cartouche treasury" data-field="treasury"></span>
        <span class="cartouche" data-field="population"></span>
        <span class="cartouche" data-field="labour"></span>
        <button class="cartouche" data-wages data-field="wages"></button>
        <button class="cartouche" data-taxes data-field="taxes"></button>
        <span class="spacer"></span>
        <span class="speeds">
          ${[0, 1, 2, 4].map((speed) => `<button class="medallion" data-speed="${speed}">${speedLabel(speed)}</button>`).join('')}
        </span>
        <button class="overlay-toggle" data-overlay>Appeal <kbd>O</kbd></button>
        <button class="overlay-toggle" data-new-city>New city</button>
      </header>
      <aside class="panel">
        <div class="panel-inner">
          ${renderPanel(buttons)}
        </div>
      </aside>
      <footer class="scroll">
        <span data-field="hover"></span>
        <span data-field="messages"></span>
      </footer>
    </div>
  `,
  );

  const hud = root.querySelector('.hud') as HTMLElement;
  const field = (name: string) => hud.querySelector(`[data-field="${name}"]`) as HTMLElement;

  hud.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((element) => {
    element.addEventListener('click', () => selectTool(Number(element.dataset.tool)));
  });
  hud.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((element) => {
    element.addEventListener('click', () => {
      game.speed = Number(element.dataset.speed);
    });
  });
  hud.querySelector('[data-overlay]')?.addEventListener('click', () => game.toggleAppealOverlay());
  hud.querySelector('[data-wages]')?.addEventListener('click', () => {
    game.world.wageLevel = (game.world.wageLevel + 1) % WAGE_LEVELS.length;
    game.world.hireWorkers();
  });
  hud.querySelector('[data-taxes]')?.addEventListener('click', () => {
    game.world.taxRate = (game.world.taxRate + 1) % TAX_RATES.length;
  });
  hud.querySelector('[data-new-city]')?.addEventListener('click', () => {
    if (!confirm('Abandon this city and found a new one?')) return;
    abandonCity();
    location.reload();
  });

  const selectTool = (index: number) => {
    const button = buttons[index];
    if (!button) return;
    game.tool = button.tool;
  };

  window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    const index = buttons.findIndex((button) => button.shortcut === key);
    if (index >= 0) selectTool(index);
    if (key === 'o') game.toggleAppealOverlay();
    if (key === ' ') {
      event.preventDefault();
      game.speed = game.speed === 0 ? 1 : 0;
    }
  });

  return {
    update: () => {
      field('date').textContent = game.world.dateLabel;
      field('treasury').textContent = `${Math.floor(game.world.treasury)} dr`;
      field('population').textContent = `${game.world.population} citizens`;
      field('labour').textContent = labourLabel(game.world.labour);
      field('wages').textContent = `Wages: ${WAGE_LEVELS[game.world.wageLevel].name}`;
      field('taxes').textContent = taxLabel(game.world);
      field('hover').textContent = game.describeHover();
      field('messages').textContent = game.world.messages[0] ?? '';

      hud.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((element) => {
        const button = buttons[Number(element.dataset.tool)];
        element.classList.toggle('active', isSameTool(button.tool, game.tool));
      });
      hud.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((element) => {
        element.classList.toggle('active', Number(element.dataset.speed) === game.speed);
      });
    },
  };
}

function toolButtons(): ToolButton[] {
  const structures = PLACEABLE.map((kind, index) => {
    const def = BUILDINGS[kind];
    return {
      label: def.name,
      cost: def.cost,
      hint: def.description,
      shortcut: String(index + 1),
      tool: { kind: 'build', building: kind } as Tool,
      group: groupFor(kind),
    };
  });

  return [
    { label: 'Road', cost: ROAD_COST, hint: 'Per tile', shortcut: 'r', tool: { kind: 'road' }, group: 'Road' },
    {
      label: 'Roadblock',
      cost: ROADBLOCK_COST,
      hint: 'Roaming walkers turn back here; deliverymen pass',
      shortcut: 'b',
      tool: { kind: 'roadblock' },
      group: 'Road',
    },
    ...structures,
    { label: 'Demolish', cost: null, hint: 'Remove roads and buildings', shortcut: 'x', tool: { kind: 'demolish' }, group: 'Demolish' },
  ];
}

function groupFor(kind: string): string {
  if (kind === 'house') return 'Housing';
  if (kind === 'wheatFarm' || kind === 'granary') return 'Food';
  return 'Services';
}

function taxLabel(world: Game['world']): string {
  const { taxedPeople, untaxedPeople, collected } = world.taxes;
  const covered = taxedPeople + untaxedPeople === 0 ? 0 : Math.round((100 * taxedPeople) / (taxedPeople + untaxedPeople));
  return `Tax: ${TAX_RATES[world.taxRate].name} · ${covered}% · ${Math.round(collected)} dr`;
}

function renderPanel(buttons: ToolButton[]): string {
  const headed = ['Housing', 'Food', 'Services'];
  const roads = buttons.map((button, index) => ({ button, index })).filter(({ button }) => button.group === 'Road');
  const demolish = buttons.findIndex((button) => button.group === 'Demolish');

  const sections = headed
    .map((name) => {
      const items = buttons.map((button, index) => ({ button, index })).filter(({ button }) => button.group === name);
      return `
        <section class="tool-group">
          <h3>${name}</h3>
          <div class="tool-group-buttons">
            ${items.map(({ button, index }) => renderButton(button, index)).join('')}
          </div>
        </section>
      `;
    })
    .join('');

  return `
    ${roads.map(({ button, index }) => renderButton(button, index)).join('')}
    ${sections}
    <div class="divider"></div>
    ${renderButton(buttons[demolish], demolish)}
  `;
}

function labourLabel({ employed, required, workforce }: LabourReport): string {
  const idle = workforce - employed;
  if (employed < required) return `${employed}/${required} workers · ${required - employed} short`;
  return `${employed}/${required} workers · ${idle} idle`;
}

function speedLabel(speed: number): string {
  if (speed === 0) return '<span class="pause-icon"><span></span><span></span></span>';
  return `${speed}×`;
}

function renderButton(button: ToolButton, index: number): string {
  const cost = button.cost === null ? '' : `<small>${button.cost} dr</small>`;
  return `<button class="tool" data-tool="${index}" title="${button.hint}">
    <span class="tool-label">${button.label}${cost}</span>
    <kbd>${button.shortcut.toUpperCase()}</kbd>
  </button>`;
}

function isSameTool(a: Tool, b: Tool): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'build' && b.kind === 'build') return a.building === b.building;
  return true;
}

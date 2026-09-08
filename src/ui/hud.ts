import type { Game, Tool } from '../game';
import { BUILDINGS, PLACEABLE, ROAD_COST } from '../sim/buildings';

interface ToolButton {
  label: string;
  hint: string;
  shortcut: string;
  tool: Tool;
}

export function createHud(root: HTMLElement, game: Game): { update: () => void } {
  const buttons = toolButtons();

  root.insertAdjacentHTML(
    'beforeend',
    `
    <div class="hud">
      <header class="status">
        <span class="brand">Zeus</span>
        <span data-field="date"></span>
        <span data-field="daylight"></span>
        <span data-field="treasury"></span>
        <span data-field="population"></span>
        <span class="spacer"></span>
        <span class="speeds">
          ${[0, 1, 2, 4].map((speed) => `<button data-speed="${speed}">${speed === 0 ? '❚❚' : `${speed}×`}</button>`).join('')}
        </span>
        <button data-overlay>Desirability (O)</button>
      </header>
      <aside class="tools">
        ${buttons.map((button, index) => renderButton(button, index)).join('')}
      </aside>
      <footer class="readout">
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
  hud.querySelector('[data-overlay]')?.addEventListener('click', () => game.toggleDesirabilityOverlay());

  const selectTool = (index: number) => {
    const button = buttons[index];
    if (!button) return;
    game.tool = button.tool;
  };

  window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    const index = buttons.findIndex((button) => button.shortcut === key);
    if (index >= 0) selectTool(index);
    if (key === 'o') game.toggleDesirabilityOverlay();
    if (key === ' ') {
      event.preventDefault();
      game.speed = game.speed === 0 ? 1 : 0;
    }
  });

  return {
    update: () => {
      field('date').textContent = game.world.dateLabel;
      field('daylight').textContent = game.atmosphere.timeOfDay;
      field('treasury').textContent = `${Math.floor(game.world.treasury)} dr`;
      field('population').textContent = `${game.world.population} citizens`;
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
      hint: `${def.cost} dr — ${def.description}`,
      shortcut: String(index + 1),
      tool: { kind: 'build', building: kind } as Tool,
    };
  });

  return [
    { label: 'Road', hint: `${ROAD_COST} dr per tile`, shortcut: 'r', tool: { kind: 'road' } },
    ...structures,
    { label: 'Demolish', hint: 'Remove roads and buildings', shortcut: 'x', tool: { kind: 'demolish' } },
  ];
}

function renderButton(button: ToolButton, index: number): string {
  return `<button data-tool="${index}" title="${button.hint}">
    <span>${button.label}</span>
    <kbd>${button.shortcut.toUpperCase()}</kbd>
  </button>`;
}

function isSameTool(a: Tool, b: Tool): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'build' && b.kind === 'build') return a.building === b.building;
  return true;
}

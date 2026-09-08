import type { Game, Tool } from '../game';
import { BUILDINGS, PLACEABLE, ROAD_COST } from '../sim/buildings';

interface ToolButton {
  label: string;
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
        <span class="cartouche" data-field="daylight"></span>
        <span class="cartouche treasury" data-field="treasury"></span>
        <span class="cartouche" data-field="population"></span>
        <span class="spacer"></span>
        <span class="speeds">
          ${[0, 1, 2, 4]
            .map((speed) => `<button class="medallion" data-speed="${speed}">${speed === 0 ? '❚❚' : `${speed}×`}</button>`)
            .join('')}
        </span>
        <button class="overlay-toggle" data-overlay>Desirability <kbd>O</kbd></button>
      </header>
      <aside class="panel">
        <div class="panel-inner">
          ${renderGroups(buttons)}
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
      group: groupFor(kind),
    };
  });

  return [
    { label: 'Road', hint: `${ROAD_COST} dr per tile`, shortcut: 'r', tool: { kind: 'road' }, group: 'Road' },
    ...structures,
    { label: 'Demolish', hint: 'Remove roads and buildings', shortcut: 'x', tool: { kind: 'demolish' }, group: 'Demolish' },
  ];
}

function groupFor(kind: string): string {
  if (kind === 'house') return 'Housing';
  if (kind === 'wheatFarm' || kind === 'granary') return 'Food';
  return 'Services';
}

function renderGroups(buttons: ToolButton[]): string {
  const groups: { name: string; items: { button: ToolButton; index: number }[] }[] = [];
  buttons.forEach((button, index) => {
    let group = groups.find((entry) => entry.name === button.group);
    if (!group) {
      group = { name: button.group, items: [] };
      groups.push(group);
    }
    group.items.push({ button, index });
  });

  return groups
    .map(
      (group) => `
      <section class="tool-group">
        <h3>${group.name}</h3>
        <div class="tool-group-buttons">
          ${group.items.map(({ button, index }) => renderButton(button, index)).join('')}
        </div>
      </section>
    `,
    )
    .join('');
}

function renderButton(button: ToolButton, index: number): string {
  return `<button class="tool" data-tool="${index}" title="${button.hint}">
    <span>${button.label}</span>
    <kbd>${button.shortcut.toUpperCase()}</kbd>
  </button>`;
}

function isSameTool(a: Tool, b: Tool): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'build' && b.kind === 'build') return a.building === b.building;
  return true;
}

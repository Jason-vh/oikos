import type { Game, Tool } from '../game';
import type { OverlayMode } from '../render/scene';
import { BUILDINGS, PLACEABLE, ROADBLOCK_COST, ROAD_COST } from '../sim/buildings';
import { WAGE_LEVELS, type LabourReport } from '../sim/labour';
import { TAX_RATES } from '../sim/taxation';
import { abandonCity } from '../sim/save';
import {
  describeBuildingTool,
  describeDemolishTool,
  describeInspectTool,
  describeRoadTool,
  describeRoadblockTool,
  type Inspection,
} from './inspect';

interface ToolButton {
  label: string;
  cost: number | null;
  shortcut: string;
  tool: Tool;
  group: string;
  describe: () => Inspection;
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
        <span class="cartouche" data-field="popularity"></span>
        <button class="cartouche" data-wages data-field="wages"></button>
        <button class="cartouche" data-taxes data-field="taxes"></button>
        <span class="spacer"></span>
        <span class="speeds">
          ${[0, 1, 2, 4].map((speed) => `<button class="medallion" data-speed="${speed}">${speedLabel(speed)}</button>`).join('')}
        </span>
        <button class="overlay-toggle" data-overlay="appeal">Appeal <kbd>O</kbd></button>
        <button class="overlay-toggle" data-overlay="hazard">Hazards <kbd>H</kbd></button>
        <button class="overlay-toggle" data-new-city>New city</button>
      </header>
      <aside class="panel">
        <div class="panel-inner">
          ${renderPanel(buttons)}
        </div>
      </aside>
      <section class="goals" data-goals>
        <h2 data-goals-title></h2>
        <p class="goals-blurb" data-goals-blurb></p>
        <ul class="goals-list" data-goals-list></ul>
      </section>
      <section class="popup" data-popup hidden>
        <button class="popup-close" data-popup-close>×</button>
        <h2 data-popup-title></h2>
        <p class="popup-subtitle" data-popup-subtitle></p>
        <p class="popup-description" data-popup-description></p>
        <dl class="popup-facts" data-popup-facts></dl>
      </section>
      <footer class="scroll">
        <span data-field="hover"></span>
        <span data-field="messages"></span>
      </footer>
    </div>
  `,
  );

  const hud = root.querySelector('.hud') as HTMLElement;
  const field = (name: string) => hud.querySelector(`[data-field="${name}"]`) as HTMLElement;

  const popup = hud.querySelector('[data-popup]') as HTMLElement;
  let balloon: Inspection | null = null;

  hud.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((element) => {
    const button = buttons[Number(element.dataset.tool)];
    element.addEventListener('click', () => selectTool(Number(element.dataset.tool)));
    element.addEventListener('mouseenter', () => {
      balloon = button.describe();
    });
    element.addEventListener('mouseleave', () => {
      balloon = null;
    });
  });
  hud.querySelector('[data-popup-close]')?.addEventListener('click', () => game.clearSelection());
  hud.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((element) => {
    element.addEventListener('click', () => {
      game.speed = Number(element.dataset.speed);
    });
  });
  hud.querySelectorAll<HTMLButtonElement>('[data-overlay]').forEach((element) => {
    element.addEventListener('click', () => game.toggleOverlay(element.dataset.overlay as OverlayMode));
  });
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
    if (key === 'escape') {
      game.clearSelection();
      selectTool(buttons.findIndex((button) => button.tool.kind === 'inspect'));
      return;
    }

    const index = buttons.findIndex((button) => button.shortcut === key);
    if (index >= 0) selectTool(index);
    if (key === 'o') game.toggleOverlay('appeal');
    if (key === 'h') game.toggleOverlay('hazard');
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
      field('popularity').textContent = popularityLabel(game.world.sentiment.popularity, game.world.migrants);
      field('wages').textContent = `Wages: ${WAGE_LEVELS[game.world.wageLevel].name}`;
      field('taxes').textContent = taxLabel(game.world);
      renderGoals(hud, game.world);
      renderPopup(popup, balloon ?? game.inspectSelection(), balloon === null);
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
  const structures = PLACEABLE.map((kind, index) => ({
    label: BUILDINGS[kind].name,
    cost: BUILDINGS[kind].cost,
    shortcut: String(index + 1),
    tool: { kind: 'build', building: kind } as Tool,
    group: groupFor(kind),
    describe: () => describeBuildingTool(kind),
  }));

  return [
    {
      label: 'Inspect',
      cost: null,
      shortcut: 'i',
      tool: { kind: 'inspect' },
      group: 'Road',
      describe: describeInspectTool,
    },
    { label: 'Road', cost: ROAD_COST, shortcut: 'r', tool: { kind: 'road' }, group: 'Road', describe: describeRoadTool },
    {
      label: 'Roadblock',
      cost: ROADBLOCK_COST,
      shortcut: 'b',
      tool: { kind: 'roadblock' },
      group: 'Road',
      describe: describeRoadblockTool,
    },
    ...structures,
    {
      label: 'Demolish',
      cost: null,
      shortcut: 'x',
      tool: { kind: 'demolish' },
      group: 'Demolish',
      describe: describeDemolishTool,
    },
  ];
}

function renderGoals(hud: HTMLElement, world: Game['world']): void {
  const title = hud.querySelector('[data-goals-title]') as HTMLElement;
  const blurb = hud.querySelector('[data-goals-blurb]') as HTMLElement;
  const list = hud.querySelector('[data-goals-list]') as HTMLElement;

  title.textContent = world.scenario.name;
  blurb.textContent = world.scenarioWon ? 'Every goal is met. The city is yours.' : world.scenario.blurb;

  const rows = world.goals
    .map(
      (goal) =>
        `<li class="${goal.met ? 'met' : ''}"><span>${goal.label}</span><b>${goal.current} / ${goal.target}</b></li>`,
    )
    .join('');
  if (list.innerHTML !== rows) list.innerHTML = rows;
}

function renderPopup(popup: HTMLElement, inspection: Inspection | null, closable: boolean): void {
  popup.hidden = inspection === null;
  if (!inspection) return;

  (popup.querySelector('[data-popup-close]') as HTMLElement).hidden = !closable;

  const set = (name: string, text: string) => {
    (popup.querySelector(`[data-popup-${name}]`) as HTMLElement).textContent = text;
  };
  set('title', inspection.title);
  set('subtitle', inspection.subtitle);
  set('description', inspection.description);

  const facts = popup.querySelector('[data-popup-facts]') as HTMLElement;
  facts.innerHTML = inspection.facts
    .map(([term, value]) => `<dt>${term}</dt><dd>${value}</dd>`)
    .join('');
}

function groupFor(kind: string): string {
  if (kind === 'house') return 'Housing';
  if (kind === 'wheatFarm' || kind === 'granary' || kind === 'growersLodge' || kind === 'agora') return 'Food';
  if (kind === 'olivePress') return 'Industry';
  if (kind === 'college' || kind === 'podium') return 'Culture';
  if (kind === 'palace' || kind === 'taxOffice') return 'Government';
  return 'Services';
}

function taxLabel(world: Game['world']): string {
  const { taxedPeople, untaxedPeople, collected } = world.taxes;
  const covered = taxedPeople + untaxedPeople === 0 ? 0 : Math.round((100 * taxedPeople) / (taxedPeople + untaxedPeople));
  return `Tax: ${TAX_RATES[world.taxRate].name} · ${covered}% · ${Math.round(collected)} dr`;
}

function renderPanel(buttons: ToolButton[]): string {
  const headed = ['Housing', 'Food', 'Industry', 'Culture', 'Services'];
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

function popularityLabel(popularity: number, migrants: number): string {
  if (migrants > 0) return `Popularity ${popularity} · ${migrants} settling`;
  if (migrants < 0) return `Popularity ${popularity} · ${-migrants} leaving`;
  return `Popularity ${popularity}`;
}

function speedLabel(speed: number): string {
  if (speed === 0) return '<span class="pause-icon"><span></span><span></span></span>';
  return `${speed}×`;
}

function renderButton(button: ToolButton, index: number): string {
  const cost = button.cost === null ? '' : `<small>${button.cost} dr</small>`;
  return `<button class="tool" data-tool="${index}">
    <span class="tool-label">${button.label}${cost}</span>
    <kbd>${button.shortcut.toUpperCase()}</kbd>
  </button>`;
}

function isSameTool(a: Tool, b: Tool): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'build' && b.kind === 'build') return a.building === b.building;
  return true;
}

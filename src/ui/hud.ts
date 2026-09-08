import type { Game, Tool } from '../game';
import type { OverlayMode } from '../render/scene';
import { BUILDINGS, PLACEABLE, ROADBLOCK_COST, ROAD_COST } from '../sim/buildings';
import { monthlyWages, WAGE_LEVELS, type LabourReport } from '../sim/labour';
import { TAX_RATES } from '../sim/taxation';
import { GODS, GOD_KINDS, moodName } from '../sim/gods';
import { abandonCity } from '../sim/save';
import { money } from './money';
import {
  describeBuildingTool,
  describeDemolishTool,
  describeInspectTool,
  describeRoadTool,
  describeRoadblockTool,
  type Inspection,
} from './inspect';

const SPEEDS = [
  { speed: 0, name: 'Paused' },
  { speed: 1, name: 'Steady' },
  { speed: 2, name: 'Brisk' },
  { speed: 4, name: 'Yeet' },
];

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
        ${renderMenu('treasury', 'treasury', financeMenu())}
        ${renderMenu('people', '', peopleMenu())}
        ${renderMenu('gods', '', godsMenu())}
        ${renderMenu('speed', '', speedMenu())}
        <span class="spacer"></span>
        <button class="overlay-toggle" data-overlay="appeal">Appeal <kbd>O</kbd></button>
        <button class="overlay-toggle" data-overlay="hazard">Hazards <kbd>H</kbd></button>
      </header>
      <aside class="panel">
        <div class="panel-inner">
          ${renderPanel(buttons)}
        </div>
      </aside>
      <section class="goals" data-goals>
        <button class="goals-header" data-goals-toggle>
          <h2 data-goals-title></h2>
          <span class="chevron"></span>
        </button>
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
      <p class="message" data-field="messages"></p>
      <div class="modal" data-modal hidden>
        <div class="modal-card">
          <h2>Zeus</h2>
          <button class="modal-button" data-resume>Resume</button>
          <button class="modal-button" data-new-city>Abandon city</button>
        </div>
      </div>
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
  hud.querySelectorAll<HTMLButtonElement>('[data-overlay]').forEach((element) => {
    element.addEventListener('click', () => game.toggleOverlay(element.dataset.overlay as OverlayMode));
  });

  const menus = Array.from(hud.querySelectorAll<HTMLElement>('[data-menu]'));
  const closeMenus = () => menus.forEach((menu) => menu.classList.remove('open'));

  hud.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((element) => {
    element.addEventListener('click', () => {
      game.speed = Number(element.dataset.speed);
      closeMenus();
    });
  });

  menus.forEach((menu) => {
    menu.querySelector('[data-menu-button]')?.addEventListener('click', () => {
      const wasOpen = menu.classList.contains('open');
      closeMenus();
      menu.classList.toggle('open', !wasOpen);
    });
  });
  document.addEventListener('pointerdown', (event) => {
    if (!(event.target instanceof Node) || !menus.some((menu) => menu.contains(event.target as Node))) closeMenus();
  });

  hud.querySelectorAll<HTMLButtonElement>('[data-step]').forEach((element) => {
    element.addEventListener('click', () => {
      const [setting, amount] = element.dataset.step!.split(':');
      if (setting === 'wages') {
        game.world.wageLevel = clampIndex(game.world.wageLevel + Number(amount), WAGE_LEVELS.length);
        game.world.hireWorkers();
      } else {
        game.world.taxRate = clampIndex(game.world.taxRate + Number(amount), TAX_RATES.length);
      }
    });
  });

  const modal = hud.querySelector('[data-modal]') as HTMLElement;
  hud.querySelector('[data-resume]')?.addEventListener('click', () => {
    modal.hidden = true;
  });
  hud.querySelector('[data-new-city]')?.addEventListener('click', () => {
    if (!confirm('Abandon this city and found a new one?')) return;
    abandonCity();
    location.reload();
  });

  const goals = hud.querySelector('[data-goals]') as HTMLElement;
  hud.querySelector('[data-goals-toggle]')?.addEventListener('click', () => goals.classList.toggle('collapsed'));

  const selectTool = (index: number) => {
    const button = buttons[index];
    if (!button) return;
    game.tool = button.tool;
  };

  window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    if (key === 'escape') {
      if (!modal.hidden) {
        modal.hidden = true;
        return;
      }
      if (menus.some((menu) => menu.classList.contains('open'))) {
        closeMenus();
        return;
      }
      if (game.selected || game.tool.kind !== 'inspect') {
        game.clearSelection();
        selectTool(buttons.findIndex((button) => button.tool.kind === 'inspect'));
        return;
      }
      modal.hidden = false;
      return;
    }

    const index = buttons.findIndex((button) => button.shortcut !== '' && button.shortcut === key);
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
      const { world } = game;
      field('date').textContent = world.dateLabel;
      field('treasury').innerHTML = money(world.treasury);
      field('speed').textContent = speedLabel(game.speed);
      field('gods').textContent = godsLabel(world);
      for (const kind of GOD_KINDS) {
        const god = world.gods[kind];
        field(`mood-${kind}`).textContent = `${moodName(god.mood, god.honoured)}${god.honoured ? ` · ${god.mood}` : ''}`;
      }
      field('godsNote').textContent = godsNote(world);
      field('people').textContent = `${world.population} citizens`;
      field('taxRate').textContent = TAX_RATES[world.taxRate].name;
      field('taxTake').innerHTML = `${money(world.taxes.collected)} a month`;
      field('taxCover').textContent = `${taxCoverage(world)}% of citizens`;
      field('wageLevel').textContent = WAGE_LEVELS[world.wageLevel].name;
      field('wageBill').innerHTML = `${money(monthlyWages(world.labour.employed, world.wageLevel))} a month`;
      field('workers').textContent = labourLabel(world.labour);
      field('idle').textContent = `${world.labour.workforce - world.labour.employed}`;
      field('popularity').textContent = `${world.sentiment.popularity} of 100`;
      field('migration').textContent = migrationLabel(world.migrants);
      field('complaint').textContent = world.sentiment.complaint ?? 'Nobody complains.';
      renderGoals(hud, world);
      renderPopup(popup, balloon ?? game.inspectSelection(), balloon === null);
      field('messages').textContent = world.messages[0] ?? '';

      hud.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((element) => {
        const button = buttons[Number(element.dataset.tool)];
        element.classList.toggle('active', isSameTool(button.tool, game.tool));
      });
      hud.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((element) => {
        element.classList.toggle('chosen', Number(element.dataset.speed) === game.speed);
      });
    },
  };
}

function toolButtons(): ToolButton[] {
  const structures = PLACEABLE.map((kind, index) => ({
    label: BUILDINGS[kind].name,
    cost: BUILDINGS[kind].cost,
    shortcut: index < 9 ? String(index + 1) : '',
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
  if (kind.startsWith('sanctuary')) return 'Mythology';
  return 'Services';
}

function godsLabel(world: Game['world']): string {
  const honoured = GOD_KINDS.filter((kind) => world.gods[kind].honoured);
  if (honoured.length === 0) return 'No gods';
  const wrathful = honoured.filter((kind) => moodName(world.gods[kind].mood, true) === 'Wrathful').length;
  if (wrathful > 0) return `${wrathful} god${wrathful > 1 ? 's' : ''} wrathful`;
  return `${honoured.length} god${honoured.length > 1 ? 's' : ''} honoured`;
}

function godsNote(world: Game['world']): string {
  for (const kind of GOD_KINDS) {
    const act = world.gods[kind].lastAct;
    if (act) return act;
  }
  const honoured = GOD_KINDS.some((kind) => world.gods[kind].honoured);
  if (honoured) return 'No god has stirred yet.';
  return 'Raise a sanctuary and a god will take an interest.';
}

function taxCoverage(world: Game['world']): number {
  const { taxedPeople, untaxedPeople } = world.taxes;
  if (taxedPeople + untaxedPeople === 0) return 0;
  return Math.round((100 * taxedPeople) / (taxedPeople + untaxedPeople));
}

function renderMenu(name: string, extraClass: string, rows: string): string {
  return `
    <div class="cartouche-menu" data-menu="${name}">
      <button class="cartouche ${extraClass}" data-menu-button data-field="${name}"></button>
      <div class="dropdown">${rows}</div>
    </div>
  `;
}

function financeMenu(): string {
  return `
    ${renderStepper('Tax rate', 'tax', 'taxRate')}
    ${renderReading('Collected', 'taxTake')}
    ${renderReading('Paying tax', 'taxCover')}
    <div class="dropdown-rule"></div>
    ${renderStepper('Wages', 'wages', 'wageLevel')}
    ${renderReading('Wage bill', 'wageBill')}
  `;
}

function peopleMenu(): string {
  return `
    ${renderReading('Workers', 'workers')}
    ${renderReading('Unemployed', 'idle')}
    <div class="dropdown-rule"></div>
    ${renderReading('Popularity', 'popularity')}
    ${renderReading('Migration', 'migration')}
    <p class="dropdown-note" data-field="complaint"></p>
  `;
}

function renderStepper(label: string, setting: string, field: string): string {
  return `
    <div class="dropdown-row">
      <span>${label}</span>
      <span class="stepper">
        <button data-step="${setting}:-1">◀</button>
        <b data-field="${field}"></b>
        <button data-step="${setting}:1">▶</button>
      </span>
    </div>
  `;
}

function renderReading(label: string, field: string): string {
  return `<div class="dropdown-row"><span>${label}</span><b data-field="${field}"></b></div>`;
}



function clampIndex(index: number, length: number): number {
  return Math.min(length - 1, Math.max(0, index));
}

function renderPanel(buttons: ToolButton[]): string {
  const headed = ['Housing', 'Food', 'Industry', 'Culture', 'Services', 'Government', 'Mythology'];
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

function labourLabel({ employed, required }: LabourReport): string {
  if (employed < required) return `${employed}/${required} · ${required - employed} short`;
  return `${employed}/${required}`;
}

function migrationLabel(migrants: number): string {
  if (migrants > 0) return `${migrants} settling`;
  if (migrants < 0) return `${-migrants} leaving`;
  return 'Steady';
}

function godsMenu(): string {
  const rows = GOD_KINDS.map(
    (kind) => `
      <div class="dropdown-row">
        <span>${GODS[kind].name}</span>
        <b data-field="mood-${kind}"></b>
      </div>`,
  ).join('');
  return `${rows}<p class="dropdown-note" data-field="godsNote"></p>`;
}

function speedMenu(): string {
  return SPEEDS.map(
    ({ speed, name }) => `<button class="choice" data-speed="${speed}"><span>${name}</span><b>${speed === 0 ? '—' : `${speed}×`}</b></button>`,
  ).join('');
}

function speedLabel(speed: number): string {
  if (speed === 0) return 'Paused';
  return `${speed}×`;
}

function renderButton(button: ToolButton, index: number): string {
  const cost = button.cost === null ? '' : `<small>${money(button.cost)}</small>`;
  const key = button.shortcut === '' ? '' : `<kbd>${button.shortcut.toUpperCase()}</kbd>`;
  return `<button class="tool" data-tool="${index}">
    <span class="tool-label">${button.label}${cost}</span>
    ${key}
  </button>`;
}

function isSameTool(a: Tool, b: Tool): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'build' && b.kind === 'build') return a.building === b.building;
  return true;
}

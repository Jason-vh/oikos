import type { Game, Tool } from '../game';
import type { OverlayMode } from '../render/scene';
import { BUILDINGS, PLACEABLE, ROADBLOCK_COST, ROAD_COST, WALL_COST } from '../sim/buildings';
import { monthlyWages, WAGE_LEVELS, type LabourReport } from '../sim/labour';
import { TAX_RATES } from '../sim/taxation';
import { GODS, GOD_KINDS, moodName } from '../sim/gods';
import { UNITS, type UnitKind } from '../sim/military';
import { DIFFICULTIES } from '../sim/difficulty';
import { describeRequest } from '../sim/events';
import { HEROES, HERO_KINDS, summonable, type HeroKind } from '../sim/heroes';
import { CAMPAIGN } from '../sim/scenario';
import type { BuildingKind } from '../sim/types';
import { abandonCity } from '../sim/save';
import { TRADE_ROUTES } from '../sim/trade';
import { COIN, money } from './money';
import {
  describeBuildingTool,
  describeDemolishTool,
  describeInspectTool,
  describeRoadTool,
  describeRoadblockTool,
  describeWallTool,
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
  costOf?: BuildingKind;
  shortcut: string;
  tool: Tool;
  group: string;
  describe: () => Inspection;
}

export function createHud(root: HTMLElement, game: Game): { update: () => void } {
  const buttons = toolButtons(game);

  root.insertAdjacentHTML(
    'beforeend',
    `
    <div class="hud">
      <header class="topbar">
        <span class="brand">Zeus</span>
        <span class="cartouche" data-field="date"></span>
        ${renderMenu('treasury', 'treasury', financeMenu())}
        ${renderMenu('people', '', peopleMenu())}
        ${renderMenu('heroes', '', '<div data-heroes></div>')}
        ${renderMenu('requests', '', '<div data-requests></div>')}
        ${renderMenu('army', '', armyMenu())}
        ${renderMenu('trade', '', tradeMenu())}
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
        <button class="goals-next" data-next-episode hidden></button>
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
          <div class="modal-section">Difficulty</div>
          ${DIFFICULTIES.map(
            (level, index) => `<button class="choice" data-difficulty="${index}"><span>${level.name}</span><b>×${level.costMultiplier}</b></button>`,
          ).join('')}
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
  hud.querySelectorAll<HTMLButtonElement>('[data-route]').forEach((element) => {
    element.addEventListener('click', () => {
      const route = element.dataset.route!;
      game.world.tradeOrders[route] = !game.world.tradeOrders[route];
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
  hud.querySelectorAll<HTMLButtonElement>('[data-difficulty]').forEach((element) => {
    element.addEventListener('click', () => {
      game.world.difficulty = Number(element.dataset.difficulty);
      game.world.hireWorkers();
    });
  });
  hud.querySelector('[data-new-city]')?.addEventListener('click', () => {
    if (!confirm('Abandon this city and found a new one?')) return;
    abandonCity();
    location.reload();
  });

  hud.querySelector('[data-next-episode]')?.addEventListener('click', () => {
    game.world.beginEpisode(game.world.episode + 1);
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
      field('heroes').textContent = 'Heroes';
      renderHeroes(hud, game);
      field('requests').textContent = 'World';
      alert(hud, 'requests', world.requests.length > 0);
      alert(hud, 'gods', GOD_KINDS.some((kind) => world.gods[kind].honoured && world.gods[kind].mood <= 20));
      alert(hud, 'heroes', world.monster !== null);
      renderRequests(hud, world, game);
      field('army').textContent = 'Army';
      for (const kind of Object.keys(UNITS) as UnitKind[]) {
        field(`army-${kind}`).textContent = `${world.army[kind]} compan${world.army[kind] === 1 ? 'y' : 'ies'}`;
      }
      field('armyNote').textContent = armyNote(world);
      field('trade').textContent = 'Trade';
      field('tradeNote').innerHTML = tradeNote(world);
      field('gods').textContent = 'Gods';
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
      hud.querySelectorAll<HTMLButtonElement>('[data-route]').forEach((element) => {
        element.classList.toggle('chosen', world.tradeOrders[element.dataset.route!]);
      });
      hud.querySelectorAll<HTMLButtonElement>('[data-difficulty]').forEach((element) => {
        element.classList.toggle('chosen', Number(element.dataset.difficulty) === world.difficulty);
      });
      hud.querySelectorAll<HTMLElement>('[data-cost]').forEach((element) => {
        element.innerHTML = money(world.costOf(element.dataset.cost as BuildingKind));
      });
    },
  };
}

function toolButtons(game: Game): ToolButton[] {
  const structures = PLACEABLE.map((kind, index) => ({
    label: BUILDINGS[kind].name,
    cost: null,
    costOf: kind,
    shortcut: index < 9 ? String(index + 1) : '',
    tool: { kind: 'build', building: kind } as Tool,
    group: groupFor(kind),
    describe: () => describeBuildingTool(kind, game.world.difficulty),
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
      label: 'Wall',
      cost: WALL_COST,
      shortcut: 'w',
      tool: { kind: 'wall' },
      group: 'Defence',
      describe: describeWallTool,
    },
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
  const next = hud.querySelector('[data-next-episode]') as HTMLButtonElement;

  title.textContent = `${world.episode + 1}. ${world.scenario.name}`;
  blurb.textContent = episodeBlurb(world);
  next.hidden = !world.scenarioWon || !world.hasNextEpisode;
  next.textContent = world.hasNextEpisode ? `On to ${CAMPAIGN[world.episode + 1].name}` : '';

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
  if (kind === 'house' || kind === 'estate') return 'Housing';
  if (kind === 'wheatFarm' || kind === 'granary' || kind === 'growersLodge' || kind === 'agora') return 'Food';
  if (kind === 'olivePress' || kind === 'winery' || kind === 'cardingShed' || kind === 'vineyard') return 'Industry';
  if (['college', 'podium', 'gymnasium', 'dramaSchool', 'theatre', 'stadium'].includes(kind)) return 'Culture';
  if (kind === 'infirmary' || kind === 'watchpost') return 'Services';
  if (kind === 'palace' || kind === 'taxOffice' || kind === 'tradingPost') return 'Government';
  if (kind === 'tower') return 'Defence';
  if (kind.startsWith('sanctuary') || kind === 'heroHall') return 'Mythology';
  return 'Services';
}


function renderHeroes(hud: HTMLElement, game: Game): void {
  const host = hud.querySelector('[data-heroes]') as HTMLElement;
  const { world } = game;
  const ready = summonable(world.heroCall());

  const rows = HERO_KINDS.map((kind) => {
    const hero = HEROES[kind];
    const here = world.hero?.kind === kind;
    const state = here ? `${world.hero?.monthsLeft} months` : ready.includes(kind) ? 'Ready' : hero.demands;
    return `<button class="choice${here ? ' chosen' : ''}" data-hero="${kind}"><span>${hero.name}</span><b>${state}</b></button>`;
  }).join('');

  const note = world.monster
    ? `<p class="dropdown-note">${world.monster.name} is loose. Only ${HEROES[world.monster.slayer].name} can kill it.</p>`
    : '<p class="dropdown-note">A hero hall and what he asks of the city bring him in.</p>';
  const markup = rows + note;

  if (host.innerHTML === markup) return;
  host.innerHTML = markup;
  host.querySelectorAll<HTMLButtonElement>('[data-hero]').forEach((element) => {
    element.addEventListener('click', () => {
      if (!game.world.summon(element.dataset.hero as HeroKind)) {
        game.world.log('No hero answers that call.');
      }
    });
  });
}


function renderRequests(hud: HTMLElement, world: Game['world'], game: Game): void {
  const host = hud.querySelector('[data-requests]') as HTMLElement;
  const rows = world.requests
    .map(
      (request, index) =>
        `<button class="choice" data-request="${index}"><span>${describeRequest(request)}</span><b>${request.reward} ${COIN}</b></button>`,
    )
    .join('');
  const note = `<p class="dropdown-note">Standing with the world: ${world.standing} of 100.</p>`;
  const empty = '<p class="dropdown-note">No city asks anything of you.</p>';
  const markup = (rows === '' ? empty : rows) + note;

  if (host.innerHTML === markup) return;
  host.innerHTML = markup;
  host.querySelectorAll<HTMLButtonElement>('[data-request]').forEach((element) => {
    element.addEventListener('click', () => {
      if (!game.world.fulfilRequest(Number(element.dataset.request))) {
        game.world.log('The city has not the goods to send.');
      }
    });
  });
}


function armyNote(world: Game['world']): string {
  if (!world.has('palace')) return 'Without a palace nobody musters.';
  const battle = world.lastBattle;
  if (!battle) return 'Housing raises the companies; the better the house, the better the soldier.';
  if (battle.won) return `The ${battle.invasion.nation} were thrown back.`;
  return `The ${battle.invasion.nation} sacked the city.`;
}


function tradeNote(world: Game['world']): string {
  const { earned, spent, exported, imported } = world.trade;
  if (earned === 0 && spent === 0) return 'A staffed trading post carries the orders you open.';
  return `Last month: ${exported} out for ${money(earned)}, ${imported} in for ${money(spent)}.`;
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

function alert(hud: HTMLElement, menu: string, active: boolean): void {
  hud.querySelector(`[data-field="${menu}"]`)?.classList.toggle('alert', active);
}

function episodeBlurb(world: Game['world']): string {
  if (world.scenarioLost) return 'The city is bankrupt and your rule is over.';
  if (!world.scenarioWon) return world.scenario.blurb;
  if (world.hasNextEpisode) return 'Every goal is met. Another city awaits.';
  return 'Every goal of the campaign is met. Greece is yours.';
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
  const headed = ['Housing', 'Food', 'Industry', 'Culture', 'Services', 'Government', 'Defence', 'Mythology'];
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

function armyMenu(): string {
  const rows = (Object.keys(UNITS) as UnitKind[])
    .map((kind) => `<div class="dropdown-row"><span>${UNITS[kind].name}</span><b data-field="army-${kind}"></b></div>`)
    .join('');
  return `${rows}<p class="dropdown-note" data-field="armyNote"></p>`;
}

function tradeMenu(): string {
  const rows = TRADE_ROUTES.map(
    (route) => `
      <button class="choice" data-route="${route.id}">
        <span>${route.city} ${route.direction === 'export' ? 'buys' : 'sells'} ${route.good}</span>
        <b>${route.price} ${COIN}</b>
      </button>`,
  ).join('');
  return `${rows}<p class="dropdown-note" data-field="tradeNote"></p>`;
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
  const cost = button.costOf
    ? `<small data-cost="${button.costOf}"></small>`
    : button.cost === null
      ? ''
      : `<small>${money(button.cost)}</small>`;
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

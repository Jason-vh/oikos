import type { Building, Rotation, Summary, Tool, World } from '../sim/types';
import { BUILDINGS, HOUSE_CAPACITY, HOUSE_NAMES, MONTH_SECONDS, ROAD_COST, VENDOR_COST } from '../sim/catalog';
import { toolIcon } from './icons';

export interface HudActions {
  tool(tool: Tool): void;
  rotate(): void;
  speed(speed: 0 | 1 | 3): void;
  save(): void;
  load(): void;
  newIsland(): void;
  vendor(id: number, enabled: boolean): void;
  focus(x: number, z: number): void;
  grid(enabled: boolean): void;
}

export type Selection =
  | { kind: 'building'; building: Building; status: string[] }
  | { kind: 'person'; name: string; role: string; status: string[] };

export interface Hud {
  update(world: World, summary: Summary, selected: Selection | null): void;
  setTool(tool: Tool, rotation: Rotation): void;
  setSpeed(speed: 0 | 1 | 3): void;
  notify(message: string, error?: boolean): void;
  setHint(message: string): void;
  setGrid(enabled: boolean): void;
  toggleMenu(): boolean;
  dispose(): void;
}

const TOOL_DEFS: Array<{ tool: Tool; label: string; cost: string; key: string }> = [
  { tool: 'road', label: 'Road', cost: `${ROAD_COST} / tile`, key: '1' },
  { tool: 'house', label: BUILDINGS.house.name, cost: String(BUILDINGS.house.cost), key: '2' },
  { tool: 'farm', label: BUILDINGS.farm.name, cost: String(BUILDINGS.farm.cost), key: '3' },
  { tool: 'granary', label: BUILDINGS.granary.name, cost: String(BUILDINGS.granary.cost), key: '4' },
  { tool: 'agora', label: BUILDINGS.agora.name, cost: String(BUILDINGS.agora.cost), key: '5' },
  { tool: 'fountain', label: BUILDINGS.fountain.name, cost: String(BUILDINGS.fountain.cost), key: '6' },
  { tool: 'maintenance', label: BUILDINGS.maintenance.name, cost: String(BUILDINGS.maintenance.cost), key: '7' },
  { tool: 'demolish', label: 'Demolish', cost: 'half refunded', key: 'X' },
];

const TOAST_LIFETIME = 3200;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FOUNDING_YEAR_BC = 421;

function formatDrachma(value: number): string {
  return `${Math.round(value).toLocaleString('en-US')} dr`;
}

function formatSigned(value: number): string {
  const rounded = Math.round(value);
  if (rounded > 0) return `+${rounded.toLocaleString('en-US')} dr`;
  if (rounded < 0) return `\u2212${Math.abs(rounded).toLocaleString('en-US')} dr`;
  return '0 dr';
}

function formatDate(world: World): string {
  const months = Math.floor(world.time / MONTH_SECONDS);
  const day = Math.floor((world.time % MONTH_SECONDS) / MONTH_SECONDS * 30) + 1;
  const year = FOUNDING_YEAR_BC - Math.floor(months / 12);
  return `${day} ${MONTHS[months % 12]} ${year} BC`;
}

function describeStores(building: Building): string {
  const entries = Object.entries(building.stores).filter(([, amount]) => amount > 0);
  if (entries.length === 0) return 'Empty';
  return entries.map(([food, amount]) => `${Math.round(amount)} ${food}`).join(' \u00b7 ');
}

function vendorInstalled(building: Building): boolean {
  const record = building as Building & { vendorInstalled?: boolean };
  return record.vendorInstalled ?? building.vendorEnabled;
}

interface Milestones {
  houses: boolean;
  farmGranary: boolean;
  agoraVendor: boolean;
  foodDelivered: boolean;
  services: boolean;
  courtyards: boolean;
}

function computeMilestones(world: World, summary: Summary): Milestones {
  const houses = world.buildings.filter((building) => building.kind === 'house');
  const farms = world.buildings.some((building) => building.kind === 'farm');
  const granaries = world.buildings.some((building) => building.kind === 'granary');
  const agoraVendor = world.buildings.some((building) => building.kind === 'agora' && vendorInstalled(building));
  const fountains = world.buildings.some((building) => building.kind === 'fountain');
  const maintenance = world.buildings.some((building) => building.kind === 'maintenance');
  const courtyardCount = houses.filter((house) => house.tier === 3).length;
  return {
    houses: houses.length >= 4,
    farmGranary: farms && granaries,
    agoraVendor,
    foodDelivered: world.delivered > 0,
    services: fountains && maintenance,
    courtyards: courtyardCount >= 4 && (summary.goal || summary.balance >= 0),
  };
}

const SKELETON = `
  <div class="hud-top">
    <header class="hud-panel hud-masthead" data-testid="masthead">
      <h1>Oikos</h1>
      <dl class="hud-resources" aria-label="City resources">
        <div><dt>Population</dt><dd data-field="population">0</dd></div>
        <div><dt>Treasury</dt><dd data-field="treasury">0 dr</dd></div>
        <div><dt>Food</dt><dd data-field="food">0</dd></div>
        <div><dt>Balance</dt><dd data-field="balance">0 dr</dd></div>
        <div><dt>Employed</dt><dd data-field="employed">0 / 0</dd></div>
      </dl>
      <div class="hud-clock">
        <time data-field="time">1 Jan 421 BC</time>
        <div class="hud-speed" role="group" aria-label="Simulation speed">
          <button type="button" data-speed="0" aria-pressed="false" aria-label="Pause, shortcut Space">Pause</button>
          <button type="button" data-speed="1" aria-pressed="true" aria-label="Normal speed">1\u00d7</button>
          <button type="button" data-speed="3" aria-pressed="false" aria-label="Fast speed">3\u00d7</button>
        </div>
        <button type="button" class="hud-menu-button" data-action="menu" aria-label="Menu, shortcut Escape" data-testid="menu">Menu</button>
      </div>
    </header>
  </div>
  <details class="hud-panel hud-guide" data-testid="guide" open>
    <summary>Guide</summary>
    <ol class="hud-milestones" data-testid="milestones">
      <li><label><input type="checkbox" disabled data-milestone="houses" /> Four houses built</label></li>
      <li><label><input type="checkbox" disabled data-milestone="farmGranary" /> A wheat farm and a granary</label></li>
      <li><label><input type="checkbox" disabled data-milestone="agoraVendor" /> An agora with a vendor</label></li>
      <li><label><input type="checkbox" disabled data-milestone="foodDelivered" /> Food delivered to your houses</label></li>
      <li><label><input type="checkbox" disabled data-milestone="services" /> A fountain and a maintenance post</label></li>
      <li><label><input type="checkbox" disabled data-milestone="courtyards" /> Four courtyard houses, thriving</label></li>
    </ol>
    <p class="hud-guide-note">Wheat only takes root in fertile soil: the darker, striped fields.</p>
  </details>
  <details class="hud-panel hud-inspector" data-testid="inspector" hidden>
    <summary>Inspector</summary>
    <h3 data-field="inspector-title"></h3>
    <p class="hud-inspector-tier" data-field="inspector-tier" hidden></p>
    <dl class="hud-inspector-stats">
      <div data-row="residents" hidden><dt>Residents</dt><dd data-field="inspector-residents"></dd></div>
      <div data-row="condition"><dt>Condition</dt><dd data-field="inspector-condition"></dd></div>
      <div data-row="stock" hidden><dt>Stock</dt><dd data-field="inspector-stock"></dd></div>
      <div data-row="workers" hidden><dt>Workers</dt><dd data-field="inspector-workers"></dd></div>
      <div data-row="food" hidden><dt>Food</dt><dd data-field="inspector-food"></dd></div>
      <div data-row="water" hidden><dt>Water</dt><dd data-field="inspector-water"></dd></div>
    </dl>
    <p class="hud-inspector-note" data-field="inspector-status"></p>
    <button type="button" class="hud-vendor" data-action="vendor" hidden data-testid="vendor-toggle"></button>
  </details>
  <div class="hud-bottom">
    <p class="hud-hint" data-field="hint" role="note" hidden></p>
    <div class="hud-panel hud-toolbar" role="group" aria-label="Build tools" data-testid="toolbar"></div>
  </div>
  <div class="hud-toast-region" role="status" aria-live="polite" data-testid="toast-region"></div>
  <dialog class="hud-dialog hud-menu" data-testid="menu-dialog" aria-label="Menu">
    <form method="dialog">
      <h2>Oikos</h2>
      <div class="hud-menu-actions">
        <button type="submit" value="save" data-testid="save">Save island</button>
        <button type="submit" value="load" data-testid="load">Load saved island</button>
        <button type="submit" value="new" data-testid="new-island">New island</button>
        <button type="submit" value="grid" data-testid="grid-toggle" aria-pressed="false">Placement grid</button>
      </div>
      <dl class="hud-keys">
        <div><dt>1\u20137</dt><dd>Build tools</dd></div>
        <div><dt>X</dt><dd>Demolish</dd></div>
        <div><dt>R</dt><dd>Rotate building</dd></div>
        <div><dt>G</dt><dd>Toggle grid</dd></div>
        <div><dt>WASD / \u2190\u2191\u2192\u2193</dt><dd>Pan the view</dd></div>
        <div><dt>Q</dt><dd>Rotate view</dd></div>
        <div><dt>Space</dt><dd>Pause</dd></div>
        <div><dt>Esc</dt><dd>Cancel tool / menu</dd></div>
      </dl>
      <p class="hud-menu-footer"><a href="/art.html" target="_blank" rel="noopener">Model atelier</a><button type="submit" value="close">Close</button></p>
    </form>
  </dialog>
  <dialog class="hud-dialog" data-testid="new-island-dialog">
    <form method="dialog">
      <h2>Start a new island?</h2>
      <p>This replaces your saved island \u2014 the controller autosaves right away.</p>
      <div class="hud-dialog-actions">
        <button type="submit" value="cancel">Cancel</button>
        <button type="submit" value="confirm" class="hud-primary" autofocus>New island</button>
      </div>
    </form>
  </dialog>
`;

function field(root: ParentNode, name: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(`[data-field="${name}"]`);
  if (!element) throw new Error(`hud: missing field "${name}"`);
  return element;
}

function action(root: ParentNode, name: string): HTMLButtonElement {
  const element = root.querySelector<HTMLButtonElement>(`[data-action="${name}"]`);
  if (!element) throw new Error(`hud: missing action "${name}"`);
  return element;
}

function row(root: ParentNode, name: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(`[data-row="${name}"]`);
  if (!element) throw new Error(`hud: missing row "${name}"`);
  return element;
}

export function createHud(root: HTMLElement, actions: HudActions): Hud {
  root.innerHTML = SKELETON;

  const populationField = field(root, 'population');
  const treasuryField = field(root, 'treasury');
  const foodField = field(root, 'food');
  const balanceField = field(root, 'balance');
  const employedField = field(root, 'employed');
  const timeField = field(root, 'time');

  const toolbar = root.querySelector<HTMLElement>('.hud-toolbar')!;
  const toolButtons = new Map<Tool, HTMLButtonElement>();
  for (const def of TOOL_DEFS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hud-tool';
    button.dataset.tool = def.tool;
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-label', `${def.label}, ${def.cost}, shortcut ${def.key}`);
    button.title = `${def.label} \u00b7 ${def.key}`;
    const label = document.createElement('span');
    label.className = 'hud-tool-label';
    label.textContent = def.label;
    const cost = document.createElement('span');
    cost.className = 'hud-tool-cost';
    cost.textContent = def.cost;
    button.append(toolIcon(def.tool), label, cost);
    button.addEventListener('click', () => actions.tool(def.tool));
    toolbar.appendChild(button);
    toolButtons.set(def.tool, button);
  }

  const speedButtons = new Map<0 | 1 | 3, HTMLButtonElement>();
  root.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((button) => {
    const speed = Number(button.dataset.speed) as 0 | 1 | 3;
    speedButtons.set(speed, button);
    button.addEventListener('click', () => actions.speed(speed));
  });

  const dialog = root.querySelector<HTMLDialogElement>('[data-testid="new-island-dialog"]')!;
  dialog.addEventListener('close', () => {
    if (dialog.returnValue === 'confirm') actions.newIsland();
    dialog.returnValue = '';
  });

  const menu = root.querySelector<HTMLDialogElement>('.hud-menu')!;
  const gridButton = root.querySelector<HTMLButtonElement>('[data-testid="grid-toggle"]')!;
  action(root, 'menu').addEventListener('click', () => menu.showModal());
  menu.addEventListener('close', () => {
    const choice = menu.returnValue;
    menu.returnValue = '';
    if (choice === 'save') actions.save();
    else if (choice === 'load') actions.load();
    else if (choice === 'new') dialog.showModal();
    else if (choice === 'grid') actions.grid(gridButton.getAttribute('aria-pressed') !== 'true');
  });


  const guidePanel = root.querySelector<HTMLDetailsElement>('.hud-guide')!;
  const inspectorPanel = root.querySelector<HTMLDetailsElement>('.hud-inspector')!;
  let lastSelectedId: number | string | null = null;
  const narrow = window.matchMedia('(max-width: 860px)');
  if (narrow.matches) guidePanel.open = false;
  narrow.addEventListener('change', (event) => {
    if (event.matches) guidePanel.open = false;
    if (lastSelectedId !== null) guidePanel.hidden = event.matches;
  });

  const milestoneInputs = new Map<keyof Milestones, HTMLInputElement>();
  root.querySelectorAll<HTMLInputElement>('[data-milestone]').forEach((input) => {
    milestoneInputs.set(input.dataset.milestone as keyof Milestones, input);
  });

  const inspectorTitle = field(root, 'inspector-title');
  const inspectorTier = field(root, 'inspector-tier');
  const inspectorStatus = field(root, 'inspector-status');
  const rowResidents = row(root, 'residents');
  const rowCondition = row(root, 'condition');
  const rowStock = row(root, 'stock');
  const rowWorkers = row(root, 'workers');
  const rowFood = row(root, 'food');
  const rowWater = row(root, 'water');
  const vendorButton = action(root, 'vendor');

  function updateVendor(building: Building): void {
    if (building.kind !== 'agora') {
      vendorButton.hidden = true;
      return;
    }
    vendorButton.hidden = false;
    if (!vendorInstalled(building)) {
      vendorButton.textContent = `Add food vendor \u00b7 ${VENDOR_COST}`;
      vendorButton.setAttribute('aria-pressed', 'false');
      vendorButton.onclick = () => actions.vendor(building.id, true);
      return;
    }
    vendorButton.textContent = building.vendorEnabled ? 'Pause vendor' : 'Resume vendor';
    vendorButton.setAttribute('aria-pressed', String(building.vendorEnabled));
    vendorButton.onclick = () => actions.vendor(building.id, !building.vendorEnabled);
  }

  function showPerson(selection: Extract<Selection, { kind: 'person' }>): void {
    inspectorTitle.textContent = selection.name;
    inspectorTier.hidden = false;
    inspectorTier.textContent = selection.role;
    for (const element of [rowResidents, rowCondition, rowStock, rowWorkers, rowFood, rowWater]) element.hidden = true;
    vendorButton.hidden = true;
    inspectorStatus.textContent = selection.status.join(' ');
  }

  function updateInspector(selection: Selection | null): void {
    if (!selection) {
      inspectorPanel.hidden = true;
      guidePanel.hidden = false;
      lastSelectedId = null;
      return;
    }
    const id = selection.kind === 'building' ? selection.building.id : selection.name;
    if (id !== lastSelectedId) {
      inspectorPanel.open = true;
      lastSelectedId = id;
    }
    inspectorPanel.hidden = false;
    guidePanel.hidden = narrow.matches;
    if (selection.kind === 'person') {
      showPerson(selection);
      return;
    }
    const selected = selection.building;
    inspectorStatus.textContent = selection.status.join(' ');

    const definition = BUILDINGS[selected.kind];
    inspectorTitle.textContent = selected.kind === 'house' ? HOUSE_NAMES[selected.tier] : definition.name;
    inspectorTier.hidden = selected.kind !== 'house';
    if (selected.kind === 'house') inspectorTier.textContent = `Tier ${selected.tier}`;

    rowResidents.hidden = selected.kind !== 'house';
    if (selected.kind === 'house') {
      field(rowResidents, 'inspector-residents').textContent = `${selected.residents} / ${HOUSE_CAPACITY[selected.tier]}`;
    }

    rowCondition.hidden = false;
    field(rowCondition, 'inspector-condition').textContent = `${Math.round(selected.condition)}%`;

    const hasStock = selected.kind === 'farm' || selected.kind === 'granary' || selected.kind === 'agora';
    rowStock.hidden = !hasStock;
    if (hasStock) field(rowStock, 'inspector-stock').textContent = describeStores(selected);

    const hasWorkers = definition.jobs > 0;
    rowWorkers.hidden = !hasWorkers;
    if (hasWorkers) field(rowWorkers, 'inspector-workers').textContent = `${selected.workers} / ${definition.jobs}`;

    rowFood.hidden = selected.kind !== 'house';
    rowWater.hidden = selected.kind !== 'house';
    if (selected.kind === 'house') {
      field(rowFood, 'inspector-food').textContent = selected.food > 0 ? 'Stocked' : 'Needed';
      field(rowWater, 'inspector-water').textContent = selected.water > 0 ? `${Math.round(selected.water)}s left` : 'Needed';
    }

    updateVendor(selected);
  }

  function updateMilestones(world: World, summary: Summary): void {
    const milestones = computeMilestones(world, summary);
    for (const [key, input] of milestoneInputs) {
      input.checked = milestones[key];
    }
  }

  const hintElement = field(root, 'hint');
  const toastRegion = root.querySelector<HTMLElement>('.hud-toast-region')!;
  const toastTimers = new Set<number>();

  function update(world: World, summary: Summary, selected: Selection | null): void {
    populationField.textContent = summary.population.toLocaleString('en-US');
    treasuryField.textContent = formatDrachma(world.money);
    foodField.textContent = summary.food.toLocaleString('en-US');
    balanceField.textContent = formatSigned(summary.balance);
    employedField.textContent = `${summary.workers} / ${summary.jobs}`;
    timeField.textContent = formatDate(world);

    updateMilestones(world, summary);
    updateInspector(selected);
  }

  function setTool(tool: Tool, rotation: Rotation): void {
    for (const [key, button] of toolButtons) button.setAttribute('aria-pressed', String(key === tool));
    toolbar.dataset.rotation = String(rotation);
  }

  function setGrid(enabled: boolean): void {
    gridButton.setAttribute('aria-pressed', String(enabled));
  }

  function toggleMenu(): boolean {
    if (menu.open) {
      menu.close('close');
      return false;
    }
    if (dialog.open) {
      dialog.close('cancel');
      return false;
    }
    menu.showModal();
    return true;
  }

  function setSpeed(speed: 0 | 1 | 3): void {
    for (const [key, button] of speedButtons) button.setAttribute('aria-pressed', String(key === speed));
  }

  function notify(message: string, error = false): void {
    if (message.length === 0) return;
    const latest = toastRegion.lastElementChild;
    if (latest?.textContent === message) latest.remove();
    while (toastRegion.children.length >= 2) toastRegion.firstElementChild?.remove();
    const toast = document.createElement('div');
    toast.className = error ? 'hud-toast hud-toast-error' : 'hud-toast';
    toast.textContent = message;
    toastRegion.appendChild(toast);
    const timer = window.setTimeout(() => {
      toast.remove();
      toastTimers.delete(timer);
    }, TOAST_LIFETIME);
    toastTimers.add(timer);
  }

  function setHint(message: string): void {
    hintElement.textContent = message;
    hintElement.hidden = message.length === 0;
  }

  function dispose(): void {
    for (const timer of toastTimers) window.clearTimeout(timer);
    toastTimers.clear();
    root.replaceChildren();
  }

  return { update, setTool, setSpeed, notify, setHint, setGrid, toggleMenu, dispose };
}

import type { Building, BuildingKind, BuildTool, City, Resource, Rotation, StallGood, Summary, Tool, World } from '../sim/types';
import { nextUnlock, tierNoun, unlocked } from '../sim/unlocks';
import { STALL_GOODS, STALL_TRADES, stallServing } from '../sim/stalls';
import { BUILDINGS, HOUSE_CAPACITY, HOUSE_NAMES, MONTH_SECONDS, ROAD_COST, VENDOR_COST, storesGoods } from '../sim/catalog';
import { appetitePerResident, thirstPerSecond } from '../sim/variation';
import { cityColors } from '../art/primitives';
import type { CityColor } from '../sim/colors';
import { resourceIcon, toolIcon } from './icons';

export type HudTool = Tool | 'harbour';
export type Stance = 'founding' | 'watching' | 'building';

export interface HudActions {
  tool(tool: HudTool): void;
  rotate(): void;
  vendor(id: number, enabled: boolean, stall: StallGood): void;
  focus(x: number, z: number): void;
  grid(enabled: boolean): void;
  menu(open: boolean): void;
  sound(enabled: boolean): void;
  discardPending(): void;
  resetWorld(): void;
}

export interface HudFeatures {
  canReset: boolean;
}

export interface CityScope {
  city: City;
  summary: Summary;
}

export interface Tooltip {
  text: string;
  resource: Resource | null;
  x: number;
  y: number;
}

export type Selection =
  | { kind: 'building'; building: Building; status: string[]; editable: boolean }
  | { kind: 'person'; name: string; role: string; status: string[] };

export interface Hud {
  update(world: World, viewed: CityScope | null, active: CityScope | null, selected: Selection | null, writable: boolean): void;
  setTool(tool: HudTool, rotation: Rotation): void;
  notify(message: string, error?: boolean): void;
  setHint(message: string): void;
  setTooltip(tooltip: Tooltip | null): void;
  setGrid(enabled: boolean): void;
  setSound(enabled: boolean): void;
  setConnection(blocked: boolean, message: string): void;
  setStance(stance: Stance, ready: boolean): void;
  announceFounding(name: string, color: CityColor): void;
  setDiscardAvailable(available: boolean): void;
  toggleMenu(): boolean;
  dispose(): void;
}

interface ToolDef {
  tool: HudTool;
  label: string;
  cost: string;
  price: number;
  key?: string;
}

interface ToolGroup {
  name: string;
  tools: ToolDef[];
}

const HARBOUR_DEF: ToolDef = { tool: 'harbour', label: 'Harbour', cost: '', price: 0 };

const TOOL_GROUPS: ToolGroup[] = [
  {
    name: 'Build',
    tools: [
      { tool: 'road', label: 'Road', cost: `${ROAD_COST} / tile`, price: ROAD_COST, key: 'B' },
      { tool: 'house', label: BUILDINGS.house.name, cost: String(BUILDINGS.house.cost), price: BUILDINGS.house.cost },
    ],
  },
  {
    name: 'Food',
    tools: [
      { tool: 'farm', label: BUILDINGS.farm.name, cost: String(BUILDINGS.farm.cost), price: BUILDINGS.farm.cost },
      { tool: 'wharf', label: 'Fisher', cost: String(BUILDINGS.wharf.cost), price: BUILDINGS.wharf.cost },
      { tool: 'lodge', label: 'Hunter', cost: String(BUILDINGS.lodge.cost), price: BUILDINGS.lodge.cost },
    ],
  },
  {
    name: 'Goods',
    tools: [
      { tool: 'orchard', label: 'Olives', cost: String(BUILDINGS.orchard.cost), price: BUILDINGS.orchard.cost },
      { tool: 'press', label: 'Press', cost: String(BUILDINGS.press.cost), price: BUILDINGS.press.cost },
      { tool: 'woodcutter', label: 'Woodcutter', cost: String(BUILDINGS.woodcutter.cost), price: BUILDINGS.woodcutter.cost },
    ],
  },
  {
    name: 'Distribution',
    tools: [
      { tool: 'granary', label: BUILDINGS.granary.name, cost: String(BUILDINGS.granary.cost), price: BUILDINGS.granary.cost },
      { tool: 'agora', label: BUILDINGS.agora.name, cost: String(BUILDINGS.agora.cost), price: BUILDINGS.agora.cost },
      { tool: 'stockpile', label: BUILDINGS.stockpile.name, cost: String(BUILDINGS.stockpile.cost), price: BUILDINGS.stockpile.cost },
    ],
  },
  {
    name: 'Services',
    tools: [
      { tool: 'fountain', label: BUILDINGS.fountain.name, cost: String(BUILDINGS.fountain.cost), price: BUILDINGS.fountain.cost },
      { tool: 'maintenance', label: 'Caretaker', cost: String(BUILDINGS.maintenance.cost), price: BUILDINGS.maintenance.cost },
    ],
  },
  {
    name: 'Clear',
    tools: [{ tool: 'demolish', label: 'Demolish', cost: 'half refunded', price: 0, key: 'X' }],
  },
];

const TOOL_DEFS: ToolDef[] = TOOL_GROUPS.flatMap((group) => group.tools);

const TOAST_LIFETIME = 3200;
const BANNER_LIFETIME = 3600;
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

function describeStores(building: Building): Node[] {
  const entries = Object.entries(building.stores).filter(([, amount]) => amount > 0) as [Resource, number][];
  if (entries.length === 0) return [document.createTextNode('Empty')];
  return entries.map(([resource, amount]) => {
    const item = document.createElement('span');
    item.className = 'hud-stock-item';
    item.title = resource;
    item.append(String(Math.round(amount)), resourceIcon(resource));
    return item;
  });
}

interface Milestones {
  houses: boolean;
  farmGranary: boolean;
  agoraVendor: boolean;
  foodDelivered: boolean;
  services: boolean;
  courtyards: boolean;
  harbourTrade: boolean;
}

function computeMilestones(city: City, summary: Summary): Milestones {
  const connected = city.buildings.filter((building) => building.connected);
  const houses = connected.filter((building) => building.kind === 'house');
  const farms = connected.some((building) => building.kind === 'farm');
  const granaries = connected.some((building) => building.kind === 'granary');
  const agoraVendor = connected.some((building) => stallServing(building, 'food'));
  const fountains = connected.some((building) => building.kind === 'fountain');
  const maintenance = connected.some((building) => building.kind === 'maintenance');
  return {
    houses: houses.length >= 4,
    farmGranary: farms && granaries,
    agoraVendor,
    foodDelivered: city.delivered > 0,
    services: fountains && maintenance,
    courtyards: summary.goal,
    harbourTrade: city.harbour.tier === 2 && city.harbour.vendorInstalled,
  };
}

const SKELETON = `
  <div class="hud-top">
    <header class="hud-panel hud-masthead" data-testid="masthead">
      <h1 lang="grc">Οἶκος</h1>
      <dl class="hud-resources" aria-label="City resources">
        <div><dt>Population</dt><dd data-field="population">0</dd></div>
        <div><dt>Treasury</dt><dd data-field="treasury">0 dr</dd></div>
        <div><dt>Food</dt><dd data-field="food">0</dd></div>
        <div><dt>Balance / month</dt><dd data-field="balance">0 dr</dd></div>
        <div><dt>Employed</dt><dd data-field="employed">0 / 0</dd></div>
      </dl>
      <div class="hud-clock">
        <time data-field="time">1 Jan 421 BC</time>
        <button type="button" class="hud-menu-button" data-action="menu" aria-label="Menu, shortcut Escape" data-testid="menu">Menu</button>
      </div>
    </header>
    <div class="hud-panel hud-connection" role="status" data-testid="connection" hidden>
      <p data-field="connection"></p>
      <button type="button" data-action="discard-pending" data-testid="discard-pending" hidden>Discard unresolved action</button>
    </div>
  </div>
  <details class="hud-panel hud-guide" data-testid="guide" open>
    <summary><span class="hud-colour" data-field="guide-colour" hidden></span><span data-field="guide-title">Guide</span></summary>
    <ol class="hud-milestones" data-testid="milestones">
      <li><label><input type="checkbox" disabled data-milestone="houses" /> Four homes linked to the harbour</label></li>
      <li><label><input type="checkbox" disabled data-milestone="farmGranary" /> A wheat farm and a granary</label></li>
      <li><label><input type="checkbox" disabled data-milestone="agoraVendor" /> An agora with a food stall</label></li>
      <li><label><input type="checkbox" disabled data-milestone="foodDelivered" /> Food delivered to your houses</label></li>
      <li><label><input type="checkbox" disabled data-milestone="services" /> A fountain and a maintenance post</label></li>
      <li><label><input type="checkbox" disabled data-milestone="courtyards" /> Four courtyard houses, thriving</label></li>
      <li><label><input type="checkbox" disabled data-milestone="harbourTrade" /> The harbour rebuilt and trading lumber</label></li>
    </ol>
    <p class="hud-guide-note">Wheat only takes root in fertile soil: the darker, striped fields.</p>
    <p class="hud-guide-unlock" data-field="unlock" data-testid="next-unlock" hidden></p>
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
    <button type="button" class="hud-vendor" data-action="oil-stall" hidden data-testid="oil-stall-toggle"></button>
  </details>
  <div class="hud-bottom">
    <p class="hud-hint" data-field="hint" role="note" hidden></p>
    <div class="hud-panel hud-toolbar" role="group" aria-label="Build tools" data-testid="toolbar"></div>
  </div>
  <p class="hud-tooltip" data-field="tooltip" data-testid="tooltip"></p>
  <div class="hud-toast-region" role="status" aria-live="polite" data-testid="toast-region"></div>
  <div class="hud-banner" role="status" aria-live="polite" data-testid="banner" hidden>
    <p class="hud-banner-title"><span class="hud-colour" data-field="banner-colour"></span><span data-field="banner-title"></span></p>
    <p class="hud-banner-note" data-field="banner-note"></p>
  </div>
  <dialog class="hud-dialog hud-menu" data-testid="menu-dialog" aria-label="Menu">
    <form method="dialog">
      <h2 lang="grc">Οἶκος</h2>
      <div class="hud-menu-actions">
        <button type="submit" value="grid" data-testid="grid-toggle" aria-pressed="false">Placement grid</button>
        <button type="button" data-action="sound" data-testid="sound-toggle" aria-pressed="true">Sound on</button>
        <button type="button" class="hud-menu-danger" data-action="reset-world" data-testid="reset-world" hidden>Reset world</button>
      </div>
      <dl class="hud-keys">
        <div><dt>R</dt><dd>Rotate building</dd></div>
        <div><dt>B / X</dt><dd>Road / demolish</dd></div>
        <div><dt>G</dt><dd>Toggle grid</dd></div>
        <div><dt>WASD / \u2190\u2191\u2192\u2193</dt><dd>Pan the view</dd></div>
        <div><dt>Q / H</dt><dd>Rotate / return to village</dd></div>
        <div><dt>Shift</dt><dd>Switch road bend</dd></div>
        <div><dt>Esc</dt><dd>Cancel tool / menu</dd></div>
      </dl>
      <p class="hud-menu-footer"><a href="/art.html" target="_blank" rel="noopener">Model atelier</a><button type="submit" value="close">Close</button></p>
    </form>
  </dialog>
`;

function field(root: ParentNode, name: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(`[data-field="${name}"]`);
  if (!element) throw new Error(`hud: missing field "${name}"`);
  return element;
}

function paintSwatch(element: HTMLElement, color: CityColor): void {
  element.style.setProperty('--city-colour', `#${cityColors[color].toString(16).padStart(6, '0')}`);
  element.title = color;
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

export function createHud(root: HTMLElement, actions: HudActions, features: HudFeatures = { canReset: false }): Hud {
  root.innerHTML = SKELETON;

  const populationField = field(root, 'population');
  const treasuryField = field(root, 'treasury');
  const foodField = field(root, 'food');
  const balanceField = field(root, 'balance');
  const employedField = field(root, 'employed');
  const timeField = field(root, 'time');

  const toolbar = root.querySelector<HTMLElement>('.hud-toolbar')!;
  const toolButtons = new Map<HudTool, HTMLButtonElement>();
  function addToolButton(def: ToolDef, parent: HTMLElement): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hud-tool';
    button.dataset.tool = def.tool;
    button.setAttribute('aria-pressed', 'false');
    const described = def.cost.length > 0 ? `${def.label}, ${def.cost}` : def.label;
    button.setAttribute('aria-label', def.key ? `${described}, shortcut ${def.key}` : described);
    button.title = def.key ? `${def.label} (${def.key})` : def.label;
    const label = document.createElement('span');
    label.className = 'hud-tool-label';
    label.textContent = def.label;
    button.append(toolIcon(def.tool), label);
    if (def.cost.length > 0) {
      const cost = document.createElement('span');
      cost.className = 'hud-tool-cost';
      cost.textContent = def.cost;
      button.append(cost);
    }
    button.addEventListener('click', () => actions.tool(def.tool));
    parent.appendChild(button);
    toolButtons.set(def.tool, button);
    return button;
  }
  const harbourButton = addToolButton(HARBOUR_DEF, toolbar);
  harbourButton.hidden = true;
  const groupPanels = TOOL_GROUPS.map((group) => {
    const panel = document.createElement('div');
    panel.className = 'hud-tool-group';
    panel.dataset.group = group.name.toLowerCase();
    panel.setAttribute('role', 'group');
    panel.setAttribute('aria-label', group.name);
    const caption = document.createElement('span');
    caption.className = 'hud-tool-group-name';
    caption.textContent = group.name;
    const tools = document.createElement('div');
    tools.className = 'hud-tool-group-tools';
    panel.append(caption, tools);
    for (const def of group.tools) addToolButton(def, tools);
    toolbar.appendChild(panel);
    return { panel, tools: group.tools.map((def) => def.tool) };
  });

  action(root, 'discard-pending').addEventListener('click', () => {
    if (window.confirm('This may abandon an action that already applied to the shared city. Discard the unresolved request?')) actions.discardPending();
  });

  const menu = root.querySelector<HTMLDialogElement>('.hud-menu')!;
  const gridButton = root.querySelector<HTMLButtonElement>('[data-testid="grid-toggle"]')!;
  function openMenu(): void {
    actions.menu(true);
    menu.showModal();
  }
  const resetButton = action(root, 'reset-world');
  resetButton.hidden = !features.canReset;
  resetButton.addEventListener('click', () => {
    if (!window.confirm('Reset the world? Every city on the archipelago is lost.')) return;
    menu.close('close');
    actions.resetWorld();
  });
  action(root, 'sound').addEventListener('click', () => actions.sound(action(root, 'sound').getAttribute('aria-pressed') !== 'true'));
  action(root, 'menu').addEventListener('click', openMenu);
  menu.addEventListener('close', () => {
    const choice = menu.returnValue;
    menu.returnValue = '';
    actions.menu(false);
    if (choice === 'grid') actions.grid(gridButton.getAttribute('aria-pressed') !== 'true');
  });


  const guidePanel = root.querySelector<HTMLDetailsElement>('.hud-guide')!;
  const inspectorPanel = root.querySelector<HTMLDetailsElement>('.hud-inspector')!;
  const resources = root.querySelector<HTMLElement>('.hud-resources')!;
  let lastSelectedId: number | string | null = null;
  let stance: Stance = 'building';
  let lastActive: CityScope | null = null;
  const shownTools = new Set<HudTool>();
  const stillMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let toolbarSettled = false;

  function revealTool(button: HTMLButtonElement): void {
    button.classList.add('hud-tool-entering');
    button.addEventListener('animationend', () => button.classList.remove('hud-tool-entering'), { once: true });
  }

  function applyAvailability(): void {
    const building = stance === 'building';
    for (const def of TOOL_DEFS) {
      const button = toolButtons.get(def.tool)!;
      const available = building && (!lastActive || unlocked(lastActive.city, def.tool as BuildTool));
      if (available && !shownTools.has(def.tool) && toolbarSettled && !stillMotion.matches) revealTool(button);
      button.hidden = !available;
      if (available) shownTools.add(def.tool);
      else shownTools.delete(def.tool);
    }
    for (const group of groupPanels) group.panel.hidden = group.tools.every((tool) => !shownTools.has(tool));
    toolbarSettled = building;
  }

  const narrow = window.matchMedia('(max-width: 860px)');
  if (narrow.matches) guidePanel.open = false;

  function showGuide(crowdedOut: boolean): void {
    guidePanel.hidden = stance === 'watching' || crowdedOut;
  }

  narrow.addEventListener('change', (event) => {
    if (event.matches) guidePanel.open = false;
    if (lastSelectedId !== null) showGuide(event.matches);
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
  const oilButton = action(root, 'oil-stall');
  const stallButtons: Record<StallGood, HTMLButtonElement> = { food: vendorButton, oil: oilButton };

  function updateStall(building: Building, good: StallGood, editable: boolean): void {
    const button = stallButtons[good];
    const stall = building.stalls[good] ?? { installed: false, enabled: false };
    const trade = STALL_TRADES[good];
    button.hidden = false;
    button.disabled = !editable;
    if (!stall.installed) {
      button.textContent = `Add ${trade.name} \u00b7 ${VENDOR_COST}`;
      button.setAttribute('aria-pressed', 'false');
      button.onclick = () => actions.vendor(building.id, true, good);
      return;
    }
    button.textContent = stall.enabled ? `Close ${trade.name}` : `Open ${trade.name}`;
    button.setAttribute('aria-pressed', String(stall.enabled));
    button.onclick = () => actions.vendor(building.id, !stall.enabled, good);
  }

  function updateVendor(building: Building, editable: boolean): void {
    oilButton.hidden = true;
    if (building.kind === 'harbour') {
      vendorButton.hidden = building.tier < 2;
      if (vendorButton.hidden) return;
      vendorButton.disabled = !editable;
      vendorButton.textContent = building.vendorEnabled ? 'Pause lumber trade' : 'Start lumber trade';
      vendorButton.setAttribute('aria-pressed', String(building.vendorEnabled));
      vendorButton.onclick = () => actions.vendor(building.id, !building.vendorEnabled, 'food');
      return;
    }
    if (building.kind !== 'agora') {
      vendorButton.hidden = true;
      return;
    }
    for (const good of STALL_GOODS) updateStall(building, good, editable);
  }

  function showPerson(selection: Extract<Selection, { kind: 'person' }>): void {
    inspectorTitle.textContent = selection.name;
    inspectorTier.hidden = false;
    inspectorTier.textContent = selection.role;
    for (const element of [rowResidents, rowCondition, rowStock, rowWorkers, rowFood, rowWater]) element.hidden = true;
    vendorButton.hidden = true;
    oilButton.hidden = true;
    inspectorStatus.textContent = selection.status.join(' ');
  }

  function updateInspector(selection: Selection | null): void {
    if (!selection) {
      inspectorPanel.hidden = true;
      showGuide(false);
      lastSelectedId = null;
      return;
    }
    const id = selection.kind === 'building' ? selection.building.id : selection.name;
    if (id !== lastSelectedId) {
      inspectorPanel.open = true;
      lastSelectedId = id;
    }
    inspectorPanel.hidden = false;
    showGuide(narrow.matches);
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

    const hasStock = storesGoods(selected.kind);
    rowStock.hidden = !hasStock;
    if (hasStock) field(rowStock, 'inspector-stock').replaceChildren(...describeStores(selected));

    const hasWorkers = definition.jobs > 0;
    rowWorkers.hidden = !hasWorkers;
    if (hasWorkers) field(rowWorkers, 'inspector-workers').textContent = `${selected.workers} / ${definition.jobs}`;

    rowFood.hidden = selected.kind !== 'house';
    rowWater.hidden = selected.kind !== 'house';
    if (selected.kind === 'house') {
      let foodReserve = 'Needed';
      if (selected.food > 0) {
        foodReserve = 'Stocked';
        if (selected.residents > 0) foodReserve = `${Math.ceil(selected.food / (selected.residents * appetitePerResident(selected)))}s reserve`;
      }
      field(rowFood, 'inspector-food').textContent = foodReserve;
      field(rowWater, 'inspector-water').textContent = selected.water > 0 ? `${Math.ceil(selected.water / thirstPerSecond(selected))}s reserve` : 'Needed';
    }

    updateVendor(selected, selection.editable);
  }

  const unlockLine = field(root, 'unlock');

  function showNextUnlock(city: City): void {
    const pending = nextUnlock(city);
    unlockLine.hidden = pending === null;
    if (!pending) return;
    const short = pending.requirement.residents - pending.living;
    unlockLine.textContent = `Next: ${BUILDINGS[pending.tool as BuildingKind].name}, ${short} ${tierNoun(pending.requirement.tier)} away.`;
  }

  function updateMilestones(active: CityScope | null): void {
    guidePanel.querySelector<HTMLElement>('.hud-milestones')!.hidden = !active;
    const guideTitle = field(guidePanel, 'guide-title');
    const guideColour = field(guidePanel, 'guide-colour');
    guideColour.hidden = !active;
    if (active) paintSwatch(guideColour, active.city.color);
    if (!active) {
      guideTitle.textContent = 'No city yet';
      guidePanel.querySelector('.hud-guide-note')!.textContent = 'Choose the harbour below, then a shore to set it on: the quay on land, its pier over the water. Islands washed in a colour are already taken.';
      return;
    }
    const summary = active.summary;
    const milestones = computeMilestones(active.city, summary);
    for (const [key, input] of milestoneInputs) {
      input.checked = milestones[key];
    }
    const steps: Array<[keyof Milestones, string]> = [
      ['houses', 'Build four dwellings beside roads linked to the harbour.'],
      ['farmGranary', 'The striped soil grows wheat. Connect a farm and a granary.'],
      ['agoraVendor', 'Build an agora, then select it to open its food stall.'],
      ['foodDelivered', 'Follow the carts: farm, granary, market, then homes.'],
      ['services', 'Connect a fountain and a maintenance post to supply your streets.'],
      ['courtyards', 'Keep four homes fed and watered. Watch them become courtyard houses.'],
      ['harbourTrade', 'Porters carry stockpile lumber to the harbour. Enough rebuilds it in stone; then start its trade.'],
    ];
    const next = steps.find(([key]) => !milestones[key]);
    guideTitle.textContent = summary.goal ? `${active.city.name} is thriving` : `A home in ${active.city.name}`;
    guidePanel.querySelector('.hud-guide-note')!.textContent = next?.[1] ?? 'Your neighbourhood is thriving. Keep building at your own pace.';
    showNextUnlock(active.city);
  }

  const hintElement = field(root, 'hint');
  const toastRegion = root.querySelector<HTMLElement>('.hud-toast-region')!;
  const toastTimers = new Set<number>();
  const banner = root.querySelector<HTMLElement>('.hud-banner')!;
  const bannerTitle = field(root, 'banner-title');
  const bannerColour = field(root, 'banner-colour');
  const bannerNote = field(root, 'banner-note');
  let bannerDate = '';

  function announceFounding(name: string, color: CityColor): void {
    paintSwatch(bannerColour, color);
    bannerTitle.textContent = name;
    bannerNote.textContent = `founded \u00b7 ${bannerDate}`;
    banner.hidden = false;
    banner.classList.remove('hud-banner-shown');
    void banner.offsetWidth;
    banner.classList.add('hud-banner-shown');
    const timer = window.setTimeout(() => {
      banner.classList.remove('hud-banner-shown');
      banner.hidden = true;
      toastTimers.delete(timer);
    }, BANNER_LIFETIME);
    toastTimers.add(timer);
  }

  function update(world: World, viewed: CityScope | null, active: CityScope | null, selected: Selection | null, writable: boolean): void {
    const money = viewed?.city.money ?? 0;
    populationField.textContent = (viewed?.summary.population ?? 0).toLocaleString('en-US');
    treasuryField.textContent = formatDrachma(money);
    treasuryField.classList.toggle('hud-debt', money < 0);
    foodField.textContent = Math.round(viewed?.summary.food ?? 0).toLocaleString('en-US');
    lastActive = active;
    for (const def of TOOL_DEFS) {
      const button = toolButtons.get(def.tool)!;
      button.disabled = !writable || !active;
      button.classList.toggle('hud-tool-unaffordable', !!active && def.price > active.city.money);
    }
    applyAvailability();
    balanceField.textContent = formatSigned(viewed?.summary.balance ?? 0);
    employedField.textContent = `${viewed?.summary.workers ?? 0} / ${viewed?.summary.jobs ?? 0}`;
    bannerDate = formatDate(world);
    timeField.textContent = bannerDate;

    updateMilestones(active);
    updateInspector(selected);
  }

  function setTool(tool: HudTool, rotation: Rotation): void {
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
    openMenu();
    return true;
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

  const tooltipElement = field(root, 'tooltip');
  let tooltipShape = { key: '', halfWidth: 0 };
  function setTooltip(tooltip: Tooltip | null): void {
    if (!tooltip) {
      tooltipElement.classList.remove('hud-tooltip-shown');
      return;
    }
    const key = `${tooltip.resource}:${tooltip.text}`;
    if (key !== tooltipShape.key) {
      if (tooltip.resource) tooltipElement.replaceChildren(tooltip.text, resourceIcon(tooltip.resource));
      else tooltipElement.replaceChildren(tooltip.text);
      tooltipShape = { key, halfWidth: tooltipElement.offsetWidth / 2 };
    }
    const margin = tooltipShape.halfWidth + 8;
    tooltipElement.style.left = `${Math.min(Math.max(tooltip.x, margin), window.innerWidth - margin)}px`;
    tooltipElement.style.top = `${tooltip.y}px`;
    tooltipElement.classList.add('hud-tooltip-shown');
  }

  function dispose(): void {
    for (const timer of toastTimers) window.clearTimeout(timer);
    toastTimers.clear();
    root.replaceChildren();
  }

  function setSound(enabled: boolean): void {
    const button = action(root, 'sound');
    button.setAttribute('aria-pressed', String(enabled));
    button.textContent = enabled ? 'Sound on' : 'Sound off';
  }

  const connectionPanel = root.querySelector<HTMLElement>('.hud-connection')!;
  const connectionText = field(root, 'connection');
  const discardButton = action(root, 'discard-pending');
  function setConnection(blocked: boolean, message: string): void {
    connectionPanel.hidden = !blocked;
    connectionText.textContent = message;
  }

  function setStance(next: Stance, ready: boolean): void {
    stance = next;
    harbourButton.hidden = stance !== 'founding';
    harbourButton.disabled = !ready;
    applyAvailability();
    toolbar.hidden = stance === 'watching';
    resources.hidden = stance === 'watching';
    showGuide(lastSelectedId !== null && narrow.matches);
  }

  function setDiscardAvailable(available: boolean): void {
    discardButton.hidden = !available;
  }

  return {
    update, setTool, notify, setHint, setTooltip, setGrid, setSound, toggleMenu, dispose,
    setConnection, setStance, announceFounding, setDiscardAvailable,
  };
}

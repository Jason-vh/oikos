import type { Building, City, Rotation, Summary, Tool, World } from '../sim/types';
import { BUILDINGS, HOUSE_CAPACITY, HOUSE_NAMES, MONTH_SECONDS, ROAD_COST, VENDOR_COST } from '../sim/catalog';
import { FOOD_CONSUMPTION_PER_RESIDENT, WATER_DECAY_PER_SECOND } from '../sim/balance';
import { toolIcon } from './icons';
import { ISLAND_COUNT, nextArchipelagoSeed } from '../sim/island';
import { createIslandChoice } from './island-choice';

export interface HudActions {
  tool(tool: Tool): void;
  rotate(): void;
  speed(speed: 0 | 1 | 3): void;
  save(): void;
  load(): void;
  newIsland(home?: number): void;
  vendor(id: number, enabled: boolean): void;
  focus(x: number, z: number): void;
  grid(enabled: boolean): void;
  menu(open: boolean): void;
  home(): void;
  export(): void;
  import(file: File): void;
  sound(enabled: boolean): void;
  undo(): void;
  visit(id: number): void;
}

export interface CityScope {
  city: City;
  summary: Summary;
}

export type Selection =
  | { kind: 'building'; building: Building; status: string[] }
  | { kind: 'person'; name: string; role: string; status: string[] };

export interface Hud {
  update(world: World, viewed: CityScope | null, active: CityScope | null, selected: Selection | null): void;
  setTool(tool: Tool, rotation: Rotation): void;
  setSpeed(speed: 0 | 1 | 3): void;
  notify(message: string, error?: boolean): void;
  setHint(message: string): void;
  setGrid(enabled: boolean): void;
  setSound(enabled: boolean): void;
  setSaved(): void;
  setUndo(available: boolean): void;
  setCities(cities: { id: number; label: string }[], viewedId: number | null): void;
  toggleMenu(): boolean;
  dispose(): void;
}

const TOOL_DEFS: Array<{ tool: Tool; label: string; cost: string; price: number; key: string }> = [
  { tool: 'road', label: 'Road', cost: `${ROAD_COST} / tile`, price: ROAD_COST, key: '1' },
  { tool: 'house', label: BUILDINGS.house.name, cost: String(BUILDINGS.house.cost), price: BUILDINGS.house.cost, key: '2' },
  { tool: 'farm', label: BUILDINGS.farm.name, cost: String(BUILDINGS.farm.cost), price: BUILDINGS.farm.cost, key: '3' },
  { tool: 'granary', label: BUILDINGS.granary.name, cost: String(BUILDINGS.granary.cost), price: BUILDINGS.granary.cost, key: '4' },
  { tool: 'agora', label: BUILDINGS.agora.name, cost: String(BUILDINGS.agora.cost), price: BUILDINGS.agora.cost, key: '5' },
  { tool: 'fountain', label: BUILDINGS.fountain.name, cost: String(BUILDINGS.fountain.cost), price: BUILDINGS.fountain.cost, key: '6' },
  { tool: 'maintenance', label: 'Caretaker', cost: String(BUILDINGS.maintenance.cost), price: BUILDINGS.maintenance.cost, key: '7' },
  { tool: 'lodge', label: 'Hunter', cost: String(BUILDINGS.lodge.cost), price: BUILDINGS.lodge.cost, key: '8' },
  { tool: 'woodcutter', label: 'Woodcutter', cost: String(BUILDINGS.woodcutter.cost), price: BUILDINGS.woodcutter.cost, key: '9' },
  { tool: 'stockpile', label: BUILDINGS.stockpile.name, cost: String(BUILDINGS.stockpile.cost), price: BUILDINGS.stockpile.cost, key: '0' },
  { tool: 'demolish', label: 'Demolish', cost: 'half refunded', price: 0, key: 'X' },
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
  const agoraVendor = connected.some((building) => building.kind === 'agora' && building.vendorEnabled);
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
        <div class="hud-speed" role="group" aria-label="Simulation speed">
          <button type="button" data-speed="0" aria-pressed="false" aria-label="Pause, shortcut Space">Pause</button>
          <button type="button" data-speed="1" aria-pressed="true" aria-label="Normal speed">1\u00d7</button>
          <button type="button" data-speed="3" aria-pressed="false" aria-label="Fast speed">3\u00d7</button>
        </div>
        <button type="button" class="hud-menu-button" data-action="home" aria-label="Return to village, shortcut H">Village</button>
        <button type="button" class="hud-menu-button" data-action="menu" aria-label="Menu, shortcut Escape" data-testid="menu">Menu</button>
      </div>
    </header>
  </div>
  <div class="hud-panel hud-cities" role="group" aria-label="Visit a city" data-testid="cities" hidden></div>
  <details class="hud-panel hud-guide" data-testid="guide" open>
    <summary>Guide</summary>
    <ol class="hud-milestones" data-testid="milestones">
      <li><label><input type="checkbox" disabled data-milestone="houses" /> Four homes linked to the harbour</label></li>
      <li><label><input type="checkbox" disabled data-milestone="farmGranary" /> A wheat farm and a granary</label></li>
      <li><label><input type="checkbox" disabled data-milestone="agoraVendor" /> An agora with a vendor</label></li>
      <li><label><input type="checkbox" disabled data-milestone="foodDelivered" /> Food delivered to your houses</label></li>
      <li><label><input type="checkbox" disabled data-milestone="services" /> A fountain and a maintenance post</label></li>
      <li><label><input type="checkbox" disabled data-milestone="courtyards" /> Four courtyard houses, thriving</label></li>
      <li><label><input type="checkbox" disabled data-milestone="harbourTrade" /> The harbour rebuilt and trading lumber</label></li>
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
    <button type="button" class="hud-panel hud-undo" data-action="undo" data-testid="undo" hidden>Undo construction · Ctrl / ⌘ Z</button>
    <p class="hud-hint" data-field="hint" role="note" hidden></p>
    <div class="hud-panel hud-toolbar" role="group" aria-label="Build tools" data-testid="toolbar"></div>
  </div>
  <div class="hud-toast-region" role="status" aria-live="polite" data-testid="toast-region"></div>
  <dialog class="hud-dialog hud-menu" data-testid="menu-dialog" aria-label="Menu">
    <form method="dialog">
      <h2 lang="grc">Οἶκος</h2>
      <div class="hud-menu-actions">
        <button type="submit" value="save" data-testid="save">Save checkpoint</button>
        <button type="submit" value="load" data-testid="load">Restore checkpoint</button>
        <button type="submit" value="export" data-testid="export">Export island</button>
        <button type="submit" value="import" data-testid="import">Import island</button>
        <button type="submit" value="new" data-testid="new-island">New island</button>
        <button type="submit" value="grid" data-testid="grid-toggle" aria-pressed="false">Placement grid</button>
        <button type="button" data-action="sound" data-testid="sound-toggle" aria-pressed="true">Sound on</button>
      </div>
      <p class="hud-save-status" data-field="saved">Autosaves locally. Checkpoints stay until you replace them.</p>
      <dl class="hud-keys">
        <div><dt>1\u20130</dt><dd>Build tools</dd></div>
        <div><dt>X</dt><dd>Demolish</dd></div>
        <div><dt>R</dt><dd>Rotate building</dd></div>
        <div><dt>G</dt><dd>Toggle grid</dd></div>
        <div><dt>WASD / \u2190\u2191\u2192\u2193</dt><dd>Pan the view</dd></div>
        <div><dt>Q / H</dt><dd>Rotate / return to village</dd></div>
        <div><dt>Shift</dt><dd>Switch road bend</dd></div>
        <div><dt>Space</dt><dd>Pause</dd></div>
        <div><dt>Esc</dt><dd>Cancel tool / menu</dd></div>
      </dl>
      <p class="hud-menu-footer"><a href="/art.html" target="_blank" rel="noopener">Model atelier</a><button type="submit" value="close">Close</button></p>
    </form>
  </dialog>
  <dialog class="hud-dialog hud-island-dialog" data-testid="new-island-dialog" aria-labelledby="new-island-title">
    <form method="dialog">
      <h2 id="new-island-title">Start a new island?</h2>
      <p>This opens a fresh archipelago and replaces your autosave. Save a checkpoint or export first to keep this city.</p>
      <canvas class="hud-island-map" data-testid="island-preview" role="img" aria-label="Archipelago preview"></canvas>
      <p data-testid="island-facts" aria-live="polite"></p>
      <label class="hud-island-choice">Starting island
        <select name="home" data-testid="starting-island">
          <option value="">Central island (recommended)</option>
          ${Array.from({ length: ISLAND_COUNT }, (_, index) => `<option value="${index}">Island ${index + 1}</option>`).join('')}
        </select>
      </label>
      <p>Next, place your dockyard beside the prepared landing road. The other islands remain unexplored.</p>
      <div class="hud-dialog-actions">
        <button type="submit" value="cancel" autofocus>Cancel</button>
        <button type="submit" value="confirm" class="hud-primary">New island</button>
      </div>
    </form>
  </dialog>
  <input type="file" data-testid="import-file" accept=".json,application/json" hidden />
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
  const showIslandChoice = createIslandChoice(
    dialog.querySelector<HTMLCanvasElement>('[data-testid="island-preview"]')!,
    dialog.querySelector<HTMLSelectElement>('[name="home"]')!,
    dialog.querySelector<HTMLElement>('[data-testid="island-facts"]')!,
  );
  let nextSeed = nextArchipelagoSeed(1);
  dialog.addEventListener('close', () => {
    actions.menu(false);
    if (dialog.returnValue === 'confirm') {
      const choice = dialog.querySelector<HTMLSelectElement>('[name="home"]')!.value;
      actions.newIsland(choice === '' ? undefined : Number(choice));
    }
    dialog.returnValue = '';
  });

  const menu = root.querySelector<HTMLDialogElement>('.hud-menu')!;
  const gridButton = root.querySelector<HTMLButtonElement>('[data-testid="grid-toggle"]')!;
  function openMenu(): void {
    actions.menu(true);
    menu.showModal();
  }
  const importFile = root.querySelector<HTMLInputElement>('[data-testid="import-file"]')!;
  importFile.addEventListener('change', () => {
    const file = importFile.files?.[0];
    if (file) actions.import(file);
    importFile.value = '';
  });
  action(root, 'home').addEventListener('click', actions.home);
  action(root, 'undo').addEventListener('click', actions.undo);
  action(root, 'sound').addEventListener('click', () => actions.sound(action(root, 'sound').getAttribute('aria-pressed') !== 'true'));
  action(root, 'menu').addEventListener('click', openMenu);
  menu.addEventListener('close', () => {
    const choice = menu.returnValue;
    menu.returnValue = '';
    if (choice !== 'new') actions.menu(false);
    if (choice === 'save') actions.save();
    else if (choice === 'load') actions.load();
    else if (choice === 'new') {
      showIslandChoice(nextSeed);
      dialog.showModal();
    }
    else if (choice === 'export') actions.export();
    else if (choice === 'import') importFile.click();
    else if (choice === 'grid') actions.grid(gridButton.getAttribute('aria-pressed') !== 'true');
  });


  const citiesPanel = root.querySelector<HTMLElement>('.hud-cities')!;
  function setCities(cities: { id: number; label: string }[], viewedId: number | null): void {
    citiesPanel.hidden = cities.length <= 1;
    citiesPanel.replaceChildren();
    if (cities.length <= 1) return;
    for (const entry of cities) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = entry.label;
      button.setAttribute('aria-pressed', String(entry.id === viewedId));
      button.addEventListener('click', () => actions.visit(entry.id));
      citiesPanel.appendChild(button);
    }
  }

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
    if (building.kind === 'harbour') {
      vendorButton.hidden = building.tier < 2;
      if (vendorButton.hidden) return;
      vendorButton.textContent = building.vendorEnabled ? 'Pause lumber trade' : 'Start lumber trade';
      vendorButton.setAttribute('aria-pressed', String(building.vendorEnabled));
      vendorButton.onclick = () => actions.vendor(building.id, !building.vendorEnabled);
      return;
    }
    if (building.kind !== 'agora') {
      vendorButton.hidden = true;
      return;
    }
    vendorButton.hidden = false;
    if (!building.vendorInstalled) {
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

    const hasStock = selected.kind === 'farm' || selected.kind === 'granary' || selected.kind === 'agora' || selected.kind === 'lodge' || selected.kind === 'woodcutter' || selected.kind === 'stockpile' || selected.kind === 'harbour';
    rowStock.hidden = !hasStock;
    if (hasStock) field(rowStock, 'inspector-stock').textContent = describeStores(selected);

    const hasWorkers = definition.jobs > 0;
    rowWorkers.hidden = !hasWorkers;
    if (hasWorkers) field(rowWorkers, 'inspector-workers').textContent = `${selected.workers} / ${definition.jobs}`;

    rowFood.hidden = selected.kind !== 'house';
    rowWater.hidden = selected.kind !== 'house';
    if (selected.kind === 'house') {
      let foodReserve = 'Needed';
      if (selected.food > 0) {
        foodReserve = 'Stocked';
        if (selected.residents > 0) foodReserve = `${Math.ceil(selected.food / (selected.residents * FOOD_CONSUMPTION_PER_RESIDENT))}s reserve`;
      }
      field(rowFood, 'inspector-food').textContent = foodReserve;
      field(rowWater, 'inspector-water').textContent = selected.water > 0 ? `${Math.ceil(selected.water / WATER_DECAY_PER_SECOND)}s reserve` : 'Needed';
    }

    updateVendor(selected);
  }

  function updateMilestones(active: CityScope | null): void {
    const founded = active?.city.founded ?? false;
    guidePanel.querySelector<HTMLElement>('.hud-milestones')!.hidden = !founded;
    if (!active || !founded) {
      guidePanel.querySelector('summary')!.textContent = active ? 'Found your city' : 'No city yet';
      guidePanel.querySelector('.hud-guide-note')!.textContent = active
        ? 'Place your harbour beside the landing road. The green footprint shows a valid site. H returns here; Escape opens the menu.'
        : '';
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
    guidePanel.querySelector('summary')!.textContent = summary.goal ? 'Kalliste is thriving' : 'A home on Kalliste';
    guidePanel.querySelector('.hud-guide-note')!.textContent = next?.[1] ?? 'Your neighbourhood is thriving. Keep building at your own pace.';
  }

  const hintElement = field(root, 'hint');
  const toastRegion = root.querySelector<HTMLElement>('.hud-toast-region')!;
  const toastTimers = new Set<number>();

  function update(world: World, viewed: CityScope | null, active: CityScope | null, selected: Selection | null): void {
    const canWrite = viewed !== null && active !== null && viewed.city.id === active.city.id;
    nextSeed = nextArchipelagoSeed(world.seed);
    const money = viewed?.city.money ?? 0;
    populationField.textContent = (viewed?.summary.population ?? 0).toLocaleString('en-US');
    treasuryField.textContent = formatDrachma(money);
    treasuryField.classList.toggle('hud-debt', money < 0);
    foodField.textContent = Math.round(viewed?.summary.food ?? 0).toLocaleString('en-US');
    for (const def of TOOL_DEFS) {
      const button = toolButtons.get(def.tool)!;
      button.disabled = !canWrite || !(active?.city.founded ?? false);
      button.classList.toggle('hud-tool-unaffordable', !!active && def.price > active.city.money);
    }
    balanceField.textContent = formatSigned(viewed?.summary.balance ?? 0);
    employedField.textContent = `${viewed?.summary.workers ?? 0} / ${viewed?.summary.jobs ?? 0}`;
    timeField.textContent = formatDate(world);

    updateMilestones(active);
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
    openMenu();
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

  function setSound(enabled: boolean): void {
    const button = action(root, 'sound');
    button.setAttribute('aria-pressed', String(enabled));
    button.textContent = enabled ? 'Sound on' : 'Sound off';
  }

  function setSaved(): void {
    field(root, 'saved').textContent = 'Autosaved locally. Your checkpoint is kept separately.';
  }

  function setUndo(available: boolean): void {
    action(root, 'undo').hidden = !available;
  }

  return { update, setTool, setSpeed, notify, setHint, setGrid, setSound, setSaved, setUndo, setCities, toggleMenu, dispose };
}

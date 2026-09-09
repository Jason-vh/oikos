import { createInterface } from 'node:readline';
import { chromium, type Page } from 'playwright';
import { BUILDINGS } from '../src/sim/buildings';
import { tileToScreen } from '../src/render/iso';
import { TICKS_PER_MONTH, TICKS_PER_SECOND } from '../src/sim/time';
import type { BuildingKind } from '../src/sim/types';

const URL = process.argv[2] ?? 'http://localhost:5180';
const FRESH = process.argv.includes('--fresh');
const VIEWPORT = { width: 1600, height: 1000 };
const PANEL_WIDTH = 280;
const GOALS_WIDTH = 300;
const TOPBAR_HEIGHT = 90;
const MESSAGE_HEIGHT = 70;

const TERRAIN_GLYPHS = [',', '"', '~', '^', '.'];

interface Tile {
  x: number;
  y: number;
}

const context = await chromium.launchPersistentContext('scripts/.pilot-profile', {
  headless: false,
  viewport: VIEWPORT,
  args: ['--window-size=1620,1100'],
});
const page = context.pages()[0] ?? (await context.newPage());

page.on('dialog', (dialog) => dialog.accept());
page.on('pageerror', (error) => say(`[error] ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') say(`[console] ${message.text()}`);
});

await open();

const commands: Record<string, (args: string[]) => Promise<string>> = {
  help: async () => Object.keys(commands).join(' '),
  new: async () => {
    await abandon();
    return await commands.state([]);
  },
  state: async () => {
    const snapshot = await page.evaluate(() => {
      const { world } = Reflect.get(window, 'game');
      return {
        date: world.dateLabel,
        population: world.population,
        treasury: Math.round(world.treasury),
        popularity: Math.round(world.sentiment.popularity),
        complaint: world.sentiment.complaint,
        labour: `${world.labour.employed}/${world.labour.required}`,
        tax: world.taxRate,
        wages: world.wageLevel,
        goals: world.goals.map((goal: { label: string; current: number; target: number; met: boolean }) =>
          `${goal.label} ${goal.current}/${goal.target}${goal.met ? ' ✓' : ''}`,
        ),
      };
    });
    return JSON.stringify(snapshot);
  },
  buildings: async () => {
    const list = await page.evaluate(() => {
      const { world } = Reflect.get(window, 'game');
      const rows: string[] = [];
      for (const b of world.buildings.values()) {
        const detail = b.kind === 'house' ? `t${b.tier} p${b.population}` : `staff ${b.staff}`;
        rows.push(`${b.kind}@${b.x},${b.y} ${detail} fire ${Math.round(b.fireRisk)}`);
      }
      return rows;
    });
    return list.length === 0 ? 'nothing built' : list.join('\n');
  },
  walkers: async () => {
    const counts = await page.evaluate(() => {
      const { world } = Reflect.get(window, 'game');
      const byKind: Record<string, number> = {};
      for (const walker of world.walkers.values()) byKind[walker.kind] = (byKind[walker.kind] ?? 0) + 1;
      return byKind;
    });
    return JSON.stringify(counts);
  },
  msgs: async ([count]) => {
    const messages = await page.evaluate(
      (n: number) => Reflect.get(window, 'game').world.messages.slice(0, n),
      Number(count ?? 8),
    );
    return messages.join('\n');
  },
  map: async (args) => await gridDump(args, 'features'),
  heights: async (args) => await gridDump(args, 'heights'),
  look: async ([x, y]) => {
    await useTool('Inspect');
    await clickTile({ x: Number(x), y: Number(y) });
    const inspection = await page.evaluate(() => Reflect.get(window, 'game').inspectSelection());
    if (!inspection) return 'nothing there';
    const facts = inspection.facts.map(([label, value]: [string, string]) => `${label}: ${value}`).join(', ');
    return `${inspection.title} — ${inspection.subtitle}\n${inspection.description}\n${facts}`;
  },
  build: async ([kind, x, y]) => {
    const name = BUILDINGS[kind as BuildingKind]?.name;
    if (!name) return `unknown building ${kind}`;
    if (!(await useTool(name))) return `no panel button for ${name}`;
    const before = await structureCount();
    await clickTile({ x: Number(x), y: Number(y) });
    if ((await structureCount()) > before) return `built ${name} at ${x},${y}`;
    return `refused: ${await lastMessage()}`;
  },
  road: async ([x1, y1, x2, y2]) => {
    await useTool('Road');
    await dragTiles({ x: Number(x1), y: Number(y1) }, { x: Number(x2 ?? x1), y: Number(y2 ?? y1) });
    return `road ${x1},${y1} → ${x2 ?? x1},${y2 ?? y1}`;
  },
  roadblock: async ([x, y]) => {
    await useTool('Roadblock');
    await clickTile({ x: Number(x), y: Number(y) });
    return `roadblock at ${x},${y}`;
  },
  demolish: async ([x, y]) => {
    await useTool('Demolish');
    await clickTile({ x: Number(x), y: Number(y) });
    return `demolished ${x},${y}`;
  },
  tool: async ([label]) => ((await useTool(label)) ? `tool ${label}` : `no button ${label}`),
  key: async ([key]) => {
    await page.keyboard.press(key);
    return `pressed ${key}`;
  },
  speed: async ([value]) => {
    await page.evaluate((speed: number) => {
      Reflect.get(window, 'game').speed = speed;
    }, Number(value));
    return `speed ${value}`;
  },
  run: async ([months, speed]) => {
    const ticks = Math.round(Number(months ?? 1) * TICKS_PER_MONTH);
    const rate = Number(speed ?? 4);
    await page.evaluate((value: number) => {
      Reflect.get(window, 'game').speed = value;
    }, rate);
    const target = await page.evaluate(
      (extra: number) => Reflect.get(window, 'game').world.tick + extra,
      ticks,
    );
    const timeout = ((ticks / (TICKS_PER_SECOND * rate)) * 1000 + 15000) * 2;
    await page.waitForFunction((goal: number) => Reflect.get(window, 'game').world.tick >= goal, target, { timeout });
    await page.evaluate(() => {
      Reflect.get(window, 'game').speed = 0;
    });
    return await commands.state([]);
  },
  camera: async ([x, y, scale]) => {
    await page.evaluate(
      ({ x, y, scale }) => {
        const game = Reflect.get(window, 'game');
        if (scale !== undefined) game.camera.scale = scale;
        game.camera.centreOnTile(x, y, window.innerWidth, window.innerHeight);
      },
      { x: Number(x), y: Number(y), scale: scale === undefined ? undefined : Number(scale) },
    );
    return `camera on ${x},${y}`;
  },
  overlay: async ([mode]) => {
    await page.evaluate((value: string) => Reflect.get(window, 'game').setOverlay(value), mode ?? 'none');
    return `overlay ${mode ?? 'none'}`;
  },
  shot: async ([path]) => {
    const file = path ?? 'scripts/pilot-shot.png';
    await page.screenshot({ path: file });
    return `shot ${file}`;
  },
  eval: async (args) => {
    const result = await page.evaluate((source: string) => {
      const value = new Function('game', `return (${source})`)(Reflect.get(window, 'game'));
      return JSON.stringify(value ?? null);
    }, args.join(' '));
    return String(result);
  },
  quit: async () => {
    await context.close();
    process.exit(0);
  },
};

const input = createInterface({ input: process.stdin });
say('pilot ready');

for await (const line of input) {
  const [name, ...args] = line.trim().split(/\s+/);
  if (name === undefined || name === '') continue;

  const command = commands[name];
  if (!command) {
    say(`? ${name} — try: ${Object.keys(commands).join(' ')}`);
    continue;
  }

  try {
    say(`$ ${line.trim()}\n${await command(args)}`);
  } catch (error) {
    say(`! ${line.trim()} — ${(error as Error).message}`);
  }
}

await context.close();

async function gridDump(args: string[], mode: 'features' | 'heights'): Promise<string> {
  const [cx, cy, radius] = args;
  const rows = await page.evaluate(
    ({ cx, cy, radius, glyphs, mode }) => {
      const { world } = Reflect.get(window, 'game');
      const { grid } = world;
      const centre = { x: Number(cx ?? grid.size / 2), y: Number(cy ?? grid.size / 2) };
      const span = Number(radius ?? 14);
      const lines: string[] = [];

      for (let y = centre.y - span; y <= centre.y + span; y++) {
        let line = String(y).padStart(3) + ' ';
        for (let x = centre.x - span; x <= centre.x + span; x++) {
          if (!grid.contains(x, y)) {
            line += ' ';
            continue;
          }
          if (mode === 'heights') {
            line += String(grid.heightAt(x, y));
            continue;
          }
          const index = grid.index(x, y);
          const building = world.buildingAt(index);
          if (building) line += building.kind === 'house' ? 'h' : building.kind[0].toUpperCase();
          else if (grid.isRoadblock(index)) line += '=';
          else if (grid.isRoad(index)) line += '#';
          else if (grid.isWall(index)) line += '|';
          else line += glyphs[grid.terrainAt(x, y)];
        }
        lines.push(line);
      }
      lines.push(`    x ${centre.x - span} → ${centre.x + span}`);
      return lines;
    },
    { cx, cy, radius, glyphs: TERRAIN_GLYPHS, mode },
  );
  return rows.join('\n');
}

function say(text: string): void {
  process.stdout.write(`${text}\n`);
}

async function open(): Promise<void> {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await ready();
  if (FRESH) await abandon();
}

async function abandon(): Promise<void> {
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }),
    page.evaluate(() => document.querySelector<HTMLButtonElement>('[data-new-city]')?.click()),
  ]);
  await ready();
}

async function ready(): Promise<void> {
  await page.waitForFunction(() => Reflect.get(window, 'game') !== undefined);
  await page.evaluate(() => {
    Reflect.get(window, 'game').speed = 0;
  });
}

async function useTool(label: string): Promise<boolean> {
  return await page.evaluate((wanted: string) => {
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('.panel button.tool')];
    const match = buttons.find(
      (button) => button.querySelector('.tool-label')?.firstChild?.textContent?.trim().toLowerCase() === wanted.toLowerCase(),
    );
    if (!match) return false;
    match.click();
    return true;
  }, label);
}

async function clickTile(tile: Tile): Promise<void> {
  const point = await pointFor(tile);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.up();
}

async function dragTiles(from: Tile, to: Tile): Promise<void> {
  const start = await pointFor(from);
  const end = await pointFor(to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2);
  await page.mouse.move(end.x, end.y);
  await page.mouse.up();
}

async function pointFor(tile: Tile): Promise<Tile> {
  const point = await clientPoint(tile);
  const free = {
    left: GOALS_WIDTH,
    top: TOPBAR_HEIGHT,
    right: VIEWPORT.width - PANEL_WIDTH,
    bottom: VIEWPORT.height - MESSAGE_HEIGHT,
  };
  if (point.x > free.left && point.x < free.right && point.y > free.top && point.y < free.bottom) return point;

  const centre = { x: (free.left + free.right) / 2, y: (free.top + free.bottom) / 2 };
  await page.evaluate(
    ({ dx, dy }) => Reflect.get(window, 'game').camera.panBy(dx, dy),
    { dx: centre.x - point.x, dy: centre.y - point.y },
  );
  return centre;
}

async function clientPoint(tile: Tile): Promise<Tile> {
  const view = await page.evaluate(
    ({ x, y }) => {
      const game = Reflect.get(window, 'game');
      const canvas = document.querySelector('canvas') as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      return {
        camera: { x: game.camera.x, y: game.camera.y, scale: game.camera.scale },
        origin: { x: rect.left, y: rect.top },
        height: game.world.grid.heightAt(x, y),
      };
    },
    tile,
  );

  const screen = tileToScreen(tile.x + 0.5, tile.y + 0.5, view.height);
  return {
    x: view.origin.x + view.camera.x + screen.x * view.camera.scale,
    y: view.origin.y + view.camera.y + screen.y * view.camera.scale,
  };
}

async function structureCount(): Promise<number> {
  return await page.evaluate(() => Reflect.get(window, 'game').world.buildings.size);
}

async function lastMessage(): Promise<string> {
  return await page.evaluate(() => Reflect.get(window, 'game').world.messages[0] ?? '');
}

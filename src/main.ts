import { Application } from 'pixi.js';
import { Game } from './game';
import { loadBakedStructures } from './render/baked';
import { loadGroundSheet } from './render/ground';
import { loadCity, saveCity } from './sim/save';
import { createHud } from './ui/hud';

const AUTOSAVE_INTERVAL_MS = 5000;

async function boot(): Promise<void> {
  const root = document.getElementById('app') as HTMLElement;

  const app = new Application();
  await app.init({
    background: 0x10120f,
    resizeTo: window,
    antialias: true,
    resolution: window.devicePixelRatio,
    autoDensity: true,
  });

  root.appendChild(app.canvas);

  const saved = loadCity();
  const ground = await loadGroundSheet();
  const game = new Game(app, saved?.world, ground);
  if (saved) game.restoreView(saved.view);
  const hud = createHud(document.body, game);

  if (import.meta.env.DEV || location.search.includes('debug')) Reflect.set(window, 'game', game);

  window.addEventListener('pagehide', () => saveCity(game.world, game.camera));
  setInterval(() => saveCity(game.world, game.camera), AUTOSAVE_INTERVAL_MS);

  loadBakedStructures().then((baked) => {
    if (baked) game.scene.setBakedStructures(baked);
  });

  app.ticker.add((ticker) => {
    game.update(ticker.deltaMS);
    hud.update();
  });
}

void boot();

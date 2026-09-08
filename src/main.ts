import { Application } from 'pixi.js';
import { Game } from './game';
import { createHud } from './ui/hud';

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

const game = new Game(app);
const hud = createHud(document.body, game);

if (import.meta.env.DEV) Reflect.set(window, 'game', game);

app.ticker.add((ticker) => {
  game.update(ticker.deltaMS);
  hud.update();
});

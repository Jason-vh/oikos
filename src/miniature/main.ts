import { Stage } from '../render/stage';
import { createWorld } from './world';
import './style.css';

const views = {
  harbour: { target: [-2, 0, -4], offset: [36, 31, 46], size: 39 },
  streets: { target: [-1, 1.5, 2], offset: [22, 24, 35], size: 19 },
  islands: { target: [4, 0, -18], offset: [38, 42, 60], size: 69 },
};
type View = keyof typeof views;

function boot(): void {
  const stage = new Stage(document.querySelector<HTMLElement>('#app')!);
  const world = createWorld(stage.scene);
  let currentView: View = 'harbour';
  let paused = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let golden = false;
  let elapsed = 0;
  let previous = 0;
  let lastFrame = 0;
  let lastShadow = 0;
  let frameDelta = 0;
  const motionButton = document.querySelector<HTMLButtonElement>('#motion')!;

  function updateMotionButton(): void {
    motionButton.textContent = paused ? 'Resume life' : 'Pause life';
    motionButton.setAttribute('aria-pressed', String(paused));
  }
  function setView(view: View): void {
    currentView = view;
    stage.setView(views[view]);
    document.body.dataset.view = view;
    document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.view === view)));
  }
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view as View)));
  document.querySelector('#reset')!.addEventListener('click', () => setView(currentView));
  motionButton.addEventListener('click', () => { paused = !paused; updateMotionButton(); });
  document.querySelector('#light')!.addEventListener('click', (event) => {
    golden = !golden;
    stage.golden(golden);
    (event.currentTarget as HTMLButtonElement).setAttribute('aria-pressed', String(golden));
  });
  document.addEventListener('visibilitychange', () => { previous = 0; if (!document.hidden) stage.invalidate(); });
  updateMotionButton();
  setView('harbour');
  stage.shadows();
  function frame(now: number): void {
    const delta = previous === 0 || document.hidden ? 0 : Math.min((now - previous) / 1000, .05);
    previous = now;
    if (!paused && !document.hidden) {
      elapsed += delta;
      frameDelta += delta;
      if (now - lastFrame >= 1000 / 30) {
        world.update(elapsed, frameDelta);
        frameDelta = 0;
        lastFrame = now;
        stage.invalidate();
      }
      if (now - lastShadow >= 150) { stage.shadows(); lastShadow = now; }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  Reflect.set(window, 'artStudy', { get frames() { return stage.frames; }, get camera() { return [...stage.camera.position.toArray(), ...stage.controls.target.toArray(), stage.camera.zoom]; } });
}

try { boot(); }
catch (error) {
  document.body.dataset.error = 'true';
  document.querySelector<HTMLElement>('#status')!.textContent = 'The harbour study requires WebGL 2 and hardware acceleration.';
  console.error(error);
}

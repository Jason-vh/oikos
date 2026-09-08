import type { Point } from './iso';
import type { Camera } from './camera';

export interface PointerHandlers {
  hover(world: Point): void;
  press(world: Point): void;
  drag(world: Point): void;
  release(): void;
  cancel(): void;
}

export function attachPointerInput(
  canvas: HTMLCanvasElement,
  camera: Camera,
  handlers: PointerHandlers,
): void {
  let painting = false;
  let panning = false;
  let lastPan = { x: 0, y: 0 };

  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  canvas.addEventListener('pointerdown', (event) => {
    canvas.setPointerCapture(event.pointerId);

    if (event.button === 0) {
      painting = true;
      handlers.press(camera.screenToWorld(event.offsetX, event.offsetY));
      return;
    }

    if (event.button === 2 && painting) {
      painting = false;
      handlers.cancel();
      return;
    }

    panning = true;
    lastPan = { x: event.clientX, y: event.clientY };
  });

  canvas.addEventListener('pointermove', (event) => {
    if (panning) {
      camera.panBy(event.clientX - lastPan.x, event.clientY - lastPan.y);
      lastPan = { x: event.clientX, y: event.clientY };
    }

    const world = camera.screenToWorld(event.offsetX, event.offsetY);
    handlers.hover(world);
    if (painting) handlers.drag(world);
  });

  const endPointer = (event: PointerEvent) => {
    if (event.button === 0 && painting) {
      painting = false;
      handlers.release();
    }
    if (event.button !== 0) panning = false;
  };

  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', () => {
    painting = false;
    panning = false;
    handlers.cancel();
  });

  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      camera.zoomAt(event.offsetX, event.offsetY, factor);
    },
    { passive: false },
  );
}

export function attachKeyboardPan(camera: Camera, speedPerSecond = 900): () => void {
  const pressed = new Set<string>();

  window.addEventListener('keydown', (event) => pressed.add(event.key.toLowerCase()));
  window.addEventListener('keyup', (event) => pressed.delete(event.key.toLowerCase()));
  window.addEventListener('blur', () => pressed.clear());

  let lastTime = performance.now();
  return () => {
    const now = performance.now();
    const delta = (now - lastTime) / 1000;
    lastTime = now;

    const step = speedPerSecond * delta;
    let dx = 0;
    let dy = 0;
    if (pressed.has('arrowleft') || pressed.has('a')) dx += step;
    if (pressed.has('arrowright') || pressed.has('d')) dx -= step;
    if (pressed.has('arrowup') || pressed.has('w')) dy += step;
    if (pressed.has('arrowdown') || pressed.has('s')) dy -= step;
    if (dx !== 0 || dy !== 0) camera.panBy(dx, dy);
  };
}

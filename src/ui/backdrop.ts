import * as T from 'three';
import { CityScene } from '../render/city';
import { Stage } from '../render/stage';
import { GROUND_Y, islandFor, worldPositionOn } from '../sim/island';
import type { World } from '../sim/types';

export interface Backdrop {
  dispose(): void;
}

const UP = new T.Vector3(0, 1, 0);
const DRIFT_PER_SECOND = Math.PI / 150;
const OFFSET = new T.Vector3(38, 40, 52);
const VIEW_SIZE = 54;

function centre(world: World): { map: ReturnType<typeof islandFor>; target: T.Vector3 } {
  const showpiece = [...world.cities].sort((a, b) => b.buildings.length - a.buildings.length)[0];
  const map = islandFor(world.seed, showpiece?.home);
  const island = map.islands[map.home];
  const anchor = showpiece ? showpiece.harbour : map.entry;
  const inland = {
    x: (anchor.x + island.x + island.width / 2) / 2,
    z: (anchor.z + island.z + island.depth / 2) / 2,
  };
  const position = worldPositionOn(map, inland.x, inland.z);
  return { map, target: new T.Vector3(position.x, GROUND_Y, position.z) };
}

export async function showBackdrop(world: World, root: HTMLElement): Promise<Backdrop> {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const stage = new Stage(root, false);
  stage.reducedMotion = reducedMotion;
  stage.controls.enabled = false;
  const { map, target } = centre(world);
  const city = new CityScene(stage, map, !reducedMotion);
  stage.setView({ target: target.toArray(), offset: OFFSET.toArray(), size: VIEW_SIZE });
  city.setWorldTime(world.time);
  city.sync(world);
  city.watch(stage.controls.target, stage.viewSpan());
  city.animate(0, .25, 1);
  stage.shadows();

  let angle = 0;
  let previous = 0;
  let request = 0;
  const frame = (now: number): void => {
    request = requestAnimationFrame(frame);
    const delta = previous === 0 || document.hidden ? 0 : Math.min((now - previous) / 1000, .25);
    previous = now;
    if (delta === 0) return;
    angle += delta * DRIFT_PER_SECOND;
    stage.camera.position.copy(target).add(OFFSET.clone().applyAxisAngle(UP, angle));
    stage.camera.lookAt(target);
    city.animate(now / 1000, delta, 1);
    stage.shadowsFromMotion();
    stage.invalidate();
  };
  if (!reducedMotion) request = requestAnimationFrame(frame);
  await new Promise<void>((resolve) => { requestAnimationFrame(() => resolve()); });

  return {
    dispose() {
      cancelAnimationFrame(request);
      city.dispose();
      stage.dispose();
      delete document.body.dataset.ready;
    },
  };
}

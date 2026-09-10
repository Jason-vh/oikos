import * as T from 'three';
import { animalModel, animateAnimal, animateFigure, boat, citizen, colors, disposeModel, figure, getBuildingModel, type ModelStage } from './art';
import type { AnimalKind } from './sim/types';
import { BUILDINGS, footprint } from './sim/catalog';
import { CELL_SIZE } from './sim/island';
import type { BuildingKind, Stores } from './sim/types';

const STORE_VARIANTS: Record<string, Stores> = {
  empty: {},
  wheat: { wheat: 300 },
  mixed: { wheat: 200, carrots: 100, fish: 100, meat: 100 },
  full: { wheat: 300, carrots: 200, fish: 100, meat: 100, olives: 100 },
  materials: { lumber: 300, clay: 100, stone: 100 },
};
import { Stage } from './render/stage';
import './art-viewer.css';

function boot(): void {
  const stage = new Stage(document.querySelector<HTMLElement>('#app')!);
  const ground = new T.Mesh(new T.PlaneGeometry(2000, 2000).rotateX(-Math.PI / 2), new T.MeshStandardMaterial({ color: colors.grass, roughness: .88 }));
  ground.position.y = -.075;
  ground.receiveShadow = true;
  stage.scene.add(ground);
  const grid = new T.GridHelper(15, 12, 0xc1bd91, 0xc1bd91);
  grid.position.y = -.06;
  stage.scene.add(grid);
  const reference = citizen(colors.blue, true);
  reference.position.set(3.5, 0, 1.6);
  stage.scene.add(reference);
  const border = new T.LineLoop(new T.BufferGeometry(), new T.LineDashedMaterial({ color: 0x567458, dashSize: .12, gapSize: .1 }));
  stage.scene.add(border);
  let model: T.Group | null = null;
  let golden = false;
  const select = document.querySelector<HTMLSelectElement>('#model')!;
  const wireframe = document.querySelector<HTMLInputElement>('#wireframe')!;

  function buildSelected(id: string): { model: T.Group; footprint: { width: number; depth: number } | null; description: string; animate?: (time: number) => void } {
    const [kindValue, tierValue, variant = ''] = id.split(':');
    if (kindValue === 'animal') {
      const kind = tierValue as AnimalKind;
      const model = animalModel(kind);
      return { model, footprint: null, description: `${kind[0].toUpperCase()}${kind.slice(1)}. Lives on the island; see src/sim/wildlife.ts for habitat and yield.`, animate: (time) => animateAnimal(model, kind, time, true) };
    }
    if (kindValue === 'person') {
      const load = tierValue === 'jar' ? 'jar' : tierValue === 'bundle' ? 'bundle' : 'none';
      const model = figure(colors.blue, load).root;
      return { model, footprint: null, description: 'A citizen. Legs and arms swing while walking.', animate: (time) => animateFigure(model, time * 9, .55) };
    }
    if (kindValue === 'boat') {
      return { model: boat(colors.blue, tierValue !== 'small'), footprint: null, description: 'A merchant boat with a striped sail.' };
    }
    const kind = kindValue as BuildingKind;
    const tier = Number(tierValue) as 1 | 2 | 3;
    const stores = STORE_VARIANTS[variant] ?? {};
    const model = getBuildingModel(kind, { tier, vendorEnabled: kind === 'agora' && tier === 2, stage: Number(variant || 3) as ModelStage, stores });
    return { model, footprint: footprint(kind), description: BUILDINGS[kind].description };
  }

  let animate: ((time: number) => void) | null = null;

  function showModel(): void {
    if (model) {
      model.removeFromParent();
      model.traverse((child) => {
        if (!(child instanceof T.Mesh)) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) material.dispose();
      });
      disposeModel(model);
    }
    const selected = buildSelected(select.value);
    model = selected.model;
    animate = selected.animate ?? null;
    model.traverse((child) => {
      if (!(child instanceof T.Mesh)) return;
      const material = (child.material as T.MeshStandardMaterial).clone();
      material.wireframe = wireframe.checked;
      child.material = material;
    });
    stage.scene.add(model);
    const size = selected.footprint;
    border.visible = size !== null;
    if (size) {
      const w = size.width * CELL_SIZE / 2;
      const d = size.depth * CELL_SIZE / 2;
      border.geometry.dispose();
      border.geometry = new T.BufferGeometry().setFromPoints([new T.Vector3(-w, -.02, -d), new T.Vector3(w, -.02, -d), new T.Vector3(w, -.02, d), new T.Vector3(-w, -.02, d)]);
      border.computeLineDistances();
    }
    const bounds = new T.Box3().setFromObject(model).getSize(new T.Vector3());
    const extent = Math.max(bounds.x, bounds.y, bounds.z);
    stage.setView({ target: [-extent * .25, extent * .25, 0], offset: [9, 8, 12], size: Math.max(2.2, extent * 2.4) });
    reference.position.set(Math.max(1.1, extent * .7), 0, -Math.max(.9, extent * .5));
    reference.visible = document.querySelector<HTMLInputElement>('#reference')!.checked && !select.value.startsWith('person');
    let triangles = 0;
    let meshes = 0;
    model.traverse((child) => {
      if (!(child instanceof T.Mesh)) return;
      triangles += (child.geometry.index?.count ?? child.geometry.getAttribute('position').count) / 3;
      meshes++;
    });
    const metrics = document.querySelector('#metrics')!;
    metrics.replaceChildren();
    for (const [label, value] of [['Footprint', size ? `${size.width} × ${size.depth} cells` : 'none'], ['Bounds', `${bounds.x.toFixed(2)} × ${bounds.y.toFixed(2)} × ${bounds.z.toFixed(2)}`], ['Triangles', Math.round(triangles).toLocaleString()], ['Meshes', String(meshes)]]) {
      const term = document.createElement('dt');
      const detail = document.createElement('dd');
      term.textContent = label;
      detail.textContent = value;
      metrics.append(term, detail);
    }
    document.querySelector('#description')!.textContent = selected.description;
    document.body.dataset.model = select.value;
    const url = new URL(location.href);
    url.searchParams.set('model', select.value);
    history.replaceState(null, '', url);
    stage.shadows();
  }
  select.addEventListener('change', showModel);
  wireframe.addEventListener('change', showModel);
  document.querySelector<HTMLInputElement>('#reference')!.addEventListener('change', (event) => {
    reference.visible = (event.target as HTMLInputElement).checked && !select.value.startsWith('person');
    stage.shadows();
  });
  document.querySelector('#turn')!.addEventListener('click', () => { if (model) model.rotation.y += Math.PI / 2; stage.shadows(); });
  document.querySelector('#reset')!.addEventListener('click', () => showModel());
  document.querySelector('#light')!.addEventListener('click', (event) => {
    golden = !golden;
    (event.currentTarget as HTMLButtonElement).setAttribute('aria-pressed', String(golden));
    stage.golden(golden);
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) stage.invalidate(); });
  const requested = new URLSearchParams(location.search).get('model');
  if (requested && Array.from(select.options).some((option) => option.value === requested)) select.value = requested;
  showModel();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let previous = 0;
  let elapsed = 0;
  function frame(now: number): void {
    const delta = previous === 0 ? 0 : Math.min((now - previous) / 1000, .05);
    previous = now;
    if (animate && !document.hidden && !reducedMotion) {
      elapsed += delta;
      animate(elapsed);
      stage.invalidate();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  Reflect.set(window, 'artStudy', { get frames() { return stage.frames; }, get camera() { return [...stage.camera.position.toArray(), ...stage.controls.target.toArray(), stage.camera.zoom]; } });
}

try { boot(); }
catch (error) {
  document.body.dataset.error = 'true';
  document.querySelector<HTMLElement>('#status')!.textContent = 'The model viewer requires WebGL 2 and hardware acceleration.';
  console.error(error);
}

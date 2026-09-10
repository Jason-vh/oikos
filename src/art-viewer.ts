import * as T from 'three';
import { citizen, colors, disposeModel, getBuildingModel, type GranaryVariant, type ModelStage } from './art';
import { BUILDINGS, footprint } from './sim/catalog';
import { CELL_SIZE } from './sim/island';
import type { BuildingKind, Stores } from './sim/types';

const STORE_VARIANTS: Record<string, Stores> = {
  empty: {},
  wheat: { wheat: 300 },
  mixed: { wheat: 200, carrots: 100, fish: 100, meat: 100 },
  full: { wheat: 300, carrots: 200, fish: 100, meat: 100, olives: 100 },
};
import { Stage } from './render/stage';
import './art-viewer.css';

function boot(): void {
  const stage = new Stage(document.querySelector<HTMLElement>('#app')!);
  const view = { target: [-1.2, 1.2, 0], offset: [9, 8, 12], size: 11 };
  stage.setView(view);
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
    const [kindValue, tierValue, variant = '', granary = 'tower'] = select.value.split(':');
    const kind = kindValue as BuildingKind;
    const tier = Number(tierValue) as 1 | 2 | 3;
    const stores = STORE_VARIANTS[variant] ?? {};
    model = getBuildingModel(kind, { tier, vendorEnabled: kind === 'agora' && tier === 2, stage: Number(variant || 3) as ModelStage, stores, granary: granary as GranaryVariant });
    model.traverse((child) => {
      if (!(child instanceof T.Mesh)) return;
      const material = (child.material as T.MeshStandardMaterial).clone();
      material.wireframe = wireframe.checked;
      child.material = material;
    });
    stage.scene.add(model);
    const size = footprint(kind);
    const w = size.width * CELL_SIZE / 2;
    const d = size.depth * CELL_SIZE / 2;
    border.geometry.dispose();
    border.geometry = new T.BufferGeometry().setFromPoints([new T.Vector3(-w, -.02, -d), new T.Vector3(w, -.02, -d), new T.Vector3(w, -.02, d), new T.Vector3(-w, -.02, d)]);
    border.computeLineDistances();
    const bounds = new T.Box3().setFromObject(model).getSize(new T.Vector3());
    let triangles = 0;
    let meshes = 0;
    model.traverse((child) => {
      if (!(child instanceof T.Mesh)) return;
      triangles += (child.geometry.index?.count ?? child.geometry.getAttribute('position').count) / 3;
      meshes++;
    });
    const metrics = document.querySelector('#metrics')!;
    metrics.replaceChildren();
    for (const [label, value] of [['Footprint', `${size.width} × ${size.depth} cells`], ['Bounds', `${bounds.x.toFixed(2)} × ${bounds.y.toFixed(2)} × ${bounds.z.toFixed(2)}`], ['Triangles', Math.round(triangles).toLocaleString()], ['Meshes', String(meshes)]]) {
      const term = document.createElement('dt');
      const detail = document.createElement('dd');
      term.textContent = label;
      detail.textContent = value;
      metrics.append(term, detail);
    }
    document.querySelector('#description')!.textContent = BUILDINGS[kind].description;
    document.body.dataset.model = select.value;
    stage.shadows();
  }
  select.addEventListener('change', showModel);
  wireframe.addEventListener('change', showModel);
  document.querySelector<HTMLInputElement>('#reference')!.addEventListener('change', (event) => {
    reference.visible = (event.target as HTMLInputElement).checked;
    stage.shadows();
  });
  document.querySelector('#turn')!.addEventListener('click', () => { if (model) model.rotation.y += Math.PI / 2; stage.shadows(); });
  document.querySelector('#reset')!.addEventListener('click', () => stage.setView(view));
  document.querySelector('#light')!.addEventListener('click', (event) => {
    golden = !golden;
    (event.currentTarget as HTMLButtonElement).setAttribute('aria-pressed', String(golden));
    stage.golden(golden);
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) stage.invalidate(); });
  showModel();
  Reflect.set(window, 'artStudy', { get frames() { return stage.frames; }, get camera() { return [...stage.camera.position.toArray(), ...stage.controls.target.toArray(), stage.camera.zoom]; } });
}

try { boot(); }
catch (error) {
  document.body.dataset.error = 'true';
  document.querySelector<HTMLElement>('#status')!.textContent = 'The model viewer requires WebGL 2 and hardware acceleration.';
  console.error(error);
}

import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createWorld } from './world';
import './style.css';

const views = {
  harbour: { target: [-2, 0, -4], offset: [36, 31, 46], size: 39 },
  streets: { target: [-1, 1.5, 2], offset: [22, 24, 35], size: 19 },
  islands: { target: [4, 0, -18], offset: [38, 42, 60], size: 69 },
} satisfies Record<string, { target: number[]; offset: number[]; size: number }>;

type View = keyof typeof views;

function boot(): void {
  const root = document.querySelector<HTMLElement>('#app')!;
  const scene = new T.Scene();
  scene.background = new T.Color(0xb1d2cd);
  scene.fog = new T.FogExp2(0xb1d2cd, .0045);
  const renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;
  renderer.domElement.setAttribute('aria-label', 'Miniature Greek harbour with animated citizens and sailing ships');
  root.appendChild(renderer.domElement);

  const camera = new T.OrthographicCamera(-30, 30, 20, -20, .1, 350);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = .075;
  controls.minPolarAngle = Math.PI / 7;
  controls.maxPolarAngle = Math.PI / 2.65;
  controls.minZoom = .65;
  controls.maxZoom = 3.8;
  controls.maxTargetRadius = 90;
  controls.screenSpacePanning = false;
  controls.zoomSpeed = .75;
  controls.rotateSpeed = .55;

  const ambient = new T.HemisphereLight(0xe7f1ee, 0xb4a075, 2.1);
  scene.add(ambient);
  const sun = new T.DirectionalLight(0xffe6bd, 3.5);
  sun.position.set(-25, 42, 24);
  sun.target.position.set(-2, 0, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 120 });
  sun.shadow.normalBias = .055;
  sun.shadow.bias = -.00015;
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun, sun.target);
  const world = createWorld(scene);
  renderer.shadowMap.needsUpdate = true;

  const target = new T.WebGLRenderTarget(window.innerWidth, window.innerHeight, { type: T.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const ao = new GTAOPass(scene, camera, window.innerWidth, window.innerHeight);
  ao.updateGtaoMaterial({ radius: .65, distanceExponent: 1.5, thickness: 1, scale: 1 });
  ao.blendIntensity = .65;
  composer.addPass(ao);
  composer.addPass(new OutputPass());

  let currentView: View = 'harbour';
  let viewSize = views.harbour.size;
  let paused = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let golden = false;
  let elapsed = 0;
  let previous = 0;
  let shadowElapsed = 0;
  let frameId = 0;
  const motionButton = document.querySelector<HTMLButtonElement>('#motion')!;

  function updateMotionButton(): void {
    motionButton.textContent = paused ? 'Resume life' : 'Pause life';
    motionButton.setAttribute('aria-pressed', String(paused));
  }

  function resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const aspect = width / height;
    const size = viewSize * Math.max(1, 1.25 / aspect);
    camera.left = -size * aspect / 2;
    camera.right = size * aspect / 2;
    camera.top = size / 2;
    camera.bottom = -size / 2;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    composer.setSize(width, height);
  }

  function setView(view: View): void {
    currentView = view;
    const preset = views[view];
    controls.enableDamping = false;
    controls.update();
    controls.target.fromArray(preset.target);
    camera.position.copy(controls.target).add(new T.Vector3().fromArray(preset.offset));
    camera.zoom = 1;
    viewSize = preset.size;
    controls.update();
    controls.enableDamping = true;
    resize();
    document.body.dataset.view = view;
    document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.view === view));
    });
  }

  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => {
    button.addEventListener('click', () => setView(button.dataset.view as View));
  });
  document.querySelector('#reset')!.addEventListener('click', () => setView(currentView));
  motionButton.addEventListener('click', () => {
    paused = !paused;
    updateMotionButton();
  });
  document.querySelector('#light')!.addEventListener('click', (event) => {
    golden = !golden;
    sun.color.setHex(golden ? 0xffc083 : 0xffe6bd);
    sun.position.set(-25, golden ? 22 : 42, 24);
    sun.intensity = golden ? 3.8 : 3.5;
    ambient.intensity = golden ? 1.55 : 2.1;
    renderer.shadowMap.needsUpdate = true;
    (event.currentTarget as HTMLButtonElement).setAttribute('aria-pressed', String(golden));
  });
  renderer.domElement.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    cancelAnimationFrame(frameId);
    const status = document.querySelector<HTMLElement>('#status')!;
    status.textContent = 'The 3D context was lost. Reload to reopen the harbour.';
    status.hidden = false;
    document.body.dataset.error = 'context-lost';
  });
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => { previous = 0; });
  updateMotionButton();
  setView('harbour');

  function frame(now: number): void {
    const delta = previous === 0 ? 0 : Math.min((now - previous) / 1000, .05);
    previous = now;
    controls.update();
    if (!paused) {
      elapsed += delta;
      shadowElapsed += delta;
      world.update(elapsed, delta);
      if (shadowElapsed > .1) {
        renderer.shadowMap.needsUpdate = true;
        shadowElapsed = 0;
      }
    }
    composer.render();
    document.body.dataset.ready = 'true';
    document.querySelector<HTMLElement>('#status')!.hidden = true;
    frameId = requestAnimationFrame(frame);
  }
  frameId = requestAnimationFrame(frame);
}

try {
  boot();
} catch (error) {
  document.body.dataset.error = 'true';
  document.querySelector<HTMLElement>('#status')!.textContent = 'The miniature could not open. This study requires WebGL 2 and hardware acceleration.';
  console.error(error);
}

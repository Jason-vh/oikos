import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export interface View { target: number[]; offset: number[]; size: number; }

export class Stage {
  readonly scene = new T.Scene();
  readonly camera = new T.OrthographicCamera(-30, 30, 20, -20, .1, 350);
  readonly renderer = new T.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  readonly controls: OrbitControls;
  readonly canvas: HTMLCanvasElement;
  private readonly composer: EffectComposer;
  private readonly ao: GTAOPass;
  private readonly ambient = new T.HemisphereLight(0xe7f1ee, 0xb4a075, 2.1);
  private readonly sun = new T.DirectionalLight(0xffe6bd, 3.5);
  private readonly ray = new T.Raycaster();
  private size = 44;
  private request = 0;
  private lost = false;
  frames = 0;

  constructor(root: HTMLElement, interactive = true) {
    this.scene.background = new T.Color(0xb1d2cd);
    this.scene.fog = new T.FogExp2(0xb1d2cd, .0045);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.canvas = this.renderer.domElement;
    this.canvas.setAttribute('aria-label', 'Interactive miniature island');
    root.append(this.canvas);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = false;
    this.controls.minPolarAngle = Math.PI / 7;
    this.controls.maxPolarAngle = Math.PI / 2.65;
    this.controls.minZoom = .65;
    this.controls.maxZoom = 3.8;
    this.controls.maxTargetRadius = 65;
    this.controls.screenSpacePanning = false;
    this.controls.zoomSpeed = .75;
    this.controls.rotateSpeed = .55;
    if (!interactive) this.controls.mouseButtons.LEFT = null;
    this.controls.addEventListener('change', this.invalidate);
    this.sun.position.set(-25, 42, 24);
    this.sun.target.position.set(-2, 0, -4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -44, right: 44, top: 44, bottom: -44, near: 1, far: 120 });
    this.sun.shadow.normalBias = .055;
    this.sun.shadow.bias = -.00015;
    this.sun.shadow.camera.updateProjectionMatrix();
    this.scene.add(this.ambient, this.sun, this.sun.target);
    const target = new T.WebGLRenderTarget(1, 1, { type: T.HalfFloatType, samples: 2 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.ao = new GTAOPass(this.scene, this.camera, 1, 1);
    this.ao.updateGtaoMaterial({ radius: .65, distanceExponent: 1.5, thickness: 1, scale: 1 });
    this.ao.blendIntensity = .65;
    this.ao.enabled = !new URLSearchParams(location.search).has('noao');
    this.composer.addPass(this.ao);
    this.composer.addPass(new OutputPass());
    this.canvas.addEventListener('webglcontextlost', this.contextLost);
    window.addEventListener('resize', this.resize);
    this.resize();
  }

  private contextLost = (event: Event): void => {
    event.preventDefault();
    this.lost = true;
    cancelAnimationFrame(this.request);
    document.body.dataset.error = 'context-lost';
    const status = document.querySelector<HTMLElement>('#status');
    if (status) {
      status.hidden = false;
      status.textContent = 'The 3D context was lost. Reload to reopen the island.';
    }
  };

  invalidate = (): void => {
    if (this.request || this.lost) return;
    this.request = requestAnimationFrame(() => {
      this.request = 0;
      if (document.hidden) return;
      this.composer.render();
      this.frames++;
      document.body.dataset.ready = 'true';
      const status = document.querySelector<HTMLElement>('#status');
      if (status) status.hidden = true;
    });
  };

  shadows(): void {
    this.renderer.shadowMap.needsUpdate = true;
    this.invalidate();
  }

  resize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const aspect = width / height;
    const size = this.size * Math.max(1, 1.25 / aspect);
    this.camera.left = -size * aspect / 2;
    this.camera.right = size * aspect / 2;
    this.camera.top = size / 2;
    this.camera.bottom = -size / 2;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
    const ratio = this.renderer.getPixelRatio() * .7;
    this.ao.setSize(Math.max(1, Math.round(width * ratio)), Math.max(1, Math.round(height * ratio)));
    this.invalidate();
  };

  setView(view: View): void {
    this.controls.target.fromArray(view.target);
    this.camera.position.copy(this.controls.target).add(new T.Vector3().fromArray(view.offset));
    this.camera.zoom = 1;
    this.size = view.size;
    this.controls.update();
    this.resize();
  }

  focus(x: number, z: number): void {
    const offset = this.camera.position.clone().sub(this.controls.target);
    this.controls.target.set(x, 1.15, z);
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
    this.invalidate();
  }

  rotate(): void {
    const offset = this.camera.position.clone().sub(this.controls.target);
    offset.applyAxisAngle(new T.Vector3(0, 1, 0), Math.PI / 2);
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
    this.invalidate();
  }

  golden(enabled: boolean): void {
    this.sun.color.setHex(enabled ? 0xffc083 : 0xffe6bd);
    this.sun.position.set(-25, enabled ? 22 : 42, 24);
    this.sun.intensity = enabled ? 3.8 : 3.5;
    this.ambient.intensity = enabled ? 1.55 : 2.1;
    this.shadows();
  }

  pick(clientX: number, clientY: number, y: number): T.Vector3 | null {
    const rect = this.canvas.getBoundingClientRect();
    this.ray.setFromCamera(new T.Vector2((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1), this.camera);
    return this.ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), -y), new T.Vector3());
  }

  project(x: number, y: number, z: number): { x: number; y: number } {
    const point = new T.Vector3(x, y, z).project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return { x: rect.left + (point.x + 1) * rect.width / 2, y: rect.top + (1 - point.y) * rect.height / 2 };
  }

  dispose(): void {
    cancelAnimationFrame(this.request);
    window.removeEventListener('resize', this.resize);
    this.canvas.removeEventListener('webglcontextlost', this.contextLost);
    this.controls.dispose();
    this.ao.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}

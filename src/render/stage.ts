import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GOLDEN_SUN_OFFSET, SUN_OFFSET } from './sun';

export interface View { target: number[]; offset: number[]; size: number; zoom?: number; }

const UP = new T.Vector3(0, 1, 0);
const MOTION_SHADOW_INTERVAL = 1000 / 12;
const SHADOW_MAP = 2048;
const SHADOW_SNAP = 4;
const SHADOW_PADDING = 24;
const SHADOW_MIN_RADIUS = 44;
const SHADOW_BIAS_TEXELS = 1.3;
const SHADOW_MIN_NORMAL_BIAS = .055;
const HAZE = 0xb1d2cd;
const DEFAULT_WORLD_SPAN = 1000;
const STANDOFF_SHARE = 1.7;
const CLIP_SHARE = 1.6;
const FOG_NEAR_SHARE = .45;
const FOG_FAR_SHARE = 1.15;
const CLOSEST_SPAN = 13;
const AO_BLEND = .65;
const AO_FULL_SPAN = 120;
const AO_GONE_SPAN = 220;

export class Stage {
  readonly scene = new T.Scene();
  readonly camera = new T.OrthographicCamera(-30, 30, 20, -20, -350, 350);
  readonly renderer = new T.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  readonly controls: OrbitControls;
  readonly canvas: HTMLCanvasElement;
  private readonly composer: EffectComposer;
  private readonly ao: GTAOPass;
  private aoWanted = true;
  private readonly ambient = new T.HemisphereLight(0xe7f1ee, 0xb4a075, 2.1);
  private readonly sun = new T.DirectionalLight(0xffe6bd, 3.5);
  private readonly haze = new T.Fog(HAZE, 1, 2);
  private worldSpan = DEFAULT_WORLD_SPAN;
  private size = 44;
  private request = 0;
  private lost = false;
  private shadowsDue = false;
  private motionShadowsDue = false;
  private lastShadows = 0;
  private readonly sunOffset = SUN_OFFSET.clone();
  private readonly sunFocus = new T.Vector3();
  private sunRadius = 0;
  private readonly goal = { target: new T.Vector3(), spin: 0, active: false };
  private readonly painted = new Set<() => void>();
  reducedMotion = false;
  frames = 0;

  constructor(root: HTMLElement, interactive = true) {
    this.scene.background = new T.Color(HAZE);
    this.scene.fog = this.haze;
    const lean = new URLSearchParams(location.search).has('lean');
    this.renderer.setPixelRatio(lean ? 1 : Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = !lean;
    this.renderer.shadowMap.type = T.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.info.autoReset = false;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.canvas = this.renderer.domElement;
    this.canvas.setAttribute('aria-label', 'Interactive island');
    root.append(this.canvas);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = .14;
    this.controls.minPolarAngle = Math.PI / 7;
    this.controls.maxPolarAngle = Math.PI / 2.65;
    this.controls.maxTargetRadius = 65;
    this.controls.screenSpacePanning = false;
    this.controls.zoomSpeed = .75;
    this.controls.rotateSpeed = .55;
    if (!interactive) this.controls.mouseButtons.LEFT = null;
    this.controls.addEventListener('change', this.invalidate);
    this.controls.addEventListener('start', this.settle);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    this.sun.shadow.bias = -.00015;
    this.scene.add(this.ambient, this.sun, this.sun.target);
    const target = new T.WebGLRenderTarget(1, 1, { type: T.HalfFloatType, samples: 2 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.ao = new GTAOPass(this.scene, this.camera, 1, 1);
    this.ao.updateGtaoMaterial({ radius: .65, distanceExponent: 1.5, thickness: 1, scale: 1 });
    this.ao.blendIntensity = AO_BLEND;
    this.aoWanted = !lean && !new URLSearchParams(location.search).has('noao');
    this.ao.enabled = this.aoWanted;
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

  private settle = (): void => {
    this.goal.active = false;
    this.goal.spin = 0;
  };

  invalidate = (): void => {
    if (this.request || this.lost) return;
    this.request = requestAnimationFrame(() => {
      this.request = 0;
      if (document.hidden) return;
      this.depth();
      this.trackSun();
      this.refreshShadows();
      this.renderer.info.reset();
      this.composer.render();
      this.frames++;
      for (const follow of this.painted) follow();
      document.body.dataset.ready = 'true';
      const status = document.querySelector<HTMLElement>('#status');
      if (status) status.hidden = true;
    });
  };

  onPainted(follow: () => void): () => void {
    this.painted.add(follow);
    return () => this.painted.delete(follow);
  }

  viewSpan(): number {
    return (this.camera.right - this.camera.left) / this.camera.zoom;
  }

  world(span: number): void {
    this.worldSpan = span;
    this.standoff();
    this.clampZoom();
    this.invalidate();
  }

  private standoff(): void {
    const offset = this.camera.position.clone().sub(this.controls.target);
    if (offset.lengthSq() === 0) return;
    this.camera.position.copy(this.controls.target).addScaledVector(offset.normalize(), this.worldSpan * STANDOFF_SHARE);
    this.controls.update();
  }

  private clampZoom(): void {
    const spanAtRest = this.camera.right - this.camera.left;
    this.controls.minZoom = spanAtRest / this.worldSpan;
    this.controls.maxZoom = spanAtRest / CLOSEST_SPAN;
    const bounded = T.MathUtils.clamp(this.camera.zoom, this.controls.minZoom, this.controls.maxZoom);
    if (bounded === this.camera.zoom) return;
    this.camera.zoom = bounded;
    this.camera.updateProjectionMatrix();
  }

  sizeToFit(target: T.Vector3, offset: T.Vector3, corners: T.Vector3[]): number {
    const forward = offset.clone().normalize();
    const across = new T.Vector3().crossVectors(forward, UP).normalize();
    const up = new T.Vector3().crossVectors(across, forward).normalize();
    const local = new T.Vector3();
    let horizontal = 0;
    let vertical = 0;
    for (const corner of corners) {
      local.subVectors(corner, target);
      horizontal = Math.max(horizontal, Math.abs(local.dot(across)));
      vertical = Math.max(vertical, Math.abs(local.dot(up)));
    }
    const aspect = window.innerWidth / window.innerHeight;
    const widening = Math.max(1, 1.25 / aspect);
    return Math.max(vertical * 2, horizontal * 2 / aspect) / widening;
  }

  private fitContactShadows(span: number): void {
    if (!this.aoWanted) return;
    const blend = AO_BLEND * (1 - T.MathUtils.smoothstep(span, AO_FULL_SPAN, AO_GONE_SPAN));
    this.ao.blendIntensity = blend;
    this.ao.enabled = blend > .01;
  }

  private depth(): void {
    const distance = this.camera.position.distanceTo(this.controls.target);
    const span = this.viewSpan();
    this.fitContactShadows(span);
    const reach = Math.max(this.worldSpan, span);
    this.haze.near = distance + reach * FOG_NEAR_SHARE;
    this.haze.far = distance + reach * FOG_FAR_SHARE;
    const clip = reach * CLIP_SHARE;
    if (Math.abs(this.camera.far - (distance + clip)) < 1) return;
    this.camera.near = distance - clip;
    this.camera.far = distance + clip;
    this.camera.updateProjectionMatrix();
  }

  private sunCoverage(): { center: T.Vector3; radius: number } {
    const forward = new T.Vector3().subVectors(this.controls.target, this.camera.position).normalize();
    const lit = new T.Box3();
    if (forward.y < -.05) {
      const across = new T.Vector3().crossVectors(forward, UP).normalize();
      const up = new T.Vector3().crossVectors(across, forward).normalize();
      const halfWidth = (this.camera.right - this.camera.left) / (2 * this.camera.zoom);
      const halfHeight = (this.camera.top - this.camera.bottom) / (2 * this.camera.zoom);
      for (const sideways of [-halfWidth, halfWidth]) {
        for (const raised of [-halfHeight, halfHeight]) {
          const corner = this.camera.position.clone().addScaledVector(across, sideways).addScaledVector(up, raised);
          lit.expandByPoint(corner.addScaledVector(forward, -corner.y / forward.y));
        }
      }
    } else {
      lit.expandByPoint(this.controls.target);
    }
    const center = lit.getCenter(new T.Vector3()).setY(0);
    const spread = lit.getSize(new T.Vector3());
    const reach = Math.min(Math.hypot(spread.x, spread.z) / 2 + SHADOW_PADDING, this.worldSpan);
    center.set(Math.round(center.x / SHADOW_SNAP) * SHADOW_SNAP, 0, Math.round(center.z / SHADOW_SNAP) * SHADOW_SNAP);
    return { center, radius: Math.max(SHADOW_MIN_RADIUS, Math.ceil(reach / SHADOW_SNAP) * SHADOW_SNAP) };
  }

  private trackSun(): void {
    const { center, radius } = this.sunCoverage();
    if (this.sunFocus.equals(center) && this.sunRadius === radius) return;
    this.sunFocus.copy(center);
    this.sunRadius = radius;
    this.aimSun();
    this.shadowsDue = true;
  }

  private aimSun(): void {
    const radius = this.sunRadius;
    const distance = radius + this.sunOffset.length();
    this.sun.target.position.copy(this.sunFocus);
    this.sun.target.updateMatrixWorld();
    this.sun.position.copy(this.sunFocus).addScaledVector(this.sunOffset.clone().normalize(), distance);
    const shadow = this.sun.shadow;
    Object.assign(shadow.camera, { left: -radius, right: radius, top: radius, bottom: -radius, near: 1, far: distance + radius });
    shadow.camera.updateProjectionMatrix();
    shadow.normalBias = Math.max(SHADOW_MIN_NORMAL_BIAS, radius * 2 / SHADOW_MAP * SHADOW_BIAS_TEXELS);
  }

  bounds(radius: number): void {
    this.controls.maxTargetRadius = radius;
  }

  private refreshShadows(): void {
    const now = performance.now();
    const motionDue = this.motionShadowsDue && now - this.lastShadows >= MOTION_SHADOW_INTERVAL;
    if (!this.shadowsDue && !motionDue) return;
    this.renderer.shadowMap.needsUpdate = true;
    this.shadowsDue = false;
    this.motionShadowsDue = false;
    this.lastShadows = now;
  }

  shadows(): void {
    this.shadowsDue = true;
    this.invalidate();
  }

  shadowsFromMotion(): void {
    this.motionShadowsDue = true;
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
    this.clampZoom();
    this.invalidate();
  };

  setView(view: View): void {
    this.controls.target.fromArray(view.target);
    this.camera.position.copy(this.controls.target).add(new T.Vector3().fromArray(view.offset));
    this.camera.zoom = view.zoom ?? 1;
    this.size = view.size;
    this.settle();
    this.standoff();
    this.controls.update();
    this.resize();
  }

  getView(): View {
    return {
      target: this.controls.target.toArray(),
      offset: this.camera.position.clone().sub(this.controls.target).toArray(),
      size: this.size,
      zoom: this.camera.zoom,
    };
  }

  focus(x: number, z: number, immediate = false): void {
    this.goal.target.set(x, 1.15, z);
    this.goal.active = true;
    if (immediate || this.reducedMotion) this.update(Infinity);
    this.invalidate();
  }

  update(delta: number): void {
    if (this.goal.active) {
      const ease = 1 - Math.exp(-delta * 9);
      const step = this.goal.target.clone().sub(this.controls.target).multiplyScalar(ease);
      const remainingSpin = this.goal.spin * ease;
      this.goal.spin -= remainingSpin;
      const offset = this.camera.position.clone().sub(this.controls.target).applyAxisAngle(UP, remainingSpin);
      this.controls.target.add(step);
      this.camera.position.copy(this.controls.target).add(offset);
      const settled = this.controls.target.distanceToSquared(this.goal.target) < 1e-4 && Math.abs(this.goal.spin) < 1e-3;
      if (settled) {
        this.controls.target.copy(this.goal.target);
        this.camera.position.copy(this.controls.target).add(offset.applyAxisAngle(UP, this.goal.spin));
        this.goal.spin = 0;
        this.goal.active = false;
      }
      this.controls.update();
      this.invalidate();
      return;
    }
    if (this.controls.update()) this.invalidate();
  }

  pan(right: number, forward: number): void {
    if (right === 0 && forward === 0) return;
    this.settle();
    const forwardDirection = new T.Vector3().subVectors(this.controls.target, this.camera.position).setY(0).normalize();
    const rightDirection = new T.Vector3().crossVectors(forwardDirection, new T.Vector3(0, 1, 0)).normalize();
    const distance = (this.camera.right - this.camera.left) / this.camera.zoom;
    const step = new T.Vector3().addScaledVector(rightDirection, right * distance).addScaledVector(forwardDirection, forward * distance);
    this.controls.target.add(step);
    this.camera.position.add(step);
    this.controls.update();
    this.invalidate();
  }

  rotate(): void {
    if (!this.goal.active) this.goal.target.copy(this.controls.target);
    this.goal.spin += Math.PI / 2;
    this.goal.active = true;
    if (this.reducedMotion) this.update(Infinity);
    this.invalidate();
  }

  golden(enabled: boolean): void {
    this.sun.color.setHex(enabled ? 0xffc083 : 0xffe6bd);
    this.sunOffset.copy(enabled ? GOLDEN_SUN_OFFSET : SUN_OFFSET);
    this.aimSun();
    this.sun.intensity = enabled ? 3.8 : 3.5;
    this.ambient.intensity = enabled ? 1.55 : 2.1;
    this.shadows();
  }

  pointerRay(clientX: number, clientY: number): T.Raycaster {
    const rect = this.canvas.getBoundingClientRect();
    const ray = new T.Raycaster();
    ray.setFromCamera(new T.Vector2((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1), this.camera);
    return ray;
  }

  pick(clientX: number, clientY: number, y: number): T.Vector3 | null {
    return this.pointerRay(clientX, clientY).ray.intersectPlane(new T.Plane(UP, -y), new T.Vector3());
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
    this.controls.removeEventListener('start', this.settle);
    this.controls.dispose();
    this.ao.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}

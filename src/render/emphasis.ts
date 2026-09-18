import * as T from 'three';

export type GlowChannel = 'hover' | 'select';

export const GLOW_SWELL = .04;

const GLOW = new T.Color(0xffc478);
const GLOW_WARMTH = .35;
const GLOW_REACH = .45;

const glowing = new Map<string, T.MeshStandardMaterial>();
const plain = new WeakMap<T.Material, T.Material>();
const byChannel: Record<GlowChannel, T.MeshStandardMaterial[]> = { hover: [], select: [] };
const levels: Record<GlowChannel, number> = { hover: 0, select: 1 };

function plainMaterial(material: T.Material): T.Material {
  return plain.get(material) ?? material;
}

export function glowMaterial(source: T.Material, channel: GlowChannel): T.Material {
  const base = plainMaterial(source);
  if (!(base instanceof T.MeshStandardMaterial)) return base;
  const key = `${base.uuid}:${channel}`;
  const existing = glowing.get(key);
  if (existing) return existing;
  const material = base.clone();
  material.emissive.copy(base.color).lerp(GLOW, GLOW_WARMTH);
  material.emissiveIntensity = levels[channel] * GLOW_REACH;
  glowing.set(key, material);
  plain.set(material, base);
  byChannel[channel].push(material);
  return material;
}

const FADE = new T.Color(0xb3b0a4);
const FADE_REACH = .62;
const FADE_OPACITY = .62;

const faded = new Map<string, T.MeshStandardMaterial>();

export function fadedMaterial(source: T.Material): T.Material {
  const base = plainMaterial(source);
  if (!(base instanceof T.MeshStandardMaterial)) return base;
  const existing = faded.get(base.uuid);
  if (existing) return existing;
  const material = base.clone();
  material.color.lerp(FADE, FADE_REACH);
  material.transparent = true;
  material.opacity = FADE_OPACITY;
  material.depthWrite = false;
  faded.set(base.uuid, material);
  return material;
}

export function glowStrength(channel: GlowChannel, level: number): void {
  levels[channel] = level;
  for (const material of byChannel[channel]) material.emissiveIntensity = level * GLOW_REACH;
}

export class ModelGlow {
  private applied: T.Object3D | null = null;
  private readonly original = new Map<T.Mesh, T.Material>();

  constructor(private readonly channel: GlowChannel) {}

  attach(model: T.Object3D | null): void {
    if (model === this.applied) return;
    this.detach();
    if (!model) return;
    model.traverse((child) => {
      if (!(child instanceof T.Mesh) || Array.isArray(child.material)) return;
      const base = plainMaterial(child.material);
      this.original.set(child, base);
      child.material = glowMaterial(base, this.channel);
    });
    this.applied = model;
  }

  detach(): void {
    for (const [mesh, material] of this.original) mesh.material = material;
    this.original.clear();
    this.applied = null;
  }
}

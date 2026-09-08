import { Assets, Rectangle, Texture } from 'pixi.js';
import type { BuildingKind } from '../sim/types';
import type { StructureSprite } from './textures';

type BakedLayer = 'body' | 'shadow';

interface BakedFrame {
  kind: string;
  variant: number;
  phase: number;
  layer?: BakedLayer;
  x: number;
  y: number;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
}

interface BakedManifest {
  image: string;
  frames: BakedFrame[];
}

const MANIFEST_URL = '/assets/structures.json';

export class BakedStructures {
  private readonly sprites = new Map<string, StructureSprite>();

  constructor(manifest: BakedManifest, sheet: Texture) {
    for (const frame of manifest.frames) {
      this.sprites.set(`${frame.kind}:${frame.variant ?? 0}:${frame.phase}:${frame.layer ?? 'body'}`, {
        texture: new Texture({
          source: sheet.source,
          frame: new Rectangle(frame.x, frame.y, frame.width, frame.height),
        }),
        anchorX: frame.anchorX,
        anchorY: frame.anchorY,
      });
    }
  }

  get(kind: BuildingKind, variant: number, phase: number): StructureSprite | undefined {
    return this.lookup(kind, variant, phase, 'body');
  }

  shadow(kind: BuildingKind, variant: number, phase: number): StructureSprite | undefined {
    return this.lookup(kind, variant, phase, 'shadow');
  }

  private lookup(kind: BuildingKind, variant: number, phase: number, layer: BakedLayer): StructureSprite | undefined {
    return (
      this.sprites.get(`${kind}:${variant}:${phase}:${layer}`) ?? this.sprites.get(`${kind}:0:${phase}:${layer}`)
    );
  }

  get size(): number {
    return this.sprites.size;
  }
}

export async function loadBakedStructures(): Promise<BakedStructures | null> {
  try {
    const response = await fetch(MANIFEST_URL);
    if (!response.ok) return null;

    const manifest = (await response.json()) as BakedManifest;
    if (!manifest.frames?.length) return null;

    const sheet = await Assets.load<Texture>(`/assets/${manifest.image}`);
    return new BakedStructures(manifest, sheet);
  } catch {
    return null;
  }
}

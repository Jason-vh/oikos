import { Assets, Rectangle, Texture } from 'pixi.js';
import type { StructureKind, StructureSprite } from './textures';

type BakedLayer = 'body' | 'shadow';

interface BakedFrame {
  kind: string;
  variant: number;
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
      this.sprites.set(`${frame.kind}:${frame.variant ?? 0}:${frame.layer ?? 'body'}`, {
        texture: new Texture({
          source: sheet.source,
          frame: new Rectangle(frame.x, frame.y, frame.width, frame.height),
        }),
        anchorX: frame.anchorX,
        anchorY: frame.anchorY,
      });
    }
  }

  get(kind: StructureKind, variant: number): StructureSprite | undefined {
    return this.lookup(kind, variant, 'body');
  }

  shadow(kind: StructureKind, variant: number): StructureSprite | undefined {
    return this.lookup(kind, variant, 'shadow');
  }

  getExact(kind: StructureKind, variant: number, layer: BakedLayer): StructureSprite | undefined {
    return this.sprites.get(`${kind}:${variant}:${layer}`);
  }

  private lookup(kind: StructureKind, variant: number, layer: BakedLayer): StructureSprite | undefined {
    return this.sprites.get(`${kind}:${variant}:${layer}`) ?? this.sprites.get(`${kind}:0:${layer}`);
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

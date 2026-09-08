import { Assets, Rectangle, Texture } from 'pixi.js';
import type { BuildingKind } from '../sim/types';
import type { StructureSprite } from './textures';

interface BakedFrame {
  kind: string;
  phase: number;
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
      this.sprites.set(`${frame.kind}:${frame.phase}`, {
        texture: new Texture({
          source: sheet.source,
          frame: new Rectangle(frame.x, frame.y, frame.width, frame.height),
        }),
        anchorX: frame.anchorX,
        anchorY: frame.anchorY,
      });
    }
  }

  get(kind: BuildingKind, phase: number): StructureSprite | undefined {
    return this.sprites.get(`${kind}:${phase}`);
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

import type { GroundSheet } from './atlas';

const MANIFEST_URL = '/assets/ground.json';

interface GroundManifest {
  image: string;
  tileWidth: number;
  tileHeight: number;
  kinds: Record<string, { first: number; count: number }>;
}

export async function loadGroundSheet(): Promise<GroundSheet | null> {
  try {
    const response = await fetch(MANIFEST_URL);
    if (!response.ok || !response.headers.get('content-type')?.includes('json')) return null;
    const manifest = (await response.json()) as GroundManifest;
    if (!Object.keys(manifest.kinds).length) return null;
    const image = new Image();
    image.src = `/assets/${manifest.image}`;
    await image.decode();
    return { image, tileWidth: manifest.tileWidth, tileHeight: manifest.tileHeight, kinds: manifest.kinds };
  } catch {
    return null;
  }
}

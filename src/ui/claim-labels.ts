import { cityColors } from '../art/primitives';
import { groundHeight, worldPositionOn, type IslandMap } from '../sim/island';
import type { City, World } from '../sim/types';

const HEIGHT_ABOVE_LAND = 7;

export type Projector = (x: number, y: number, z: number) => { x: number; y: number };

interface Placard {
  card: HTMLElement;
  anchor: { x: number; y: number; z: number };
}

export class ClaimLabels {
  private readonly root = document.createElement('div');
  private readonly placards: Placard[] = [];
  private signature = '';
  private strength = 0;

  constructor(parent: HTMLElement, private readonly map: IslandMap) {
    this.root.className = 'claim-labels';
    this.root.dataset.testid = 'claim-labels';
    parent.append(this.root);
  }

  update(world: World, shown: boolean): void {
    const signature = shown ? world.cities.map((city) => `${city.id}:${city.name}:${city.color}`).join(';') : '';
    if (signature === this.signature) return;
    this.signature = signature;
    this.root.textContent = '';
    this.placards.length = 0;
    if (shown) for (const city of world.cities) this.addCard(city);
  }

  follow(project: Projector, strength: number): void {
    if (strength <= 0 && this.strength <= 0) return;
    this.strength = strength;
    this.root.style.opacity = String(strength);
    for (const placard of this.placards) {
      const point = project(placard.anchor.x, placard.anchor.y, placard.anchor.z);
      const visible = strength > 0 && point.x > 0 && point.y > 0 && point.x < window.innerWidth && point.y < window.innerHeight;
      placard.card.hidden = !visible;
      if (visible) placard.card.style.transform = `translate3d(${point.x.toFixed(1)}px, ${point.y.toFixed(1)}px, 0) translate(-50%, -100%)`;
    }
  }

  dispose(): void {
    this.root.remove();
  }

  get cards(): number {
    return this.placards.length;
  }

  private addCard(city: City): void {
    const island = this.map.islands[city.home];
    if (!island) return;
    const centreX = island.x + island.width / 2;
    const centreZ = island.z + island.depth / 2;
    const point = worldPositionOn(this.map, centreX, centreZ);
    const card = document.createElement('p');
    card.className = 'claim-label';
    card.hidden = true;
    const swatch = document.createElement('span');
    swatch.className = 'hud-colour';
    swatch.style.setProperty('--city-colour', `#${cityColors[city.color].toString(16).padStart(6, '0')}`);
    card.append(swatch, document.createTextNode(city.name));
    this.root.append(card);
    this.placards.push({ card, anchor: { x: point.x, y: groundHeight(this.map, Math.floor(centreX), Math.floor(centreZ)) + HEIGHT_ABOVE_LAND, z: point.z } });
  }
}

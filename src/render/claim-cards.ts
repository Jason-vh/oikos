import * as T from 'three';
import { cityColors } from '../art/primitives';
import { groundHeight, worldPositionOn, type IslandMap } from '../sim/island';
import type { City, World } from '../sim/types';
import type { Stage } from './stage';

const HEIGHT_ABOVE_LAND = 7;
const FONT_SIZE = 15;
const PADDING_X = 13;
const PADDING_Y = 7;
const DOT_RADIUS = 4.5;
const DOT_GAP = 9;
const SHADOW_ROOM = 14;
const TEXTURE_SCALE = 3;
const PLATE = 'rgba(250, 248, 240, .86)';
const RIM = 'rgba(255, 255, 255, .7)';
const INK = '#294b4a';

interface Card {
  sprite: T.Sprite;
  width: number;
  height: number;
}

function plate(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number): void {
  context.beginPath();
  context.roundRect(x, y, width, height, height / 2);
}

function cardTexture(city: City): { texture: T.CanvasTexture; width: number; height: number } {
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = `${FONT_SIZE}px Georgia, 'Times New Roman', serif`;
  const textWidth = measure.measureText(city.name).width;
  const width = PADDING_X * 2 + DOT_RADIUS * 2 + DOT_GAP + textWidth;
  const height = FONT_SIZE + PADDING_Y * 2;

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil((width + SHADOW_ROOM * 2) * TEXTURE_SCALE);
  canvas.height = Math.ceil((height + SHADOW_ROOM * 2) * TEXTURE_SCALE);
  const context = canvas.getContext('2d')!;
  context.scale(TEXTURE_SCALE, TEXTURE_SCALE);
  context.translate(SHADOW_ROOM, SHADOW_ROOM);

  context.shadowColor = 'rgba(31, 59, 58, .22)';
  context.shadowBlur = 10;
  context.shadowOffsetY = 3;
  context.fillStyle = PLATE;
  plate(context, 0, 0, width, height);
  context.fill();
  context.shadowColor = 'transparent';
  context.lineWidth = 1;
  context.strokeStyle = RIM;
  plate(context, .5, .5, width - 1, height - 1);
  context.stroke();

  context.fillStyle = `#${cityColors[city.color].toString(16).padStart(6, '0')}`;
  context.beginPath();
  context.arc(PADDING_X + DOT_RADIUS, height / 2, DOT_RADIUS, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = INK;
  context.font = `${FONT_SIZE}px Georgia, 'Times New Roman', serif`;
  context.textBaseline = 'middle';
  context.fillText(city.name, PADDING_X + DOT_RADIUS * 2 + DOT_GAP, height / 2 + 1);

  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 4;
  return { texture, width: width + SHADOW_ROOM * 2, height: height + SHADOW_ROOM * 2 };
}

export class ClaimCards {
  private readonly group = new T.Group();
  private readonly cards: Card[] = [];
  private signature = '';
  private strength = 0;

  constructor(private readonly stage: Stage, private readonly map: IslandMap) {
    this.group.visible = false;
    stage.scene.add(this.group);
  }

  update(world: World, shown: boolean): void {
    const signature = shown ? world.cities.map((city) => `${city.id}:${city.name}:${city.color}`).join(';') : '';
    if (signature === this.signature) return;
    this.signature = signature;
    this.clear();
    if (shown) for (const city of world.cities) this.addCard(city);
    this.group.visible = shown && this.strength > 0;
    this.stage.invalidate();
  }

  place(worldPerPixel: number, strength: number): void {
    this.strength = strength;
    this.group.visible = this.cards.length > 0 && strength > 0;
    for (const card of this.cards) {
      card.sprite.scale.set(card.width * worldPerPixel, card.height * worldPerPixel, 1);
      (card.sprite.material as T.SpriteMaterial).opacity = strength;
    }
  }

  dispose(): void {
    this.clear();
    this.group.removeFromParent();
    this.stage.invalidate();
  }

  get count(): number {
    return this.cards.length;
  }

  private addCard(city: City): void {
    const island = this.map.islands[city.home];
    if (!island) return;
    const centreX = island.x + island.width / 2;
    const centreZ = island.z + island.depth / 2;
    const point = worldPositionOn(this.map, centreX, centreZ);
    const { texture, width, height } = cardTexture(city);
    const sprite = new T.Sprite(new T.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, opacity: this.strength }));
    sprite.center.set(.5, 0);
    sprite.position.set(point.x, groundHeight(this.map, Math.floor(centreX), Math.floor(centreZ)) + HEIGHT_ABOVE_LAND, point.z);
    this.group.add(sprite);
    this.cards.push({ sprite, width, height });
  }

  private clear(): void {
    for (const card of this.cards) {
      const material = card.sprite.material as T.SpriteMaterial;
      material.map?.dispose();
      material.dispose();
    }
    this.group.clear();
    this.cards.length = 0;
  }
}

export type Relation = 'distant' | 'ally' | 'vassal' | 'rival';

export interface CityDef {
  id: string;
  name: string;
  strength: number;
  blurb: string;
}

export const CITIES: CityDef[] = [
  { id: 'corinth', name: 'Corinth', strength: 3, blurb: 'Rich on oil, and knows it.' },
  { id: 'knossos', name: 'Knossos', strength: 4, blurb: 'Buys everything, cheaply.' },
  { id: 'mycenae', name: 'Mycenae', strength: 5, blurb: 'Grain in its granaries and spears at its gates.' },
  { id: 'troy', name: 'Troy', strength: 6, blurb: 'Walled, proud, and never quite friendly.' },
  { id: 'thebes', name: 'Thebes', strength: 3, blurb: 'Drinks more wine than it presses.' },
  { id: 'sparta', name: 'Sparta', strength: 6, blurb: 'Sells fleece, keeps its soldiers.' },
];

export const NEUTRAL_GOODWILL = 40;
export const ALLY_GOODWILL = 55;
export const VASSAL_GOODWILL = 85;
export const RIVAL_GOODWILL = 20;

export const GIFT_COST = 500;
export const GIFT_GOODWILL = 12;
export const TRIBUTE_PER_YEAR = 400;

export function newGoodwill(): Record<string, number> {
  return Object.fromEntries(CITIES.map((city) => [city.id, NEUTRAL_GOODWILL]));
}

export function relationOf(goodwill: number): Relation {
  if (goodwill >= VASSAL_GOODWILL) return 'vassal';
  if (goodwill >= ALLY_GOODWILL) return 'ally';
  if (goodwill <= RIVAL_GOODWILL) return 'rival';
  return 'distant';
}

export function tradesWithYou(goodwill: number): boolean {
  return relationOf(goodwill) === 'ally' || relationOf(goodwill) === 'vassal';
}

export function tributeFrom(goodwill: number): number {
  return relationOf(goodwill) === 'vassal' ? TRIBUTE_PER_YEAR : 0;
}

export function shiftGoodwill(goodwill: number, amount: number): number {
  return Math.max(0, Math.min(100, goodwill + amount));
}

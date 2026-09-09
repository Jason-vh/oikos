import type { BuildingKind } from './types';

export const GOD_KINDS = [
  'zeus',
  'poseidon',
  'demeter',
  'athena',
  'artemis',
  'apollo',
  'ares',
  'hephaestus',
  'aphrodite',
  'hermes',
  'dionysus',
  'hades',
  'hera',
  'atlas',
] as const;
export type GodKind = (typeof GOD_KINDS)[number];

export interface GodDef {
  kind: GodKind;
  name: string;
  domain: string;
  sanctuary: BuildingKind;
  blessing: string;
  wrath: string;
}

function god(kind: GodKind, domain: string, blessing: string, wrath: string): GodDef {
  const name = kind[0].toUpperCase() + kind.slice(1);
  return {
    kind,
    name,
    domain,
    sanctuary: `sanctuary${name}` as BuildingKind,
    blessing: `${name} ${blessing}`,
    wrath: `${name} ${wrath}`,
  };
}

export const GODS: Record<GodKind, GodDef> = {
  zeus: god('zeus', 'Sky and rule', 'blesses the whole city.', 'strikes a building with lightning.'),
  poseidon: god('poseidon', 'Sea and trade', 'sends a fair wind to the traders.', 'wrecks the ships and the goods aboard.'),
  demeter: god('demeter', 'Harvest', 'fills the granaries.', 'blights the fields.'),
  athena: god('athena', 'War and craft', 'drills the companies to twice their worth.', 'takes the heart out of the army.'),
  artemis: god('artemis', 'The hunt', 'sends game to every granary.', 'looses beasts on the outlying houses.'),
  apollo: god('apollo', 'Healing and light', 'lifts every sickness in the city.', 'sends plague through the streets.'),
  ares: god('ares', 'Battle', 'raises companies of his own.', 'throws down the walls and towers.'),
  hephaestus: god('hephaestus', 'The forge', 'damps every hearth in the city.', 'sets a building alight.'),
  aphrodite: god('aphrodite', 'Love', 'makes the city beloved, and nobody leaves.', 'carries citizens away with her.'),
  hermes: god('hermes', 'Roads and trade', 'speeds the carts and fills their loads.', 'empties a storehouse onto the road.'),
  dionysus: god('dionysus', 'Wine and revels', 'fills the wine stores.', 'sets the city drinking and quarrelling.'),
  hades: god('hades', 'The underworld', 'sends up buried silver.', 'claims his tribute from the treasury.'),
  hera: god('hera', 'Marriage and plenty', 'blesses every household in the city.', 'turns the citizens against you.'),
  atlas: god('atlas', 'The burden of the sky', 'steadies the quarries and the masons.', 'petrifies the stonecutters.'),
};

export interface GodState {
  mood: number;
  honoured: boolean;
  lastAct: string | null;
}

export const NEUTRAL_MOOD = 50;
const MAX_MOOD = 100;
const TENDED_GAIN = 3;
const UNSTAFFED_GAIN = 1;
const NEGLECT_LOSS = 2;
const PLEASED_MOOD = 80;
const ANGRY_MOOD = 20;
const ACT_CHANCE = 0.25;

export type GodAct = 'bless' | 'curse' | null;

export function newPantheon(): Record<GodKind, GodState> {
  return Object.fromEntries(
    GOD_KINDS.map((kind) => [kind, { mood: NEUTRAL_MOOD, honoured: false, lastAct: null }]),
  ) as Record<GodKind, GodState>;
}

export function moodAfterMonth(mood: number, sanctuaries: number, staffedSanctuaries: number): number {
  if (sanctuaries === 0) return clamp(mood - NEGLECT_LOSS);
  if (staffedSanctuaries === 0) return clamp(mood + UNSTAFFED_GAIN);
  return clamp(mood + TENDED_GAIN * staffedSanctuaries);
}

export function actFor(mood: number, roll: number): GodAct {
  if (mood >= PLEASED_MOOD && roll < ACT_CHANCE) return 'bless';
  if (mood <= ANGRY_MOOD && roll < ACT_CHANCE) return 'curse';
  return null;
}

export function moodName(mood: number, honoured: boolean): string {
  if (!honoured) return 'Indifferent';
  if (mood >= PLEASED_MOOD) return 'Pleased';
  if (mood >= 60) return 'Content';
  if (mood > ANGRY_MOOD) return 'Restless';
  return 'Wrathful';
}

function clamp(mood: number): number {
  return Math.max(0, Math.min(MAX_MOOD, mood));
}

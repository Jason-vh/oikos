import type { BuildingKind } from './types';

export const GOD_KINDS = ['demeter', 'hephaestus', 'hermes', 'hades'] as const;
export type GodKind = (typeof GOD_KINDS)[number];

export interface GodDef {
  kind: GodKind;
  name: string;
  domain: string;
  sanctuary: BuildingKind;
  blessing: string;
  wrath: string;
}

export const GODS: Record<GodKind, GodDef> = {
  demeter: {
    kind: 'demeter',
    name: 'Demeter',
    domain: 'Harvest',
    sanctuary: 'sanctuaryDemeter',
    blessing: 'Demeter fills the granaries.',
    wrath: 'Demeter blights the fields.',
  },
  hephaestus: {
    kind: 'hephaestus',
    name: 'Hephaestus',
    domain: 'The forge',
    sanctuary: 'sanctuaryHephaestus',
    blessing: 'Hephaestus damps every hearth in the city.',
    wrath: 'Hephaestus sets a building alight.',
  },
  hermes: {
    kind: 'hermes',
    name: 'Hermes',
    domain: 'Roads and trade',
    sanctuary: 'sanctuaryHermes',
    blessing: 'Hermes speeds the carts and fills their loads.',
    wrath: 'Hermes empties a storehouse onto the road.',
  },
  hades: {
    kind: 'hades',
    name: 'Hades',
    domain: 'The underworld',
    sanctuary: 'sanctuaryHades',
    blessing: 'Hades sends up buried silver.',
    wrath: 'Hades claims his tribute from the treasury.',
  },
};

export const SANCTUARY_KINDS = GOD_KINDS.map((kind) => GODS[kind].sanctuary);

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

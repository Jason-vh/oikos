import type { BuildTool, City } from './types';

export type LadderTier = 1 | 2 | 3 | 4;

export interface Requirement {
  tier: LadderTier;
  residents: number;
}

export const UNLOCKS: Partial<Record<BuildTool, Requirement>> = {
  woodcutter: { tier: 2, residents: 24 },
  stockpile: { tier: 2, residents: 24 },
  orchard: { tier: 3, residents: 20 },
  press: { tier: 3, residents: 20 },
};

const TIER_NOUNS: Record<LadderTier, string> = {
  1: 'dwellers',
  2: 'cottagers',
  3: 'courtyard residents',
  4: 'townspeople',
};

export function tierNoun(tier: LadderTier): string {
  return TIER_NOUNS[tier];
}

export function residentsAtTier(city: City, tier: LadderTier): number {
  return city.buildings
    .filter((building) => building.kind === 'house' && building.tier >= tier)
    .reduce((sum, house) => sum + house.residents, 0);
}

export function requirementOf(tool: BuildTool): Requirement | null {
  return UNLOCKS[tool] ?? null;
}

export function unlockRefusal(city: City, tool: BuildTool): string {
  const requirement = requirementOf(tool);
  if (!requirement) return '';
  const living = residentsAtTier(city, requirement.tier);
  if (living >= requirement.residents) return '';
  return `Needs ${requirement.residents} ${tierNoun(requirement.tier)}; ${living} live here.`;
}

export function unlocked(city: City, tool: BuildTool): boolean {
  return unlockRefusal(city, tool) === '';
}

export interface PendingUnlock {
  tool: BuildTool;
  requirement: Requirement;
  living: number;
}

export function lockedTools(city: City): PendingUnlock[] {
  return (Object.keys(UNLOCKS) as BuildTool[])
    .filter((tool) => !unlocked(city, tool))
    .map((tool) => ({ tool, requirement: UNLOCKS[tool]!, living: residentsAtTier(city, UNLOCKS[tool]!.tier) }));
}

export function nextUnlock(city: City): PendingUnlock | null {
  const pending = lockedTools(city);
  if (pending.length === 0) return null;
  return pending.reduce((nearest, candidate) => {
    const gap = candidate.requirement.residents - candidate.living;
    const best = nearest.requirement.residents - nearest.living;
    if (gap !== best) return gap < best ? candidate : nearest;
    return candidate.requirement.tier < nearest.requirement.tier ? candidate : nearest;
  });
}

export function unlockedTools(city: City): BuildTool[] {
  return (Object.keys(UNLOCKS) as BuildTool[]).filter((tool) => unlocked(city, tool));
}

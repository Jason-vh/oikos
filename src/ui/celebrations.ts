import { getSummary } from '../sim/world';
import { BUILDINGS } from '../sim/catalog';
import { unlockedTools } from '../sim/unlocks';
import type { BuildTool, City } from '../sim/types';
import type { SoundCue } from './sound';

export function cityUnlocks(city: City): BuildTool[] {
  return unlockedTools(city);
}

export function unlockCelebration(previous: readonly BuildTool[], next: readonly BuildTool[]): { message: string; sound: SoundCue } | null {
  const fresh = next.find((tool) => !previous.includes(tool));
  if (!fresh) return null;
  if (fresh === 'road') return null;
  return { message: `${BUILDINGS[fresh].name} unlocked: your city has earned it.`, sound: 'upgrade' };
}

export function rememberUnlocks(previous: readonly BuildTool[], next: readonly BuildTool[]): BuildTool[] {
  return [...new Set([...previous, ...next])];
}

export interface CityMilestones {
  settled: boolean;
  delivered: boolean;
  courtyard: boolean;
  townhouse: boolean;
  thriving: boolean;
}

export const NO_MILESTONES: CityMilestones = { settled: false, delivered: false, courtyard: false, townhouse: false, thriving: false };

export function cityMilestones(city: City): CityMilestones {
  const summary = getSummary(city);
  return {
    settled: summary.population > 0,
    delivered: city.delivered > 0,
    courtyard: summary.prosperous > 0,
    townhouse: summary.townhouses > 0,
    thriving: summary.goal,
  };
}

export function celebration(previous: CityMilestones, next: CityMilestones, name = 'Your city'): { message: string; sound: SoundCue } | null {
  if (!previous.townhouse && next.townhouse) return { message: 'Your first townhouse. Oil, bread and water keep it standing tall.', sound: 'upgrade' };
  if (!previous.thriving && next.thriving) return { message: `${name} is thriving. Four courtyard homes, supplied and prosperous.`, sound: 'goal' };
  if (!previous.courtyard && next.courtyard) return { message: 'Your first courtyard home. A neighbourhood takes shape.', sound: 'upgrade' };
  if (!previous.delivered && next.delivered) return { message: 'The first food has reached a home.', sound: 'delivery' };
  if (!previous.settled && next.settled) return { message: 'Your first settlers have arrived. Welcome home.', sound: 'arrival' };
  return null;
}

export function rememberMilestones(previous: CityMilestones, next: CityMilestones): CityMilestones {
  return {
    settled: previous.settled || next.settled,
    delivered: previous.delivered || next.delivered,
    courtyard: previous.courtyard || next.courtyard,
    townhouse: previous.townhouse || next.townhouse,
    thriving: previous.thriving || next.thriving,
  };
}

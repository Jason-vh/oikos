import { getSummary } from '../sim/world';
import type { World } from '../sim/types';
import type { SoundCue } from './sound';

export interface CityMilestones {
  settled: boolean;
  delivered: boolean;
  courtyard: boolean;
  thriving: boolean;
}

export function cityMilestones(world: World): CityMilestones {
  const summary = getSummary(world);
  return {
    settled: summary.population > 0,
    delivered: world.delivered > 0,
    courtyard: summary.prosperous > 0,
    thriving: summary.goal,
  };
}

export function celebration(previous: CityMilestones, next: CityMilestones): { message: string; sound: SoundCue } | null {
  if (!previous.thriving && next.thriving) return { message: 'Kalliste is thriving. Four courtyard homes, supplied and prosperous.', sound: 'goal' };
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
    thriving: previous.thriving || next.thriving,
  };
}

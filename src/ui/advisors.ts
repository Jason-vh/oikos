import { isDwelling, tierOf } from '../sim/buildings';
import { GODS, moodName } from '../sim/gods';
import { HEROES } from '../sim/heroes';
import { companiesIn } from '../sim/military';
import type { World } from '../sim/world';

export interface AdvisorReading {
  label: string;
  value: string;
  concern: boolean;
}

export interface AdvisorReport {
  name: string;
  verdict: string;
  readings: AdvisorReading[];
}

export function adviseCity(world: World): AdvisorReport[] {
  return [adviseOnPeople(world), adviseOnTrade(world), adviseOnRisk(world), adviseOnGods(world)];
}

function adviseOnPeople(world: World): AdvisorReport {
  const { workforce, employed, required } = world.labour;
  const idle = workforce - employed;
  const short = Math.max(0, required - employed);
  const houses = dwellings(world);
  const crowded = houses.reduce((total, house) => total + tierOf(house).capacity, 0);

  return {
    name: 'The people',
    verdict: world.sentiment.complaint ?? 'Nobody complains.',
    readings: [
      { label: 'Citizens', value: `${world.population} of ${crowded} rooms`, concern: false },
      { label: 'Popularity', value: `${world.sentiment.popularity} of 100`, concern: world.sentiment.popularity < 40 },
      { label: 'Workers short', value: `${short}`, concern: short > 0 },
      { label: 'Idle', value: `${idle}`, concern: idle > workforce * 0.2 },
      { label: 'Migration', value: migration(world.migrants), concern: world.migrants < 0 },
    ],
  };
}

function adviseOnTrade(world: World): AdvisorReport {
  const { earned, spent } = world.trade;
  const wages = Math.round(world.taxes.collected - earned + spent);

  return {
    name: 'The treasury',
    verdict: world.monthsInDebt > 0 ? `In debt for ${world.monthsInDebt} months.` : 'The books balance.',
    readings: [
      { label: 'Treasury', value: `${Math.round(world.treasury)}`, concern: world.treasury < 0 },
      { label: 'Tax last month', value: `${Math.round(world.taxes.collected)}`, concern: world.taxes.collected === 0 },
      { label: 'Trade last month', value: `${earned} in, ${spent} out`, concern: false },
      { label: 'Standing abroad', value: `${world.standing} of 100`, concern: world.standing < 35 },
      { label: 'Requests waiting', value: `${world.requests.length}`, concern: world.requests.length > 0 },
      { label: 'Untaxed people', value: `${world.taxes.untaxedPeople}`, concern: wages < 0 },
    ],
  };
}

function adviseOnRisk(world: World): AdvisorReport {
  const houses = dwellings(world);
  const sick = houses.filter((house) => house.disease >= 50).length;
  const lawless = houses.filter((house) => house.crime >= 50).length;
  const hungry = houses.filter((house) => tierOf(house).needs.includes('food') && house.supply.food === 0).length;

  return {
    name: 'The city',
    verdict: world.monster ? `${world.monster.name} is loose.` : 'No monster walks the streets.',
    readings: [
      { label: 'Houses sickening', value: `${sick}`, concern: sick > 0 },
      { label: 'Houses turning to crime', value: `${lawless}`, concern: lawless > 0 },
      { label: 'Houses unfed', value: `${hungry}`, concern: hungry > 0 },
      { label: 'Companies', value: `${companiesIn(world.army)}`, concern: companiesIn(world.army) === 0 },
      { label: 'Walls', value: `${world.wallLength} tiles`, concern: false },
      { label: 'Hero', value: heroName(world), concern: false },
    ],
  };
}

function adviseOnGods(world: World): AdvisorReport {
  const readings = world.scenario.gods.map((kind) => {
    const god = world.gods[kind];
    return {
      label: GODS[kind].name,
      value: `${moodName(god.mood, god.honoured)}${god.honoured ? ` · ${god.mood}` : ''}`,
      concern: god.honoured && god.mood <= 20,
    };
  });

  return {
    name: 'The gods',
    verdict: readings.some((reading) => reading.concern) ? 'Someone above is angry.' : 'The gods are quiet.',
    readings,
  };
}

function heroName(world: World): string {
  if (!world.hero) return 'none';
  return `${HEROES[world.hero.kind].name} · ${world.hero.monthsLeft} months`;
}

function migration(migrants: number): string {
  if (migrants > 0) return `${migrants} settling`;
  if (migrants < 0) return `${-migrants} leaving`;
  return 'steady';
}

function dwellings(world: World) {
  return [...world.buildings.values()].filter((building) => isDwelling(building.kind));
}

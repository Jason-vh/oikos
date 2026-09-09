import type { GodKind } from './gods';

export interface QuestCity {
  population: number;
  companies: number;
  sanctuaries: number;
  treasury: number;
  marble: number;
  wine: number;
  oil: number;
  fleece: number;
  allies: number;
  heroes: number;
  monstersSlain: number;
}

export interface Quest {
  god: GodKind;
  name: string;
  demand: string;
  reward: number;
  met: (city: QuestCity) => boolean;
}

export const OFFER_MOOD = 70;

export const QUESTS: Record<GodKind, Quest> = {
  zeus: {
    god: 'zeus',
    name: 'The Games at Olympia',
    demand: '1200 citizens and three sanctuaries',
    reward: 1600,
    met: (city) => city.population >= 1200 && city.sanctuaries >= 3,
  },
  poseidon: {
    god: 'poseidon',
    name: 'The Ships of Poseidon',
    demand: 'three allies abroad',
    reward: 1200,
    met: (city) => city.allies >= 3,
  },
  demeter: {
    god: 'demeter',
    name: 'The Rites of Eleusis',
    demand: '800 citizens and 20 oil in store',
    reward: 900,
    met: (city) => city.population >= 800 && city.oil >= 20,
  },
  athena: {
    god: 'athena',
    name: 'The Owl and the Spear',
    demand: 'six companies under arms',
    reward: 1100,
    met: (city) => city.companies >= 6,
  },
  artemis: {
    god: 'artemis',
    name: 'The Hunt of Artemis',
    demand: '24 fleece in store',
    reward: 700,
    met: (city) => city.fleece >= 24,
  },
  apollo: {
    god: 'apollo',
    name: 'The Oracle Answers',
    demand: 'two sanctuaries and 4000 drachmas',
    reward: 1000,
    met: (city) => city.sanctuaries >= 2 && city.treasury >= 4000,
  },
  ares: {
    god: 'ares',
    name: 'The Spoils of Ares',
    demand: 'ten companies under arms',
    reward: 1400,
    met: (city) => city.companies >= 10,
  },
  hephaestus: {
    god: 'hephaestus',
    name: 'The Bronze Doors',
    demand: '40 marble in store',
    reward: 900,
    met: (city) => city.marble >= 40,
  },
  aphrodite: {
    god: 'aphrodite',
    name: 'The Feast of Aphrodite',
    demand: '16 wine in store',
    reward: 800,
    met: (city) => city.wine >= 16,
  },
  hermes: {
    god: 'hermes',
    name: 'The Roads of Hermes',
    demand: 'two allies abroad',
    reward: 700,
    met: (city) => city.allies >= 2,
  },
  dionysus: {
    god: 'dionysus',
    name: 'The Revel of Dionysus',
    demand: '24 wine in store',
    reward: 900,
    met: (city) => city.wine >= 24,
  },
  hades: {
    god: 'hades',
    name: 'A Monster Slain',
    demand: 'a monster killed by a hero',
    reward: 1500,
    met: (city) => city.monstersSlain >= 1,
  },
};

export type QuestState = 'unoffered' | 'offered' | 'done';

export const CITY_COLORS = ['terracotta', 'saffron', 'olive', 'verdigris', 'aegean', 'lapis', 'plum', 'crimson'] as const;

export type CityColor = typeof CITY_COLORS[number];

export function cityColor(raw: unknown): CityColor | null {
  return CITY_COLORS.includes(raw as CityColor) ? raw as CityColor : null;
}

export function randomCityColor(taken: readonly CityColor[] = []): CityColor {
  const free = CITY_COLORS.filter((color) => !taken.includes(color));
  const choices = free.length > 0 ? free : CITY_COLORS;
  return choices[Math.floor(Math.random() * choices.length)];
}

export function cityColorAt(index: number): CityColor {
  return CITY_COLORS[((index % CITY_COLORS.length) + CITY_COLORS.length) % CITY_COLORS.length];
}

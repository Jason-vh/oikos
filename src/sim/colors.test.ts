import { describe, expect, test } from 'bun:test';
import { CITY_COLORS, cityColor, cityColorAt, randomCityColor } from './colors';

describe('cityColor', () => {
  test('accepts every palette entry and nothing else', () => {
    for (const color of CITY_COLORS) expect(cityColor(color)).toBe(color);
    for (const raw of ['', 'chartreuse', 'Terracotta', 0, null, undefined, {}]) expect(cityColor(raw)).toBeNull();
  });
});

describe('cityColorAt', () => {
  test('gives every city a colour, wrapping past the palette', () => {
    expect(cityColorAt(0)).toBe(CITY_COLORS[0]);
    expect(cityColorAt(CITY_COLORS.length)).toBe(CITY_COLORS[0]);
    expect(cityColorAt(-1)).toBe(CITY_COLORS[CITY_COLORS.length - 1]);
  });
});

describe('randomCityColor', () => {
  test('avoids the colours already taken', () => {
    const taken = CITY_COLORS.slice(0, CITY_COLORS.length - 1);
    for (let attempt = 0; attempt < 32; attempt++) expect(randomCityColor(taken)).toBe(CITY_COLORS[CITY_COLORS.length - 1]);
  });

  test('falls back to the whole palette once every colour is taken', () => {
    expect(CITY_COLORS).toContain(randomCityColor(CITY_COLORS));
  });
});

import { expect, test } from 'bun:test';
import { cityName } from '../sim/claims';
import { suggestCityName } from './city-names';

test('every suggested name is one the authority would accept, unchanged', () => {
  const seen = new Set<string>();
  for (let draw = 0; draw < 400; draw++) seen.add(suggestCityName());
  expect(seen.size).toBeGreaterThan(1);
  for (const name of seen) expect(cityName(name)).toBe(name);
});

import type { City } from '@kamel-pulse/analytics';

const CAMPUS_CITIES = new Set<City>(['ithaca', 'binghamton']);

export const CITY_LABELS: Record<City, string> = {
  ithaca: 'Ithaca',
  nyc: 'NYC',
  syracuse: 'Syracuse',
  binghamton: 'Binghamton',
  philadelphia: 'Philadelphia',
  boston: 'Boston',
  rochester: 'Rochester',
  washington_dc: 'Washington DC',
};

export function corridorLabel(origin: City, destination: City): string {
  return `${CITY_LABELS[origin]} → ${CITY_LABELS[destination]}`;
}

export function pairKey(origin: City, destination: City): string {
  return [origin, destination].sort().join('__');
}

/** true for the "leaving campus" direction of a pair (Thu/Fri-heavy, top row). */
export function isOutboundDirection(origin: City): boolean {
  return CAMPUS_CITIES.has(origin);
}

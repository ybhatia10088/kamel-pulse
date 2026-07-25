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

/**
 * true for the "leaving campus" direction of a pair (Thu/Fri-heavy, top
 * row). Ithaca is treated as the primary hub: for the one pair where both
 * endpoints are campus cities (Ithaca<->Binghamton), origin-is-a-campus-
 * city alone can't tell the two directions apart — both would say
 * "outbound" and one silently overwrites the other in the heatmap's
 * pair grouping.
 */
export function isOutboundDirection(origin: City, destination: City): boolean {
  if (origin === 'ithaca') return true;
  if (destination === 'ithaca') return false;
  return CAMPUS_CITIES.has(origin);
}

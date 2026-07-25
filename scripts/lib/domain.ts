import type { City } from '@kamel-pulse/analytics';

export const CORRIDOR_PAIRS = [
  { a: 'ithaca', b: 'nyc', share: 0.46, costShare: [45, 62] as const, hours: 4.5 },
  { a: 'ithaca', b: 'syracuse', share: 0.13, costShare: [18, 26] as const, hours: 1.3 },
  { a: 'ithaca', b: 'binghamton', share: 0.11, costShare: [15, 21] as const, hours: 1.2 },
  { a: 'ithaca', b: 'philadelphia', share: 0.09, costShare: [50, 66] as const, hours: 4.2 },
  { a: 'ithaca', b: 'boston', share: 0.07, costShare: [60, 78] as const, hours: 6.1 },
  { a: 'binghamton', b: 'nyc', share: 0.06, costShare: [35, 47] as const, hours: 3.2 },
  { a: 'ithaca', b: 'rochester', share: 0.05, costShare: [20, 29] as const, hours: 1.8 },
  { a: 'ithaca', b: 'washington_dc', share: 0.03, costShare: [70, 88] as const, hours: 5.9 },
] satisfies readonly { a: City; b: City; share: number; costShare: readonly [number, number]; hours: number }[];

export type DirectedCorridor = {
  origin: City;
  destination: City;
  pairKey: string;
  share: number; // this direction's share of total corridor volume
  costShare: readonly [number, number];
  hours: number;
};

const CAMPUS_CITIES = new Set<City>(['ithaca', 'binghamton']);

export const DIRECTED_CORRIDORS: DirectedCorridor[] = CORRIDOR_PAIRS.flatMap((pair) => {
  const pairKey = `${pair.a}__${pair.b}`;
  return [
    { origin: pair.a, destination: pair.b, pairKey, share: pair.share / 2, costShare: pair.costShare, hours: pair.hours },
    { origin: pair.b, destination: pair.a, pairKey, share: pair.share / 2, costShare: pair.costShare, hours: pair.hours },
  ];
});

/** true when this corridor is a "leaving campus" (outbound, Thu/Fri-heavy) direction. */
export function isOutboundDirection(c: Pick<DirectedCorridor, 'origin'>): boolean {
  return CAMPUS_CITIES.has(c.origin);
}

// Sun=0 .. Sat=6. Outbound (leaving campus) clusters Thu/Fri; return
// (arriving at campus) clusters Sun/Mon.
export const OUTBOUND_DOW_WEIGHTS = [0.5, 0.5, 0.7, 0.9, 2.6, 2.9, 1.0];
export const RETURN_DOW_WEIGHTS = [2.7, 2.1, 0.8, 0.6, 0.5, 0.6, 1.2];

export function dowWeights(c: Pick<DirectedCorridor, 'origin' | 'destination'>): number[] {
  return isOutboundDirection(c) ? OUTBOUND_DOW_WEIGHTS : RETURN_DOW_WEIGHTS;
}

export const SEATS_TOTAL_DIST: readonly (readonly [number, number])[] = [
  [2, 0.22],
  [3, 0.48],
  [4, 0.3],
];

export const SEATS_NEEDED_DIST: readonly (readonly [number, number])[] = [
  [1, 0.81],
  [2, 0.15],
  [3, 0.04],
];

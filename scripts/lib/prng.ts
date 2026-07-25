// Deterministic PRNG (mulberry32) so `pnpm seed` produces byte-identical
// output on every run. Do not swap in Math.random anywhere in this tree.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = () => number;

export function randInt(rng: Rng, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

export function randFloat(rng: Rng, min: number, max: number): number {
  return rng() * (max - min) + min;
}

export function chance(rng: Rng, p: number): boolean {
  return rng() < p;
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[randInt(rng, 0, items.length - 1)];
}

export function weightedPick<T>(rng: Rng, items: readonly (readonly [T, number])[]): T {
  const total = items.reduce((sum, [, w]) => sum + w, 0);
  let r = rng() * total;
  for (const [value, weight] of items) {
    r -= weight;
    if (r <= 0) return value;
  }
  return items[items.length - 1][0];
}

export function shuffle<T>(rng: Rng, items: T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = randInt(rng, 0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Box-Muller transform, clamped to [min, max]. */
export function gaussian(rng: Rng, mean: number, sd: number, min: number, max: number): number {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.min(Math.max(mean + z * sd, min), max);
}

/** Lognormal sample via exp(gaussian(log(median), sigma)); good for skewed durations. */
export function lognormal(rng: Rng, median: number, sigma: number, min: number, max: number): number {
  const g = gaussian(rng, Math.log(median), sigma, -50, 50);
  return Math.min(Math.max(Math.exp(g), min), max);
}

const HEX = '0123456789abcdef';

/** Valid-format UUID v4, deterministically derived from the seeded rng. */
export function seededUuid(rng: Rng): string {
  let out = '';
  for (let i = 0; i < 32; i++) {
    if (i === 12) {
      out += '4';
    } else if (i === 16) {
      out += HEX[(randInt(rng, 0, 15) & 0x3) | 0x8];
    } else {
      out += HEX[randInt(rng, 0, 15)];
    }
    if (i === 7 || i === 11 || i === 15 || i === 19) out += '-';
  }
  return out;
}

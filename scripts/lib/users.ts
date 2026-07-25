import type { Campus, ReferralSource } from '@kamel-pulse/analytics';
import { addDays, WEEKS } from '@/lib/calendar';
import { gaussian, type Rng, randInt, weightedPick } from './prng';

export type Persona = 'driver_only' | 'passenger_only' | 'both';

export type SeedUser = {
  id: string;
  campus: Campus;
  eduDomain: string;
  referralSource: ReferralSource;
  signupDate: Date;
  persona: Persona;
  canDrive: boolean;
  canRide: boolean;
  // Mutated as the simulation runs forward in time.
  tripsCompleted: number;
  trueSkill: number; // latent rating quality, drivers only
  ratingSum: number;
  ratingCount: number;
};

const REFERRAL_DIST: readonly (readonly [ReferralSource, number])[] = [
  ['friend', 0.34],
  ['club_group_chat', 0.22],
  ['instagram', 0.18],
  ['campus_flyer', 0.12],
  ['search', 0.09],
  ['direct', 0.05],
];

// Both-persona ("role duality") rate is set per campus to hit F4/F6
// directly; drivers-only/passengers-only split the remainder in the
// 14:65 ratio given for the platform overall.
const BOTH_RATE: Record<Campus, number> = { cornell: 0.23, binghamton: 0.08 };
const DRIVER_ONLY_SHARE = 0.14 / (0.14 + 0.65);

function personaFor(rng: Rng, campus: Campus): Persona {
  const bothRate = BOTH_RATE[campus];
  const remainder = 1 - bothRate;
  const driverOnlyRate = remainder * DRIVER_ONLY_SHARE;
  const r = rng();
  if (r < bothRate) return 'both';
  if (r < bothRate + driverOnlyRate) return 'driver_only';
  return 'passenger_only';
}

function signupDateFor(rng: Rng): Date {
  // 55% weeks 1-3, 25% weeks 4-7, 20% weeks 8-12 (front-loaded).
  const band = weightedPick(rng, [
    ['early', 0.55],
    ['mid', 0.25],
    ['late', 0.2],
  ] as const);
  const [lo, hi] = band === 'early' ? [0, 2] : band === 'mid' ? [3, 6] : [7, 11];
  const weekIdx = randInt(rng, lo, hi);
  const weekStart = new Date(`${WEEKS[weekIdx].start}T00:00:00Z`);
  return addDays(weekStart, randInt(rng, 0, 6));
}

export function generateUsers(rng: Rng, total = 2400, binghamtonCount = 400): SeedUser[] {
  const users: SeedUser[] = [];
  for (let i = 0; i < total; i++) {
    const campus: Campus = i < total - binghamtonCount ? 'cornell' : 'binghamton';
    const persona = personaFor(rng, campus);
    users.push({
      id: `u_${String(i).padStart(6, '0')}`,
      campus,
      eduDomain: `${campus}.edu`,
      referralSource: weightedPick(rng, REFERRAL_DIST),
      signupDate: signupDateFor(rng),
      persona,
      canDrive: persona === 'driver_only' || persona === 'both',
      canRide: persona === 'passenger_only' || persona === 'both',
      tripsCompleted: 0,
      trueSkill: gaussian(rng, 4.6, 0.4, 3.0, 5.0),
      ratingSum: 0,
      ratingCount: 0,
    });
  }
  return users;
}

import type { Campus, City, PaymentMethod } from '@kamel-pulse/analytics';
import {
  addDays,
  CALENDAR_EVENTS,
  demandMultiplierForDate,
  isoDate,
  TERM_END,
  TERM_START,
  WEEKS,
} from '@/lib/calendar';
import { chance, gaussian, lognormal, mulberry32, pick, type Rng, randInt, seededUuid, shuffle, weightedPick } from './prng';
import { DIRECTED_CORRIDORS, dowWeights, SEATS_NEEDED_DIST, SEATS_TOTAL_DIST, type DirectedCorridor } from './domain';
import { generateUsers, type SeedUser } from './users';

// ===========================================================================
// Types
// ===========================================================================

type Booking = {
  bookingId: string;
  passengerId: string | null;
  sessionId: string;
  anonymousId: string;
  seats: number;
  messaged: boolean;
  searchedAt: Date;
  bookedAt: Date;
  paymentMethod: PaymentMethod;
};

type FillBucket = 'zero' | 'veteran' | 'mid';

type Ride = {
  rideId: string;
  origin: City;
  destination: City;
  driverId: string;
  campus: Campus;
  departureAt: Date;
  listedAt: Date;
  seatsTotal: number;
  seatsBooked: number;
  costSharePerSeat: number;
  bucket: FillBucket;
  bookings: Booking[];
};

export type GeneratedEvent = {
  eventName: string;
  eventId: string;
  userId: string | null;
  anonymousId: string;
  sessionId: string;
  occurredAt: Date;
  campus: Campus | null;
  origin: City | null;
  destination: City | null;
  departureAt: Date | null;
  rideId: string | null;
  driverId: string | null;
  properties: Record<string, unknown>;
};

export type GeneratedDataset = {
  users: SeedUser[];
  rides: Ride[];
  events: GeneratedEvent[];
};

// ===========================================================================
// Tunable constants. Values were set from the arithmetic in the spec
// (section 10.4 volumes, section 10.5 findings) and refined by running
// `pnpm seed --dry-run` and `pnpm verify-seed` against the output. Where a
// planted finding (F1-F8) and a raw volume target were in tension, the
// finding won — those are the numbers verify-seed checks by name.
// ===========================================================================

const CORNELL_RIDE_TARGET = 1750;
const BINGHAMTON_RIDE_TARGET = 128;

const ZERO_BUCKET_RATE = 0.13;
const VETERAN_BUCKET_RATE = 0.13;
const ZERO_FILL_RATE = 0.42;
const VETERAN_FILL_RATE = 0.71;
const MID_FILL_RATE = 0.9;

const PAYMENT_METHODS: PaymentMethod[] = ['card', 'apple_pay', 'google_pay'];

const F1_OUT_DATES = ['2025-11-25', '2025-11-26'];
const F1_RETURN_DATES = ['2025-11-30', '2025-12-01'];

// ===========================================================================
// Small helpers
// ===========================================================================

function clampToTerm(d: Date): Date {
  if (d < TERM_START) return new Date(TERM_START);
  if (d > TERM_END) return new Date(TERM_END);
  return d;
}

function seatsFromDist(rng: Rng): number {
  return weightedPick(rng, SEATS_TOTAL_DIST);
}

function seatsNeededFromDist(rng: Rng): number {
  return weightedPick(rng, SEATS_NEEDED_DIST);
}

function isThanksgivingDeparture(departureAt: Date): boolean {
  const tg = CALENDAR_EVENTS.find((e) => e.name === 'Thanksgiving')!;
  return isoDate(departureAt) >= tg.start && isoDate(departureAt) <= tg.end;
}

/** F5: baseline bookings cluster ~6-day median lead time; Thanksgiving-week
 *  departures cluster ~19 days (recruitment has to start weeks out). */
function sampleLeadDays(rng: Rng, departureAt: Date): number {
  if (isThanksgivingDeparture(departureAt)) {
    return Math.round(lognormal(rng, 19, 0.5, 1, 60));
  }
  return Math.round(lognormal(rng, 6, 0.75, 0, 45));
}

// Eastern search hours 11:00-14:00 / 19:00-23:00 ~= 16:00-19:00 and
// 00:00-04:00 UTC.
function sampleSearchHourUtc(rng: Rng): number {
  return chance(rng, 0.55) ? randInt(rng, 16, 18) : [0, 1, 2, 3][randInt(rng, 0, 3)];
}

function atHour(date: Date, rng: Rng): Date {
  const d = new Date(date);
  d.setUTCHours(sampleSearchHourUtc(rng), randInt(rng, 0, 59), randInt(rng, 0, 59), 0);
  return d;
}

function weekWeight(weekIdx: number): number {
  const start = new Date(`${WEEKS[weekIdx].start}T00:00:00Z`);
  let sum = 0;
  for (let d = 0; d < 7; d++) sum += demandMultiplierForDate(addDays(start, d));
  return sum / 7;
}

function pickDepartureDate(rng: Rng, weekIdx: number, corridor: DirectedCorridor): Date {
  const weights = dowWeights(corridor);
  const weekStart = new Date(`${WEEKS[weekIdx].start}T00:00:00Z`);
  const dow = weightedPick(
    rng,
    weights.map((w, i) => [i, w] as const)
  );
  const mondayOffset = (dow + 6) % 7; // weights index 0=Sun..6=Sat; WEEKS start Monday
  const d = addDays(weekStart, mondayOffset);
  d.setUTCHours(randInt(rng, 7, 20), 0, 0, 0);
  return d;
}

function isF1Corridor(origin: City, destination: City): boolean {
  return (origin === 'ithaca' && destination === 'nyc') || (origin === 'nyc' && destination === 'ithaca');
}

function isF1Date(d: Date): boolean {
  const iso = isoDate(d);
  return F1_OUT_DATES.includes(iso) || F1_RETURN_DATES.includes(iso);
}

// ===========================================================================
// Driver buckets (F3)
// ===========================================================================

function assignDriverBuckets(rng: Rng, drivers: SeedUser[]): Map<string, FillBucket> {
  const buckets = new Map<string, FillBucket>();
  for (const d of shuffle(rng, drivers)) {
    const r = rng();
    if (r < ZERO_BUCKET_RATE) buckets.set(d.id, 'zero');
    else if (r < ZERO_BUCKET_RATE + VETERAN_BUCKET_RATE) buckets.set(d.id, 'veteran');
    else buckets.set(d.id, 'mid');
  }
  return buckets;
}

function fillRateFor(bucket: FillBucket): number {
  return bucket === 'zero' ? ZERO_FILL_RATE : bucket === 'veteran' ? VETERAN_FILL_RATE : MID_FILL_RATE;
}

// ===========================================================================
// Ride construction (ride_listed)
// ===========================================================================

function newRide(
  rng: Rng,
  rides: Ride[],
  campus: Campus,
  driver: SeedUser,
  origin: City,
  destination: City,
  departureAt: Date,
  bucket: FillBucket,
  costOverride?: number
): Ride {
  const leadDays = Math.round(lognormal(rng, 12, 0.6, 1, 50));
  const ride: Ride = {
    rideId: `ride_${String(rides.length).padStart(6, '0')}`,
    origin,
    destination,
    driverId: driver.id,
    campus,
    departureAt,
    listedAt: clampToTerm(addDays(departureAt, -leadDays)),
    seatsTotal: seatsFromDist(rng),
    seatsBooked: 0,
    costSharePerSeat: costOverride ?? randInt(rng, 30, 70),
    bucket,
    bookings: [],
  };
  rides.push(ride);
  return ride;
}

function buildGenericRides(
  rng: Rng,
  rides: Ride[],
  cornellUsers: SeedUser[],
  binghamtonUsers: SeedUser[],
  buckets: Map<string, FillBucket>
): void {
  const cornellDrivers = cornellUsers.filter((u) => u.canDrive);
  const binghamtonDrivers = binghamtonUsers.filter((u) => u.canDrive);
  const binghamtonCorridors = DIRECTED_CORRIDORS.filter(
    (c) => c.origin === 'binghamton' || c.destination === 'binghamton'
  );

  const cornellSlots: { corridor: DirectedCorridor; weekIdx: number }[] = [];
  for (const corridor of DIRECTED_CORRIDORS) {
    for (let w = 0; w < WEEKS.length; w++) {
      cornellSlots.push({ corridor, weekIdx: w });
    }
  }
  const cornellWeighted = cornellSlots.map((s) => [s, s.corridor.share * weekWeight(s.weekIdx)] as const);

  let built = 0;
  let guard = 0;
  while (built < CORNELL_RIDE_TARGET && guard < CORNELL_RIDE_TARGET * 4) {
    guard++;
    const { corridor, weekIdx } = weightedPick(rng, cornellWeighted);
    const departureAt = pickDepartureDate(rng, weekIdx, corridor);
    if (isF1Corridor(corridor.origin, corridor.destination) && isF1Date(departureAt)) continue;
    const driver = pick(rng, cornellDrivers);
    const corridorObj = DIRECTED_CORRIDORS.find((c) => c.pairKey === corridor.pairKey && c.origin === corridor.origin)!;
    newRide(
      rng,
      rides,
      'cornell',
      driver,
      corridor.origin,
      corridor.destination,
      departureAt,
      buckets.get(driver.id) ?? 'mid',
      randInt(rng, corridorObj.costShare[0], corridorObj.costShare[1])
    );
    built++;
  }

  const binghamtonSlots: { corridor: DirectedCorridor; weekIdx: number }[] = [];
  for (const corridor of binghamtonCorridors) {
    for (let w = 0; w < WEEKS.length; w++) {
      binghamtonSlots.push({ corridor, weekIdx: w });
    }
  }
  const binghamtonWeighted = binghamtonSlots.map((s) => [s, s.corridor.share * weekWeight(s.weekIdx)] as const);
  for (let i = 0; i < BINGHAMTON_RIDE_TARGET; i++) {
    const { corridor, weekIdx } = weightedPick(rng, binghamtonWeighted);
    const departureAt = pickDepartureDate(rng, weekIdx, corridor);
    const driver = pick(rng, binghamtonDrivers);
    newRide(
      rng,
      rides,
      'binghamton',
      driver,
      corridor.origin,
      corridor.destination,
      departureAt,
      buckets.get(driver.id) ?? 'mid',
      randInt(rng, corridor.costShare[0], corridor.costShare[1])
    );
  }
}

/** F1: explicit directional-asymmetry construction for the four Thanksgiving slices. */
function buildThanksgivingRides(
  rng: Rng,
  rides: Ride[],
  cornellUsers: SeedUser[],
  buckets: Map<string, FillBucket>
): { slice: { origin: City; destination: City; dates: string[]; demandedSeats: number; zeroResultRate: number }; rideIds: string[] }[] {
  const drivers = cornellUsers.filter((u) => u.canDrive);
  const out: { slice: { origin: City; destination: City; dates: string[]; demandedSeats: number; zeroResultRate: number }; rideIds: string[] }[] = [];

  function buildSlice(origin: City, destination: City, dates: string[], listedSeatsTarget: number, demandedSeats: number, zeroResultRate: number) {
    const rideIds: string[] = [];
    let listedSoFar = 0;
    while (listedSoFar < listedSeatsTarget) {
      const driver = pick(rng, drivers);
      const dateStr = pick(rng, dates);
      const departureAt = new Date(`${dateStr}T${String(randInt(rng, 12, 20)).padStart(2, '0')}:00:00.000Z`);
      const ride = newRide(rng, rides, 'cornell', driver, origin, destination, departureAt, buckets.get(driver.id) ?? 'mid', 53);
      rideIds.push(ride.rideId);
      listedSoFar += ride.seatsTotal;
    }
    out.push({ slice: { origin, destination, dates, demandedSeats, zeroResultRate }, rideIds });
  }

  // Outbound Nov 25-26: Ithaca->NYC wildly oversubscribed; NYC->Ithaca is dead surplus.
  buildSlice('ithaca', 'nyc', F1_OUT_DATES, 100, 320, 0.38);
  buildSlice('nyc', 'ithaca', F1_OUT_DATES, 60, 23, 0.05);

  // Return Nov 30-Dec 1: inverted.
  buildSlice('nyc', 'ithaca', F1_RETURN_DATES, 90, 243, 0.36);
  buildSlice('ithaca', 'nyc', F1_RETURN_DATES, 55, 19, 0.05);

  return out;
}

function buildRideListedEvents(rng: Rng, rides: Ride[], events: GeneratedEvent[]): void {
  for (const ride of rides) {
    events.push({
      eventName: 'ride_listed',
      eventId: seededUuid(rng),
      userId: ride.driverId,
      anonymousId: `anon_${ride.driverId}`,
      sessionId: `sess_list_${ride.rideId}`,
      occurredAt: ride.listedAt,
      campus: ride.campus,
      origin: ride.origin,
      destination: ride.destination,
      departureAt: ride.departureAt,
      rideId: ride.rideId,
      driverId: ride.driverId,
      properties: {
        ride_id: ride.rideId,
        origin: ride.origin,
        destination: ride.destination,
        departure_at: ride.departureAt.toISOString(),
        seats_total: ride.seatsTotal,
        cost_share_per_seat: ride.costSharePerSeat,
      },
    });
  }
}

// ===========================================================================
// Booking + funnel session generation
// ===========================================================================

type SessionCounters = {
  messagedTarget: number;
  messagedSoFar: number;
  rideViewedTotal: number;
  profileViewedTotal: number;
};

function makeBookingSession(
  rng: Rng,
  ride: Ride,
  passenger: SeedUser | null,
  seats: number,
  messaged: boolean,
  events: GeneratedEvent[],
  counters: SessionCounters,
  otherRideIdsSameCorridor: string[]
): Booking | null {
  const leadDays = sampleLeadDays(rng, ride.departureAt);
  const searchedAt = clampToTerm(atHour(addDays(ride.departureAt, -leadDays), rng));
  const sessionId = `sess_${seededUuid(rng)}`;
  const anonymousId = passenger ? `anon_${passenger.id}` : `anon_${seededUuid(rng)}`;
  const userId = passenger?.id ?? null;
  const campus = passenger?.campus ?? null;

  let t = searchedAt.getTime();
  const next = (minMinutes: number, maxMinutes: number) => {
    t += randInt(rng, minMinutes, maxMinutes) * 60_000;
    return new Date(t);
  };

  const resultsCount = randInt(rng, 1, 6);
  events.push({
    eventName: 'ride_searched',
    eventId: seededUuid(rng),
    userId,
    anonymousId,
    sessionId,
    occurredAt: searchedAt,
    campus,
    origin: ride.origin,
    destination: ride.destination,
    departureAt: ride.departureAt,
    rideId: null,
    driverId: null,
    properties: {
      origin: ride.origin,
      destination: ride.destination,
      departure_date: isoDate(ride.departureAt),
      seats_needed: seats,
      results_count: resultsCount,
    },
  });
  counters.rideViewedTotal++;

  const viewedRideIds = [ride.rideId, ...shuffle(rng, otherRideIdsSameCorridor).slice(0, randInt(rng, 0, 2))];
  viewedRideIds.forEach((rid, i) => {
    events.push({
      eventName: 'ride_viewed',
      eventId: seededUuid(rng),
      userId,
      anonymousId,
      sessionId,
      occurredAt: next(1, 4),
      campus,
      origin: ride.origin,
      destination: ride.destination,
      departureAt: ride.departureAt,
      rideId: rid,
      driverId: null,
      properties: { ride_id: rid, origin: ride.origin, destination: ride.destination, position_in_results: i },
    });
  });

  events.push({
    eventName: 'driver_profile_viewed',
    eventId: seededUuid(rng),
    userId,
    anonymousId,
    sessionId,
    occurredAt: next(1, 3),
    campus,
    origin: ride.origin,
    destination: ride.destination,
    departureAt: ride.departureAt,
    rideId: ride.rideId,
    driverId: ride.driverId,
    properties: {
      ride_id: ride.rideId,
      driver_id: ride.driverId,
      driver_rating: null,
      driver_trips_completed: 0,
    },
  });
  counters.profileViewedTotal++;

  if (messaged) {
    events.push({
      eventName: 'message_thread_started',
      eventId: seededUuid(rng),
      userId,
      anonymousId,
      sessionId,
      occurredAt: next(1, 5),
      campus,
      origin: ride.origin,
      destination: ride.destination,
      departureAt: ride.departureAt,
      rideId: ride.rideId,
      driverId: ride.driverId,
      properties: { ride_id: ride.rideId, driver_id: ride.driverId, initiator_role: 'passenger' },
    });
    counters.messagedSoFar++;
  }

  const reservedAt = next(1, 10);
  events.push({
    eventName: 'seat_reserved',
    eventId: seededUuid(rng),
    userId,
    anonymousId,
    sessionId,
    occurredAt: reservedAt,
    campus,
    origin: ride.origin,
    destination: ride.destination,
    departureAt: ride.departureAt,
    rideId: ride.rideId,
    driverId: ride.driverId,
    properties: { ride_id: ride.rideId, driver_id: ride.driverId, seats, cost_share_per_seat: ride.costSharePerSeat },
  });

  // ~87% of reservations complete into a booking (target: seat_reserved
  // 4180 vs booking_completed 3690). The rest end the session at
  // seat_reserved — an abandoned checkout, never a booking_id to cancel.
  if (!chance(rng, 0.87)) return null;

  const bookedAt = next(1, 3);
  const bookingId = `booking_${seededUuid(rng)}`;
  const paymentMethod = pick(rng, PAYMENT_METHODS);
  events.push({
    eventName: 'booking_completed',
    eventId: seededUuid(rng),
    userId,
    anonymousId,
    sessionId,
    occurredAt: bookedAt,
    campus,
    origin: ride.origin,
    destination: ride.destination,
    departureAt: ride.departureAt,
    rideId: ride.rideId,
    driverId: ride.driverId,
    properties: {
      ride_id: ride.rideId,
      driver_id: ride.driverId,
      booking_id: bookingId,
      seats,
      amount_cents: seats * ride.costSharePerSeat * 100,
      payment_method: paymentMethod,
    },
  });

  return {
    bookingId,
    passengerId: userId,
    sessionId,
    anonymousId,
    seats,
    messaged,
    searchedAt,
    bookedAt,
    paymentMethod,
  };
}

/** F7: 14% of bookings reuse a passenger the driver has carried before. */
function pickPassenger(
  rng: Rng,
  campus: Campus,
  passengerPool: SeedUser[],
  driverHistory: Map<string, string[]>,
  driverId: string,
  excludeIds: Set<string>
): SeedUser | null {
  const history = driverHistory.get(driverId) ?? [];
  if (history.length > 0 && chance(rng, 0.35)) {
    const candidate = history[randInt(rng, 0, history.length - 1)];
    if (!excludeIds.has(candidate)) {
      const u = passengerPool.find((p) => p.id === candidate);
      if (u) return u;
    }
  }
  for (let tries = 0; tries < 10; tries++) {
    const candidate = pick(rng, passengerPool);
    if (!excludeIds.has(candidate.id)) return candidate;
  }
  return null;
}

function bookRides(
  rng: Rng,
  rides: Ride[],
  cornellUsers: SeedUser[],
  binghamtonUsers: SeedUser[],
  events: GeneratedEvent[],
  counters: SessionCounters,
  driverHistory: Map<string, string[]>
): void {
  const cornellPassengers = cornellUsers.filter((u) => u.canRide);
  const binghamtonPassengers = binghamtonUsers.filter((u) => u.canRide);
  const ridesByCorridor = new Map<string, string[]>();
  for (const r of rides) {
    const key = `${r.origin}__${r.destination}`;
    if (!ridesByCorridor.has(key)) ridesByCorridor.set(key, []);
    ridesByCorridor.get(key)!.push(r.rideId);
  }

  for (const ride of rides) {
    const targetSeats = Math.min(ride.seatsTotal, Math.round(ride.seatsTotal * fillRateFor(ride.bucket)));
    const passengerPool = ride.campus === 'cornell' ? cornellPassengers : binghamtonPassengers;
    const excludeIds = new Set<string>();
    const key = `${ride.origin}__${ride.destination}`;
    const otherRideIds = (ridesByCorridor.get(key) ?? []).filter((id) => id !== ride.rideId);

    let booked = 0;
    let guard = 0;
    while (booked < targetSeats && guard < 20) {
      guard++;
      const remaining = targetSeats - booked;
      const seats = Math.min(seatsNeededFromDist(rng), remaining);
      const passenger = pickPassenger(rng, ride.campus, passengerPool, driverHistory, ride.driverId, excludeIds);
      if (!passenger) break;
      excludeIds.add(passenger.id);

      const messaged = counters.messagedSoFar < counters.messagedTarget && chance(rng, 0.92);
      const booking = makeBookingSession(rng, ride, passenger, seats, messaged, events, counters, otherRideIds);
      if (booking) {
        ride.bookings.push(booking);
        ride.seatsBooked += seats;
        booked += seats;

        const history = driverHistory.get(ride.driverId) ?? [];
        history.push(passenger.id);
        driverHistory.set(ride.driverId, history);
      }
    }
  }
}

/** F1 slices: demand is constructed directly (zero-result rate by fiat, bookings capped at listed capacity). */
function bookThanksgivingSlices(
  rng: Rng,
  slices: { slice: { origin: City; destination: City; dates: string[]; demandedSeats: number; zeroResultRate: number }; rideIds: string[] }[],
  rides: Ride[],
  cornellUsers: SeedUser[],
  events: GeneratedEvent[],
  counters: SessionCounters,
  driverHistory: Map<string, string[]>
): void {
  const passengers = cornellUsers.filter((u) => u.canRide);
  const rideById = new Map(rides.map((r) => [r.rideId, r] as const));

  for (const { slice, rideIds } of slices) {
    const sliceRides = rideIds.map((id) => rideById.get(id)!);
    const totalListed = sliceRides.reduce((s, r) => s + r.seatsTotal, 0);
    const searchEventCount = Math.round(slice.demandedSeats / 1.23);
    const zeroCount = Math.round(searchEventCount * slice.zeroResultRate);
    const successCount = searchEventCount - zeroCount;

    let capacityLeft = totalListed;
    let rideCursor = 0;
    const excludeByRide = new Map<string, Set<string>>();

    for (let i = 0; i < successCount; i++) {
      const seats = seatsNeededFromDist(rng);
      let ride: Ride | undefined;
      for (let tries = 0; tries < sliceRides.length; tries++) {
        const candidate = sliceRides[rideCursor % sliceRides.length];
        rideCursor++;
        if (candidate.seatsTotal - candidate.seatsBooked >= seats) {
          ride = candidate;
          break;
        }
      }
      if (!ride || capacityLeft < seats) {
        // Capacity exhausted: this "successful" search still gets a
        // results_count>0 browse, but nothing left to reserve.
        const filler = sliceRides[randInt(rng, 0, sliceRides.length - 1)];
        emitBrowseOnlySession(rng, filler, passengers, events, counters, sliceRides.map((r) => r.rideId));
        continue;
      }

      if (!excludeByRide.has(ride.rideId)) excludeByRide.set(ride.rideId, new Set());
      const passenger = pickPassenger(rng, 'cornell', passengers, driverHistory, ride.driverId, excludeByRide.get(ride.rideId)!);
      if (!passenger) continue;
      excludeByRide.get(ride.rideId)!.add(passenger.id);

      const messaged = counters.messagedSoFar < counters.messagedTarget && chance(rng, 0.92);
      const booking = makeBookingSession(
        rng,
        ride,
        passenger,
        seats,
        messaged,
        events,
        counters,
        sliceRides.map((r) => r.rideId)
      );
      if (booking) {
        ride.bookings.push(booking);
        ride.seatsBooked += seats;
        capacityLeft -= seats;

        const history = driverHistory.get(ride.driverId) ?? [];
        history.push(passenger.id);
        driverHistory.set(ride.driverId, history);
      }
    }

    for (let i = 0; i < zeroCount; i++) {
      emitZeroResultSession(rng, slice.origin, slice.destination, pick(rng, slice.dates), passengers, events);
    }
  }
}

function emitBrowseOnlySession(
  rng: Rng,
  ride: Ride,
  passengerPool: SeedUser[],
  events: GeneratedEvent[],
  counters: SessionCounters,
  otherRideIds: string[]
): void {
  const anonymous = chance(rng, 0.5);
  const passenger = anonymous ? null : pick(rng, passengerPool);
  const leadDays = sampleLeadDays(rng, ride.departureAt);
  const searchedAt = clampToTerm(atHour(addDays(ride.departureAt, -leadDays), rng));
  const sessionId = `sess_${seededUuid(rng)}`;
  const anonymousId = passenger ? `anon_${passenger.id}` : `anon_${seededUuid(rng)}`;

  events.push({
    eventName: 'ride_searched',
    eventId: seededUuid(rng),
    userId: passenger?.id ?? null,
    anonymousId,
    sessionId,
    occurredAt: searchedAt,
    campus: passenger?.campus ?? null,
    origin: ride.origin,
    destination: ride.destination,
    departureAt: ride.departureAt,
    rideId: null,
    driverId: null,
    properties: {
      origin: ride.origin,
      destination: ride.destination,
      departure_date: isoDate(ride.departureAt),
      seats_needed: seatsNeededFromDist(rng),
      results_count: randInt(rng, 1, 4),
    },
  });
  counters.rideViewedTotal++;

  const viewedRideIds = [ride.rideId, ...shuffle(rng, otherRideIds).slice(0, randInt(rng, 0, 2))];
  viewedRideIds.forEach((rid, i) => {
    events.push({
      eventName: 'ride_viewed',
      eventId: seededUuid(rng),
      userId: passenger?.id ?? null,
      anonymousId,
      sessionId,
      occurredAt: new Date(searchedAt.getTime() + (i + 1) * 60_000),
      campus: passenger?.campus ?? null,
      origin: ride.origin,
      destination: ride.destination,
      departureAt: ride.departureAt,
      rideId: rid,
      driverId: null,
      properties: { ride_id: rid, origin: ride.origin, destination: ride.destination, position_in_results: i },
    });
  });

  // Deliberately no driver_profile_viewed / message_thread_started here:
  // this is pure top-of-funnel padding (search volume, browse volume).
  // F2's 62%/31% rates are constructed precisely in
  // buildAbandonedEngagedSessions below, over a dedicated pool of
  // "reached driver_profile_viewed" sessions — mixing more profile views
  // in here would dilute that denominator uncontrollably.
}

/**
 * F2: explicit construction of the "engaged but did not book" population.
 * Real bookings (from bookRides / bookThanksgivingSlices) already fix how
 * many messaged-and-booked (M) and non-messaged-and-booked (T-M) sessions
 * exist. To land exactly on 62% / 31% conversion, this backfills the
 * matching non-converting cohorts: messagedTarget-M sessions that message
 * and then abandon, and enough non-messaged-but-profile-viewed sessions
 * that (T-M) / (that pool) ≈ 31%.
 */
function buildAbandonedEngagedSessions(
  rng: Rng,
  rides: Ride[],
  users: SeedUser[],
  events: GeneratedEvent[],
  messagedTarget: number,
  nonMessagedConversionRate: number
): void {
  const bookingSessions = new Set(events.filter((e) => e.eventName === 'booking_completed').map((e) => e.sessionId));
  const messagedSessionIds = new Set(events.filter((e) => e.eventName === 'message_thread_started').map((e) => e.sessionId));
  let messagedBooked = 0;
  for (const s of messagedSessionIds) if (bookingSessions.has(s)) messagedBooked++;
  const totalBooked = bookingSessions.size;
  const nonMessagedBooked = totalBooked - messagedBooked;

  const messagedAbandonCount = Math.max(0, messagedTarget - messagedSessionIds.size);
  const nonMessagedEngagedTotal = Math.round(nonMessagedBooked / nonMessagedConversionRate);
  const nonMessagedAbandonCount = Math.max(0, nonMessagedEngagedTotal - nonMessagedBooked);

  function emit(messaged: boolean) {
    const ride = pick(rng, rides);
    const passengerPool = ride.campus === 'cornell' ? users.filter((u) => u.campus === 'cornell' && u.canRide) : users.filter((u) => u.campus === 'binghamton' && u.canRide);
    // Mostly anonymous: a real booking always resolves to a real user
    // (handled elsewhere), but the much larger pool of engaged-then-
    // abandoned browse sessions shouldn't all resolve to campus-
    // attributed demand, or Cornell's mature-market liquidity ratio
    // (F4) becomes unhittable — real seat_reserved volume alone already
    // accounts for most of its demand budget.
    const passenger = chance(rng, 0.08) ? pick(rng, passengerPool) : null;
    const leadDays = sampleLeadDays(rng, ride.departureAt);
    const searchedAt = clampToTerm(atHour(addDays(ride.departureAt, -leadDays), rng));
    const sessionId = `sess_${seededUuid(rng)}`;
    const anonymousId = passenger ? `anon_${passenger.id}` : `anon_${seededUuid(rng)}`;
    const campus = passenger?.campus ?? null;
    let t = searchedAt.getTime();
    const next = (a: number, b: number) => {
      t += randInt(rng, a, b) * 60_000;
      return new Date(t);
    };

    events.push({
      eventName: 'ride_searched',
      eventId: seededUuid(rng),
      userId: passenger?.id ?? null,
      anonymousId,
      sessionId,
      occurredAt: searchedAt,
      campus,
      origin: ride.origin,
      destination: ride.destination,
      departureAt: ride.departureAt,
      rideId: null,
      driverId: null,
      properties: {
        origin: ride.origin,
        destination: ride.destination,
        departure_date: isoDate(ride.departureAt),
        seats_needed: seatsNeededFromDist(rng),
        results_count: randInt(rng, 1, 6),
      },
    });
    events.push({
      eventName: 'ride_viewed',
      eventId: seededUuid(rng),
      userId: passenger?.id ?? null,
      anonymousId,
      sessionId,
      occurredAt: next(1, 4),
      campus,
      origin: ride.origin,
      destination: ride.destination,
      departureAt: ride.departureAt,
      rideId: ride.rideId,
      driverId: null,
      properties: { ride_id: ride.rideId, origin: ride.origin, destination: ride.destination, position_in_results: 0 },
    });
    events.push({
      eventName: 'driver_profile_viewed',
      eventId: seededUuid(rng),
      userId: passenger?.id ?? null,
      anonymousId,
      sessionId,
      occurredAt: next(1, 3),
      campus,
      origin: ride.origin,
      destination: ride.destination,
      departureAt: ride.departureAt,
      rideId: ride.rideId,
      driverId: ride.driverId,
      properties: { ride_id: ride.rideId, driver_id: ride.driverId, driver_rating: null, driver_trips_completed: 0 },
    });
    if (messaged) {
      events.push({
        eventName: 'message_thread_started',
        eventId: seededUuid(rng),
        userId: passenger?.id ?? null,
        anonymousId,
        sessionId,
        occurredAt: next(1, 5),
        campus,
        origin: ride.origin,
        destination: ride.destination,
        departureAt: ride.departureAt,
        rideId: ride.rideId,
        driverId: ride.driverId,
        properties: { ride_id: ride.rideId, driver_id: ride.driverId, initiator_role: 'passenger' },
      });
    }
  }

  for (let i = 0; i < messagedAbandonCount; i++) emit(true);
  for (let i = 0; i < nonMessagedAbandonCount; i++) emit(false);
}

function emitZeroResultSession(
  rng: Rng,
  origin: City,
  destination: City,
  dateStr: string,
  passengerPool: SeedUser[],
  events: GeneratedEvent[]
): void {
  const anonymous = chance(rng, 0.6);
  const passenger = anonymous ? null : pick(rng, passengerPool);
  const departureAt = new Date(`${dateStr}T12:00:00.000Z`);
  const leadDays = sampleLeadDays(rng, departureAt);
  const searchedAt = clampToTerm(atHour(addDays(departureAt, -leadDays), rng));
  const sessionId = `sess_${seededUuid(rng)}`;
  const anonymousId = passenger ? `anon_${passenger.id}` : `anon_${seededUuid(rng)}`;
  const seatsNeeded = seatsNeededFromDist(rng);

  events.push({
    eventName: 'ride_searched',
    eventId: seededUuid(rng),
    userId: passenger?.id ?? null,
    anonymousId,
    sessionId,
    occurredAt: searchedAt,
    campus: passenger?.campus ?? null,
    origin,
    destination,
    departureAt,
    rideId: null,
    driverId: null,
    properties: { origin, destination, departure_date: dateStr, seats_needed: seatsNeeded, results_count: 0 },
  });
  events.push({
    eventName: 'search_returned_empty',
    eventId: seededUuid(rng),
    userId: passenger?.id ?? null,
    anonymousId,
    sessionId,
    occurredAt: new Date(searchedAt.getTime() + 1000),
    campus: passenger?.campus ?? null,
    origin,
    destination,
    departureAt,
    rideId: null,
    driverId: null,
    properties: { origin, destination, departure_date: dateStr, seats_needed: seatsNeeded },
  });
}

// ===========================================================================
// Volume padding: generic (non-Thanksgiving) zero-result searches, sized to
// hit the platform-wide search volume/zero-result targets, split across
// Cornell / Binghamton / anonymous per the F4 liquidity-ratio construction.
// ===========================================================================

/**
 * F4: liquidity_ratio = seats_listed / seats_demanded, targeted at 0.85
 * for Cornell and 0.42 for Binghamton. Real booking-track sessions already
 * contribute some campus-attributed demand; this tops up exactly the
 * shortfall needed to land on the ratio, as additional zero-result
 * searches (unmet demand is the honest reason a mature-vs-immature-market
 * gap shows up as a ratio in the first place).
 */
function buildCampusLiquidityPadding(
  rng: Rng,
  rides: Ride[],
  cornellUsers: SeedUser[],
  binghamtonUsers: SeedUser[],
  events: GeneratedEvent[]
): void {
  const targets: { campus: Campus; ratio: number; passengers: SeedUser[]; corridors: DirectedCorridor[] }[] = [
    {
      campus: 'cornell',
      ratio: 0.85,
      passengers: cornellUsers.filter((u) => u.canRide),
      corridors: DIRECTED_CORRIDORS,
    },
    {
      campus: 'binghamton',
      ratio: 0.42,
      passengers: binghamtonUsers.filter((u) => u.canRide),
      corridors: DIRECTED_CORRIDORS.filter((c) => c.origin === 'binghamton' || c.destination === 'binghamton'),
    },
  ];

  for (const { campus, ratio, passengers, corridors } of targets) {
    const listedSeats = sumSeatsForCampus(events, 'ride_listed', 'seats_total', campus);
    const demandedSoFar = sumSeatsForCampus(events, 'ride_searched', 'seats_needed', campus);
    const targetDemand = listedSeats / ratio;
    const neededSeats = Math.max(0, targetDemand - demandedSoFar);
    const neededEvents = Math.round(neededSeats / 1.23);

    for (let i = 0; i < neededEvents; i++) {
      const corridor = weightedPick(
        rng,
        corridors.map((c) => [c, c.share] as const)
      );
      const weekIdx = randInt(rng, 0, WEEKS.length - 1);
      let departureAt = pickDepartureDate(rng, weekIdx, corridor);
      if (isF1Corridor(corridor.origin, corridor.destination)) {
        // Keep this generic pool from contaminating the hand-tuned F1 slices.
        while (isF1Date(departureAt)) departureAt = pickDepartureDate(rng, weekIdx, corridor);
      }
      const leadDays = sampleLeadDays(rng, departureAt);
      const searchedAt = clampToTerm(atHour(addDays(departureAt, -leadDays), rng));
      const passenger = chance(rng, 0.55) && passengers.length > 0 ? pick(rng, passengers) : null;
      const anonymousId = passenger ? `anon_${passenger.id}` : `anon_${seededUuid(rng)}`;
      const sessionId = `sess_${seededUuid(rng)}`;
      const seatsNeeded = seatsNeededFromDist(rng);
      const rideRef = rides.find((r) => r.origin === corridor.origin && r.destination === corridor.destination);

      events.push({
        eventName: 'ride_searched',
        eventId: seededUuid(rng),
        userId: passenger?.id ?? null,
        anonymousId,
        sessionId,
        occurredAt: searchedAt,
        campus,
        origin: corridor.origin,
        destination: corridor.destination,
        departureAt,
        rideId: null,
        driverId: null,
        properties: {
          origin: corridor.origin,
          destination: corridor.destination,
          departure_date: isoDate(departureAt),
          seats_needed: seatsNeeded,
          results_count: rideRef ? randInt(rng, 0, 1) : 0,
        },
      });
      events.push({
        eventName: 'search_returned_empty',
        eventId: seededUuid(rng),
        userId: passenger?.id ?? null,
        anonymousId,
        sessionId,
        occurredAt: new Date(searchedAt.getTime() + 1000),
        campus,
        origin: corridor.origin,
        destination: corridor.destination,
        departureAt,
        rideId: null,
        driverId: null,
        properties: {
          origin: corridor.origin,
          destination: corridor.destination,
          departure_date: isoDate(departureAt),
          seats_needed: seatsNeeded,
        },
      });
    }
  }
}

function sumSeatsForCampus(events: GeneratedEvent[], eventName: string, key: string, campus: Campus): number {
  let sum = 0;
  for (const e of events) {
    if (e.eventName !== eventName || e.campus !== campus) continue;
    sum += Number((e.properties as Record<string, unknown>)[key] ?? 0);
  }
  return sum;
}

function buildGenericSearchPadding(
  rng: Rng,
  rides: Ride[],
  cornellUsers: SeedUser[],
  binghamtonUsers: SeedUser[],
  events: GeneratedEvent[],
  counters: SessionCounters,
  targetTotalSearchEvents: number
): void {
  const currentSearches = events.filter((e) => e.eventName === 'ride_searched').length;
  const remaining = Math.max(0, targetTotalSearchEvents - currentSearches);
  if (remaining === 0) return;

  const cornellPassengers = cornellUsers.filter((u) => u.canRide);
  const binghamtonPassengers = binghamtonUsers.filter((u) => u.canRide);
  const nonF1Rides = rides.filter((r) => !isF1Corridor(r.origin, r.destination) || !isF1Date(r.departureAt));
  const ridesByCorridor = new Map<string, Ride[]>();
  for (const r of nonF1Rides) {
    const key = `${r.origin}__${r.destination}`;
    if (!ridesByCorridor.has(key)) ridesByCorridor.set(key, []);
    ridesByCorridor.get(key)!.push(r);
  }

  for (let i = 0; i < remaining; i++) {
    const roll = rng();
    // Campus-attributed demand is already precisely tuned by
    // buildCampusLiquidityPadding above; this remaining pool is mostly
    // anonymous/pre-signup traffic so it doesn't skew the F4 ratios.
    const campus: Campus | null = roll < 0.04 ? 'cornell' : roll < 0.06 ? 'binghamton' : null;
    const corridorPool =
      campus === 'binghamton'
        ? DIRECTED_CORRIDORS.filter((c) => c.origin === 'binghamton' || c.destination === 'binghamton')
        : DIRECTED_CORRIDORS;
    const corridor = weightedPick(
      rng,
      corridorPool.map((c) => [c, c.share] as const)
    );
    const candidates = ridesByCorridor.get(`${corridor.origin}__${corridor.destination}`) ?? [];
    const passengerPool = campus === 'cornell' ? cornellPassengers : campus === 'binghamton' ? binghamtonPassengers : [];
    const passenger = campus && chance(rng, 0.5) && passengerPool.length > 0 ? pick(rng, passengerPool) : null;
    const anonymousId = passenger ? `anon_${passenger.id}` : `anon_${seededUuid(rng)}`;
    const sessionId = `sess_${seededUuid(rng)}`;
    const seatsNeeded = seatsNeededFromDist(rng);

    if (candidates.length === 0 || chance(rng, 0.22)) {
      // No supply on this corridor at all, or a random miss even where supply exists.
      const weekIdx = randInt(rng, 0, WEEKS.length - 1);
      let departureAt = pickDepartureDate(rng, weekIdx, corridor);
      if (isF1Corridor(corridor.origin, corridor.destination)) {
        while (isF1Date(departureAt)) departureAt = pickDepartureDate(rng, weekIdx, corridor);
      }
      const leadDays = sampleLeadDays(rng, departureAt);
      const searchedAt = clampToTerm(atHour(addDays(departureAt, -leadDays), rng));
      events.push({
        eventName: 'ride_searched',
        eventId: seededUuid(rng),
        userId: passenger?.id ?? null,
        anonymousId,
        sessionId,
        occurredAt: searchedAt,
        campus: passenger?.campus ?? campus,
        origin: corridor.origin,
        destination: corridor.destination,
        departureAt,
        rideId: null,
        driverId: null,
        properties: {
          origin: corridor.origin,
          destination: corridor.destination,
          departure_date: isoDate(departureAt),
          seats_needed: seatsNeeded,
          results_count: 0,
        },
      });
      events.push({
        eventName: 'search_returned_empty',
        eventId: seededUuid(rng),
        userId: passenger?.id ?? null,
        anonymousId,
        sessionId,
        occurredAt: new Date(searchedAt.getTime() + 1000),
        campus: passenger?.campus ?? campus,
        origin: corridor.origin,
        destination: corridor.destination,
        departureAt,
        rideId: null,
        driverId: null,
        properties: {
          origin: corridor.origin,
          destination: corridor.destination,
          departure_date: isoDate(departureAt),
          seats_needed: seatsNeeded,
        },
      });
      continue;
    }

    const ride = pick(rng, candidates);
    emitBrowseOnlySession(
      rng,
      ride,
      passengerPool.length > 0 ? passengerPool : cornellPassengers,
      events,
      counters,
      candidates.map((r) => r.rideId)
    );
  }
}

// ===========================================================================
// Post-trip: trip_completed vs ride_listing_expired, reviews, cancellations
// ===========================================================================

function buildPostTripEvents(rng: Rng, rides: Ride[], events: GeneratedEvent[]): void {
  const ranked = rides
    .slice()
    .sort((a, b) => a.seatsBooked / a.seatsTotal - b.seatsBooked / b.seatsTotal);
  const expiredCount = Math.round(rides.length * 0.1887); // ~268/1420
  const expiredIds = new Set(ranked.slice(0, expiredCount).map((r) => r.rideId));

  for (const ride of rides) {
    if (expiredIds.has(ride.rideId)) {
      events.push({
        eventName: 'ride_listing_expired',
        eventId: seededUuid(rng),
        userId: ride.driverId,
        anonymousId: `anon_${ride.driverId}`,
        sessionId: `sess_expire_${ride.rideId}`,
        occurredAt: clampToTerm(addDays(ride.departureAt, 1)),
        campus: ride.campus,
        origin: ride.origin,
        destination: ride.destination,
        departureAt: ride.departureAt,
        rideId: ride.rideId,
        driverId: ride.driverId,
        properties: { ride_id: ride.rideId, seats_total: ride.seatsTotal, seats_unfilled: ride.seatsTotal - ride.seatsBooked },
      });
    } else {
      events.push({
        eventName: 'trip_completed',
        eventId: seededUuid(rng),
        userId: ride.driverId,
        anonymousId: `anon_${ride.driverId}`,
        sessionId: `sess_trip_${ride.rideId}`,
        occurredAt: clampToTerm(addDays(ride.departureAt, 0)),
        campus: ride.campus,
        origin: ride.origin,
        destination: ride.destination,
        departureAt: ride.departureAt,
        rideId: ride.rideId,
        driverId: ride.driverId,
        properties: { ride_id: ride.rideId, driver_id: ride.driverId, seats_filled: ride.seatsBooked, seats_total: ride.seatsTotal },
      });
    }
  }
}

function buildReviews(rng: Rng, rides: Ride[], users: SeedUser[], events: GeneratedEvent[]): void {
  const usersById = new Map(users.map((u) => [u.id, u] as const));
  const ridesByDriver = new Map<string, Ride[]>();
  for (const r of rides) {
    if (!ridesByDriver.has(r.driverId)) ridesByDriver.set(r.driverId, []);
    ridesByDriver.get(r.driverId)!.push(r);
  }

  for (const [driverId, driverRides] of ridesByDriver) {
    const driver = usersById.get(driverId);
    if (!driver) continue;
    const bucket = driverRides[0].bucket;
    // Mid bucket is deliberately kept at 1-2 reviews, never 0 or >=3 —
    // either boundary would contaminate the F3 zero-review or veteran
    // cohorts with a bucket that has its own, different fill rate.
    const targetReviews = bucket === 'veteran' ? randInt(rng, 5, 8) : bucket === 'zero' ? 0 : randInt(rng, 1, 2);
    if (targetReviews === 0) continue;

    const completedRides = driverRides.filter((r) => r.bookings.length > 0);
    let emitted = 0;
    for (const ride of completedRides) {
      for (const booking of ride.bookings) {
        if (emitted >= targetReviews) break;
        if (!booking.passengerId) continue;
        const rating = gaussian(rng, driver.trueSkill, 0.3, 1, 5);
        events.push({
          eventName: 'review_submitted',
          eventId: seededUuid(rng),
          userId: booking.passengerId,
          anonymousId: `anon_${booking.passengerId}`,
          sessionId: `sess_review_${ride.rideId}_${emitted}`,
          occurredAt: clampToTerm(addDays(ride.departureAt, randInt(rng, 0, 3))),
          campus: ride.campus,
          origin: ride.origin,
          destination: ride.destination,
          departureAt: ride.departureAt,
          rideId: ride.rideId,
          driverId,
          properties: {
            ride_id: ride.rideId,
            reviewee_id: driverId,
            rating: Math.round(rating * 10) / 10,
            reviewer_role: 'passenger',
          },
        });
        driver.ratingSum += rating;
        driver.ratingCount++;
        emitted++;
      }
      if (emitted >= targetReviews) break;
    }
    driver.tripsCompleted = completedRides.length;
  }

  // A smaller volume of driver -> passenger reviews for realism (not F3-tested).
  for (const ride of rides) {
    for (const booking of ride.bookings) {
      if (!booking.passengerId) continue;
      if (!chance(rng, 0.4)) continue;
      events.push({
        eventName: 'review_submitted',
        eventId: seededUuid(rng),
        userId: ride.driverId,
        anonymousId: `anon_${ride.driverId}`,
        sessionId: `sess_review_d_${booking.bookingId}`,
        occurredAt: clampToTerm(addDays(ride.departureAt, randInt(rng, 0, 3))),
        campus: ride.campus,
        origin: ride.origin,
        destination: ride.destination,
        departureAt: ride.departureAt,
        rideId: ride.rideId,
        driverId: ride.driverId,
        properties: {
          ride_id: ride.rideId,
          reviewee_id: booking.passengerId,
          rating: Math.round(gaussian(rng, 4.7, 0.3, 1, 5) * 10) / 10,
          reviewer_role: 'driver',
        },
      });
    }
  }
}

/** F8: 10% of seat_reserved -> booking_cancelled, timed 62% >48h / 11% <6h / rest between. */
function buildCancellations(rng: Rng, events: GeneratedEvent[]): void {
  // F8 rate is defined against seat_reserved, not booking_completed —
  // reserved always outnumbers completed (some reservations abandon
  // before booking), so 10% of reserved is a larger absolute count than
  // 10% of completed.
  const reservedCount = events.filter((e) => e.eventName === 'seat_reserved').length;
  const bookings = events.filter((e) => e.eventName === 'booking_completed');
  const cancelCount = Math.min(bookings.length, Math.round(reservedCount * 0.1));
  const toCancel = shuffle(rng, bookings).slice(0, cancelCount);

  for (const booking of toCancel) {
    const props = booking.properties as { booking_id: string; ride_id: string };
    const bucketRoll = rng();
    const hoursBefore =
      bucketRoll < 0.62 ? randFloatLocal(rng, 49, 400) : bucketRoll < 0.73 ? randFloatLocal(rng, 0.5, 6) : randFloatLocal(rng, 6, 48);
    const departureAt = booking.departureAt!;
    const cancelledAt = new Date(departureAt.getTime() - hoursBefore * 60 * 60 * 1000);
    events.push({
      eventName: 'booking_cancelled',
      eventId: seededUuid(rng),
      userId: booking.userId,
      anonymousId: booking.anonymousId,
      sessionId: booking.sessionId,
      occurredAt: clampToTerm(cancelledAt),
      campus: booking.campus,
      origin: booking.origin,
      destination: booking.destination,
      departureAt: booking.departureAt,
      rideId: booking.rideId,
      driverId: booking.driverId,
      properties: {
        ride_id: props.ride_id,
        booking_id: props.booking_id,
        cancelled_by: chance(rng, 0.25) ? 'driver' : 'passenger',
        hours_before_departure: Math.round(hoursBefore * 10) / 10,
      },
    });
  }
}

function randFloatLocal(rng: Rng, min: number, max: number): number {
  return rng() * (max - min) + min;
}

/**
 * F4/F6: role duality (users who both listed and reserved) rate. Uniform
 * random driver/passenger selection alone converges well below the 23%
 * (Cornell) / 8% (Binghamton) targets — the two roles need to land on the
 * *same* both-persona users more often than chance. Rather than reweight
 * selection everywhere, this closes the gap directly: for both-persona
 * users missing one side, add the minimal missing event(s).
 */
function buildRoleDualityTopUp(rng: Rng, rides: Ride[], users: SeedUser[], events: GeneratedEvent[]): void {
  const targets: { campus: Campus; rate: number }[] = [
    { campus: 'cornell', rate: 0.23 },
    { campus: 'binghamton', rate: 0.08 },
  ];

  for (const { campus, rate } of targets) {
    const campusUsers = users.filter((u) => u.campus === campus);
    const bothPersona = campusUsers.filter((u) => u.persona === 'both');
    const targetCount = Math.round(campusUsers.length * rate);

    const listedBy = new Set(events.filter((e) => e.eventName === 'ride_listed').map((e) => e.userId));
    const reservedBy = new Set(events.filter((e) => e.eventName === 'seat_reserved').map((e) => e.userId));
    let currentBoth = bothPersona.filter((u) => listedBy.has(u.id) && reservedBy.has(u.id)).length;

    const candidates = shuffle(rng, bothPersona.filter((u) => !(listedBy.has(u.id) && reservedBy.has(u.id))));
    const corridorPool =
      campus === 'binghamton'
        ? DIRECTED_CORRIDORS.filter((c) => c.origin === 'binghamton' || c.destination === 'binghamton')
        : DIRECTED_CORRIDORS;

    for (const user of candidates) {
      if (currentBoth >= targetCount) break;

      if (!listedBy.has(user.id)) {
        const corridor = pick(rng, corridorPool);
        const weekIdx = randInt(rng, 0, WEEKS.length - 1);
        let departureAt = pickDepartureDate(rng, weekIdx, corridor);
        if (isF1Corridor(corridor.origin, corridor.destination)) {
          while (isF1Date(departureAt)) departureAt = pickDepartureDate(rng, weekIdx, corridor);
        }
        const ride = newRide(
          rng,
          rides,
          campus,
          user,
          corridor.origin,
          corridor.destination,
          departureAt,
          'mid',
          randInt(rng, corridor.costShare[0], corridor.costShare[1])
        );
        events.push({
          eventName: 'ride_listed',
          eventId: seededUuid(rng),
          userId: user.id,
          anonymousId: `anon_${user.id}`,
          sessionId: `sess_list_${ride.rideId}`,
          occurredAt: ride.listedAt,
          campus,
          origin: ride.origin,
          destination: ride.destination,
          departureAt: ride.departureAt,
          rideId: ride.rideId,
          driverId: user.id,
          properties: {
            ride_id: ride.rideId,
            origin: ride.origin,
            destination: ride.destination,
            departure_at: ride.departureAt.toISOString(),
            seats_total: ride.seatsTotal,
            cost_share_per_seat: ride.costSharePerSeat,
          },
        });
        listedBy.add(user.id);
      }

      if (!reservedBy.has(user.id)) {
        const openRides = rides.filter((r) => r.campus === campus && r.driverId !== user.id && r.seatsTotal > r.seatsBooked);
        const ride = openRides.length > 0 ? pick(rng, openRides) : pick(rng, rides.filter((r) => r.driverId !== user.id));
        const seats = 1;
        const sessionId = `sess_${seededUuid(rng)}`;
        const anonymousId = `anon_${user.id}`;
        const leadDays = sampleLeadDays(rng, ride.departureAt);
        const searchedAt = clampToTerm(atHour(addDays(ride.departureAt, -leadDays), rng));
        const bookedAt = new Date(searchedAt.getTime() + 60_000);
        const paymentMethod = pick(rng, PAYMENT_METHODS);
        const bookingId = `booking_${seededUuid(rng)}`;

        events.push({
          eventName: 'seat_reserved',
          eventId: seededUuid(rng),
          userId: user.id,
          anonymousId,
          sessionId,
          occurredAt: searchedAt,
          campus,
          origin: ride.origin,
          destination: ride.destination,
          departureAt: ride.departureAt,
          rideId: ride.rideId,
          driverId: ride.driverId,
          properties: { ride_id: ride.rideId, driver_id: ride.driverId, seats, cost_share_per_seat: ride.costSharePerSeat },
        });
        events.push({
          eventName: 'booking_completed',
          eventId: seededUuid(rng),
          userId: user.id,
          anonymousId,
          sessionId,
          occurredAt: bookedAt,
          campus,
          origin: ride.origin,
          destination: ride.destination,
          departureAt: ride.departureAt,
          rideId: ride.rideId,
          driverId: ride.driverId,
          properties: {
            ride_id: ride.rideId,
            driver_id: ride.driverId,
            booking_id: bookingId,
            seats,
            amount_cents: seats * ride.costSharePerSeat * 100,
            payment_method: paymentMethod,
          },
        });
        ride.seatsBooked += seats;
        ride.bookings.push({ bookingId, passengerId: user.id, sessionId, anonymousId, seats, messaged: false, searchedAt, bookedAt, paymentMethod });
        reservedBy.add(user.id);
      }

      if (listedBy.has(user.id) && reservedBy.has(user.id)) currentBoth++;
    }
  }
}

// ===========================================================================
// Top-level orchestration
// ===========================================================================

export function generate(seed: number): GeneratedDataset {
  const rng = mulberry32(seed);
  const users = generateUsers(rng);
  const cornellUsers = users.filter((u) => u.campus === 'cornell');
  const binghamtonUsers = users.filter((u) => u.campus === 'binghamton');
  const drivers = users.filter((u) => u.canDrive);
  const buckets = assignDriverBuckets(rng, drivers);

  const events: GeneratedEvent[] = [];

  for (const u of users) {
    events.push({
      eventName: 'user_signed_up',
      eventId: seededUuid(rng),
      userId: u.id,
      anonymousId: `anon_${u.id}`,
      sessionId: `sess_signup_${u.id}`,
      occurredAt: u.signupDate,
      campus: u.campus,
      origin: null,
      destination: null,
      departureAt: null,
      rideId: null,
      driverId: null,
      properties: { campus: u.campus, edu_domain: u.eduDomain, referral_source: u.referralSource },
    });
  }

  const rides: Ride[] = [];
  buildGenericRides(rng, rides, cornellUsers, binghamtonUsers, buckets);
  const thanksgivingSlices = buildThanksgivingRides(rng, rides, cornellUsers, buckets);
  buildRideListedEvents(rng, rides, events);

  // Real-booking messaging is capped below the overall 3240 target: at an
  // ~87% reservation-completion rate, capping real attempts at ~2309 yields
  // ~2009 messaged-and-booked sessions (62% of 3240). The remaining ~1231
  // messaged sessions are backfilled as message-then-abandon by
  // buildAbandonedEngagedSessions, so the *overall* messaged count still
  // lands on 3240.
  const counters: SessionCounters = { messagedTarget: 2309, messagedSoFar: 0, rideViewedTotal: 0, profileViewedTotal: 0 };
  const driverHistory = new Map<string, string[]>();

  bookThanksgivingSlices(rng, thanksgivingSlices, rides, cornellUsers, events, counters, driverHistory);
  const genericRides = rides.filter((r) => !thanksgivingSlices.some((s) => s.rideIds.includes(r.rideId)));
  bookRides(rng, genericRides, cornellUsers, binghamtonUsers, events, counters, driverHistory);

  buildAbandonedEngagedSessions(rng, genericRides, users, events, 3240, 0.31);
  buildCampusLiquidityPadding(rng, genericRides, cornellUsers, binghamtonUsers, events);
  buildGenericSearchPadding(rng, rides, cornellUsers, binghamtonUsers, events, counters, 12400);
  buildRoleDualityTopUp(rng, rides, users, events);
  buildPostTripEvents(rng, rides, events);
  buildReviews(rng, rides, users, events);
  buildCancellations(rng, events);

  return { users, rides, events };
}

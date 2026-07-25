import { generate, type GeneratedEvent } from './lib/generate';

const start = Date.now();
const { users, rides, events } = generate(20250929);
console.log(`generated in ${Date.now() - start}ms`);
console.log(`users=${users.length} rides=${rides.length} events=${events.length}`);

const counts = new Map<string, number>();
for (const e of events) counts.set(e.eventName, (counts.get(e.eventName) ?? 0) + 1);
const targets: Record<string, number> = {
  user_signed_up: 2400,
  ride_searched: 12400,
  search_returned_empty: 2150,
  ride_listed: 1420,
  ride_viewed: 19600,
  driver_profile_viewed: 7300,
  message_thread_started: 3240,
  seat_reserved: 4180,
  booking_completed: 3690,
  booking_cancelled: 415,
  ride_listing_expired: 268,
  trip_completed: 1152,
  review_submitted: 2870,
};
console.log('\nevent counts vs targets:');
for (const [name, target] of Object.entries(targets)) {
  const actual = counts.get(name) ?? 0;
  const pct = (((actual - target) / target) * 100).toFixed(1);
  console.log(`  ${name.padEnd(24)} actual=${String(actual).padEnd(6)} target=${target.toString().padEnd(6)} (${pct}%)`);
}

// ---------------------------------------------------------------------------
// Planted findings, computed in-memory (fast iteration loop before wiring
// the real SQL version into verify-seed.ts).
// ---------------------------------------------------------------------------
console.log('\n--- planted findings ---');

function byName(name: string): GeneratedEvent[] {
  return events.filter((e) => e.eventName === name);
}
function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function sumSeats(evts: GeneratedEvent[], key: string): number {
  return evts.reduce((s, e) => s + Number((e.properties as Record<string, unknown>)[key] ?? 0), 0);
}

// F1: Thanksgiving directional asymmetry
function f1Slice(origin: string, destination: string, dates: string[]) {
  const searched = byName('ride_searched').filter(
    (e) => e.origin === origin && e.destination === destination && dates.includes(iso(e.departureAt!))
  );
  const empty = byName('search_returned_empty').filter(
    (e) => e.origin === origin && e.destination === destination && dates.includes(iso(e.departureAt!))
  );
  const listed = byName('ride_listed').filter(
    (e) => e.origin === origin && e.destination === destination && dates.includes(iso(e.departureAt!))
  );
  const booked = byName('booking_completed').filter(
    (e) => e.origin === origin && e.destination === destination && dates.includes(iso(e.departureAt!))
  );
  const seatsDemanded = sumSeats(searched, 'seats_needed');
  const seatsListed = sumSeats(listed, 'seats_total');
  const seatsBooked = sumSeats(booked, 'seats');
  return {
    ratio: seatsDemanded / Math.max(seatsListed, 1),
    zeroRate: empty.length / Math.max(searched.length, 1),
    fillRate: seatsBooked / Math.max(seatsListed, 1),
    seatsDemanded,
    seatsListed,
    seatsBooked,
    searches: searched.length,
  };
}
const f1Out = f1Slice('ithaca', 'nyc', ['2025-11-25', '2025-11-26']);
const f1OutReturn = f1Slice('nyc', 'ithaca', ['2025-11-25', '2025-11-26']);
const f1Return = f1Slice('nyc', 'ithaca', ['2025-11-30', '2025-12-01']);
const f1ReturnOut = f1Slice('ithaca', 'nyc', ['2025-11-30', '2025-12-01']);
console.log('F1 outbound ithaca->nyc (Nov25-26): ratio', f1Out.ratio.toFixed(2), 'target 2.9-3.5; zeroRate', (f1Out.zeroRate * 100).toFixed(1) + '%', 'target ~38%');
console.log('F1 outbound nyc->ithaca (Nov25-26): fillRate', (f1OutReturn.fillRate * 100).toFixed(1) + '%', 'target ~34%');
console.log('F1 return nyc->ithaca (Nov30-Dec1): ratio', f1Return.ratio.toFixed(2), 'target ~2.7; zeroRate', (f1Return.zeroRate * 100).toFixed(1) + '%', 'target ~36%');
console.log('F1 return ithaca->nyc (Nov30-Dec1): fillRate', (f1ReturnOut.fillRate * 100).toFixed(1) + '%', 'target ~31%');

// F2: messaging lift. Scoped to sessions that reached driver_profile_viewed
// (the point at which messaging first becomes possible) rather than every
// ride_searched — a session that bounced before ever considering a driver
// couldn't have messaged either way, so it isn't part of this comparison.
const engagedSessions = new Set(byName('driver_profile_viewed').map((e) => e.sessionId));
const messagedSessions = new Set(byName('message_thread_started').map((e) => e.sessionId));
const bookedSessions = new Set(byName('booking_completed').map((e) => e.sessionId));
let msgTotal = 0, msgBooked = 0, noMsgTotal = 0, noMsgBooked = 0;
for (const s of engagedSessions) {
  if (messagedSessions.has(s)) {
    msgTotal++;
    if (bookedSessions.has(s)) msgBooked++;
  } else {
    noMsgTotal++;
    if (bookedSessions.has(s)) noMsgBooked++;
  }
}
console.log(`\nF2 messaged conversion: ${((msgBooked / msgTotal) * 100).toFixed(1)}% (target 62%, n=${msgTotal})`);
console.log(`F2 non-messaged conversion: ${((noMsgBooked / noMsgTotal) * 100).toFixed(1)}% (target 31%, n=${noMsgTotal})`);

// F3: review lift on fill rate
const reviewCountByDriver = new Map<string, number>();
for (const e of byName('review_submitted')) {
  if ((e.properties as Record<string, unknown>).reviewer_role !== 'passenger') continue;
  const driverId = e.driverId!;
  reviewCountByDriver.set(driverId, (reviewCountByDriver.get(driverId) ?? 0) + 1);
}
const seatsByDriver = new Map<string, { listed: number; booked: number }>();
for (const ride of rides) {
  const cur = seatsByDriver.get(ride.driverId) ?? { listed: 0, booked: 0 };
  cur.listed += ride.seatsTotal;
  cur.booked += ride.seatsBooked;
  seatsByDriver.set(ride.driverId, cur);
}
function fillRateForDrivers(pred: (n: number) => boolean) {
  let listed = 0, booked = 0, n = 0;
  for (const [driverId, seats] of seatsByDriver) {
    const reviews = reviewCountByDriver.get(driverId) ?? 0;
    if (pred(reviews)) {
      listed += seats.listed;
      booked += seats.booked;
      n++;
    }
  }
  return { rate: booked / Math.max(listed, 1), n };
}
const veteranFill = fillRateForDrivers((n) => n >= 3);
const zeroFill = fillRateForDrivers((n) => n === 0);
console.log(`\nF3 drivers >=3 reviews fill rate: ${(veteranFill.rate * 100).toFixed(1)}% (target 78%, n=${veteranFill.n})`);
console.log(`F3 drivers 0 reviews fill rate: ${(zeroFill.rate * 100).toFixed(1)}% (target 41%, n=${zeroFill.n})`);

// F4: campus comparison
function liquidityForCampus(campus: string) {
  const listed = sumSeats(byName('ride_listed').filter((e) => e.campus === campus), 'seats_total');
  const demanded = sumSeats(byName('ride_searched').filter((e) => e.campus === campus), 'seats_needed');
  return listed / Math.max(demanded, 1);
}
console.log(`\nF4 Cornell liquidity ratio: ${liquidityForCampus('cornell').toFixed(2)} (target 0.85)`);
console.log(`F4 Binghamton liquidity ratio: ${liquidityForCampus('binghamton').toFixed(2)} (target 0.42)`);

function roleDualityForCampus(campus: string) {
  const campusUsers = users.filter((u) => u.campus === campus);
  const listedBy = new Set(byName('ride_listed').map((e) => e.userId));
  const reservedBy = new Set(byName('seat_reserved').map((e) => e.userId));
  const both = campusUsers.filter((u) => listedBy.has(u.id) && reservedBy.has(u.id));
  return both.length / campusUsers.length;
}
console.log(`F4 Cornell role duality: ${(roleDualityForCampus('cornell') * 100).toFixed(1)}% (target 23%)`);
console.log(`F4 Binghamton role duality: ${(roleDualityForCampus('binghamton') * 100).toFixed(1)}% (target 8%)`);

// F6: overall role duality
const listedBy = new Set(byName('ride_listed').map((e) => e.userId));
const reservedBy = new Set(byName('seat_reserved').map((e) => e.userId));
const bothOverall = users.filter((u) => listedBy.has(u.id) && reservedBy.has(u.id));
console.log(`\nF6 overall role duality: ${((bothOverall.length / users.length) * 100).toFixed(1)}% (target ~21%)`);

// F5: lead time
function leadTimeDays(e: GeneratedEvent): number {
  return (e.departureAt!.getTime() - e.occurredAt.getTime()) / 86_400_000;
}
const allBookings = byName('booking_completed');
const tgBookings = allBookings.filter((e) => {
  const d = iso(e.departureAt!);
  return d >= '2025-11-22' && d <= '2025-11-30';
});
const baseBookings = allBookings.filter((e) => !tgBookings.includes(e));
function median(nums: number[]): number {
  const s = nums.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
function percentile(nums: number[], p: number): number {
  const s = nums.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length * p)];
}
const baseLead = baseBookings.map(leadTimeDays);
const tgLead = tgBookings.map(leadTimeDays);
const allLead = allBookings.map(leadTimeDays);
console.log(`\nF5 baseline median lead time: ${median(baseLead).toFixed(1)} days (target 6)`);
console.log(`F5 Thanksgiving median lead time: ${median(tgLead).toFixed(1)} days (target 19, n=${tgLead.length})`);
console.log(`F5 overall p90 lead time: ${percentile(allLead, 0.9).toFixed(1)} days (target 31)`);

// F7: repeat pairing
const pairSeen = new Set<string>();
let repeatCount = 0;
const bookingsSorted = byName('booking_completed').slice().sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
for (const b of bookingsSorted) {
  const key = `${b.driverId}__${b.userId}`;
  if (pairSeen.has(key)) repeatCount++;
  pairSeen.add(key);
}
console.log(`\nF7 repeat pairing rate: ${((repeatCount / bookingsSorted.length) * 100).toFixed(1)}% (target 14%)`);

// F8: cancellations
const cancellations = byName('booking_cancelled');
const reservedTotal = byName('seat_reserved').length;
const over48 = cancellations.filter((e) => Number((e.properties as Record<string, unknown>).hours_before_departure) > 48).length;
const under6 = cancellations.filter((e) => Number((e.properties as Record<string, unknown>).hours_before_departure) < 6).length;
console.log(`\nF8 cancellation rate vs seat_reserved: ${((cancellations.length / reservedTotal) * 100).toFixed(1)}% (target 10%)`);
console.log(`F8 >48h before: ${((over48 / cancellations.length) * 100).toFixed(1)}% (target 62%)`);
console.log(`F8 <6h before: ${((under6 / cancellations.length) * 100).toFixed(1)}% (target 11%)`);

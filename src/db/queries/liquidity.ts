import { sql } from 'drizzle-orm';
import type { City } from '@kamel-pulse/analytics';
import { db } from '@/db/client';
import { WEEKS, CALENDAR_EVENTS } from '@/lib/calendar';
import { corridorLabel, isOutboundDirection, pairKey } from '@/lib/corridors';

function toRows<T = Record<string, string>>(result: Awaited<ReturnType<typeof db.execute>>): T[] {
  return result.rows as unknown as T[];
}

export type MetricStrip = {
  unservedSeatRequests: number;
  unsoldSeats: number;
  roleDualityRate: number;
  medianLeadTimeDays: number;
};

export async function getMetricStrip(): Promise<MetricStrip> {
  const stats = await db.execute(sql`
    SELECT
      (SELECT COALESCE(SUM((properties->>'seats_needed')::int), 0) FROM events WHERE event_name = 'search_returned_empty') AS unserved,
      (SELECT COALESCE(SUM((properties->>'seats_unfilled')::int), 0) FROM events WHERE event_name = 'ride_listing_expired') AS unsold,
      (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (departure_at - occurred_at)) / 86400)
        FROM events WHERE event_name = 'booking_completed') AS median_lead
  `);
  const duality = await db.execute(sql`
    WITH listed AS (SELECT DISTINCT user_id FROM events WHERE event_name = 'ride_listed'),
    reserved AS (SELECT DISTINCT user_id FROM events WHERE event_name = 'seat_reserved'),
    total_users AS (SELECT COUNT(*) AS n FROM events WHERE event_name = 'user_signed_up')
    SELECT
      (SELECT n FROM total_users) AS total,
      (SELECT COUNT(*) FROM listed l JOIN reserved r ON r.user_id = l.user_id) AS both_count
  `);
  const s = toRows(stats)[0];
  const d = toRows(duality)[0];
  return {
    unservedSeatRequests: Number(s.unserved),
    unsoldSeats: Number(s.unsold),
    roleDualityRate: Number(d.both_count) / Math.max(Number(d.total), 1),
    medianLeadTimeDays: Number(s.median_lead),
  };
}

export type HeatmapCell = {
  origin: City;
  destination: City;
  weekIdx: number; // 0-11
  seatsDemanded: number;
  seatsListed: number;
  seatsBooked: number;
  searches: number;
  emptySearches: number;
  unmetDemandRatio: number;
  fillRate: number;
  zeroResultRate: number;
  insufficientData: boolean;
};

// Below this many listed seats, unmetDemandRatio divides by a near-empty
// denominator and swings wildly on a handful of searches — not a real
// signal. Cells this thin render as "insufficient data" instead of a color.
const MIN_LISTED_FOR_RATIO = 10;

export type CorridorPairRow = {
  pairKey: string;
  label: string;
  totalVolume: number;
  outbound: { origin: City; destination: City; cells: HeatmapCell[] };
  return: { origin: City; destination: City; cells: HeatmapCell[] };
};

function weekIndexForStart(weekStart: string): number {
  const idx = WEEKS.findIndex((w) => w.start === weekStart);
  return idx === -1 ? 0 : idx;
}

export async function getHeatmapData(): Promise<CorridorPairRow[]> {
  const result = await db.execute(sql`
    SELECT origin, destination, week_start::text AS week_start, seats_demanded, seats_listed, seats_booked, searches, empty_searches
    FROM corridor_week_rollup
    WHERE origin IS NOT NULL AND destination IS NOT NULL
    ORDER BY origin, destination, week_start
  `);
  const rows = toRows(result);

  const cellsByCorridor = new Map<string, HeatmapCell[]>();
  for (const r of rows) {
    const origin = r.origin as unknown as City;
    const destination = r.destination as unknown as City;
    const key = `${origin}__${destination}`;
    const seatsDemanded = Number((r as unknown as Record<string, unknown>).seats_demanded ?? 0);
    const seatsListed = Number((r as unknown as Record<string, unknown>).seats_listed ?? 0);
    const seatsBooked = Number((r as unknown as Record<string, unknown>).seats_booked ?? 0);
    const searches = Number((r as unknown as Record<string, unknown>).searches ?? 0);
    const emptySearches = Number((r as unknown as Record<string, unknown>).empty_searches ?? 0);
    const cell: HeatmapCell = {
      origin,
      destination,
      weekIdx: weekIndexForStart((r as unknown as Record<string, string>).week_start),
      seatsDemanded,
      seatsListed,
      seatsBooked,
      searches,
      emptySearches,
      unmetDemandRatio: seatsDemanded / Math.max(seatsListed, 1),
      fillRate: seatsBooked / Math.max(seatsListed, 1),
      zeroResultRate: emptySearches / Math.max(searches, 1),
      insufficientData: seatsListed < MIN_LISTED_FOR_RATIO,
    };
    if (!cellsByCorridor.has(key)) cellsByCorridor.set(key, []);
    cellsByCorridor.get(key)!.push(cell);
  }

  const pairs = new Map<string, CorridorPairRow>();
  for (const [key, cells] of cellsByCorridor) {
    const [origin, destination] = key.split('__') as [City, City];
    const pk = pairKey(origin, destination);
    const volume = cells.reduce((s, c) => s + c.seatsDemanded + c.seatsListed, 0);
    if (!pairs.has(pk)) {
      pairs.set(pk, {
        pairKey: pk,
        label: '',
        totalVolume: 0,
        outbound: { origin, destination, cells: [] },
        return: { origin, destination, cells: [] },
      });
    }
    const pair = pairs.get(pk)!;
    pair.totalVolume += volume;
    if (isOutboundDirection(origin, destination)) {
      pair.outbound = { origin, destination, cells };
      pair.label = corridorLabel(origin, destination).split(' → ')[0] + ' ↔ ' + corridorLabel(origin, destination).split(' → ')[1];
    } else {
      pair.return = { origin, destination, cells };
    }
  }

  return Array.from(pairs.values())
    .filter((p) => p.outbound.cells.length > 0 || p.return.cells.length > 0)
    .sort((a, b) => b.totalVolume - a.totalVolume);
}

export type Asymmetry = {
  pairLabel: string;
  weekLabel: string;
  highOrigin: City;
  highDestination: City;
  highRatio: number;
  lowOrigin: City;
  lowDestination: City;
  lowFillRate: number;
};

/** Largest directional split found in the data: the pair+week where the two
 *  directions' unmet-demand ratios diverge the most. Computed, not hardcoded. */
export function findBiggestAsymmetry(pairs: CorridorPairRow[]): Asymmetry | null {
  let best: Asymmetry | null = null;
  let bestScore = -Infinity;

  // Restrict to the higher-traffic half of corridor pairs: a founder-credible
  // "biggest asymmetry" should come from a corridor with real volume, not a
  // single small-sample week on a minor route. `pairs` is already sorted by
  // volume descending (getHeatmapData).
  const eligiblePairs = pairs.slice(0, Math.max(1, Math.ceil(pairs.length / 2)));

  for (const pair of eligiblePairs) {
    for (const outCell of pair.outbound.cells) {
      const retCell = pair.return.cells.find((c) => c.weekIdx === outCell.weekIdx);
      if (!retCell) continue;
      const [high, low] = outCell.unmetDemandRatio >= retCell.unmetDemandRatio ? [outCell, retCell] : [retCell, outCell];
      // Ignore noise from near-empty cells on both sides — a single tiny
      // listing can produce a huge ratio that isn't actually a pattern.
      if (high.seatsDemanded < 50 || high.seatsListed < 20 || low.seatsListed < 15) continue;
      // Weighted by volume so a small corridor's sampling noise (a big ratio
      // spread on a handful of searches) can't outrank a real, high-traffic
      // asymmetry — the story should be about scale, not a fluke.
      const score = (high.unmetDemandRatio - low.unmetDemandRatio) * high.seatsDemanded;
      if (score > bestScore) {
        bestScore = score;
        best = {
          pairLabel: pair.label,
          weekLabel: WEEKS[high.weekIdx].label,
          highOrigin: high.origin,
          highDestination: high.destination,
          highRatio: high.unmetDemandRatio,
          lowOrigin: low.origin,
          lowDestination: low.destination,
          lowFillRate: low.fillRate,
        };
      }
    }
  }
  return best;
}

export function asymmetrySentence(a: Asymmetry): string {
  return `The week of ${a.weekLabel}, ${corridorLabel(a.highOrigin, a.highDestination)} had ${a.highRatio.toFixed(1)} seat-requests for every seat listed while ${corridorLabel(a.lowOrigin, a.lowDestination)} filled only ${Math.round(a.lowFillRate * 100)}% of its seats. Drivers and passengers are moving in the same direction on the same days.`;
}

export type CorridorFillRate = {
  origin: City;
  destination: City;
  label: string;
  fillRate: number;
  seatsListed: number;
  seatsBooked: number;
};

export async function getFillRateByCorridor(): Promise<{ corridors: CorridorFillRate[]; platformMean: number }> {
  const result = await db.execute(sql`
    SELECT origin, destination, SUM(seats_listed) AS listed, SUM(seats_booked) AS booked
    FROM corridor_week_rollup
    WHERE origin IS NOT NULL AND destination IS NOT NULL
    GROUP BY origin, destination
  `);
  const rows = toRows(result);
  let totalListed = 0;
  let totalBooked = 0;
  const corridors: CorridorFillRate[] = rows.map((r) => {
    const origin = (r as unknown as Record<string, unknown>).origin as City;
    const destination = (r as unknown as Record<string, unknown>).destination as City;
    const listed = Number((r as unknown as Record<string, unknown>).listed ?? 0);
    const booked = Number((r as unknown as Record<string, unknown>).booked ?? 0);
    totalListed += listed;
    totalBooked += booked;
    return { origin, destination, label: corridorLabel(origin, destination), fillRate: booked / Math.max(listed, 1), seatsListed: listed, seatsBooked: booked };
  });
  corridors.sort((a, b) => a.fillRate - b.fillRate);
  return { corridors, platformMean: totalBooked / Math.max(totalListed, 1) };
}

export type LeadTimeBucket = { label: string; baseline: number; breakWeek: number };

const LEAD_TIME_BUCKET_LABELS = ['0-1', '2-3', '4-7', '8-14', '15-21', '22-30', '31+'];

export async function getLeadTimeHistogram(): Promise<LeadTimeBucket[]> {
  const breakRanges = CALENDAR_EVENTS.map((e) => sql`(departure_at::date BETWEEN ${e.start} AND ${e.end})`);
  const isBreak = sql.join(breakRanges, sql` OR `);
  const result = await db.execute(sql`
    WITH lt AS (
      SELECT
        EXTRACT(EPOCH FROM (departure_at - occurred_at)) / 86400 AS days,
        (${isBreak}) AS is_break
      FROM events WHERE event_name = 'booking_completed'
    )
    SELECT
      CASE
        WHEN days <= 1 THEN '0-1' WHEN days <= 3 THEN '2-3' WHEN days <= 7 THEN '4-7'
        WHEN days <= 14 THEN '8-14' WHEN days <= 21 THEN '15-21' WHEN days <= 30 THEN '22-30'
        ELSE '31+'
      END AS bucket,
      is_break,
      COUNT(*) AS n
    FROM lt
    GROUP BY bucket, is_break
  `);
  const rows = toRows(result);
  const buckets: Record<string, LeadTimeBucket> = {};
  for (const label of LEAD_TIME_BUCKET_LABELS) buckets[label] = { label, baseline: 0, breakWeek: 0 };
  for (const r of rows) {
    const rr = r as unknown as Record<string, unknown>;
    const bucket = buckets[rr.bucket as string];
    if (!bucket) continue;
    if (rr.is_break) bucket.breakWeek = Number(rr.n);
    else bucket.baseline = Number(rr.n);
  }
  return LEAD_TIME_BUCKET_LABELS.map((l) => buckets[l]);
}

export type CampusComparison = {
  campus: 'cornell' | 'binghamton';
  liquidityRatio: number;
  roleDualityRate: number;
  medianLeadTimeDays: number;
  fillRate: number;
};

export async function getCampusComparison(): Promise<CampusComparison[]> {
  const out: CampusComparison[] = [];
  for (const campus of ['cornell', 'binghamton'] as const) {
    const result = await db.execute(sql`
      WITH rides AS (
        SELECT properties->>'ride_id' AS ride_id, (properties->>'seats_total')::int AS seats_total
        FROM events WHERE event_name = 'ride_listed' AND campus = ${campus}
      ),
      -- Aggregated per ride before joining: a ride with N bookings must not
      -- multiply its seats_total by N when summed against rides.
      booked_per_ride AS (
        SELECT b.properties->>'ride_id' AS ride_id, SUM((b.properties->>'seats')::int) AS seats
        FROM events b
        JOIN rides r ON r.ride_id = b.properties->>'ride_id'
        WHERE b.event_name = 'booking_completed'
        GROUP BY b.properties->>'ride_id'
      ),
      demand AS (
        SELECT COALESCE(SUM((properties->>'seats_needed')::int), 0) AS demanded
        FROM events WHERE event_name = 'ride_searched' AND campus = ${campus}
      ),
      duality AS (
        WITH campus_users AS (SELECT DISTINCT user_id FROM events WHERE campus = ${campus} AND user_id IS NOT NULL),
        listed AS (SELECT DISTINCT user_id FROM events WHERE event_name = 'ride_listed'),
        reserved AS (SELECT DISTINCT user_id FROM events WHERE event_name = 'seat_reserved')
        SELECT
          (SELECT COUNT(*) FROM campus_users) AS total,
          (SELECT COUNT(*) FROM campus_users cu JOIN listed l ON l.user_id = cu.user_id JOIN reserved r ON r.user_id = cu.user_id) AS both_count
      ),
      lead AS (
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (departure_at - occurred_at)) / 86400) AS median_lead
        FROM events WHERE event_name = 'booking_completed' AND campus = ${campus}
      )
      SELECT
        COALESCE(SUM(rides.seats_total), 0) AS listed,
        COALESCE(SUM(booked_per_ride.seats), 0) AS booked,
        (SELECT demanded FROM demand) AS demanded,
        (SELECT total FROM duality) AS duality_total,
        (SELECT both_count FROM duality) AS duality_both,
        (SELECT median_lead FROM lead) AS median_lead
      FROM rides LEFT JOIN booked_per_ride USING (ride_id)
    `);
    const r = toRows(result)[0] as unknown as Record<string, unknown>;
    const listed = Number(r.listed);
    const booked = Number(r.booked);
    const demanded = Number(r.demanded);
    out.push({
      campus,
      liquidityRatio: listed / Math.max(demanded, 1),
      roleDualityRate: Number(r.duality_both) / Math.max(Number(r.duality_total), 1),
      medianLeadTimeDays: Number(r.median_lead) || 0,
      fillRate: booked / Math.max(listed, 1),
    });
  }
  return out;
}

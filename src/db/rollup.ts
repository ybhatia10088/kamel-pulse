import { sql } from 'drizzle-orm';
import { db } from './client';

// Section 11.5: the heatmap and corridor charts read from this rollup, not
// raw events — corridor/week aggregation over 60k+ rows on every page load
// would mean a sequential scan per request. Refreshed once at the end of
// `pnpm seed`. Cancelled bookings are excluded from seats_booked per the
// seats_booked metric definition (11.3).
export const DROP_ROLLUP_SQL = sql`DROP MATERIALIZED VIEW IF EXISTS corridor_week_rollup`;

export const CORRIDOR_WEEK_ROLLUP_SQL = sql`
  CREATE MATERIALIZED VIEW corridor_week_rollup AS
  WITH weekified AS (
    SELECT
      origin, destination, event_name, properties,
      ('2025-09-29'::date + (LEAST(GREATEST(FLOOR(EXTRACT(EPOCH FROM (departure_at - '2025-09-29T00:00:00Z'::timestamptz)) / 604800), 0), 11) * 7)::int)::date AS week_start
    FROM events
    WHERE origin IS NOT NULL AND destination IS NOT NULL AND departure_at IS NOT NULL
      AND event_name IN ('ride_searched', 'search_returned_empty', 'ride_listed', 'booking_completed')
  ),
  valid_bookings AS (
    SELECT w.origin, w.destination, w.week_start, (w.properties->>'seats')::int AS seats
    FROM weekified w
    WHERE w.event_name = 'booking_completed'
      AND NOT EXISTS (
        SELECT 1 FROM events c
        WHERE c.event_name = 'booking_cancelled' AND c.properties->>'booking_id' = w.properties->>'booking_id'
      )
  ),
  booked_agg AS (
    SELECT origin, destination, week_start, SUM(seats) AS seats_booked
    FROM valid_bookings
    GROUP BY origin, destination, week_start
  ),
  base_agg AS (
    SELECT
      origin, destination, week_start,
      SUM((properties->>'seats_needed')::int) FILTER (WHERE event_name = 'ride_searched') AS seats_demanded,
      SUM((properties->>'seats_total')::int) FILTER (WHERE event_name = 'ride_listed') AS seats_listed,
      COUNT(*) FILTER (WHERE event_name = 'ride_searched') AS searches,
      COUNT(*) FILTER (WHERE event_name = 'search_returned_empty') AS empty_searches
    FROM weekified
    GROUP BY origin, destination, week_start
  )
  SELECT
    b.origin, b.destination, b.week_start,
    COALESCE(b.seats_demanded, 0) AS seats_demanded,
    COALESCE(b.seats_listed, 0) AS seats_listed,
    COALESCE(k.seats_booked, 0) AS seats_booked,
    COALESCE(b.searches, 0) AS searches,
    COALESCE(b.empty_searches, 0) AS empty_searches
  FROM base_agg b
  LEFT JOIN booked_agg k USING (origin, destination, week_start)
`;

export async function createOrRefreshRollup(): Promise<void> {
  await db.execute(DROP_ROLLUP_SQL);
  await db.execute(CORRIDOR_WEEK_ROLLUP_SQL);
}

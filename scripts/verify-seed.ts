import { existsSync } from 'node:fs';
if (!process.env.DATABASE_URL && existsSync('.env.local')) process.loadEnvFile('.env.local');

import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

type Check = { name: string; value: number; target: number; tolerance: number; unit?: string };

const results: Check[] = [];
let failures = 0;

function check(name: string, value: number, target: number, tolerance: number, unit = ''): void {
  const pass = Math.abs(value - target) <= tolerance;
  if (!pass) failures++;
  results.push({ name, value, target, tolerance, unit });
  const status = pass ? 'PASS' : 'FAIL';
  console.log(
    `[${status}] ${name}: ${value.toFixed(2)}${unit} (target ${target}${unit} ± ${tolerance}${unit})`
  );
}

async function scalar(query: ReturnType<typeof sql>): Promise<number> {
  const rows = (await db.execute(query)) as unknown as Record<string, unknown>[];
  const row = rows[0] ?? {};
  const v = Object.values(row)[0];
  return v === null || v === undefined ? 0 : Number(v);
}

async function f1(): Promise<void> {
  async function slice(origin: string, destination: string, dates: string[]) {
    const dateList = sql.join(dates.map((d) => sql`${d}`), sql`, `);
    const demanded = await scalar(sql`
      SELECT COALESCE(SUM((properties->>'seats_needed')::int), 0)
      FROM events WHERE event_name = 'ride_searched' AND origin = ${origin} AND destination = ${destination}
        AND departure_at::date IN (${dateList})
    `);
    const listed = await scalar(sql`
      SELECT COALESCE(SUM((properties->>'seats_total')::int), 0)
      FROM events WHERE event_name = 'ride_listed' AND origin = ${origin} AND destination = ${destination}
        AND departure_at::date IN (${dateList})
    `);
    const booked = await scalar(sql`
      SELECT COALESCE(SUM((properties->>'seats')::int), 0)
      FROM events WHERE event_name = 'booking_completed' AND origin = ${origin} AND destination = ${destination}
        AND departure_at::date IN (${dateList})
    `);
    const searches = await scalar(sql`
      SELECT COUNT(*) FROM events WHERE event_name = 'ride_searched' AND origin = ${origin} AND destination = ${destination}
        AND departure_at::date IN (${dateList})
    `);
    const empty = await scalar(sql`
      SELECT COUNT(*) FROM events WHERE event_name = 'search_returned_empty' AND origin = ${origin} AND destination = ${destination}
        AND departure_at::date IN (${dateList})
    `);
    return {
      ratio: demanded / Math.max(listed, 1),
      zeroRate: (empty / Math.max(searches, 1)) * 100,
      fillRate: (booked / Math.max(listed, 1)) * 100,
    };
  }

  const out = await slice('ithaca', 'nyc', ['2025-11-25', '2025-11-26']);
  const outReturn = await slice('nyc', 'ithaca', ['2025-11-25', '2025-11-26']);
  const ret = await slice('nyc', 'ithaca', ['2025-11-30', '2025-12-01']);
  const retOut = await slice('ithaca', 'nyc', ['2025-11-30', '2025-12-01']);

  check('F1 outbound Ithaca->NYC demand/listed ratio', out.ratio, 3.2, 0.4);
  check('F1 outbound Ithaca->NYC zero-result rate', out.zeroRate, 38, 6, '%');
  check('F1 outbound NYC->Ithaca fill rate', outReturn.fillRate, 34, 10, '%');
  check('F1 return NYC->Ithaca demand/listed ratio', ret.ratio, 2.7, 0.4);
  check('F1 return NYC->Ithaca zero-result rate', ret.zeroRate, 36, 6, '%');
  check('F1 return Ithaca->NYC fill rate', retOut.fillRate, 31, 10, '%');
}

async function f2(): Promise<void> {
  const rows = (await db.execute(sql`
    WITH engaged AS (
      SELECT DISTINCT session_id FROM events WHERE event_name = 'driver_profile_viewed'
    ),
    messaged AS (
      SELECT DISTINCT session_id FROM events WHERE event_name = 'message_thread_started'
    ),
    booked AS (
      SELECT DISTINCT session_id FROM events WHERE event_name = 'booking_completed'
    )
    SELECT
      COUNT(*) FILTER (WHERE m.session_id IS NOT NULL) AS messaged_total,
      COUNT(*) FILTER (WHERE m.session_id IS NOT NULL AND b.session_id IS NOT NULL) AS messaged_booked,
      COUNT(*) FILTER (WHERE m.session_id IS NULL) AS non_messaged_total,
      COUNT(*) FILTER (WHERE m.session_id IS NULL AND b.session_id IS NOT NULL) AS non_messaged_booked
    FROM engaged e
    LEFT JOIN messaged m ON m.session_id = e.session_id
    LEFT JOIN booked b ON b.session_id = e.session_id
  `)) as unknown as Record<string, string>[];
  const r = rows[0];
  const messagedRate = (Number(r.messaged_booked) / Math.max(Number(r.messaged_total), 1)) * 100;
  const nonMessagedRate = (Number(r.non_messaged_booked) / Math.max(Number(r.non_messaged_total), 1)) * 100;
  check('F2 messaged-first conversion', messagedRate, 62, 6, '%');
  check('F2 non-messaged conversion', nonMessagedRate, 31, 6, '%');
}

async function f3(): Promise<void> {
  const rows = (await db.execute(sql`
    WITH driver_reviews AS (
      SELECT driver_id, COUNT(*) AS n
      FROM events
      WHERE event_name = 'review_submitted' AND properties->>'reviewer_role' = 'passenger'
      GROUP BY driver_id
    ),
    driver_seats AS (
      SELECT driver_id,
        SUM((properties->>'seats_total')::int) AS listed
      FROM events WHERE event_name = 'ride_listed'
      GROUP BY driver_id
    ),
    driver_booked AS (
      SELECT driver_id, SUM((properties->>'seats')::int) AS booked
      FROM events WHERE event_name = 'booking_completed'
      GROUP BY driver_id
    )
    SELECT
      COALESCE(SUM(s.listed) FILTER (WHERE r.n >= 3), 0) AS veteran_listed,
      COALESCE(SUM(bk.booked) FILTER (WHERE r.n >= 3), 0) AS veteran_booked,
      COALESCE(SUM(s.listed) FILTER (WHERE r.n IS NULL), 0) AS zero_listed,
      COALESCE(SUM(bk.booked) FILTER (WHERE r.n IS NULL), 0) AS zero_booked
    FROM driver_seats s
    LEFT JOIN driver_reviews r ON r.driver_id = s.driver_id
    LEFT JOIN driver_booked bk ON bk.driver_id = s.driver_id
  `)) as unknown as Record<string, string>[];
  const r = rows[0];
  const veteranFill = (Number(r.veteran_booked) / Math.max(Number(r.veteran_listed), 1)) * 100;
  const zeroFill = (Number(r.zero_booked) / Math.max(Number(r.zero_listed), 1)) * 100;
  check('F3 drivers with >=3 reviews fill rate', veteranFill, 78, 6, '%');
  check('F3 drivers with 0 reviews fill rate', zeroFill, 41, 6, '%');
}

async function f4(): Promise<void> {
  async function liquidity(campus: string) {
    const listed = await scalar(sql`SELECT COALESCE(SUM((properties->>'seats_total')::int), 0) FROM events WHERE event_name = 'ride_listed' AND campus = ${campus}`);
    const demanded = await scalar(sql`SELECT COALESCE(SUM((properties->>'seats_needed')::int), 0) FROM events WHERE event_name = 'ride_searched' AND campus = ${campus}`);
    return listed / Math.max(demanded, 1);
  }
  async function roleDuality(campus: string) {
    const rows = (await db.execute(sql`
      WITH campus_users AS (SELECT DISTINCT user_id FROM events WHERE campus = ${campus} AND user_id IS NOT NULL),
      listed AS (SELECT DISTINCT user_id FROM events WHERE event_name = 'ride_listed'),
      reserved AS (SELECT DISTINCT user_id FROM events WHERE event_name = 'seat_reserved')
      SELECT
        (SELECT COUNT(*) FROM campus_users) AS total,
        (SELECT COUNT(*) FROM campus_users cu JOIN listed l ON l.user_id = cu.user_id JOIN reserved r ON r.user_id = cu.user_id) AS both_count
    `)) as unknown as Record<string, string>[];
    const r = rows[0];
    return (Number(r.both_count) / Math.max(Number(r.total), 1)) * 100;
  }

  check('F4 Cornell liquidity ratio', await liquidity('cornell'), 0.85, 0.15);
  check('F4 Binghamton liquidity ratio', await liquidity('binghamton'), 0.42, 0.15);
  check('F4 Cornell role duality', await roleDuality('cornell'), 23, 5, '%');
  check('F4 Binghamton role duality', await roleDuality('binghamton'), 8, 5, '%');
}

async function f5(): Promise<void> {
  const rows = (await db.execute(sql`
    SELECT
      percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (departure_at - occurred_at)) / 86400)
        FILTER (WHERE NOT (departure_at::date >= '2025-11-22' AND departure_at::date <= '2025-11-30')) AS baseline_median,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (departure_at - occurred_at)) / 86400)
        FILTER (WHERE departure_at::date >= '2025-11-22' AND departure_at::date <= '2025-11-30') AS thanksgiving_median,
      percentile_cont(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (departure_at - occurred_at)) / 86400) AS p90
    FROM events WHERE event_name = 'booking_completed'
  `)) as unknown as Record<string, string>[];
  const r = rows[0];
  check('F5 baseline median lead time', Number(r.baseline_median), 6, 2, 'd');
  check('F5 Thanksgiving median lead time', Number(r.thanksgiving_median), 19, 4, 'd');
  check('F5 overall p90 lead time', Number(r.p90), 31, 8, 'd');
}

async function f6(): Promise<void> {
  const rows = (await db.execute(sql`
    WITH listed AS (SELECT DISTINCT user_id FROM events WHERE event_name = 'ride_listed'),
    reserved AS (SELECT DISTINCT user_id FROM events WHERE event_name = 'seat_reserved'),
    total_users AS (SELECT COUNT(*) AS n FROM events WHERE event_name = 'user_signed_up')
    SELECT
      (SELECT n FROM total_users) AS total,
      (SELECT COUNT(*) FROM listed l JOIN reserved r ON r.user_id = l.user_id) AS both_count
  `)) as unknown as Record<string, string>[];
  const r = rows[0];
  const rate = (Number(r.both_count) / Math.max(Number(r.total), 1)) * 100;
  check('F6 overall role duality', rate, 21, 5, '%');
}

async function f7(): Promise<void> {
  const rows = (await db.execute(sql`
    WITH ordered AS (
      SELECT driver_id, user_id, occurred_at,
        ROW_NUMBER() OVER (PARTITION BY driver_id, user_id ORDER BY occurred_at) AS rn
      FROM events WHERE event_name = 'booking_completed'
    )
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE rn > 1) AS repeats
    FROM ordered
  `)) as unknown as Record<string, string>[];
  const r = rows[0];
  const rate = (Number(r.repeats) / Math.max(Number(r.total), 1)) * 100;
  check('F7 repeat pairing rate', rate, 14, 5, '%');
}

async function f8(): Promise<void> {
  const reserved = await scalar(sql`SELECT COUNT(*) FROM events WHERE event_name = 'seat_reserved'`);
  const cancelled = await scalar(sql`SELECT COUNT(*) FROM events WHERE event_name = 'booking_cancelled'`);
  const over48 = await scalar(sql`SELECT COUNT(*) FROM events WHERE event_name = 'booking_cancelled' AND (properties->>'hours_before_departure')::float > 48`);
  const under6 = await scalar(sql`SELECT COUNT(*) FROM events WHERE event_name = 'booking_cancelled' AND (properties->>'hours_before_departure')::float < 6`);

  check('F8 cancellation rate vs seat_reserved', (cancelled / Math.max(reserved, 1)) * 100, 10, 3, '%');
  check('F8 cancellations >48h before departure', (over48 / Math.max(cancelled, 1)) * 100, 62, 8, '%');
  check('F8 cancellations <6h before departure', (under6 / Math.max(cancelled, 1)) * 100, 11, 6, '%');
}

async function main() {
  console.log('Verifying planted findings against the live database...\n');
  await f1();
  await f2();
  await f3();
  await f4();
  await f5();
  await f6();
  await f7();
  await f8();

  console.log(`\n${results.length - failures}/${results.length} checks passed.`);
  if (failures > 0) {
    console.log(`${failures} check(s) FAILED.`);
    process.exit(1);
  }
  console.log('All planted findings verified.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

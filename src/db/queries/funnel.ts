import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

function toRows<T = Record<string, string>>(result: Awaited<ReturnType<typeof db.execute>>): T[] {
  return result.rows as unknown as T[];
}

const FUNNEL_STEPS = [
  'ride_searched',
  'ride_viewed',
  'driver_profile_viewed',
  'message_thread_started',
  'seat_reserved',
  'booking_completed',
  'review_submitted',
] as const;

export type FunnelStep = {
  name: string;
  sessions: number;
  dropFromPrev: number;
  dropFromPrevPct: number;
  isLargestDrop: boolean;
};

export async function getFunnelSteps(): Promise<FunnelStep[]> {
  const counts: number[] = [];
  for (const name of FUNNEL_STEPS) {
    const result = await db.execute(sql`SELECT COUNT(DISTINCT session_id) AS n FROM events WHERE event_name = ${name}`);
    counts.push(Number((toRows(result)[0] as unknown as Record<string, unknown>).n));
  }

  const steps: FunnelStep[] = FUNNEL_STEPS.map((name, i) => {
    const prev = i === 0 ? counts[0] : counts[i - 1];
    const drop = i === 0 ? 0 : Math.max(0, prev - counts[i]);
    return {
      name,
      sessions: counts[i],
      dropFromPrev: drop,
      dropFromPrevPct: prev > 0 ? drop / prev : 0,
      isLargestDrop: false,
    };
  });

  let largestIdx = 1;
  for (let i = 2; i < steps.length; i++) {
    if (steps[i].dropFromPrevPct > steps[largestIdx].dropFromPrevPct) largestIdx = i;
  }
  steps[largestIdx].isLargestDrop = true;
  return steps;
}

export type MessagingLift = { messagedRate: number; nonMessagedRate: number; messagedN: number; nonMessagedN: number };

export async function getMessagingLift(): Promise<MessagingLift> {
  const result = await db.execute(sql`
    WITH engaged AS (SELECT DISTINCT session_id FROM events WHERE event_name = 'driver_profile_viewed'),
    messaged AS (SELECT DISTINCT session_id FROM events WHERE event_name = 'message_thread_started'),
    booked AS (SELECT DISTINCT session_id FROM events WHERE event_name = 'booking_completed')
    SELECT
      COUNT(*) FILTER (WHERE m.session_id IS NOT NULL) AS messaged_total,
      COUNT(*) FILTER (WHERE m.session_id IS NOT NULL AND b.session_id IS NOT NULL) AS messaged_booked,
      COUNT(*) FILTER (WHERE m.session_id IS NULL) AS non_messaged_total,
      COUNT(*) FILTER (WHERE m.session_id IS NULL AND b.session_id IS NOT NULL) AS non_messaged_booked
    FROM engaged e
    LEFT JOIN messaged m ON m.session_id = e.session_id
    LEFT JOIN booked b ON b.session_id = e.session_id
  `);
  const r = toRows(result)[0] as unknown as Record<string, unknown>;
  const messagedTotal = Number(r.messaged_total);
  const nonMessagedTotal = Number(r.non_messaged_total);
  return {
    messagedRate: Number(r.messaged_booked) / Math.max(messagedTotal, 1),
    nonMessagedRate: Number(r.non_messaged_booked) / Math.max(nonMessagedTotal, 1),
    messagedN: messagedTotal,
    nonMessagedN: nonMessagedTotal,
  };
}

export type ReviewLift = { veteranFillRate: number; zeroFillRate: number; veteranN: number; zeroN: number };

export async function getReviewLift(): Promise<ReviewLift> {
  const result = await db.execute(sql`
    WITH driver_reviews AS (
      SELECT driver_id, COUNT(*) AS n FROM events
      WHERE event_name = 'review_submitted' AND properties->>'reviewer_role' = 'passenger'
      GROUP BY driver_id
    ),
    driver_seats AS (
      SELECT driver_id, SUM((properties->>'seats_total')::int) AS listed
      FROM events WHERE event_name = 'ride_listed' GROUP BY driver_id
    ),
    driver_booked AS (
      SELECT driver_id, SUM((properties->>'seats')::int) AS booked
      FROM events WHERE event_name = 'booking_completed' GROUP BY driver_id
    )
    SELECT
      COALESCE(SUM(s.listed) FILTER (WHERE r.n >= 3), 0) AS veteran_listed,
      COALESCE(SUM(bk.booked) FILTER (WHERE r.n >= 3), 0) AS veteran_booked,
      COUNT(*) FILTER (WHERE r.n >= 3) AS veteran_n,
      COALESCE(SUM(s.listed) FILTER (WHERE r.n IS NULL), 0) AS zero_listed,
      COALESCE(SUM(bk.booked) FILTER (WHERE r.n IS NULL), 0) AS zero_booked,
      COUNT(*) FILTER (WHERE r.n IS NULL) AS zero_n
    FROM driver_seats s
    LEFT JOIN driver_reviews r ON r.driver_id = s.driver_id
    LEFT JOIN driver_booked bk ON bk.driver_id = s.driver_id
  `);
  const r = toRows(result)[0] as unknown as Record<string, unknown>;
  return {
    veteranFillRate: Number(r.veteran_booked) / Math.max(Number(r.veteran_listed), 1),
    zeroFillRate: Number(r.zero_booked) / Math.max(Number(r.zero_listed), 1),
    veteranN: Number(r.veteran_n),
    zeroN: Number(r.zero_n),
  };
}

export type CancellationBucket = { label: string; count: number };

const CANCEL_BUCKET_LABELS = ['0-6h', '6-24h', '24-48h', '48-96h', '96h+'];

export async function getCancellationTiming(): Promise<CancellationBucket[]> {
  const result = await db.execute(sql`
    SELECT
      CASE
        WHEN (properties->>'hours_before_departure')::float < 6 THEN '0-6h'
        WHEN (properties->>'hours_before_departure')::float < 24 THEN '6-24h'
        WHEN (properties->>'hours_before_departure')::float < 48 THEN '24-48h'
        WHEN (properties->>'hours_before_departure')::float < 96 THEN '48-96h'
        ELSE '96h+'
      END AS bucket,
      COUNT(*) AS n
    FROM events WHERE event_name = 'booking_cancelled'
    GROUP BY bucket
  `);
  const rows = toRows(result);
  const counts = new Map<string, number>();
  for (const r of rows) counts.set((r as unknown as Record<string, unknown>).bucket as string, Number((r as unknown as Record<string, unknown>).n));
  return CANCEL_BUCKET_LABELS.map((label) => ({ label, count: counts.get(label) ?? 0 }));
}

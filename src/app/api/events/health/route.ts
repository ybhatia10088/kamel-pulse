import { NextResponse } from 'next/server';
import { count, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { events } from '@/db/schema';

export async function GET() {
  const [row] = await db
    .select({
      totalEvents: count(),
      latestOccurredAt: sql<string | null>`max(${events.occurredAt})`,
    })
    .from(events);

  return NextResponse.json({
    total_events: row?.totalEvents ?? 0,
    latest_occurred_at: row?.latestOccurredAt ?? null,
  });
}

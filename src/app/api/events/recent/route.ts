import { NextResponse } from 'next/server';
import { desc } from 'drizzle-orm';
import { db } from '@/db/client';
import { events } from '@/db/schema';

export async function GET() {
  const rows = await db
    .select({
      eventId: events.eventId,
      eventName: events.eventName,
      receivedAt: events.receivedAt,
    })
    .from(events)
    .orderBy(desc(events.receivedAt))
    .limit(10);

  return NextResponse.json({ events: rows });
}

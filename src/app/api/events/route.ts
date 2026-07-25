import { NextRequest, NextResponse } from 'next/server';
import { getEventSchema } from '@kamel-pulse/analytics';
import { db } from '@/db/client';
import { events } from '@/db/schema';
import { toRow } from '@/lib/ingest';

const MAX_BATCH_SIZE = 100;

type IngestError = { index: number; event_id?: string; message: string };

// No auth on this endpoint. A production deployment would gate writes
// behind a per-client write key; out of scope for this build (see README).
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const items = Array.isArray(body) ? body : [body];

  if (items.length === 0) {
    return NextResponse.json({ error: 'empty batch' }, { status: 400 });
  }
  if (items.length > MAX_BATCH_SIZE) {
    return NextResponse.json(
      { error: `batch exceeds max size of ${MAX_BATCH_SIZE}` },
      { status: 400 }
    );
  }

  const errors: IngestError[] = [];
  const rows = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const eventName =
      item && typeof item === 'object' && 'event_name' in item
        ? String((item as Record<string, unknown>).event_name)
        : undefined;
    const schema = eventName ? getEventSchema(eventName) : undefined;

    if (!schema) {
      errors.push({ index: i, message: `unknown event_name: ${eventName ?? '(missing)'}` });
      continue;
    }

    const result = schema.safeParse(item);
    if (!result.success) {
      errors.push({
        index: i,
        event_id:
          item && typeof item === 'object' && typeof (item as Record<string, unknown>).event_id === 'string'
            ? ((item as Record<string, unknown>).event_id as string)
            : undefined,
        message: result.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; '),
      });
      continue;
    }

    rows.push(toRow(result.data));
  }

  if (rows.length > 0) {
    await db.insert(events).values(rows).onConflictDoNothing({ target: events.eventId });
  }

  return NextResponse.json(
    { accepted: rows.length, rejected: errors.length, errors },
    { status: 202 }
  );
}

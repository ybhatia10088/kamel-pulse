import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { events } from '@/db/schema';
import type { NewEventRow } from '@/db/schema';
import { createOrRefreshRollup } from '@/db/rollup';
import { generate, type GeneratedEvent } from './lib/generate';

const SEED = 20250929;
const BATCH_SIZE = 1000;

function toRow(e: GeneratedEvent): NewEventRow {
  return {
    eventId: e.eventId,
    eventName: e.eventName,
    userId: e.userId,
    anonymousId: e.anonymousId,
    sessionId: e.sessionId,
    occurredAt: e.occurredAt,
    campus: e.campus,
    schemaVersion: 1,
    origin: e.origin,
    destination: e.destination,
    departureAt: e.departureAt,
    rideId: e.rideId,
    driverId: e.driverId,
    properties: e.properties,
  };
}

async function main() {
  console.log(`Generating dataset (seed=${SEED})...`);
  const start = Date.now();
  const { users, rides, events: generated } = generate(SEED);
  console.log(`Generated ${generated.length} events in ${Date.now() - start}ms (${users.length} users, ${rides.length} rides)`);

  console.log('Truncating events table...');
  await db.execute(sql`TRUNCATE TABLE events`);

  console.log(`Inserting in batches of ${BATCH_SIZE}...`);
  const rows = generated.map(toRow);
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await db.insert(events).values(batch).onConflictDoNothing({ target: events.eventId });
    process.stdout.write(`\r  ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}`);
  }
  console.log();

  console.log('Refreshing corridor_week_rollup...');
  await createOrRefreshRollup();

  console.log('Done.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';

// Append-only event log. event_id is the primary key, so idempotency is
// enforced by the database (ON CONFLICT DO NOTHING) rather than application
// logic. Hot columns (origin/destination/departure/ride/driver) are lifted
// out of properties because corridor + time are in the WHERE clause of
// every dashboard query — JSONB alone would force a sequential scan.
export const events = pgTable(
  'events',
  {
    eventId: uuid('event_id').primaryKey(),
    eventName: text('event_name').notNull(),
    userId: text('user_id'),
    anonymousId: text('anonymous_id').notNull(),
    sessionId: text('session_id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    campus: text('campus'),
    schemaVersion: integer('schema_version').notNull().default(1),

    origin: text('origin'),
    destination: text('destination'),
    departureAt: timestamp('departure_at', { withTimezone: true }),
    rideId: text('ride_id'),
    driverId: text('driver_id'),

    properties: jsonb('properties').$type<Record<string, unknown>>().notNull(),
  },
  (t) => ({
    byNameTime: index('idx_events_name_time').on(t.eventName, t.occurredAt),
    byCorridor: index('idx_events_corridor').on(
      t.origin,
      t.destination,
      t.departureAt
    ),
    byCampus: index('idx_events_campus').on(t.campus, t.occurredAt),
    bySession: index('idx_events_session').on(t.sessionId),
    byRide: index('idx_events_ride').on(t.rideId),
  })
);

export type EventRow = typeof events.$inferSelect;
export type NewEventRow = typeof events.$inferInsert;

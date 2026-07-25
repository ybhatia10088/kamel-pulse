import { z } from 'zod';
import type { EventName, PropsFor } from './events';
import { EVENT_NAMES } from './events';

const campusSchema = z.enum(['cornell', 'binghamton']);

const citySchema = z.enum([
  'ithaca',
  'nyc',
  'syracuse',
  'binghamton',
  'philadelphia',
  'boston',
  'rochester',
  'washington_dc',
]);

const referralSourceSchema = z.enum([
  'friend',
  'campus_flyer',
  'instagram',
  'search',
  'club_group_chat',
  'direct',
]);

const paymentMethodSchema = z.enum(['card', 'apple_pay', 'google_pay']);
const roleSchema = z.enum(['driver', 'passenger']);

// One property schema per event, keyed by event_name. `satisfies` forces
// every entry's z.infer<> output to be assignable to PropsFor<K> from
// events.ts — the single discriminated union declared there. Edit a field
// in events.ts without updating the matching schema here and this file
// stops compiling. That's the shared source of truth: not a runtime
// check, a build-time one.
export const eventPropsSchemas = {
  user_signed_up: z.object({
    campus: campusSchema,
    edu_domain: z.string(),
    referral_source: referralSourceSchema,
  }),
  ride_searched: z.object({
    origin: citySchema,
    destination: citySchema,
    departure_date: z.string(),
    seats_needed: z.number().int().positive(),
    results_count: z.number().int().nonnegative(),
  }),
  search_returned_empty: z.object({
    origin: citySchema,
    destination: citySchema,
    departure_date: z.string(),
    seats_needed: z.number().int().positive(),
  }),
  ride_listed: z.object({
    ride_id: z.string(),
    origin: citySchema,
    destination: citySchema,
    departure_at: z.string(),
    seats_total: z.number().int().positive(),
    cost_share_per_seat: z.number().nonnegative(),
  }),
  ride_viewed: z.object({
    ride_id: z.string(),
    origin: citySchema,
    destination: citySchema,
    position_in_results: z.number().int().nonnegative(),
  }),
  driver_profile_viewed: z.object({
    ride_id: z.string(),
    driver_id: z.string(),
    driver_rating: z.number().min(0).max(5).nullable(),
    driver_trips_completed: z.number().int().nonnegative(),
  }),
  message_thread_started: z.object({
    ride_id: z.string(),
    driver_id: z.string(),
    initiator_role: roleSchema,
  }),
  seat_reserved: z.object({
    ride_id: z.string(),
    driver_id: z.string(),
    seats: z.number().int().positive(),
    cost_share_per_seat: z.number().nonnegative(),
  }),
  booking_completed: z.object({
    ride_id: z.string(),
    driver_id: z.string(),
    booking_id: z.string(),
    seats: z.number().int().positive(),
    amount_cents: z.number().int().nonnegative(),
    payment_method: paymentMethodSchema,
  }),
  booking_cancelled: z.object({
    ride_id: z.string(),
    booking_id: z.string(),
    cancelled_by: roleSchema,
    hours_before_departure: z.number(),
  }),
  ride_listing_expired: z.object({
    ride_id: z.string(),
    seats_total: z.number().int().positive(),
    seats_unfilled: z.number().int().nonnegative(),
  }),
  trip_completed: z.object({
    ride_id: z.string(),
    driver_id: z.string(),
    seats_filled: z.number().int().nonnegative(),
    seats_total: z.number().int().positive(),
  }),
  review_submitted: z.object({
    ride_id: z.string(),
    reviewee_id: z.string(),
    rating: z.number().min(1).max(5),
    reviewer_role: roleSchema,
  }),
} satisfies { [K in EventName]: z.ZodType<PropsFor<K>> };

const envelopeSchema = z.object({
  event_id: z.string().uuid(),
  user_id: z.string().nullable(),
  anonymous_id: z.string().min(1),
  session_id: z.string().min(1),
  occurred_at: z.string().datetime(),
  campus: campusSchema.nullable(),
  schema_version: z.literal(1),
});

function eventSchema<K extends EventName>(eventName: K) {
  return envelopeSchema.extend({
    event_name: z.literal(eventName),
    properties: eventPropsSchemas[eventName],
  });
}

export const eventSchemaByName = Object.fromEntries(
  EVENT_NAMES.map((name) => [name, eventSchema(name)])
) as { [K in EventName]: ReturnType<typeof eventSchema<K>> };

// Full envelope + properties validation for one event, by name. Returns
// undefined for an unrecognized event_name so callers can reject cleanly.
export function getEventSchema(eventName: string) {
  return (eventSchemaByName as Record<string, z.ZodTypeAny | undefined>)[
    eventName
  ];
}

export const trackedEventSchema = z.discriminatedUnion(
  'event_name',
  Object.values(eventSchemaByName) as [
    (typeof eventSchemaByName)[EventName],
    ...(typeof eventSchemaByName)[EventName][],
  ]
);

export type ValidatedTrackedEvent = z.infer<typeof trackedEventSchema>;

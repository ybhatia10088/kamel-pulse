import type { ValidatedTrackedEvent } from '@kamel-pulse/analytics';
import type { NewEventRow } from '@/db/schema';

/**
 * Lifts corridor/time/ride/driver fields out of `properties` into the hot
 * columns declared in schema.ts. Which properties count as "hot" depends
 * on the event: search-side events carry a date-only `departure_date`
 * (normalized to midnight UTC so it still lands in the right week bucket),
 * listing-side events carry a full `departure_at` timestamp. Review
 * `driver_id` is only lifted when the review target is actually a driver
 * (reviewer_role === 'passenger'); a driver reviewing a passenger has no
 * driver on the receiving end.
 */
export function liftHotColumns(
  event: ValidatedTrackedEvent
): Pick<NewEventRow, 'origin' | 'destination' | 'departureAt' | 'rideId' | 'driverId'> {
  const props = event.properties as Record<string, unknown>;

  const origin = typeof props.origin === 'string' ? props.origin : null;
  const destination = typeof props.destination === 'string' ? props.destination : null;

  let departureAt: Date | null = null;
  if (typeof props.departure_at === 'string') {
    departureAt = new Date(props.departure_at);
  } else if (typeof props.departure_date === 'string') {
    departureAt = new Date(`${props.departure_date}T00:00:00.000Z`);
  }

  const rideId = typeof props.ride_id === 'string' ? props.ride_id : null;

  let driverId: string | null = typeof props.driver_id === 'string' ? props.driver_id : null;
  if (
    event.event_name === 'review_submitted' &&
    props.reviewer_role === 'passenger' &&
    typeof props.reviewee_id === 'string'
  ) {
    driverId = props.reviewee_id;
  }

  return { origin, destination, departureAt, rideId, driverId };
}

export function toRow(event: ValidatedTrackedEvent): NewEventRow {
  const hot = liftHotColumns(event);
  return {
    eventId: event.event_id,
    eventName: event.event_name,
    userId: event.user_id,
    anonymousId: event.anonymous_id,
    sessionId: event.session_id,
    occurredAt: new Date(event.occurred_at),
    campus: event.campus,
    schemaVersion: event.schema_version,
    ...hot,
    properties: event.properties,
  };
}

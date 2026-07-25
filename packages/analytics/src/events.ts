export type Campus = 'cornell' | 'binghamton';

export type City =
  | 'ithaca'
  | 'nyc'
  | 'syracuse'
  | 'binghamton'
  | 'philadelphia'
  | 'boston'
  | 'rochester'
  | 'washington_dc';

export type ReferralSource =
  | 'friend'
  | 'campus_flyer'
  | 'instagram'
  | 'search'
  | 'club_group_chat'
  | 'direct';

export type PaymentMethod = 'card' | 'apple_pay' | 'google_pay';

export type Role = 'driver' | 'passenger';

// Envelope carried by every event, regardless of event_name.
export type EventEnvelope = {
  event_id: string; // client-generated UUID v4, used for idempotency
  user_id: string | null; // null for pre-signup activity
  anonymous_id: string; // always present
  session_id: string;
  occurred_at: string; // ISO 8601 UTC
  campus: Campus | null;
  schema_version: 1;
};

// The thirteen events. `search_returned_empty` and `ride_listing_expired`
// are the two that matter most: unserved demand and unsold supply are the
// two faces of a liquidity failure, and this system's whole point is
// making both queryable, not just the successes.
export type KamelEvent =
  | {
      event_name: 'user_signed_up';
      properties: {
        campus: Campus;
        edu_domain: string;
        referral_source: ReferralSource;
      };
    }
  | {
      event_name: 'ride_searched';
      properties: {
        origin: City;
        destination: City;
        departure_date: string;
        seats_needed: number;
        results_count: number;
      };
    }
  | {
      event_name: 'search_returned_empty';
      properties: {
        origin: City;
        destination: City;
        departure_date: string;
        seats_needed: number;
      };
    }
  | {
      event_name: 'ride_listed';
      properties: {
        ride_id: string;
        origin: City;
        destination: City;
        departure_at: string;
        seats_total: number;
        cost_share_per_seat: number;
      };
    }
  | {
      event_name: 'ride_viewed';
      properties: {
        ride_id: string;
        origin: City;
        destination: City;
        position_in_results: number;
      };
    }
  | {
      event_name: 'driver_profile_viewed';
      properties: {
        ride_id: string;
        driver_id: string;
        driver_rating: number | null;
        driver_trips_completed: number;
      };
    }
  | {
      event_name: 'message_thread_started';
      properties: {
        ride_id: string;
        driver_id: string;
        initiator_role: Role;
      };
    }
  | {
      event_name: 'seat_reserved';
      properties: {
        ride_id: string;
        driver_id: string;
        seats: number;
        cost_share_per_seat: number;
      };
    }
  | {
      event_name: 'booking_completed';
      properties: {
        ride_id: string;
        driver_id: string;
        booking_id: string;
        seats: number;
        amount_cents: number;
        payment_method: PaymentMethod;
      };
    }
  | {
      event_name: 'booking_cancelled';
      properties: {
        ride_id: string;
        booking_id: string;
        cancelled_by: Role;
        hours_before_departure: number;
      };
    }
  | {
      event_name: 'ride_listing_expired';
      properties: {
        ride_id: string;
        seats_total: number;
        seats_unfilled: number;
      };
    }
  | {
      event_name: 'trip_completed';
      properties: {
        ride_id: string;
        driver_id: string;
        seats_filled: number;
        seats_total: number;
      };
    }
  | {
      event_name: 'review_submitted';
      properties: {
        ride_id: string;
        reviewee_id: string;
        rating: number;
        reviewer_role: Role;
      };
    };

export type EventName = KamelEvent['event_name'];

// Narrows the properties type from an event_name — this is what makes
// track('ride_searched', { origin: 'chicago', ... }) fail to build.
export type PropsFor<E extends EventName> = Extract<
  KamelEvent,
  { event_name: E }
>['properties'];

export type TrackedEvent = EventEnvelope & KamelEvent;

export const EVENT_NAMES = [
  'user_signed_up',
  'ride_searched',
  'search_returned_empty',
  'ride_listed',
  'ride_viewed',
  'driver_profile_viewed',
  'message_thread_started',
  'seat_reserved',
  'booking_completed',
  'booking_cancelled',
  'ride_listing_expired',
  'trip_completed',
  'review_submitted',
] as const satisfies readonly EventName[];

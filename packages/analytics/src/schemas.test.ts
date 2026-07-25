import { describe, expect, it } from 'vitest';
import { trackedEventSchema } from './schemas';

const baseEnvelope = {
  event_id: '123e4567-e89b-12d3-a456-426614174000',
  user_id: null,
  anonymous_id: 'anon-1',
  session_id: 'sess-1',
  occurred_at: '2025-11-25T12:00:00.000Z',
  campus: 'cornell' as const,
  schema_version: 1 as const,
};

describe('trackedEventSchema', () => {
  it('accepts a valid ride_searched event', () => {
    const result = trackedEventSchema.safeParse({
      ...baseEnvelope,
      event_name: 'ride_searched',
      properties: {
        origin: 'ithaca',
        destination: 'nyc',
        departure_date: '2025-11-25',
        seats_needed: 1,
        results_count: 0,
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a city outside the enum (the origin: "chicago" case)', () => {
    const result = trackedEventSchema.safeParse({
      ...baseEnvelope,
      event_name: 'ride_searched',
      properties: {
        origin: 'chicago',
        destination: 'nyc',
        departure_date: '2025-11-25',
        seats_needed: 1,
        results_count: 0,
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unrecognized event_name', () => {
    const result = trackedEventSchema.safeParse({
      ...baseEnvelope,
      event_name: 'ride_booked_lol',
      properties: {},
    });
    expect(result.success).toBe(false);
  });

  it('rejects properties from the wrong event', () => {
    const result = trackedEventSchema.safeParse({
      ...baseEnvelope,
      event_name: 'booking_completed',
      properties: {
        // ride_searched's shape, not booking_completed's
        origin: 'ithaca',
        destination: 'nyc',
        departure_date: '2025-11-25',
        seats_needed: 1,
        results_count: 0,
      },
    });
    expect(result.success).toBe(false);
  });

  it('enforces cost_share_per_seat is non-negative on ride_listed', () => {
    const result = trackedEventSchema.safeParse({
      ...baseEnvelope,
      event_name: 'ride_listed',
      properties: {
        ride_id: 'ride-1',
        origin: 'ithaca',
        destination: 'boston',
        departure_at: '2025-12-15T14:00:00.000Z',
        seats_total: 3,
        cost_share_per_seat: -5,
      },
    });
    expect(result.success).toBe(false);
  });
});

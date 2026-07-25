import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, track } from './client';

describe('track/flush', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202, statusText: 'Accepted' });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('auto-flushes once the 20-event buffer fills, without waiting for the timer', () => {
    for (let i = 0; i < 20; i++) {
      track('ride_viewed', {
        ride_id: `ride-${i}`,
        origin: 'ithaca',
        destination: 'nyc',
        position_in_results: i,
      });
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body).toHaveLength(20);
  });

  it('flushes on the 3s timer for a buffer under the fill threshold', async () => {
    track('ride_viewed', {
      ride_id: 'ride-1',
      origin: 'ithaca',
      destination: 'nyc',
      position_in_results: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives every queued event a distinct event_id', () => {
    track('ride_viewed', { ride_id: 'a', origin: 'ithaca', destination: 'nyc', position_in_results: 0 });
    track('ride_viewed', { ride_id: 'b', origin: 'ithaca', destination: 'nyc', position_in_results: 1 });
    return flush().then(() => {
      const [, init] = fetchMock.mock.calls[0];
      const body = JSON.parse(init.body as string) as Array<{ event_id: string }>;
      expect(new Set(body.map((e) => e.event_id)).size).toBe(body.length);
    });
  });
});

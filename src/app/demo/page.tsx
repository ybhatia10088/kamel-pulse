'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { flush, track } from '@kamel-pulse/analytics';
import { Card, CardCaption, CardEyebrow } from '@/components/ui/Card';

type RecentEvent = { eventId: string; eventName: string; receivedAt: string };

type LogLine = { id: string; text: string; tone: 'default' | 'success' | 'shortage' };

function useDemoIds() {
  const rideId = useRef<string>('');
  const driverId = useRef<string>('');
  if (!rideId.current) rideId.current = `demo_ride_${crypto.randomUUID().slice(0, 8)}`;
  if (!driverId.current) driverId.current = `demo_driver_${crypto.randomUUID().slice(0, 8)}`;
  return { rideId: rideId.current, driverId: driverId.current };
}

export default function DemoPage() {
  const { rideId, driverId } = useDemoIds();
  const [health, setHealth] = useState<{ total: number; latest: string | null } | null>(null);
  const [recent, setRecent] = useState<RecentEvent[]>([]);
  const [log, setLog] = useState<LogLine[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const appendLog = useCallback((text: string, tone: LogLine['tone'] = 'default') => {
    setLog((prev) => [{ id: crypto.randomUUID(), text, tone }, ...prev].slice(0, 40));
  }, []);

  const refreshHealth = useCallback(async () => {
    const res = await fetch('/api/events/health', { cache: 'no-store' });
    const data = await res.json();
    setHealth({ total: data.total_events, latest: data.latest_occurred_at });
    return data.total_events as number;
  }, []);

  const refreshRecent = useCallback(async () => {
    const res = await fetch('/api/events/recent', { cache: 'no-store' });
    const data = await res.json();
    setRecent(data.events);
  }, []);

  const refreshAll = useCallback(async () => {
    const [total] = await Promise.all([refreshHealth(), refreshRecent()]);
    return total;
  }, [refreshHealth, refreshRecent]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  async function run(name: string, action: () => Promise<void>) {
    setBusy(name);
    try {
      await action();
    } finally {
      setBusy(null);
    }
  }

  const buttons = [
    {
      key: 'search',
      label: '1. Search Ithaca → NYC',
      run: () =>
        run('search', async () => {
          track('ride_searched', {
            origin: 'ithaca',
            destination: 'nyc',
            departure_date: '2025-12-05',
            seats_needed: 1,
            results_count: 6,
          });
          await flush();
          appendLog('ride_searched: ithaca → nyc, 6 results', 'success');
          await refreshAll();
        }),
    },
    {
      key: 'empty-search',
      label: '2. Search Ithaca → NYC, Nov 25',
      run: () =>
        run('empty-search', async () => {
          track('ride_searched', {
            origin: 'ithaca',
            destination: 'nyc',
            departure_date: '2025-11-25',
            seats_needed: 1,
            results_count: 0,
          });
          track('search_returned_empty', {
            origin: 'ithaca',
            destination: 'nyc',
            departure_date: '2025-11-25',
            seats_needed: 1,
          });
          await flush();
          appendLog('ride_searched (0 results) + search_returned_empty: ithaca → nyc, Nov 25', 'shortage');
          await refreshAll();
        }),
    },
    {
      key: 'list',
      label: '3. List a ride, Ithaca → Boston',
      run: () =>
        run('list', async () => {
          track('ride_listed', {
            ride_id: rideId,
            origin: 'ithaca',
            destination: 'boston',
            departure_at: '2025-12-06T14:00:00.000Z',
            seats_total: 3,
            cost_share_per_seat: 68,
          });
          await flush();
          appendLog(`ride_listed: ${rideId}, ithaca → boston, 3 seats`, 'success');
          await refreshAll();
        }),
    },
    {
      key: 'message',
      label: '4. Message a driver',
      run: () =>
        run('message', async () => {
          track('message_thread_started', { ride_id: rideId, driver_id: driverId, initiator_role: 'passenger' });
          await flush();
          appendLog(`message_thread_started: ride ${rideId}`, 'success');
          await refreshAll();
        }),
    },
    {
      key: 'reserve',
      label: '5. Reserve a seat',
      run: () =>
        run('reserve', async () => {
          track('seat_reserved', { ride_id: rideId, driver_id: driverId, seats: 1, cost_share_per_seat: 68 });
          await flush();
          appendLog(`seat_reserved: ride ${rideId}, 1 seat`, 'success');
          await refreshAll();
        }),
    },
    {
      key: 'book',
      label: '6. Complete a booking',
      run: () =>
        run('book', async () => {
          track('booking_completed', {
            ride_id: rideId,
            driver_id: driverId,
            booking_id: `demo_booking_${crypto.randomUUID().slice(0, 8)}`,
            seats: 1,
            amount_cents: 6800,
            payment_method: 'card',
          });
          await flush();
          appendLog(`booking_completed: ride ${rideId}, $68.00`, 'success');
          await refreshAll();
        }),
    },
  ];

  async function fireTwice() {
    setBusy('fire-twice');
    try {
      const eventId = crypto.randomUUID();
      const payload = {
        event_id: eventId,
        user_id: null,
        anonymous_id: `demo_anon_${crypto.randomUUID().slice(0, 8)}`,
        session_id: `demo_sess_${crypto.randomUUID().slice(0, 8)}`,
        occurred_at: new Date().toISOString(),
        campus: null,
        schema_version: 1,
        event_name: 'ride_viewed',
        properties: { ride_id: rideId, origin: 'ithaca', destination: 'boston', position_in_results: 0 },
      };

      appendLog(`fire twice: event_id ${eventId.slice(0, 8)}… — sending request 1 of 2`, 'default');
      const before = await refreshHealth();

      // Two genuinely separate HTTP requests to the real ingest endpoint,
      // same event_id both times. No client-side "already sent" check —
      // the server's ON CONFLICT DO NOTHING on events.event_id is what
      // makes the second one a no-op.
      const res1 = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body1 = await res1.json();
      appendLog(`request 1: HTTP ${res1.status}, accepted=${body1.accepted}, rejected=${body1.rejected}`, 'default');

      appendLog('sending request 2 of 2 — identical event_id', 'default');
      const res2 = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body2 = await res2.json();
      appendLog(`request 2: HTTP ${res2.status}, accepted=${body2.accepted}, rejected=${body2.rejected}`, 'default');

      const after = await refreshAll();
      const delta = after - before;
      appendLog(
        `event count: ${before} → ${after} (+${delta}). Both requests validated and were sent to Postgres; the DB's ON CONFLICT DO NOTHING on event_id is what kept the second one from creating a row.`,
        delta === 1 ? 'success' : 'shortage'
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-[1280px] flex-col gap-10 overflow-x-hidden px-6 py-8 sm:px-10">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-muted">Kamel Pulse</p>
          <h1 className="mt-1 text-xl font-semibold text-ink" style={{ fontFamily: 'var(--font-inter-tight)' }}>
            Live Event Simulator
          </h1>
        </div>
        <nav className="flex gap-5 font-mono text-xs uppercase tracking-wide text-muted">
          <Link href="/" className="hover:text-ink hover:underline underline-offset-4">Corridors</Link>
          <Link href="/funnel" className="hover:text-ink hover:underline underline-offset-4">Funnel</Link>
          <Link href="/demo" className="text-ink underline-offset-4">Demo</Link>
        </nav>
      </header>

      <Card className="grid grid-cols-1 divide-y divide-rule sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <div className="flex flex-col gap-1.5 px-5 py-4">
          <p className="font-mono text-[11px] uppercase tracking-widest text-muted">Total events (live)</p>
          <p className="font-mono text-3xl font-medium tabular-nums text-ink">
            {health ? health.total.toLocaleString('en-US') : '—'}
          </p>
        </div>
        <div className="flex flex-col gap-1.5 px-5 py-4">
          <p className="font-mono text-[11px] uppercase tracking-widest text-muted">Latest occurred_at</p>
          <p className="font-mono text-sm text-ink">{health?.latest ?? '—'}</p>
        </div>
      </Card>

      <section>
        <CardEyebrow>FIRE A REAL EVENT — TRACK() → POST /API/EVENTS → POSTGRES</CardEyebrow>
        <Card className="mt-3 grid grid-cols-1 gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {buttons.map((b) => (
            <button
              key={b.key}
              onClick={b.run}
              disabled={busy !== null}
              className="rounded-md border border-rule bg-paper px-4 py-3 text-left text-sm font-medium text-ink transition-colors hover:border-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === b.key ? 'Sending…' : b.label}
            </button>
          ))}
        </Card>
      </section>

      <section>
        <CardEyebrow>IDEMPOTENCY — SAME EVENT_ID, TWO REAL REQUESTS</CardEyebrow>
        <Card className="mt-3 p-4">
          <button
            onClick={fireTwice}
            disabled={busy !== null}
            className="rounded-md border border-shortage bg-paper px-4 py-3 text-left text-sm font-medium text-shortage transition-colors hover:bg-shortage hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === 'fire-twice' ? 'Sending 2 requests…' : 'Fire the same event twice'}
          </button>
        </Card>
        <CardCaption>
          Generates one event with one event_id and sends it in two separate POST /api/events requests — watch
          the log below: both come back 202, but the total only moves by 1. That&apos;s events.event_id as the
          primary key with ON CONFLICT DO NOTHING, not a client that refused to send the duplicate.
        </CardCaption>
      </section>

      <div className="grid grid-cols-1 gap-6 pb-10 lg:grid-cols-2">
        <section>
          <CardEyebrow>ACTIVITY LOG</CardEyebrow>
          <Card className="mt-3 max-h-96 overflow-y-auto p-4">
            {log.length === 0 ? (
              <p className="text-sm text-muted">Fire an event above to see it here.</p>
            ) : (
              <ul className="flex flex-col gap-2 font-mono text-xs">
                {log.map((l) => (
                  <li
                    key={l.id}
                    className={
                      l.tone === 'success' ? 'text-surplus' : l.tone === 'shortage' ? 'text-shortage' : 'text-ink'
                    }
                  >
                    {l.text}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>

        <section>
          <CardEyebrow>LAST 10 INGESTED EVENTS</CardEyebrow>
          <Card className="mt-3 overflow-x-auto p-0">
            <table className="w-full min-w-[420px] border-collapse font-mono text-xs tabular-nums">
              <thead>
                <tr className="border-b border-rule text-left uppercase tracking-wide text-muted">
                  <th className="px-4 py-2 font-medium">event_id</th>
                  <th className="px-4 py-2 font-medium">event_name</th>
                  <th className="px-4 py-2 font-medium">received_at</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((e) => (
                  <tr key={e.eventId} className="border-b border-rule last:border-0">
                    <td className="px-4 py-2 text-muted">{e.eventId.slice(0, 8)}…</td>
                    <td className="px-4 py-2 text-ink">{e.eventName}</td>
                    <td className="px-4 py-2 text-muted">{new Date(e.receivedAt).toLocaleTimeString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>
      </div>
    </main>
  );
}

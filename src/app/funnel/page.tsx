import Link from 'next/link';
import { CancellationChart } from '@/components/CancellationChart';
import { ComparisonBars } from '@/components/ComparisonBars';
import { FunnelChart } from '@/components/FunnelChart';
import { Card, CardCaption, CardEyebrow } from '@/components/ui/Card';
import { getCancellationTiming, getFunnelSteps, getMessagingLift, getReviewLift } from '@/db/queries/funnel';
import { formatInt, formatPercent } from '@/lib/format';

export const revalidate = 0;

export default async function FunnelPage() {
  const [steps, messaging, reviews, cancellations] = await Promise.all([
    getFunnelSteps(),
    getMessagingLift(),
    getReviewLift(),
    getCancellationTiming(),
  ]);

  const largestDrop = steps.find((s) => s.isLargestDrop);
  const messagedShare = messaging.messagedN / Math.max(messaging.messagedN + messaging.nonMessagedN, 1);

  return (
    <main className="mx-auto flex w-full max-w-[1280px] flex-col gap-10 overflow-x-hidden px-6 py-8 sm:px-10">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-muted">Kamel Pulse</p>
          <h1 className="mt-1 text-xl font-semibold text-ink" style={{ fontFamily: 'var(--font-inter-tight)' }}>
            Trust-to-Booking Funnel
          </h1>
        </div>
        <nav className="flex gap-5 font-mono text-xs uppercase tracking-wide text-muted">
          <Link href="/" className="hover:text-ink hover:underline underline-offset-4">Corridors</Link>
          <Link href="/funnel" className="text-ink underline-offset-4">Funnel</Link>
          <Link href="/demo" className="hover:text-ink hover:underline underline-offset-4">Demo</Link>
        </nav>
      </header>

      <section>
        <CardEyebrow>SESSION FUNNEL — DISTINCT SESSIONS REACHING EACH STEP</CardEyebrow>
        <Card className="mt-3 p-4">
          <FunnelChart steps={steps} />
        </Card>
        {largestDrop && (
          <CardCaption>
            The largest drop is at <span className="font-medium text-shortage">{largestDrop.name.replace(/_/g, ' ')}</span>, shedding{' '}
            {Math.round(largestDrop.dropFromPrevPct * 100)}% of sessions that reached the prior step.
          </CardCaption>
        )}
        <CardCaption>
          Messaging isn&apos;t shown as a step here on purpose: it&apos;s a branch off &quot;driver profile viewed,&quot; not a gate everyone
          passes through. {formatPercent(messagedShare)} of those sessions ({formatInt(messaging.messagedN)} of{' '}
          {formatInt(messaging.messagedN + messaging.nonMessagedN)}) messaged the driver first — the other{' '}
          {formatPercent(1 - messagedShare)} reserved without messaging, not dropped off. Their conversion rates diverge sharply — see
          below.
        </CardCaption>
      </section>

      <section>
        <CardEyebrow>THE HEADLINE COMPARISON</CardEyebrow>
        <Card className="mt-3 flex flex-col gap-8 p-6">
          <ComparisonBars
            title="Messaged the driver first, before reserving a seat"
            items={[
              { label: 'Messaged first', value: messaging.messagedRate, n: messaging.messagedN, nUnit: 'sessions', emphasis: false },
              { label: 'Did not message', value: messaging.nonMessagedRate, n: messaging.nonMessagedN, nUnit: 'sessions', emphasis: true },
            ]}
          />
          <div className="h-px bg-rule" />
          <ComparisonBars
            title="Driver's review history at time of booking"
            items={[
              { label: 'Driver has ≥3 reviews', value: reviews.veteranFillRate, n: reviews.veteranN, nUnit: 'drivers', emphasis: false },
              { label: 'Driver has none', value: reviews.zeroFillRate, n: reviews.zeroN, nUnit: 'drivers', emphasis: true },
            ]}
          />
        </Card>
        <CardCaption>The social layer is not a retention feature. It is the conversion mechanism.</CardCaption>
        <CardCaption>
          The review comparison is restricted to drivers with 0 or 3+ reviews on purpose — a 1-2 review middle band sits between them with
          its own fill rate, and blending it in would blur the comparison. That excludes most drivers by count, but not by volume: the two
          compared tiers still cover {formatPercent(reviews.sessionCoverageRate)} of driver-profile-view sessions platform-wide.
        </CardCaption>
      </section>

      <section className="pb-10">
        <CardEyebrow>CANCELLATION TIMING — HOURS BEFORE DEPARTURE</CardEyebrow>
        <Card className="mt-3 p-4">
          <CancellationChart buckets={cancellations} />
        </Card>
        <CardCaption>
          Cancellations inside the 0-6h window are the ones that strand a passenger with no time to find another ride.
        </CardCaption>
      </section>
    </main>
  );
}

import Link from 'next/link';
import { CorridorHeatmap } from '@/components/CorridorHeatmap';
import { FillRateChart } from '@/components/FillRateChart';
import { LeadTimeChart } from '@/components/LeadTimeChart';
import { MetricStrip } from '@/components/MetricStrip';
import { Card, CardCaption, CardEyebrow } from '@/components/ui/Card';
import {
  asymmetrySentence,
  findBiggestAsymmetry,
  getCampusComparison,
  getFillRateByCorridor,
  getHeatmapData,
  getLeadTimeHistogram,
  getMetricStrip,
} from '@/db/queries/liquidity';
import { formatDays, formatPercent, formatRatio } from '@/lib/format';

export const revalidate = 0;

export default async function Home() {
  const [metricStrip, heatmapPairs, fillRate, leadTime, campuses] = await Promise.all([
    getMetricStrip(),
    getHeatmapData(),
    getFillRateByCorridor(),
    getLeadTimeHistogram(),
    getCampusComparison(),
  ]);

  const asymmetry = findBiggestAsymmetry(heatmapPairs);
  const cornell = campuses.find((c) => c.campus === 'cornell');
  const binghamton = campuses.find((c) => c.campus === 'binghamton');

  return (
    <main className="mx-auto flex max-w-[1280px] flex-col gap-10 px-6 py-8 sm:px-10">
      <header className="flex items-center justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-muted">Kamel Pulse</p>
          <h1 className="mt-1 text-xl font-semibold text-ink" style={{ fontFamily: 'var(--font-inter-tight)' }}>
            Corridor Liquidity
          </h1>
        </div>
        <nav className="flex gap-5 font-mono text-xs uppercase tracking-wide text-muted">
          <Link href="/" className="text-ink underline-offset-4">Corridors</Link>
          <Link href="/funnel" className="hover:text-ink hover:underline underline-offset-4">Funnel</Link>
          <Link href="/demo" className="hover:text-ink hover:underline underline-offset-4">Demo</Link>
        </nav>
      </header>

      <MetricStrip data={metricStrip} />

      <section>
        <CardEyebrow>UNMET DEMAND RATIO — SEATS DEMANDED / SEATS LISTED, BY WEEK</CardEyebrow>
        <Card className="mt-3 p-4">
          <CorridorHeatmap pairs={heatmapPairs} />
        </Card>
        {asymmetry && (
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-ink">{asymmetrySentence(asymmetry)}</p>
        )}
      </section>

      <section>
        <CardEyebrow>SEAT FILL RATE — SEATS BOOKED / SEATS LISTED, BY CORRIDOR</CardEyebrow>
        <Card className="mt-3 p-4">
          <FillRateChart corridors={fillRate.corridors} platformMean={fillRate.platformMean} />
        </Card>
        <CardCaption>
          Directed corridors sorted worst-to-best fill rate. Dashed line marks the platform-wide mean ({formatPercent(fillRate.platformMean)}).
        </CardCaption>
      </section>

      <section>
        <CardEyebrow>BOOKING LEAD TIME — DAYS BETWEEN BOOKING AND DEPARTURE</CardEyebrow>
        <Card className="mt-3 p-4">
          <LeadTimeChart buckets={leadTime} />
        </Card>
        <CardCaption>
          Break-week bookings skew far earlier than baseline weeks — driver recruitment for a break has to start roughly three weeks out, not three days.
        </CardCaption>
      </section>

      <section className="pb-10">
        <CardEyebrow>CAMPUS COMPARISON</CardEyebrow>
        <Card className="mt-3 overflow-x-auto p-0">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-rule text-left font-mono text-[11px] uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-medium">Campus</th>
                <th className="px-4 py-3 font-medium">Liquidity ratio</th>
                <th className="px-4 py-3 font-medium">Role duality</th>
                <th className="px-4 py-3 font-medium">Median lead time</th>
                <th className="px-4 py-3 font-medium">Fill rate</th>
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {cornell && (
                <tr className="border-b border-rule">
                  <td className="px-4 py-3 font-sans font-medium text-ink">Cornell</td>
                  <td className="px-4 py-3">{formatRatio(cornell.liquidityRatio, 2)}</td>
                  <td className="px-4 py-3">{formatPercent(cornell.roleDualityRate)}</td>
                  <td className="px-4 py-3">{formatDays(cornell.medianLeadTimeDays)}</td>
                  <td className="px-4 py-3">{formatPercent(cornell.fillRate)}</td>
                </tr>
              )}
              {binghamton && (
                <tr>
                  <td className="px-4 py-3 font-sans font-medium text-ink">Binghamton</td>
                  <td className="px-4 py-3">{formatRatio(binghamton.liquidityRatio, 2)}</td>
                  <td className="px-4 py-3">{formatPercent(binghamton.roleDualityRate)}</td>
                  <td className="px-4 py-3">{formatDays(binghamton.medianLeadTimeDays)}</td>
                  <td className="px-4 py-3">{formatPercent(binghamton.fillRate)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
        {binghamton && (
          <CardCaption>
            Binghamton lists at {formatRatio(binghamton.liquidityRatio, 2)}× demand versus Cornell&apos;s {cornell ? formatRatio(cornell.liquidityRatio, 2) : '—'}× —
            the newer market hasn&apos;t reached self-sustaining liquidity yet.
          </CardCaption>
        )}
      </section>
    </main>
  );
}

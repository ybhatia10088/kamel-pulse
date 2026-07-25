'use client';

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { FunnelStep } from '@/db/queries/funnel';
import { formatInt, formatPercent } from '@/lib/format';

const STEP_LABELS: Record<string, string> = {
  ride_searched: 'Searched',
  ride_viewed: 'Viewed ride',
  driver_profile_viewed: 'Viewed driver',
  message_thread_started: 'Messaged',
  seat_reserved: 'Reserved',
  booking_completed: 'Booked',
  review_submitted: 'Reviewed',
};

export function FunnelChart({ steps }: { steps: FunnelStep[] }) {
  const data = steps.map((s) => ({ ...s, label: STEP_LABELS[s.name] ?? s.name }));

  return (
    <div>
      <div style={{ width: '100%', height: 280 }}>
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--rule)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} stroke="var(--rule)" />
            <YAxis tick={{ fontFamily: 'var(--font-jetbrains-mono)', fontSize: 11, fill: 'var(--muted)' }} stroke="var(--rule)" />
            <Tooltip
              contentStyle={{ background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 6, fontSize: 12 }}
              formatter={(value, _name, item) => [
                `${formatInt(Number(value))} sessions (-${formatInt(item.payload.dropFromPrev)}, ${formatPercent(item.payload.dropFromPrevPct)} drop)`,
                item.payload.label,
              ]}
            />
            <Bar dataKey="sessions" radius={[4, 4, 0, 0]}>
              {data.map((d) => (
                <Cell key={d.name} fill={d.isLargestDrop ? 'var(--shortage)' : 'var(--surplus)'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse font-mono text-xs tabular-nums">
          <thead>
            <tr className="border-b border-rule text-left uppercase tracking-wide text-muted">
              <th className="py-2 pr-4 font-medium">Step</th>
              <th className="py-2 pr-4 font-medium">Sessions</th>
              <th className="py-2 pr-4 font-medium">Drop</th>
              <th className="py-2 font-medium">Drop %</th>
            </tr>
          </thead>
          <tbody>
            {data.map((s) => (
              <tr key={s.name} className="border-b border-rule last:border-0">
                <td className={`py-2 pr-4 font-sans ${s.isLargestDrop ? 'font-semibold text-shortage' : 'text-ink'}`}>{s.label}</td>
                <td className="py-2 pr-4">{formatInt(s.sessions)}</td>
                <td className="py-2 pr-4">{s.dropFromPrev > 0 ? `-${formatInt(s.dropFromPrev)}` : '—'}</td>
                <td className={s.isLargestDrop ? 'font-semibold text-shortage' : ''}>
                  {s.dropFromPrev > 0 ? formatPercent(s.dropFromPrevPct) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

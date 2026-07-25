'use client';

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { CancellationBucket } from '@/db/queries/funnel';
import { formatInt } from '@/lib/format';

export function CancellationChart({ buckets }: { buckets: CancellationBucket[] }) {
  return (
    <div style={{ width: '100%', height: 200 }}>
      <ResponsiveContainer>
        <BarChart data={buckets} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--rule)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontFamily: 'var(--font-jetbrains-mono)', fontSize: 11, fill: 'var(--muted)' }} stroke="var(--rule)" />
          <YAxis tick={{ fontFamily: 'var(--font-jetbrains-mono)', fontSize: 11, fill: 'var(--muted)' }} stroke="var(--rule)" allowDecimals={false} />
          <Tooltip
            contentStyle={{ background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 6, fontSize: 12 }}
            formatter={(value) => [`${formatInt(Number(value))} cancellations`, '']}
          />
          <Bar dataKey="count" radius={[4, 4, 0, 0]}>
            {buckets.map((b) => (
              <Cell key={b.label} fill={b.label === '0-6h' ? 'var(--shortage)' : 'var(--kamel)'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

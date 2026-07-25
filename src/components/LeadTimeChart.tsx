'use client';

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { LeadTimeBucket } from '@/db/queries/liquidity';

export function LeadTimeChart({ buckets }: { buckets: LeadTimeBucket[] }) {
  return (
    <div style={{ width: '100%', height: 260 }}>
      <ResponsiveContainer>
        <BarChart data={buckets} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--rule)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontFamily: 'var(--font-jetbrains-mono)', fontSize: 11, fill: 'var(--muted)' }} stroke="var(--rule)" />
          <YAxis tick={{ fontFamily: 'var(--font-jetbrains-mono)', fontSize: 11, fill: 'var(--muted)' }} stroke="var(--rule)" />
          <Tooltip
            contentStyle={{ background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 6, fontSize: 12 }}
            labelFormatter={(label) => `${label} days out`}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="baseline" name="baseline weeks" fill="var(--surplus)" radius={[3, 3, 0, 0]} />
          <Bar dataKey="breakWeek" name="break weeks" fill="var(--kamel)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

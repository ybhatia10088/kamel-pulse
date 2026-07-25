'use client';

import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { CorridorFillRate } from '@/db/queries/liquidity';

function cellColor(fillRate: number): string {
  if (fillRate < 0.4) return 'var(--shortage)';
  if (fillRate < 0.7) return 'var(--kamel)';
  return 'var(--surplus)';
}

export function FillRateChart({ corridors, platformMean }: { corridors: CorridorFillRate[]; platformMean: number }) {
  const data = corridors.map((c) => ({ label: c.label, fillRate: Math.round(c.fillRate * 1000) / 10, seatsListed: c.seatsListed, seatsBooked: c.seatsBooked }));
  const height = Math.max(280, data.length * 30);

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--rule)" horizontal={false} />
          <XAxis
            type="number"
            domain={[0, 100]}
            unit="%"
            tick={{ fontFamily: 'var(--font-jetbrains-mono)', fontSize: 11, fill: 'var(--muted)' }}
            stroke="var(--rule)"
          />
          <YAxis
            type="category"
            dataKey="label"
            width={140}
            tick={{ fontSize: 11, fill: 'var(--ink)' }}
            stroke="var(--rule)"
          />
          <Tooltip
            cursor={{ fill: 'var(--balanced)', opacity: 0.4 }}
            contentStyle={{ background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 6, fontSize: 12 }}
            formatter={(value, _name, item) => [
              `${value}% (${item.payload.seatsBooked}/${item.payload.seatsListed} seats)`,
              'fill rate',
            ]}
          />
          <ReferenceLine x={Math.round(platformMean * 1000) / 10} stroke="var(--ink)" strokeDasharray="4 4" label={{ value: 'platform mean', position: 'top', fontSize: 10, fill: 'var(--muted)' }} />
          <Bar dataKey="fillRate" radius={[0, 4, 4, 0]}>
            {data.map((d) => (
              <Cell key={d.label} fill={cellColor(d.fillRate / 100)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

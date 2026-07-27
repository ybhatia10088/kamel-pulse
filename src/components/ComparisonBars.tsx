import { formatInt, formatPercent } from '@/lib/format';

type ComparisonItem = {
  label: string;
  value: number; // 0-1 fraction
  n: number;
  nUnit: string; // what n counts ('sessions', 'drivers', ...) — left unlabeled, "n=137" reads as directly comparable to any other n on the page even when the unit differs
  emphasis?: boolean;
};

function Bar({ item }: { item: ComparisonItem }) {
  const pct = Math.round(item.value * 100);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-muted">{item.label}</span>
        <span className={`font-mono text-2xl font-medium tabular-nums ${item.emphasis ? 'text-shortage' : 'text-ink'}`}>
          {formatPercent(item.value)}
        </span>
      </div>
      <div className="h-3 w-full rounded-sm bg-balanced">
        <div
          className="h-3 rounded-sm"
          style={{ width: `${pct}%`, background: item.emphasis ? 'var(--shortage)' : 'var(--surplus)' }}
        />
      </div>
      <span className="font-mono text-[11px] text-muted">n={formatInt(item.n)} {item.nUnit}</span>
    </div>
  );
}

export function ComparisonBars({ title, items }: { title: string; items: [ComparisonItem, ComparisonItem] }) {
  return (
    <div>
      <p className="text-sm font-medium text-ink">{title}</p>
      <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2">
        <Bar item={items[0]} />
        <Bar item={items[1]} />
      </div>
    </div>
  );
}

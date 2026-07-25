export function Stat({ eyebrow, value, caption }: { eyebrow: string; value: string; caption: string }) {
  return (
    <div className="flex flex-col gap-1.5 px-5 py-4">
      <p className="font-mono text-[11px] uppercase tracking-widest text-muted">{eyebrow}</p>
      <p className="font-mono text-3xl font-medium tabular-nums text-ink">{value}</p>
      <p className="text-sm text-muted">{caption}</p>
    </div>
  );
}

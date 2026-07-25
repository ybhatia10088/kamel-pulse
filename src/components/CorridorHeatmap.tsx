import { WEEKS } from '@/lib/calendar';
import { corridorLabel } from '@/lib/corridors';
import { formatInt, formatPercent, formatRatio } from '@/lib/format';
import type { CorridorPairRow, HeatmapCell } from '@/db/queries/liquidity';

const THANKSGIVING_WEEK_IDX = 8; // WEEKS[8] = "Nov 24"

function cellColor(ratio: number): { bg: string; text: string } {
  if (ratio >= 2.0) return { bg: 'var(--shortage)', text: '#ffffff' };
  if (ratio >= 1.3) return { bg: 'var(--kamel)', text: 'var(--ink)' };
  if (ratio >= 0.8) return { bg: 'var(--balanced)', text: 'var(--ink)' };
  if (ratio >= 0.5) return { bg: 'var(--surplus-light)', text: 'var(--ink)' };
  return { bg: 'var(--surplus)', text: '#ffffff' };
}

function Cell({ cell, colIndex }: { cell: HeatmapCell | undefined; colIndex: number }) {
  if (!cell || (cell.seatsDemanded === 0 && cell.seatsListed === 0)) {
    return (
      <div
        className="heatmap-cell flex h-11 items-center justify-center border border-paper text-xs text-muted"
        style={{ background: 'var(--surface)', animationDelay: `${colIndex * 12}ms` }}
      >
        —
      </div>
    );
  }

  const { bg, text } = cellColor(cell.unmetDemandRatio);
  const plainLanguage =
    cell.zeroResultRate > 0
      ? `${Math.round(cell.zeroResultRate * 100)}% of searches found no seats`
      : `${Math.round(cell.fillRate * 100)}% of listed seats got booked`;

  return (
    <div
      tabIndex={0}
      className="heatmap-cell group relative flex h-11 cursor-default items-center justify-center border border-paper font-mono text-sm font-medium tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ink"
      style={{ background: bg, color: text, animationDelay: `${colIndex * 12}ms` }}
    >
      {formatRatio(cell.unmetDemandRatio)}
      <div className="heatmap-tooltip pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-56 -translate-x-1/2 rounded-md border border-rule bg-paper p-3 text-left shadow-lg">
        <p className="font-mono text-[11px] uppercase tracking-wide text-muted">
          {corridorLabel(cell.origin, cell.destination)} · {WEEKS[cell.weekIdx].label}
        </p>
        <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-xs tabular-nums text-ink">
          <dt className="text-muted">searches</dt>
          <dd>{formatInt(cell.searches)}</dd>
          <dt className="text-muted">empty</dt>
          <dd>{formatInt(cell.emptySearches)}</dd>
          <dt className="text-muted">listed</dt>
          <dd>{formatInt(cell.seatsListed)}</dd>
          <dt className="text-muted">booked</dt>
          <dd>{formatInt(cell.seatsBooked)}</dd>
          <dt className="text-muted">fill rate</dt>
          <dd>{formatPercent(cell.fillRate)}</dd>
        </dl>
        <p className="mt-2 text-xs leading-snug text-ink">{plainLanguage}</p>
      </div>
    </div>
  );
}

function DirectionRow({
  origin,
  destination,
  cells,
}: {
  origin: string;
  destination: string;
  cells: HeatmapCell[];
}) {
  const byWeek = new Map(cells.map((c) => [c.weekIdx, c]));
  return (
    <div className="grid grid-cols-12 gap-px" title={`${origin} to ${destination}`}>
      {WEEKS.map((w, i) => (
        <Cell key={w.n} cell={byWeek.get(i)} colIndex={i} />
      ))}
    </div>
  );
}

export function CorridorHeatmap({ pairs }: { pairs: CorridorPairRow[] }) {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[820px]">
        {/* header row */}
        <div className="grid grid-cols-[160px_1fr]">
          <div className="sticky left-0 z-10 bg-paper" />
          <div className="grid grid-cols-12 gap-px pb-2">
            {WEEKS.map((w, i) => (
              <div key={w.n} className="relative text-center">
                <span className="font-mono text-[10px] text-muted">{w.label}</span>
                {i === THANKSGIVING_WEEK_IDX && (
                  <span className="absolute left-1/2 top-full mt-0.5 -translate-x-1/2 whitespace-nowrap font-mono text-[9px] uppercase tracking-wide text-shortage">
                    Thanksgiving
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-px">
          {pairs.map((pair) => (
            <div key={pair.pairKey} className="grid grid-cols-[160px_1fr] gap-px">
              <div className="sticky left-0 z-10 flex items-center border-l-2 border-kamel bg-paper pl-2">
                <span className="text-sm font-medium leading-tight text-ink">{pair.label}</span>
              </div>
              <div className="flex flex-col gap-px">
                <DirectionRow origin={pair.outbound.origin} destination={pair.outbound.destination} cells={pair.outbound.cells} />
                <DirectionRow origin={pair.return.origin} destination={pair.return.destination} cells={pair.return.cells} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

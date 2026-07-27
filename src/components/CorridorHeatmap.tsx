'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { WEEKS } from '@/lib/calendar';
import { corridorLabel } from '@/lib/corridors';
import { formatInt, formatPercent, formatRatio } from '@/lib/format';
import type { CorridorPairRow, HeatmapCell } from '@/db/queries/liquidity';

const THANKSGIVING_WEEK_IDX = 8; // WEEKS[8] = "Nov 24"
const TOOLTIP_WIDTH = 224; // w-56
const TOOLTIP_MARGIN = 8;

function cellColor(ratio: number): { bg: string; text: string } {
  if (ratio >= 2.0) return { bg: 'var(--shortage)', text: '#ffffff' };
  if (ratio >= 1.3) return { bg: 'var(--kamel)', text: 'var(--ink)' };
  if (ratio >= 0.8) return { bg: 'var(--balanced)', text: 'var(--ink)' };
  if (ratio >= 0.5) return { bg: 'var(--surplus-light)', text: 'var(--ink)' };
  return { bg: 'var(--surplus)', text: '#ffffff' };
}

type TooltipState = {
  cell: HeatmapCell;
  anchor: DOMRect;
};

function TooltipPortal({ state }: { state: TooltipState }) {
  const { cell, anchor } = state;
  const plainLanguage =
    cell.zeroResultRate > 0
      ? `${Math.round(cell.zeroResultRate * 100)}% of searches found no seats`
      : `${Math.round(cell.fillRate * 100)}% of listed seats got booked`;

  // Default: centered above the cell. Flip below if it would clip the top
  // of the viewport; flip left/right if it would clip a side edge.
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const spaceAbove = anchor.top;
  const openBelow = spaceAbove < 140;
  const top = openBelow ? anchor.bottom + TOOLTIP_MARGIN : anchor.top - TOOLTIP_MARGIN;

  let left = anchor.left + anchor.width / 2 - TOOLTIP_WIDTH / 2;
  left = Math.max(TOOLTIP_MARGIN, Math.min(left, viewportW - TOOLTIP_WIDTH - TOOLTIP_MARGIN));
  const clampedTop = Math.max(TOOLTIP_MARGIN, Math.min(top, viewportH - TOOLTIP_MARGIN));

  return createPortal(
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 rounded-md border border-rule bg-paper p-3 text-left shadow-lg"
      style={{
        width: TOOLTIP_WIDTH,
        left,
        top: clampedTop,
        transform: openBelow ? undefined : 'translateY(-100%)',
      }}
    >
      <p className="font-mono text-[11px] uppercase tracking-wide text-muted">
        {corridorLabel(cell.origin, cell.destination)} · {WEEKS[cell.weekIdx].label}
      </p>
      {cell.insufficientData && (
        <p className="mt-1 text-[11px] font-medium leading-snug text-shortage">Insufficient data — fewer than 10 seats listed</p>
      )}
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
    </div>,
    document.body
  );
}

function Cell({
  cell,
  colIndex,
  onHover,
  onLeave,
}: {
  cell: HeatmapCell | undefined;
  colIndex: number;
  onHover: (cell: HeatmapCell, el: HTMLElement) => void;
  onLeave: () => void;
}) {
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

  const { bg, text } = cell.insufficientData
    ? { bg: 'var(--surface)', text: 'var(--muted)' }
    : cellColor(cell.unmetDemandRatio);

  return (
    <div
      tabIndex={0}
      className="heatmap-cell flex h-11 cursor-default items-center justify-center border border-paper font-mono text-sm font-medium tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ink"
      style={{
        background: bg,
        color: text,
        animationDelay: `${colIndex * 12}ms`,
        ...(cell.insufficientData ? { backgroundImage: 'repeating-linear-gradient(45deg, var(--rule) 0, var(--rule) 1px, transparent 1px, transparent 6px)' } : {}),
      }}
      onMouseEnter={(e) => onHover(cell, e.currentTarget)}
      onMouseLeave={onLeave}
      onFocus={(e) => onHover(cell, e.currentTarget)}
      onBlur={onLeave}
    >
      {cell.insufficientData ? '·' : formatRatio(cell.unmetDemandRatio)}
    </div>
  );
}

function DirectionRow({
  cells,
  onHover,
  onLeave,
}: {
  origin: string;
  destination: string;
  cells: HeatmapCell[];
  onHover: (cell: HeatmapCell, el: HTMLElement) => void;
  onLeave: () => void;
}) {
  const byWeek = new Map(cells.map((c) => [c.weekIdx, c]));
  return (
    <div className="grid grid-cols-12 gap-px">
      {WEEKS.map((w, i) => (
        <Cell key={w.n} cell={byWeek.get(i)} colIndex={i} onHover={onHover} onLeave={onLeave} />
      ))}
    </div>
  );
}

export function CorridorHeatmap({ pairs }: { pairs: CorridorPairRow[] }) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleHover = useCallback((cell: HeatmapCell, el: HTMLElement) => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setTooltip({ cell, anchor: el.getBoundingClientRect() });
  }, []);

  const handleLeave = useCallback(() => {
    hideTimer.current = setTimeout(() => setTooltip(null), 0);
  }, []);

  // The anchor rect is captured once, in viewport coordinates, at hover
  // time. Scrolling (the grid's own horizontal scrollbar, or the page)
  // moves the cell without firing another hover, so the fixed-position
  // tooltip would otherwise freeze in place and drift over unrelated
  // content — dismiss it on any scroll instead of showing a stale one.
  useEffect(() => {
    if (!tooltip) return;
    const close = () => setTooltip(null);
    window.addEventListener('scroll', close, { capture: true, passive: true });
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [tooltip]);

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
                <DirectionRow origin={pair.outbound.origin} destination={pair.outbound.destination} cells={pair.outbound.cells} onHover={handleHover} onLeave={handleLeave} />
                <DirectionRow origin={pair.return.origin} destination={pair.return.destination} cells={pair.return.cells} onHover={handleHover} onLeave={handleLeave} />
              </div>
            </div>
          ))}
        </div>
      </div>
      {tooltip && <TooltipPortal state={tooltip} />}
    </div>
  );
}

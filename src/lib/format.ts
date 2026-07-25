export function formatInt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function formatPercent(fraction: number, digits = 0): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function formatRatio(n: number, digits = 1): string {
  return n.toFixed(digits);
}

export function formatDays(n: number, digits = 0): string {
  return `${n.toFixed(digits)}d`;
}

export function formatCurrency(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

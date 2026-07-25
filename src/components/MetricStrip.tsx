import { Card } from '@/components/ui/Card';
import { Stat } from '@/components/ui/Stat';
import { formatDays, formatInt, formatPercent } from '@/lib/format';
import type { MetricStrip as MetricStripData } from '@/db/queries/liquidity';

export function MetricStrip({ data }: { data: MetricStripData }) {
  return (
    <Card className="grid grid-cols-1 divide-y divide-rule sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
      <Stat
        eyebrow="Unserved seat-requests"
        value={formatInt(data.unservedSeatRequests)}
        caption="demand we could not serve"
      />
      <Stat
        eyebrow="Unsold seats"
        value={formatInt(data.unsoldSeats)}
        caption="supply that expired unbooked"
      />
      <Stat
        eyebrow="Role duality rate"
        value={formatPercent(data.roleDualityRate)}
        caption="users who both drove and rode"
      />
      <Stat
        eyebrow="Median booking lead time"
        value={formatDays(data.medianLeadTimeDays)}
        caption="days before departure"
      />
    </Card>
  );
}

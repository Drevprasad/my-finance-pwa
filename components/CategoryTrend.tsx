'use client';

import { useMemo, useState } from 'react';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { Card, CardTitle } from '@/components/ui';
import { formatINR } from '@/lib/money';
import { periodLabel } from '@/lib/dates';
import type { CategoryTrend as Trend } from '@/lib/types';

const FLAG_OVER_PCT = 20;   // red flag when latest month > avg of up to 3 earlier months by more than this
const COLLAPSED = 8;
const tooltipStyle = { backgroundColor: '#1f2937', borderColor: '#374151', color: '#fff' };

interface Row {
  key: string; name: string; data: { label: string; minor: number }[];
  cur: number; avg: number; histLen: number; total: number;
  vsPrev: number | null; vsAvg: number | null; flagged: boolean;
}

const pct = (cur: number, base: number): number | null =>
  base > 0 ? ((cur - base) / base) * 100 : null;

export default function CategoryTrend({
  trend, filtered = false,
}: { trend: Trend | null; filtered?: boolean }) {
  const [showAll, setShowAll] = useState(false);

  const rows: Row[] = useMemo(() => {
    if (!trend) return [];
    const out = trend.categories.map(c => {
      const s = c.by_month;
      const n = s.length;
      const cur = s[n - 1] ?? 0;
      const prev = n >= 2 ? s[n - 2] : 0;
      const hist = s.slice(Math.max(0, n - 4), n - 1);           // up to 3 months before the latest
      const avg = hist.length ? hist.reduce((a, b) => a + b, 0) / hist.length : 0;
      return {
        key: `${c.category_id ?? 'none'}-${c.name}`,
        name: c.name,
        data: s.map((minor, i) => ({ label: periodLabel(trend.months[i]), minor })),
        cur, avg, histLen: hist.length,
        total: s.reduce((a, b) => a + b, 0),
        vsPrev: pct(cur, prev),
        vsAvg: pct(cur, avg),
        flagged: avg > 0 && cur * 100 > avg * (100 + FLAG_OVER_PCT),
      };
    });
    return out.sort((a, b) => b.cur - a.cur || b.total - a.total);
  }, [trend]);

  const monthCount = trend?.months.length ?? 0;
  const canCompare = monthCount >= 2;
  const shown = showAll ? rows : rows.slice(0, COLLAPSED);
  const flaggedCount = rows.filter(r => r.flagged).length;
  const span = trend && trend.months.length
    ? `${periodLabel(trend.months[0])} – ${periodLabel(trend.months[trend.months.length - 1])}`
    : '';

  return (
    <Card>
      <CardTitle right={flaggedCount ? (
        <span className="rounded-full bg-red-900/60 px-2 py-0.5 text-[11px] font-semibold text-red-200">
          {flaggedCount} above avg
        </span>
      ) : undefined}>
        Category trend
      </CardTitle>
      <p className="-mt-2 mb-3 text-[11px] text-gray-500">
        {span ? `${span} · ` : ''}follows the selected period and filters · latest month is compared with earlier months ·
        flag = &gt;{FLAG_OVER_PCT}% above avg of up to 3 earlier months · investments excluded
      </p>

      {!trend ? (
        <div className="py-8 text-center text-sm text-gray-500">Loading trend…</div>
      ) : rows.length === 0 ? (
        <div className="py-8 text-center text-sm text-gray-500">
          {filtered ? 'No expenses match these filters in this period.' : 'No expenses in this period.'}
        </div>
      ) : (
        <>
          {!canCompare ? (
            <p className="mb-3 text-[11px] text-amber-300/80">
              Only one month selected. Pick 2 or more months (or a longer range) to see comparisons.
            </p>
          ) : null}
          <ul className="space-y-2">
            {shown.map(r => (
              <li key={r.key}
                  className={`rounded-lg border px-3 py-2 ${
                    r.flagged ? 'border-red-800 bg-red-950/30' : 'border-gray-800 bg-gray-900'}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-gray-100">{r.name}</span>
                      {r.flagged ? (
                        <span title={`More than ${FLAG_OVER_PCT}% above the earlier-months average`}
                              className="shrink-0 rounded bg-red-900/70 px-1.5 py-0.5 text-[10px] font-bold text-red-200">
                          ⚑ HIGH
                        </span>
                      ) : null}
                    </div>
                    <div className="tabular text-sm font-semibold text-white">{formatINR(r.cur)}</div>
                  </div>
                  <div className="h-9 w-28 shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={r.data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                        <XAxis dataKey="label" hide />
                        <Tooltip cursor={false} contentStyle={tooltipStyle}
                                 formatter={(v) => formatINR(Number(v ?? 0))} />
                        <Bar dataKey="minor" name="Spend" radius={[2, 2, 0, 0]}>
                          {r.data.map((_, i) => (
                            <Cell key={i}
                                  fill={i === r.data.length - 1 ? (r.flagged ? '#ef4444' : '#3b82f6') : '#4b5563'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                {canCompare ? (
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-gray-400">
                    <span>vs last month: <Delta p={r.vsPrev} cur={r.cur} /></span>
                    {r.histLen > 0 ? (
                      <span>vs prior {r.histLen}-mo avg ({formatINR(Math.round(r.avg))}): <Delta p={r.vsAvg} cur={r.cur} /></span>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          {rows.length > COLLAPSED ? (
            <button type="button" onClick={() => setShowAll(v => !v)}
                    className="mt-3 min-h-9 text-xs text-gray-400 underline hover:text-white">
              {showAll ? 'Show top 8' : `Show all ${rows.length}`}
            </button>
          ) : null}
        </>
      )}
    </Card>
  );
}

/** Spend going UP is bad (red), DOWN is good (green). */
function Delta({ p, cur }: { p: number | null; cur: number }) {
  if (p === null) {
    return <span className="text-gray-500">{cur > 0 ? 'new' : '—'}</span>;
  }
  const up = p > 0.05, down = p < -0.05;
  return (
    <span className={`tabular font-semibold ${up ? 'text-red-400' : down ? 'text-emerald-400' : 'text-gray-400'}`}>
      {up ? '▲' : down ? '▼' : '•'} {Math.abs(p).toFixed(0)}%
    </span>
  );
}
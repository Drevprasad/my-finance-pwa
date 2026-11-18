'use client';

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardTitle } from '@/components/ui';
import { formatINR, formatINRCompact, formatINRSigned } from '@/lib/money';
import { longDateLabel, periodLabel } from '@/lib/dates';
import type { InvestmentTrend, InvestmentTrendAccount } from '@/lib/types';

const tooltipStyle = { backgroundColor: '#1f2937', borderColor: '#374151', color: '#fff' };

const lastOf = (a: InvestmentTrendAccount) => a.by_month[a.by_month.length - 1] ?? 0;
const firstOf = (a: InvestmentTrendAccount) => a.by_month[0] ?? 0;

export default function InvestmentsPanel({
  trend, categoryFilterActive = false,
}: { trend: InvestmentTrend | null; categoryFilterActive?: boolean }) {
  const list = trend?.accounts ?? [];
  const months = trend?.months ?? [];
  const total = list.reduce((s, a) => s + lastOf(a), 0);
  const asOf = trend && trend.as_of.length ? trend.as_of[trend.as_of.length - 1] : null;
  const canCompare = months.length >= 2;

  const series = months.map((m, i) => ({
    label: periodLabel(m),
    total: list.reduce((s, a) => s + (a.by_month[i] ?? 0), 0),
  }));

  const groups: { title: string; items: InvestmentTrendAccount[] }[] = [
    { title: 'Investments', items: list.filter(a => a.subtype === 'investment') },
    { title: 'Fixed deposits', items: list.filter(a => a.subtype === 'fd') },
  ];

  return (
    <Card>
      <CardTitle right={<span className="tabular text-sm font-bold text-blue-300">{formatINR(total)}</span>}>
        Investments
      </CardTitle>
      <p className="-mt-2 mb-3 text-[11px] text-gray-500">
        Month-end balances (cost basis = running sum of postings, not market value)
        {asOf ? ` · latest as of ${longDateLabel(asOf)}` : ''}. Transfers into these accounts are never counted as expenses.
        {categoryFilterActive ? ' Category filter does not apply to balances.' : ''}
      </p>

      {trend === null ? (
        <div className="py-6 text-center text-sm text-gray-500">Loading…</div>
      ) : list.length === 0 ? (
        <div className="py-6 text-center text-sm text-gray-500">
          No investment / FD accounts match.
        </div>
      ) : (
        <div className="space-y-4">
          {canCompare ? (
            <div className="h-40 min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={series} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                  <XAxis dataKey="label" stroke="#9ca3af" fontSize={11} interval="preserveStartEnd" />
                  <YAxis width={56} stroke="#9ca3af" fontSize={11}
                         tickFormatter={v => formatINRCompact(Number(v))} />
                  <Tooltip cursor={{ fill: '#374151' }} contentStyle={tooltipStyle}
                           formatter={(v) => formatINR(Number(v ?? 0))} />
                  <Bar dataKey="total" name="Total" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : null}

          {groups.filter(g => g.items.length).map(g => (
            <div key={g.title}>
              <div className="mb-1.5 flex items-center justify-between text-xs text-gray-400">
                <span>{g.title}</span>
                <span className="tabular">{formatINR(g.items.reduce((s, a) => s + lastOf(a), 0))}</span>
              </div>
              <ul className="space-y-1.5">
                {g.items.map(a => {
                  const delta = lastOf(a) - firstOf(a);
                  return (
                    <li key={a.account_id}
                        className="flex items-center justify-between gap-2 rounded border border-gray-800 bg-gray-900 px-3 py-2 text-sm">
                      <span className="min-w-0 truncate text-gray-200">{a.name}</span>
                      <span className="shrink-0 text-right">
                        <span className="tabular block font-semibold text-white">{formatINR(lastOf(a))}</span>
                        {canCompare ? (
                          <span className={`tabular block text-[11px] ${
                            delta > 0 ? 'text-emerald-400' : delta < 0 ? 'text-red-400' : 'text-gray-500'}`}>
                            {formatINRSigned(delta)} since {periodLabel(months[0])}
                          </span>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
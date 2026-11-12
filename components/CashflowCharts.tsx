'use client';

import {
  Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Card, CardTitle } from '@/components/ui';
import { formatINR, formatINRCompact } from '@/lib/money';
import { periodLabel } from '@/lib/dates';
import type { DashboardSummary } from '@/lib/types';

const COLORS = ['#3b82f6','#10b981','#8b5cf6','#f59e0b','#ef4444','#06b6d4','#f43f5e','#ec4899'];

const tooltipStyle = { backgroundColor: '#1f2937', borderColor: '#374151', color: '#fff' };

export default function CashflowCharts({ summary }: { summary: DashboardSummary | null }) {
  const cats = summary?.by_category ?? [];
  const periods = (summary?.by_period ?? []).map(p => ({
    label: periodLabel(p.period),
    Income: p.income_minor / 100,
    Expense: p.expense_minor / 100,
  }));
  const totalExpense = cats.reduce((s, c) => s + c.amount_minor, 0);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
      <Card>
        <CardTitle>Expenses by category</CardTitle>
        {cats.length === 0 ? (
          <Empty text="No expenses in this period." />
        ) : (
          <div className="flex flex-col gap-4 sm:flex-row">
            <div className="h-52 min-w-0 flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={cats} dataKey="amount_minor" nameKey="name"
                       cx="50%" cy="50%" innerRadius={48} outerRadius={80} paddingAngle={3}>
                    {cats.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle}
                           formatter={(v) => formatINR(Number(v ?? 0))} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            {/* Own legend list instead of <Legend>: never clips, always readable */}
            <ul className="max-h-52 min-w-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
              {cats.map((c, i) => (
                <li key={`${c.category_id ?? 'none'}-${c.name}`}
                    className="flex items-center justify-between gap-2 rounded border border-gray-800 bg-gray-900 px-2 py-1.5 text-xs">
                  <span className="flex min-w-0 items-center gap-2">
                    <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                    <span className="truncate text-gray-200">{c.name}</span>
                  </span>
                  <span className="tabular shrink-0 text-right">
                    <span className="block font-semibold text-white">{formatINR(c.amount_minor)}</span>
                    <span className="block text-[11px] text-gray-500">
                      {totalExpense ? ((c.amount_minor / totalExpense) * 100).toFixed(1) : '0'}%
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card>
        <CardTitle>Cash flow</CardTitle>
        {periods.length === 0 ? (
          <Empty text="No transactions in this period." />
        ) : (
          <div className="h-56 min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={periods} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                <XAxis dataKey="label" stroke="#9ca3af" fontSize={11} interval="preserveStartEnd" />
                {/* explicit width + compact ticks: ₹12,34,567 labels ate the chart */}
                <YAxis width={56} stroke="#9ca3af" fontSize={11} tickFormatter={v => formatINRCompact(Number(v) * 100)} />
                <Tooltip cursor={{ fill: '#374151' }} contentStyle={tooltipStyle}
                         formatter={(v) => formatINR(Number(v ?? 0) * 100)} />
                <Bar dataKey="Income"  fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Expense" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="flex h-40 items-center justify-center text-sm text-gray-500">{text}</div>;
}
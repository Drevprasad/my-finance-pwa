'use client';

import { Card, CardTitle } from '@/components/ui';
import type { LiteCategoryRow, LiteEntryRow, LitePayeeRow } from '@/lib/lite/types';

const inr = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function fmtMinor(amountMinor: number): string {
  return `₹${inr.format(amountMinor / 100)}`;
}

function monthKey(date: string): string {
  return date.slice(0, 7); // YYYY-MM
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-');
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[Number(m) - 1]} ${y}`;
}

function Bar({ pct, color, label }: { pct: number; color: string; label: string }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-center justify-between gap-2 text-xs text-gray-300">
        <span className="min-w-0 truncate">{label}</span>
      </div>
      <div className="h-2 overflow-hidden rounded bg-gray-700">
        <div
          className={`h-full rounded ${color}`}
          style={{ width: `${Math.max(2, Math.min(100, pct))}%` }}
        />
      </div>
    </div>
  );
}

export function LiteCharts({
  entries,
  allEntries,
  categories,
  payees,
}: {
  entries: LiteEntryRow[];
  allEntries: LiteEntryRow[];
  categories: LiteCategoryRow[];
  payees: LitePayeeRow[];
}) {
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const payeeName = new Map(payees.map((p) => [p.id, p.name]));

  // 1. Category-wise spending (selected month, expenses only)
  const byCategory = new Map<number, number>();
  for (const e of entries) {
    if (e.kind !== 'expense') continue;
    const id = e.category_id ?? 0;
    byCategory.set(id, (byCategory.get(id) ?? 0) + e.amount_minor);
  }
  const catRows = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);
  const catMax = catRows.length ? catRows[0][1] : 0;

  // 2. Monthly trend (last 6 months from allEntries)
  const byMonth = new Map<string, { received: number; spent: number }>();
  for (const e of allEntries) {
    const key = monthKey(e.entry_date);
    const row = byMonth.get(key) ?? { received: 0, spent: 0 };
    if (e.kind === 'received') row.received += e.amount_minor;
    else row.spent += e.amount_minor;
    byMonth.set(key, row);
  }
  const months = [...byMonth.keys()].sort().slice(-6);
  const trendMax = Math.max(
    1,
    ...months.flatMap((m) => {
      const r = byMonth.get(m)!;
      return [r.received, r.spent];
    }),
  );

  // 3. Top payees (top 5 by expense amount in selected month)
  const byPayee = new Map<number, number>();
  for (const e of entries) {
    if (e.kind !== 'expense' || e.payee_id == null) continue;
    byPayee.set(e.payee_id, (byPayee.get(e.payee_id) ?? 0) + e.amount_minor);
  }
  const payeeRows = [...byPayee.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const payeeMax = payeeRows.length ? payeeRows[0][1] : 0;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Card>
        <CardTitle>Category-wise Spending</CardTitle>
        {catRows.length === 0 ? (
          <p className="text-sm text-gray-400">No expenses this month.</p>
        ) : (
          <div className="space-y-3">
            {catRows.map(([id, minor]) => (
              <Bar
                key={id}
                pct={catMax ? (minor / catMax) * 100 : 0}
                color="bg-red-600"
                label={`${catName.get(id) ?? 'Uncategorized'} · ${fmtMinor(minor)}`}
              />
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardTitle>Monthly Trend</CardTitle>
        {months.length === 0 ? (
          <p className="text-sm text-gray-400">No entries yet.</p>
        ) : (
          <div className="space-y-3">
            {months.map((m) => {
              const r = byMonth.get(m)!;
              return (
                <div key={m} className="text-xs text-gray-300">
                  <div className="mb-1 font-semibold text-gray-200">{monthLabel(m)}</div>
                  <div className="space-y-1.5">
                    <Bar
                      pct={trendMax ? (r.received / trendMax) * 100 : 0}
                      color="bg-green-600"
                      label={`Received · ${fmtMinor(r.received)}`}
                    />
                    <Bar
                      pct={trendMax ? (r.spent / trendMax) * 100 : 0}
                      color="bg-red-600"
                      label={`Spent · ${fmtMinor(r.spent)}`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card>
        <CardTitle>Top Payees</CardTitle>
        {payeeRows.length === 0 ? (
          <p className="text-sm text-gray-400">No payee expenses this month.</p>
        ) : (
          <div className="space-y-3">
            {payeeRows.map(([id, minor]) => (
              <Bar
                key={id}
                pct={payeeMax ? (minor / payeeMax) * 100 : 0}
                color="bg-blue-600"
                label={`${payeeName.get(id) ?? 'Unknown'} · ${fmtMinor(minor)}`}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { Card, CardTitle, Banner, btn } from '@/components/ui';
import { LiteCharts } from '@/components/lite/LiteCharts';
import { LiteEntryForm, LiteManagePanel } from '@/components/lite/LiteControls';
import type { LiteCategoryRow, LiteEntryRow, LitePayeeRow } from '@/lib/lite/types';

const inr = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function fmtMinor(amountMinor: number): string {
  return `₹${inr.format(amountMinor / 100)}`;
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export function LiteDashboard({
  ownerId,
  readOnly,
  title,
}: {
  ownerId: string;
  readOnly: boolean;
  title?: string;
}) {
  const [month, setMonth] = useState(currentMonth);
  const [entries, setEntries] = useState<LiteEntryRow[]>([]);
  const [categories, setCategories] = useState<LiteCategoryRow[]>([]);
  const [payees, setPayees] = useState<LitePayeeRow[]>([]);
  const [editing, setEditing] = useState<LiteEntryRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    const supabase = getSupabase();
    const [entriesRes, categoriesRes, payeesRes] = await Promise.all([
      supabase.from('lite_entries').select('*').eq('user_id', ownerId).order('entry_date', { ascending: false }),
      supabase.from('lite_categories').select('*').eq('user_id', ownerId).order('name'),
      supabase.from('lite_payees').select('*').eq('user_id', ownerId).order('name'),
    ]);
    if (entriesRes.error || categoriesRes.error || payeesRes.error) {
      setError(entriesRes.error?.message ?? categoriesRes.error?.message ?? payeesRes.error?.message ?? 'Failed to load data');
    } else {
      setEntries(entriesRes.data as LiteEntryRow[]);
      setCategories(categoriesRes.data as LiteCategoryRow[]);
      setPayees(payeesRes.data as LitePayeeRow[]);
    }
    setBusy(false);
  }, [ownerId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const monthEntries = useMemo(
    () => entries.filter((e) => e.entry_date.slice(0, 7) === month),
    [entries, month],
  );

  const received = monthEntries.reduce((sum, e) => (e.kind === 'received' ? sum + e.amount_minor : sum), 0);
  const spent = monthEntries.reduce((sum, e) => (e.kind === 'expense' ? sum + e.amount_minor : sum), 0);
  const remaining = received - spent;

  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const payeeName = new Map(payees.map((p) => [p.id, p.name]));

  async function signOut() {
    setBusy(true);
    const { error: err } = await getSupabase().auth.signOut();
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    window.location.reload();
  }

  async function removeEntry(entry: LiteEntryRow) {
    if (!window.confirm(`Delete entry from ${entry.entry_date}?`)) return;
    setBusy(true);
    setError(null);
    const { error: err } = await getSupabase().from('lite_entries').delete().eq('id', entry.id);
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    if (editing?.id === entry.id) setEditing(null);
    await refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-gray-100">{title ?? 'Lite Dashboard'}</h1>
        <div className="flex items-center gap-2">
          <input
            type="month"
            className="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-sm text-gray-100"
            value={month}
            max={currentMonth()}
            onChange={(e) => setMonth(e.target.value)}
          />
          {!readOnly && (
            <button className={btn('ghost')} onClick={signOut} disabled={busy}>
              Sign Out
            </button>
          )}
        </div>
      </div>

      {error && <Banner kind="error">{error}</Banner>}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardTitle>Total Received</CardTitle>
          <p className="text-2xl font-semibold text-green-500">{fmtMinor(received)}</p>
        </Card>
        <Card>
          <CardTitle>Total Spent</CardTitle>
          <p className="text-2xl font-semibold text-red-500">{fmtMinor(spent)}</p>
        </Card>
        <Card>
          <CardTitle>Remaining Balance</CardTitle>
          <p className={`text-2xl font-semibold ${remaining >= 0 ? 'text-gray-100' : 'text-red-500'}`}>{fmtMinor(remaining)}</p>
        </Card>
      </div>

      <LiteCharts entries={monthEntries} allEntries={entries} categories={categories} payees={payees} />

      <Card>
        <CardTitle>Entries — {month}</CardTitle>
        {busy ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : monthEntries.length === 0 ? (
          <p className="text-sm text-gray-400">No entries for this month.</p>
        ) : (
          <ul className="space-y-2">
            {monthEntries.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-300">
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-mono text-xs text-gray-500">{e.entry_date}</span>
                  {' · '}
                  {e.kind === 'received' ? 'Received' : 'Expense'}
                  {' · '}
                  {catName.get(e.category_id ?? 0) ?? 'Uncategorized'}
                  {e.payee_id != null ? ` · ${payeeName.get(e.payee_id) ?? 'Unknown'}` : ''}
                  {e.notes ? ` · ${e.notes}` : ''}
                </span>
                <span className={`shrink-0 font-semibold ${e.kind === 'received' ? 'text-green-500' : 'text-red-500'}`}>
                  {fmtMinor(e.amount_minor)}
                </span>
                {!readOnly && (
                  <span className="flex shrink-0 gap-2">
                    <button className={btn('ghost')} onClick={() => setEditing(e)} disabled={busy}>Edit</button>
                    <button className={btn('ghost')} onClick={() => removeEntry(e)} disabled={busy}>Delete</button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {!readOnly && (
        <LiteEntryForm
          ownerId={ownerId}
          categories={categories}
          payees={payees}
          editing={editing}
          onSaved={() => {
            setEditing(null);
            void refresh();
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      {!readOnly && (
        <LiteManagePanel
          ownerId={ownerId}
          categories={categories}
          payees={payees}
          onChanged={() => void refresh()}
        />
      )}
    </div>
  );
}

export default LiteDashboard;

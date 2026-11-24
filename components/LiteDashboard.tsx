'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { Banner } from '@/components/ui';
import { LiteCharts } from '@/components/lite/LiteCharts';
import { LiteEntryForm, LiteManagePanel } from '@/components/lite/LiteControls';
import type { LiteCategoryRow, LiteEntryRow, LitePayeeRow, LiteKind } from '@/lib/lite/types';

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

function fmtDay(date: string): string {
  return new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function mapName(map: Map<number, string>, id: number | null): string | undefined {
  return id == null ? undefined : map.get(id);
}

type Tab = 'entries' | 'charts' | 'manage';
type ModalState = { editing: LiteEntryRow | null; defaultKind?: LiteKind } | null;

const CARD = 'rounded-2xl border border-white/10 bg-slate-900/60 p-4';
const TEXT_BTN = 'min-h-[44px] inline-flex items-center text-sm text-slate-400';

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
  const [tab, setTab] = useState<Tab>('entries');
  const [modal, setModal] = useState<ModalState>(null);
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

  useEffect(() => {
    if (!modal) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [modal]);

  const monthEntries = useMemo(
    () => entries.filter((e) => e.entry_date.slice(0, 7) === month),
    [entries, month],
  );

  const received = monthEntries.reduce((sum, e) => (e.kind === 'received' ? sum + e.amount_minor : sum), 0);
  const spent = monthEntries.reduce((sum, e) => (e.kind === 'expense' ? sum + e.amount_minor : sum), 0);
  const remaining = received - spent;

  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const payeeName = new Map(payees.map((p) => [p.id, p.name]));

  const tabs: Tab[] = readOnly ? ['entries', 'charts'] : ['entries', 'charts', 'manage'];
  const activeTab = tabs.includes(tab) ? tab : 'entries';

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
    if (modal?.editing?.id === entry.id) setModal(null);
    await refresh();
  }


  return (
    <div className="mx-auto max-w-xl space-y-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-slate-100">{title ?? 'Lite Finance'}</h1>
        {!readOnly && (
          <button className={TEXT_BTN} onClick={signOut} disabled={busy}>Sign Out</button>
        )}
      </div>

      <input
        type="month"
        aria-label="Month"
        className="h-11 w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 text-sm text-slate-200"
        value={month}
        onChange={(e) => setMonth(e.target.value || currentMonth())}
      />

      {error && <Banner kind="error">{error}</Banner>}

      <div className={CARD}>
        <div className="text-xs uppercase tracking-wide text-slate-400">Remaining</div>
        <div className="mt-1 text-3xl font-semibold text-slate-100">{fmtMinor(remaining)}</div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs text-slate-400">Received</div>
            <div className="text-lg font-semibold text-emerald-400">{fmtMinor(received)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400">Spent</div>
            <div className="text-lg font-semibold text-rose-400">{fmtMinor(spent)}</div>
          </div>
        </div>
      </div>

      {!readOnly && (
        <div className="flex gap-2">
          <button
            className="min-h-[44px] flex-1 rounded-xl border border-rose-500/30 bg-rose-500/10 text-sm font-medium text-rose-300"
            onClick={() => setModal({ editing: null, defaultKind: 'expense' })}
          >
            + Expense
          </button>
          <button
            className="min-h-[44px] flex-1 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-sm font-medium text-emerald-300"
            onClick={() => setModal({ editing: null, defaultKind: 'received' })}
          >
            + Received
          </button>
        </div>
      )}

      <div className="flex gap-2">
        {tabs.map((t) => (
          <button
            key={t}
            className={`min-h-[44px] flex-1 rounded-xl px-3 text-sm font-medium ${
              activeTab === t ? 'bg-slate-800 text-slate-100' : 'text-slate-400'
            }`}
            onClick={() => setTab(t)}
          >
            {t === 'entries' ? 'Entries' : t === 'charts' ? 'Charts' : 'Manage'}
          </button>
        ))}
      </div>

      {activeTab === 'entries' && (
        <div className="space-y-2">
          {monthEntries.length === 0 && (
            <div className={`${CARD} text-sm text-slate-400`}>No entries this month.</div>
          )}
          {monthEntries.map((e) => (
            <div key={e.id} className={CARD}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-200">
                    {mapName(catName, e.category_id) ?? (e.kind === 'expense' ? 'Expense' : 'Received')}
                    {mapName(payeeName, e.payee_id) ? ` · ${mapName(payeeName, e.payee_id)}` : ''}
                  </div>
                </div>
                <div className={`shrink-0 text-sm font-semibold ${e.kind === 'expense' ? 'text-rose-400' : 'text-emerald-400'}`}>
                  {e.kind === 'expense' ? '−' : '+'}{fmtMinor(e.amount_minor)}
                </div>
              </div>
              <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 text-xs text-slate-400">
                  {fmtDay(e.entry_date)}
                  {e.notes ? <span className="ml-2 break-words">{e.notes}</span> : null}
                </div>
                {!readOnly && (
                  <div className="flex shrink-0 gap-2">
                    <button className={TEXT_BTN} onClick={() => setModal({ editing: e })}>Edit</button>
                    <button className={TEXT_BTN} onClick={() => removeEntry(e)} disabled={busy}>Delete</button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'charts' && (
        <LiteCharts
          entries={monthEntries}
          allEntries={entries}
          categories={categories}
          payees={payees}
        />
      )}

      {activeTab === 'manage' && !readOnly && (
        <LiteManagePanel
          ownerId={ownerId}
          categories={categories}
          payees={payees}
          onChanged={refresh}
        />
      )}

      {modal && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60"
          onClick={() => setModal(null)}
        >
          <div
            className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-t-2xl bg-slate-950 p-4"
            onClick={(ev) => ev.stopPropagation()}
          >
            <LiteEntryForm
              key={`${modal.editing?.id ?? 'new'}-${modal.defaultKind ?? 'default'}`}
              ownerId={ownerId}
              categories={categories}
              payees={payees}
              editing={modal.editing}
              defaultKind={modal.defaultKind}
              onSaved={() => {
                setModal(null);
                void refresh();
              }}
              onCancel={() => setModal(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default LiteDashboard;

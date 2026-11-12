'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import AppShell from '@/components/AppShell';
import CashflowCharts from '@/components/CashflowCharts';
import CsvImport from '@/components/CsvImport';
import EditTxnModal from '@/components/EditTxnModal';
import { Banner, Card, CardTitle, Field, btn, inputCls } from '@/components/ui';
import { rangeFor, type RangeKey } from '@/lib/dates';
import { formatINR, formatINRSigned, parseMoneyToMinor } from '@/lib/money';
import { supabase } from '@/lib/supabase';
import type {
  AccountRow, BalanceRow, CategoryRow, DashboardSummary, TxnRow,
} from '@/lib/types';
import { useToday } from '@/lib/use-today';

const PAGE_SIZE = 100;
const RANGE_KEYS: RangeKey[] = ['daily', 'weekly', 'monthly', 'yearly', 'all'];
type TxnType = 'income' | 'expense' | 'transfer';
type KindFilter = 'all' | 'expense' | 'income' | 'transfer';
type SortField = 'date' | 'amount' | 'payee' | 'category';
type Status = { kind: 'info' | 'error' | 'success'; msg: string } | null;

export default function Home() {
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [balances, setBalances] = useState<BalanceRow[]>([]);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [txns, setTxns] = useState<TxnRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [status, setStatus] = useState<Status>(null);

  const [sysExpenseAcc, setSysExpenseAcc] = useState<number | null>(null);
  const [sysIncomeAcc, setSysIncomeAcc] = useState<number | null>(null);

  const today = useToday();
  const [timeRange, setTimeRange] = useState<RangeKey>('monthly');
  const range = useMemo(
    () => (today ? rangeFor(timeRange, today) : null),
    [today, timeRange],
  );

  // Filter & Sort state
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [sortBy, setSortBy] = useState<SortField>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [editingTxn, setEditingTxn] = useState<TxnRow | null>(null);

  // Quick add
  const [txnType, setTxnType] = useState<TxnType>('expense');
  const [payee, setPayee] = useState('');
  const [amount, setAmount] = useState('');
  const [txnDate, setTxnDate] = useState('');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  useEffect(() => {
    if (today) setTxnDate(prev => prev || today);
  }, [today]);

  useEffect(() => {
    if (txnType === 'transfer') return;
    const matching = categories.filter(c => c.kind === txnType);
    if (matching.length && !matching.some(c => String(c.id) === categoryId)) {
      setCategoryId(String(matching[0].id));
    }
  }, [txnType, categories, categoryId]);

  const catNameById = useMemo(() => {
    const m: Record<number, string> = {};
    categories.forEach(c => { m[c.id] = c.name; });
    return m;
  }, [categories]);

  const loadReference = useCallback(async () => {
    const db = supabase();
    const [accRes, catRes, balRes] = await Promise.all([
      db.from('accounts')
        .select('id,name,type,subtype,currency,is_active,credit_limit_minor,statement_day,due_day')
        .eq('is_active', true).order('name'),
      db.from('categories').select('id,name,kind,parent_id,is_active').eq('is_active', true).order('name'),
      db.from('account_balances').select('id,name,type,subtype,balance_minor,is_active'),
    ]);

    const all = (accRes.data ?? []) as AccountRow[];
    const disp = all.filter(a => a.type !== 'income' && a.type !== 'expense' && a.type !== 'equity');
    setAccounts(disp);
    setSysExpenseAcc(all.find(a => a.type === 'expense')?.id ?? null);
    setSysIncomeAcc(all.find(a => a.type === 'income')?.id ?? null);
    setCategories((catRes.data ?? []) as CategoryRow[]);
    setBalances(((balRes.data ?? []) as BalanceRow[]).filter(b => b.type !== 'income' && b.type !== 'expense' && b.type !== 'equity' && b.is_active));

    if (disp.length) {
      setAccountId(prev => prev || String(disp[0].id));
      setFromId(prev => prev || String(disp[0].id));
      setToId(prev => prev || String((disp[1] ?? disp[0]).id));
    }
  }, []);

  const loadSummary = useCallback(async () => {
    if (!range) return;
    const ranges = range.from ? [{ from: range.from, to: range.to ?? range.from }] : [];
    const { data, error } = await supabase().rpc('dashboard_summary', { p_ranges: ranges });
    if (error) { setStatus({ kind: 'error', msg: `Summary failed: ${error.message}` }); return; }
    setSummary(data as DashboardSummary);
  }, [range]);

  const loadTxns = useCallback(async (offset: number) => {
    if (!range) return [];

    let q = supabase()
      .from('transactions')
      .select('id,txn_date,payee,narration,notes,kind,voided_at,postings(id,txn_id,account_id,amount_minor,category_id,accounts(name,type))')
      .is('voided_at', null)
      .neq('kind', 'opening')
      .order('txn_date', { ascending: false })
      .order('id', { ascending: false });

    if (range.from) q = q.gte('txn_date', range.from);
    if (range.to) q = q.lte('txn_date', range.to);
    q = q.range(offset, offset + PAGE_SIZE - 1);

    const { data, error } = await q;
    if (error) { setStatus({ kind: 'error', msg: `Ledger load failed: ${error.message}` }); return []; }

    const rows = (data ?? []) as unknown as TxnRow[];
    setTxns(prev => (offset === 0 ? rows : [...prev, ...rows]));
    setHasMore(rows.length === PAGE_SIZE);
    return rows;
  }, [range]);

  const refreshAll = useCallback(async () => {
    if (!range) return;
    setIsLoading(true);
    setSelectedIds([]);
    await Promise.all([loadReference(), loadSummary(), loadTxns(0)]);
    setIsLoading(false);
  }, [range, loadReference, loadSummary, loadTxns]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  /* ---------------- Client Filter & Sort ---------------- */
  const visibleTxns = useMemo(() => {
    const getTxnAmount = (t: TxnRow) => {
      const nonSys = t.postings.find(p => p.accounts?.type !== 'expense' && p.accounts?.type !== 'income');
      return Math.abs(nonSys?.amount_minor ?? t.postings[0]?.amount_minor ?? 0);
    };
    const getTxnCategory = (t: TxnRow) => {
      const catLeg = t.postings.find(p => p.category_id != null);
      if (catLeg?.category_id && catNameById[catLeg.category_id]) return catNameById[catLeg.category_id];
      return t.kind === 'transfer' ? 'Transfer' : 'Uncategorized';
    };

    const filtered = txns.filter(t => {
      if (kindFilter === 'all') return true;
      return t.kind === kindFilter;
    });

    const mult = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortBy === 'date') {
        if (a.txn_date !== b.txn_date) return a.txn_date < b.txn_date ? -1 * mult : 1 * mult;
        return (a.id - b.id) * mult;
      }
      if (sortBy === 'amount') {
        return (getTxnAmount(a) - getTxnAmount(b)) * mult;
      }
      if (sortBy === 'payee') {
        return (a.payee ?? '').localeCompare(b.payee ?? '') * mult;
      }
      if (sortBy === 'category') {
        return getTxnCategory(a).localeCompare(getTxnCategory(b)) * mult;
      }
      return 0;
    });
  }, [txns, kindFilter, sortBy, sortDir, catNameById]);

  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus(null);

    let minor: number;
    try {
      minor = Math.abs(parseMoneyToMinor(amount));
      if (minor === 0) throw new Error('Amount must be greater than zero.');
    } catch (err) {
      setStatus({ kind: 'error', msg: err instanceof Error ? err.message : String(err) });
      return;
    }

    let postings: { account_id: number; amount_minor: number; category_id: number | null }[] = [];

    if (txnType === 'expense') {
      if (!accountId || !sysExpenseAcc) {
        setStatus({ kind: 'error', msg: 'Select an account (and ensure system accounts exist).' });
        return;
      }
      postings = [
        { account_id: Number(accountId), amount_minor: -minor, category_id: null },
        { account_id: sysExpenseAcc, amount_minor: minor, category_id: categoryId ? Number(categoryId) : null },
      ];
    } else if (txnType === 'income') {
      if (!accountId || !sysIncomeAcc) {
        setStatus({ kind: 'error', msg: 'Select an account (and ensure system accounts exist).' });
        return;
      }
      postings = [
        { account_id: Number(accountId), amount_minor: minor, category_id: null },
        { account_id: sysIncomeAcc, amount_minor: -minor, category_id: categoryId ? Number(categoryId) : null },
      ];
    } else {
      if (!fromId || !toId || fromId === toId) {
        setStatus({ kind: 'error', msg: 'Choose two different accounts for a transfer.' });
        return;
      }
      postings = [
        { account_id: Number(fromId), amount_minor: -minor, category_id: null },
        { account_id: Number(toId), amount_minor: minor, category_id: null },
      ];
    }

    setIsSubmitting(true);
    const { error } = await supabase().rpc('create_transaction', {
      p_date: txnDate,
      p_payee: txnType === 'transfer' ? 'Internal Transfer' : payee.trim(),
      p_narration: `Manual-${payee.trim() || 'Transfer'}`,
      p_kind: txnType,
      p_postings: postings,
      p_notes: null,
    });
    setIsSubmitting(false);

    if (error) {
      setStatus({ kind: 'error', msg: error.message });
      return;
    }

    setPayee('');
    setAmount('');
    setStatus({ kind: 'success', msg: 'Transaction recorded.' });
    await refreshAll();
  };

  const voidIds = async (ids: number[], reason: string) => {
    if (!ids.length) return;
    const { data, error } = await supabase().rpc('void_transactions', {
      p_ids: ids,
      p_reason: reason,
    });
    if (error) {
      setStatus({ kind: 'error', msg: `Void failed: ${error.message}` });
      return;
    }
    const count = Number(data ?? 0);
    setStatus({ kind: 'success', msg: `Voided ${count} transaction(s).` });
    await refreshAll();
  };

  const toggleAll = (checked: boolean) => {
    setSelectedIds(checked ? visibleTxns.map(t => t.id) : []);
  };

  const toggleOne = (id: number, checked: boolean) => {
    setSelectedIds(prev => (checked ? [...prev, id] : prev.filter(x => x !== id)));
  };

  const rangePills = (
    <div className="hide-scrollbar flex max-w-full overflow-x-auto rounded-lg border border-gray-800 bg-gray-950/60 p-1">
      {RANGE_KEYS.map(k => (
        <button
          key={k}
          type="button"
          onClick={() => setTimeRange(k)}
          className={`min-h-9 shrink-0 whitespace-nowrap rounded-md px-3 text-xs font-semibold capitalize transition-colors ${
            timeRange === k ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
          }`}
        >
          {k}
        </button>
      ))}
    </div>
  );

  return (
    <AppShell title="Dashboard" subtitle={range?.label ?? 'Loading…'} actions={rangePills}>
      {status ? <div className="mb-4"><Banner kind={status.kind}>{status.msg}</Banner></div> : null}

      <div className="flex flex-col gap-4 sm:gap-6">
        {balances.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
            {balances.map(b => {
              const displayMinor = b.type === 'liability' ? -b.balance_minor : b.balance_minor;
              return (
                <div key={b.id} className="min-w-0 rounded-xl border border-gray-800 bg-gray-800/60 p-4">
                  <div className="truncate text-xs text-gray-400">{b.name}</div>
                  <div className="tabular mt-1 truncate text-lg font-bold text-white sm:text-xl">
                    {formatINR(displayMinor)}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-4 sm:gap-6">
            <Card>
              <CardTitle>Quick entry</CardTitle>
              <div className="mb-4 flex rounded-lg border border-gray-700 bg-gray-900 p-1">
                {(['income', 'expense', 'transfer'] as TxnType[]).map(t => {
                  const activeTone =
                    t === 'income' ? 'bg-emerald-600 text-white'
                    : t === 'expense' ? 'bg-blue-600 text-white'
                    : 'bg-purple-600 text-white';
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTxnType(t)}
                      className={`min-h-9 flex-1 rounded-md text-xs font-semibold capitalize transition-colors ${
                        txnType === t ? activeTone : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>

              <form onSubmit={handleQuickAdd} className="space-y-3">
                <Field label="Date" htmlFor="qa-date">
                  <input id="qa-date" type="date" required value={txnDate}
                         onChange={e => setTxnDate(e.target.value)} className={inputCls} />
                </Field>
                <Field label="Amount (₹)" htmlFor="qa-amount">
                  <input id="qa-amount" type="text" inputMode="decimal" required value={amount}
                         onChange={e => setAmount(e.target.value)} placeholder="0.00" className={inputCls} />
                </Field>

                {txnType !== 'transfer' ? (
                  <>
                    <Field label="Payee" htmlFor="qa-payee">
                      <input id="qa-payee" type="text" required value={payee}
                             onChange={e => setPayee(e.target.value)} placeholder="Merchant or person" className={inputCls} />
                    </Field>
                    <Field label="Account" htmlFor="qa-account">
                      <select id="qa-account" value={accountId}
                              onChange={e => setAccountId(e.target.value)} className={inputCls}>
                        {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                    </Field>
                    <Field label="Category" htmlFor="qa-category">
                      <select id="qa-category" value={categoryId}
                              onChange={e => setCategoryId(e.target.value)} className={inputCls}>
                        {categories.filter(c => c.kind === txnType).map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </Field>
                  </>
                ) : (
                  <>
                    <Field label="From account" htmlFor="qa-from">
                      <select id="qa-from" value={fromId}
                              onChange={e => setFromId(e.target.value)} className={inputCls}>
                        {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                    </Field>
                    <Field label="To account" htmlFor="qa-to">
                      <select id="qa-to" value={toId}
                              onChange={e => setToId(e.target.value)} className={inputCls}>
                        {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                    </Field>
                  </>
                )}

                <button type="submit" disabled={isSubmitting} className={btn('primary', 'w-full')}>
                  {isSubmitting ? 'Saving…' : txnType === 'income' ? 'Add income' : txnType === 'expense' ? 'Add expense' : 'Record transfer'}
                </button>
              </form>
            </Card>

            <CsvImport onImported={refreshAll} />
          </div>

          <div className="min-w-0 lg:col-span-2">
            <Card className="p-0 sm:p-0">
              {/* Header + Filter & Sort Controls */}
              <div className="flex flex-col gap-3 border-b border-gray-800 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-semibold text-gray-100 sm:text-lg">
                    Transactions ({visibleTxns.length})
                  </h2>
                  {selectedIds.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => voidIds(selectedIds, 'bulk void')}
                      className={btn('danger', 'text-xs')}
                    >
                      Void selected ({selectedIds.length})
                    </button>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  {/* Type toggle: All / Expense / Income / Transfer */}
                  <div className="flex rounded-lg border border-gray-700 bg-gray-900 p-0.5">
                    {(['all', 'expense', 'income', 'transfer'] as KindFilter[]).map(k => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setKindFilter(k)}
                        className={`min-h-8 rounded-md px-2.5 text-xs font-semibold capitalize transition-colors ${
                          kindFilter === k ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
                        }`}
                      >
                        {k}
                      </button>
                    ))}
                  </div>

                  {/* Sort controls */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-gray-400">Sort:</span>
                    <select
                      aria-label="Sort transactions by"
                      value={sortBy}
                      onChange={e => setSortBy(e.target.value as SortField)}
                      className="min-h-8 rounded-lg border border-gray-700 bg-gray-900 px-2.5 py-1 text-xs text-white"
                    >
                      <option value="date">Date</option>
                      <option value="amount">Amount</option>
                      <option value="payee">Payee</option>
                      <option value="category">Category</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'))}
                      title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
                      className="min-h-8 rounded-lg border border-gray-700 bg-gray-900 px-2.5 text-xs font-bold text-gray-300 hover:text-white"
                    >
                      {sortDir === 'asc' ? '↑ Asc' : '↓ Desc'}
                    </button>
                  </div>
                </div>
              </div>

              {isLoading ? (
                <div className="p-8 text-center text-sm text-gray-500">Loading secure ledger…</div>
              ) : visibleTxns.length === 0 ? (
                <div className="p-8 text-center text-sm text-gray-500">No transactions match this filter.</div>
              ) : (
                <>
                  <ul className="divide-y divide-gray-800 sm:hidden">
                    {visibleTxns.map(t => {
                      const catLeg = t.postings.find(p => p.category_id != null);
                      const catLabel = catLeg?.category_id ? catNameById[catLeg.category_id] : (t.kind === 'transfer' ? 'Transfer' : null);
                      return (
                        <li key={t.id} className="flex items-start justify-between gap-2 p-3.5">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="truncate text-sm font-medium text-gray-100">{t.payee || '—'}</span>
                              <span className="tabular shrink-0 text-xs text-gray-400">{t.txn_date}</span>
                            </div>
                            {catLabel ? (
                              <span className="mt-0.5 inline-block rounded bg-gray-900 px-1.5 py-0.5 text-[10px] text-blue-300">
                                {catLabel}
                              </span>
                            ) : null}
                            {t.notes || t.narration ? (
                              <div className="mt-0.5 truncate font-mono text-[11px] text-gray-400">{t.notes || t.narration}</div>
                            ) : null}
                            <PostingAmounts postings={t.postings} compact />
                          </div>
                          <div className="flex shrink-0 items-center">
                            <button
                              type="button"
                              onClick={() => setEditingTxn(t)}
                              aria-label="Edit transaction"
                              className="min-h-10 min-w-10 rounded text-gray-400 hover:text-blue-400"
                            >
                              ✏️
                            </button>
                            <button
                              type="button"
                              onClick={() => voidIds([t.id], 'manual void')}
                              aria-label="Void transaction"
                              className="min-h-10 min-w-10 rounded text-gray-400 hover:text-red-400"
                            >
                              🗑️
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>

                  <div className="hidden overflow-x-auto sm:block">
                    <table className="w-full min-w-[640px] border-collapse text-left">
                      <thead>
                        <tr className="border-b border-gray-800 bg-gray-900/50 text-xs text-gray-400">
                          <th className="w-10 p-3">
                            <input
                              type="checkbox"
                              aria-label="Select all transactions"
                              className="h-4 w-4 cursor-pointer rounded accent-blue-500"
                              checked={visibleTxns.length > 0 && selectedIds.length === visibleTxns.length}
                              onChange={e => toggleAll(e.target.checked)}
                            />
                          </th>
                          <th className="p-3">Date</th>
                          <th className="p-3">Payee / Category</th>
                          <th className="p-3">Postings</th>
                          <th className="w-24 p-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleTxns.map(t => {
                          const catLeg = t.postings.find(p => p.category_id != null);
                          const catLabel = catLeg?.category_id ? catNameById[catLeg.category_id] : (t.kind === 'transfer' ? 'Transfer' : null);
                          return (
                            <tr key={t.id} className="group border-b border-gray-800/60 hover:bg-gray-700/20">
                              <td className="p-3">
                                <input
                                  type="checkbox"
                                  aria-label="Select transaction"
                                  className="h-4 w-4 cursor-pointer rounded accent-blue-500"
                                  checked={selectedIds.includes(t.id)}
                                  onChange={e => toggleOne(t.id, e.target.checked)}
                                />
                              </td>
                              <td className="tabular whitespace-nowrap p-3 text-sm text-gray-300">{t.txn_date}</td>
                              <td className="p-3">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium text-gray-100">{t.payee || '—'}</span>
                                  {catLabel ? (
                                    <span className="rounded bg-gray-900 px-1.5 py-0.5 text-[10px] font-medium text-blue-300">
                                      {catLabel}
                                    </span>
                                  ) : null}
                                </div>
                                <div className="max-w-xs truncate font-mono text-[11px] text-gray-400">{t.notes || t.narration}</div>
                              </td>
                              <td className="p-3">
                                <PostingAmounts postings={t.postings} />
                              </td>
                              <td className="p-3 text-right">
                                <div className="inline-flex items-center justify-end gap-1">
                                  <button
                                    type="button"
                                    onClick={() => setEditingTxn(t)}
                                    title="Edit Transaction"
                                    className="min-h-9 min-w-9 rounded text-gray-400 hover:bg-gray-700 hover:text-blue-400"
                                  >
                                    ✏️
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => voidIds([t.id], 'manual void')}
                                    title="Void Transaction"
                                    className="min-h-9 min-w-9 rounded text-gray-400 hover:bg-gray-700 hover:text-red-400"
                                  >
                                    🗑️
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {hasMore ? (
                    <div className="border-t border-gray-800 p-3 text-center">
                      <button
                        type="button"
                        onClick={() => void loadTxns(txns.length)}
                        className={btn('neutral', 'text-xs')}
                      >
                        Load more
                      </button>
                    </div>
                  ) : null}
                </>
              )}
            </Card>
          </div>
        </div>

        <CashflowCharts summary={summary} />
      </div>

      <EditTxnModal
        txn={editingTxn}
        accounts={accounts}
        categories={categories}
        sysExpenseAcc={sysExpenseAcc}
        sysIncomeAcc={sysIncomeAcc}
        onClose={() => setEditingTxn(null)}
        onSaved={refreshAll}
      />
    </AppShell>
  );
}

function PostingAmounts({
  postings, compact = false,
}: { postings: TxnRow['postings']; compact?: boolean }) {
  return (
    <div className={compact ? 'mt-1 space-y-0.5' : 'space-y-0.5'}>
      {postings.map(p => {
        const isSystem = p.accounts?.type === 'expense' || p.accounts?.type === 'income';
        const cls = isSystem ? 'text-gray-500' : p.amount_minor < 0 ? 'text-red-400' : 'text-emerald-400';
        return (
          <div key={p.id} className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-xs text-gray-400">{p.accounts?.name ?? '—'}</span>
            <span className={`tabular shrink-0 text-xs font-medium ${cls}`}>
              {formatINRSigned(p.amount_minor)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

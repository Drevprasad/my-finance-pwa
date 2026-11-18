'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AppShell from '@/components/AppShell';
import CashflowCharts from '@/components/CashflowCharts';
import CategoryTrend from '@/components/CategoryTrend';
import InvestmentsPanel from '@/components/InvestmentsPanel';
import EditTxnModal from '@/components/EditTxnModal';
import ReportFilters from '@/components/ReportFilters';
import { Banner, Card, CardTitle, Field, btn, inputCls } from '@/components/ui';
import { dayRange, monthRange, yearRange, type DateRange } from '@/lib/dates';
import { formatINR, formatINRSigned } from '@/lib/money';
import {
  EMPTY_FILTERS, activeFilterCount, filterLabel, idsOrNull, rangesToPayload, spanOf,
  type ReportFilterState,
} from '@/lib/reportFilters';
import { supabase } from '@/lib/supabase';
import type {
  AccountRow, CategoryRow, CategoryTrend as TrendData, DashboardSummary, InvestmentTrend, TxnRow,
} from '@/lib/types';
import { useToday } from '@/lib/use-today';

type Mode = 'months' | 'range' | 'years' | 'days';
type KindFilter = 'all' | 'expense' | 'income' | 'transfer';
type SortField = 'date' | 'amount' | 'payee' | 'category';
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const LIST_LIMIT = 500;

export default function Reports() {
  const today = useToday();
  const nowYear = today ? Number(today.slice(0, 4)) : null;
  const [mode, setMode] = useState<Mode>('months');
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [trend, setTrend] = useState<TrendData | null>(null);
  const [invTrend, setInvTrend] = useState<InvestmentTrend | null>(null);
  const [txns, setTxns] = useState<TxnRow[]>([]);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [sysExpenseAcc, setSysExpenseAcc] = useState<number | null>(null);
  const [sysIncomeAcc, setSysIncomeAcc] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Account / category filters (applied in SQL)
  const [filters, setFilters] = useState<ReportFilterState>(EMPTY_FILTERS);

  // List-only: kind filter, sort & edit
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [sortBy, setSortBy] = useState<SortField>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [editingTxn, setEditingTxn] = useState<TxnRow | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');
  const [pickerYear, setPickerYear] = useState<number | null>(null);
  const [months, setMonths] = useState<DateRange[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [dayInput, setDayInput] = useState('');
  const [days, setDays] = useState<DateRange[]>([]);

  // Newest request wins; older responses are ignored.
  const mainReq = useRef(0);
  const sideReq = useRef(0);

  useEffect(() => {
    if (!today) return;
    const y = Number(today.slice(0, 4));
    const m = Number(today.slice(5, 7));

    setRangeFrom(prev => prev || `${y}-01-01`);
    setRangeTo(prev => prev || today);
    setPickerYear(prev => prev ?? y);
    setYears(prev => (prev.length ? prev : [y]));
    setMonths(prev => (prev.length ? prev : [monthRange(y, m)]));
    setDays(prev => (prev.length ? prev : [dayRange(today)]));
  }, [today]);

  const ranges: DateRange[] = useMemo(() => {
    if (mode === 'months') return months;
    if (mode === 'years') return years.map(y => yearRange(y));
    if (mode === 'days') return days;
    return [{ from: rangeFrom || null, to: rangeTo || null, label: 'Custom range' }];
  }, [mode, months, years, days, rangeFrom, rangeTo]);

  const payload = useMemo(() => rangesToPayload(ranges), [ranges]);
  const span = useMemo(() => spanOf(payload), [payload]);

  const catNameById = useMemo(() => {
    const m: Record<number, string> = {};
    categories.forEach(c => { m[c.id] = c.name; });
    return m;
  }, [categories]);

  const toggleMonthRange = (r: DateRange) =>
    setMonths(prev => {
      const exists = prev.some(x => x.from === r.from);
      return exists ? prev.filter(x => x.from !== r.from) : [...prev, r].sort((a, b) => (a.from! < b.from! ? -1 : 1));
    });

  const toggleYear = (y: number) =>
    setYears(prev => (prev.includes(y) ? prev.filter(x => x !== y) : [...prev, y].sort()));

  // Accounts + categories: loaded once (they feed the filter UI and the edit modal).
  const loadReference = useCallback(async () => {
    const db = supabase();
    const [accRes, catRes] = await Promise.all([
      db.from('accounts').select('id,name,type,subtype,currency,is_active,credit_limit_minor,statement_day,due_day').eq('is_active', true).order('name'),
      db.from('categories').select('id,name,kind,parent_id,is_active').eq('is_active', true).order('name'),
    ]);
    if (accRes.error || catRes.error) {
      setErr(accRes.error?.message ?? catRes.error?.message ?? 'Unknown error');
    }
    const allAcc = (accRes.data ?? []) as AccountRow[];
    setAccounts(allAcc.filter(a => a.type !== 'income' && a.type !== 'expense' && a.type !== 'equity'));
    setSysExpenseAcc(allAcc.find(a => a.type === 'expense')?.id ?? null);
    setSysIncomeAcc(allAcc.find(a => a.type === 'income')?.id ?? null);
    setCategories((catRes.data ?? []) as CategoryRow[]);
  }, []);
  useEffect(() => { void loadReference(); }, [loadReference]);

  // Summary cards + charts + transaction list: same date ranges and filters, all in SQL.
  const load = useCallback(async () => {
    if (!today) return;
    const my = ++mainReq.current;
    setIsLoading(true);
    setErr(null);

    const db = supabase();
    const accIds = filters.accountIds;
    const catIds = filters.categoryIds;

    // Extra aliased inner-joins filter the parent rows but keep the full `postings` list intact.
    const select = [
      'id,txn_date,payee,narration,notes,kind,voided_at',
      'postings(id,txn_id,account_id,amount_minor,category_id,accounts(name,type))',
      accIds.length ? 'fa:postings!inner(account_id)' : '',
      catIds.length ? 'fc:postings!inner(category_id)' : '',
    ].filter(Boolean).join(',');

    let q = db
      .from('transactions')
      .select(select)
      .is('voided_at', null)
      .neq('kind', 'opening')
      .order('txn_date', { ascending: false })
      .order('id', { ascending: false })
      .limit(LIST_LIMIT);
    if (payload.length) {
      const or = payload
        .map(r => `and(txn_date.gte.${r.from},txn_date.lte.${r.to})`)
        .join(',');
      q = q.or(or);
    }
    if (accIds.length) q = q.in('fa.account_id', accIds);
    if (catIds.length) q = q.in('fc.category_id', catIds);

    const [sumRes, txnRes] = await Promise.all([
      db.rpc('dashboard_summary', {
        p_ranges: payload,
        p_account_ids: idsOrNull(accIds),
        p_category_ids: idsOrNull(catIds),
      }),
      q,
    ]);
    if (my !== mainReq.current) return;

    if (sumRes.error || txnRes.error) {
      setErr(sumRes.error?.message ?? txnRes.error?.message ?? 'Unknown error');
    }
    setSummary((sumRes.data as DashboardSummary) ?? null);
    setTxns(((txnRes.data ?? []) as unknown) as TxnRow[]);
    setIsLoading(false);
  }, [today, payload, filters]);
  useEffect(() => { void load(); }, [load]);

  // Category trend + investment balances: same period and filters.
  const loadSide = useCallback(async () => {
    if (!today) return;
    const my = ++sideReq.current;
    const db = supabase();
    const accParam = idsOrNull(filters.accountIds);

    const [trRes, invRes] = await Promise.all([
      db.rpc('category_trend', {
        p_from: span?.from ?? null,
        p_to: span?.to ?? null,
        p_account_ids: accParam,
        p_category_ids: idsOrNull(filters.categoryIds),
        p_ranges: payload,
      }),
      db.rpc('investment_trend', {
        p_from: span?.from ?? null,
        p_to: span?.to ?? null,
        p_account_ids: accParam,
      }),
    ]);
    if (my !== sideReq.current) return;

    if (trRes.error || invRes.error) {
      setErr(trRes.error?.message ?? invRes.error?.message ?? 'Unknown error');
    }
    setTrend((trRes.data as TrendData) ?? null);
    setInvTrend((invRes.data as InvestmentTrend) ?? null);
  }, [today, payload, span, filters]);
  useEffect(() => { void loadSide(); }, [loadSide]);

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
      // 1. Filter by kind
      if (kindFilter !== 'all' && t.kind !== kindFilter) return false;

      // 2. Filter by search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const payeeMatch = (t.payee || '').toLowerCase().includes(q);
        const catMatch = getTxnCategory(t).toLowerCase().includes(q);
        const noteMatch = (t.notes || t.narration || '').toLowerCase().includes(q);
        
        const amountMatch = (getTxnAmount(t) / 100).toString().includes(q);

        return payeeMatch || catMatch || noteMatch || amountMatch;
      }
      
      return true;
    });

    const mult = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortBy === 'date') {
        if (a.txn_date !== b.txn_date) return a.txn_date < b.txn_date ? -1 * mult : 1 * mult;
        return (a.id - b.id) * mult;
      }
      if (sortBy === 'amount') return (getTxnAmount(a) - getTxnAmount(b)) * mult;
      if (sortBy === 'payee') return (a.payee ?? '').localeCompare(b.payee ?? '') * mult;
      if (sortBy === 'category') return getTxnCategory(a).localeCompare(getTxnCategory(b)) * mult;
      return 0;
    });
  }, [txns, kindFilter, sortBy, sortDir, catNameById, searchQuery]); 
  

  // Same maths as the SQL: income = -(income-account legs), expense = +(expense-account legs).
  const listTotals = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const t of visibleTxns) {
      for (const p of t.postings) {
        if (p.accounts?.type === 'income') income -= p.amount_minor;
        else if (p.accounts?.type === 'expense') expense += p.amount_minor;
      }
    }
    return { income, expense };
  }, [visibleTxns]);

  const voidOne = async (id: number) => {
    const { error } = await supabase().rpc('void_transactions', {
      p_ids: [id],
      p_reason: 'voided from reports',
    });
    if (error) { setErr(error.message); return; }
    await Promise.all([load(), loadSide()]);
  };

  if (!today || nowYear === null || pickerYear === null) {
    return (
      <AppShell title="Reports" subtitle="Loading…">
        <Card>
          <div className="p-6 text-center text-sm text-gray-400">Loading reports…</div>
        </Card>
      </AppShell>
    );
  }

  const label = ranges.length ? ranges.map(r => r.label).join(', ') : 'All time';
  const filterText = filterLabel(filters);
  const isFiltered = activeFilterCount(filters) > 0;

  return (
    <AppShell title="Reports" subtitle={filterText ? `${label} · ${filterText}` : label}>
      {err ? <div className="mb-4"><Banner kind="error">{err}</Banner></div> : null}

      <div className="flex flex-col gap-4 sm:gap-6">
        <Card>
          <CardTitle>Period</CardTitle>

          <div className="mb-4 flex flex-wrap gap-1 rounded-lg border border-gray-700 bg-gray-900 p-1">
            {([
              ['months', 'Months'],
              ['range', 'Date range'],
              ['years', 'Years'],
              ['days', 'Days'],
            ] as [Mode, string][]).map(([id, text]) => (
              <button
                key={id}
                type="button"
                onClick={() => setMode(id)}
                aria-pressed={mode === id}
                className={`min-h-9 flex-1 rounded-md px-3 text-xs font-semibold sm:flex-none ${
                  mode === id ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                {text}
              </button>
            ))}
          </div>

          {mode === 'months' ? (
            <div className="space-y-3">
              <div className="hide-scrollbar flex items-center gap-2 overflow-x-auto pb-1">
                <span className="shrink-0 text-xs text-gray-400">Year</span>
                {[nowYear - 2, nowYear - 1, nowYear, nowYear + 1].map(y => (
                  <button key={y} type="button" onClick={() => setPickerYear(y)}
                          className={`min-h-9 shrink-0 rounded-md border px-3 text-xs font-bold ${
                            pickerYear === y
                              ? 'border-purple-500 bg-purple-600 text-white'
                              : 'border-gray-700 bg-gray-900 text-gray-400'
                          }`}>
                    {y}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-12">
                {MONTHS.map((m, i) => {
                  const r = monthRange(pickerYear, i + 1);
                  const on = months.some(x => x.from === r.from);
                  return (
                    <button key={m} type="button" onClick={() => toggleMonthRange(r)}
                            aria-pressed={on}
                            className={`min-h-11 rounded-lg border text-xs font-semibold ${
                              on ? 'border-blue-400 bg-blue-600 text-white'
                                 : 'border-gray-700 bg-gray-900 text-gray-400 hover:text-white'
                            }`}>
                      {m}
                    </button>
                  );
                })}
              </div>
              <Chips items={months.map(r => ({ key: r.from!, text: r.label }))}
                     onRemove={key => setMonths(prev => prev.filter(r => r.from !== key))}
                     onClear={() => setMonths([])} />
            </div>
          ) : null}

          {mode === 'range' ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="From" htmlFor="rg-from">
                <input id="rg-from" type="date" value={rangeFrom}
                       onChange={e => setRangeFrom(e.target.value)} className={inputCls} />
              </Field>
              <Field label="To" htmlFor="rg-to">
                <input id="rg-to" type="date" value={rangeTo}
                       onChange={e => setRangeTo(e.target.value)} className={inputCls} />
              </Field>
            </div>
          ) : null}

          {mode === 'years' ? (
            <div className="flex flex-wrap gap-2">
              {[nowYear - 4, nowYear - 3, nowYear - 2, nowYear - 1, nowYear, nowYear + 1].map(y => (
                <button key={y} type="button" onClick={() => toggleYear(y)} aria-pressed={years.includes(y)}
                        className={`min-h-11 rounded-lg border px-4 text-sm font-bold ${
                          years.includes(y) ? 'border-blue-400 bg-blue-600 text-white'
                                            : 'border-gray-700 bg-gray-900 text-gray-400'
                        }`}>
                  {y}
                </button>
              ))}
            </div>
          ) : null}

          {mode === 'days' ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Add a day" htmlFor="day-input">
                  <input id="day-input" type="date" value={dayInput}
                         onChange={e => setDayInput(e.target.value)} className={inputCls} />
                </Field>
                <button type="button" className={btn('primary')}
                        onClick={() => {
                          if (!dayInput) return;
                          const r = dayRange(dayInput);
                          setDays(prev => (prev.some(x => x.from === r.from) ? prev : [...prev, r].sort((a, b) => (a.from! < b.from! ? -1 : 1))));
                          setDayInput('');
                        }}>
                  Add
                </button>
              </div>
              <Chips items={days.map(r => ({ key: r.from!, text: r.label }))}
                     onRemove={key => setDays(prev => prev.filter(r => r.from !== key))}
                     onClear={() => setDays([])} />
            </div>
          ) : null}
        </Card>

        <ReportFilters
          accounts={accounts}
          categories={categories}
          value={filters}
          onChange={setFilters}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-6">
          <Kpi label="Income" value={formatINR(summary?.income_minor ?? 0)} tone="text-emerald-400" />
          <Kpi label="Expenses" value={formatINR(summary?.expense_minor ?? 0)} tone="text-red-400" />
          <Kpi
            label="Net"
            value={formatINRSigned((summary?.income_minor ?? 0) - (summary?.expense_minor ?? 0))}
            tone={((summary?.income_minor ?? 0) - (summary?.expense_minor ?? 0)) >= 0 ? 'text-blue-400' : 'text-amber-400'}
          />
        </div>

        <CashflowCharts summary={summary} filtered={isFiltered} />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
          <CategoryTrend trend={trend} filtered={isFiltered} />
          <InvestmentsPanel trend={invTrend} categoryFilterActive={filters.categoryIds.length > 0} />
        </div>

        <Card className="p-0 sm:p-0">
          <div className="flex flex-col gap-3 border-b border-gray-800 p-4">
            <h2 className="text-base font-semibold text-gray-100 sm:text-lg">
              Matching transactions ({visibleTxns.length}{txns.length === LIST_LIMIT ? '+' : ''})
            </h2>
            <p className="tabular text-xs text-gray-400">
              On this list: Income <span className="text-emerald-400">{formatINR(listTotals.income)}</span>
              {' · '}Expenses <span className="text-red-400">{formatINR(listTotals.expense)}</span>
              {txns.length === LIST_LIMIT ? ` · first ${LIST_LIMIT} only` : ''}
            </p>

            <div className="flex flex-wrap items-center justify-between gap-2">
              
              {/* Group the toggle and search together */}
              <div className="flex flex-wrap items-center gap-2">
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

                <input
                  type="search"
                  placeholder="Search transactions..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="min-h-8 w-full rounded-lg border border-gray-700 bg-gray-900 px-2.5 py-1 text-xs text-white placeholder-gray-500 sm:w-48"
                />
              </div>

              {/* Sort controls remain here */}
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
                  className="min-h-8 rounded-lg border border-gray-700 bg-gray-900 px-2.5 text-xs font-bold text-gray-300 hover:text-white"
                >
                  {sortDir === 'asc' ? '↑ Asc' : '↓ Desc'}
                </button>
              </div>
            </div>
          </div>

          {isLoading ? (
            <div className="p-8 text-center text-sm text-gray-500">Loading ledger…</div>
          ) : visibleTxns.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500">Nothing matches this selection.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-gray-800 bg-gray-900/50 text-xs text-gray-400">
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
                      <tr key={t.id} className="border-b border-gray-800/60 hover:bg-gray-700/20">
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
                          <div className="max-w-xs truncate font-mono text-[11px] text-gray-500">{t.notes || t.narration}</div>
                        </td>
                        <td className="p-3">
                          {t.postings.map(p => (
                            <div key={p.id} className="flex items-baseline justify-between gap-3">
                              <span className="min-w-0 truncate text-xs text-gray-400">{p.accounts?.name ?? '—'}</span>
                              <span className={`tabular shrink-0 text-xs ${
                                p.accounts?.type === 'expense' || p.accounts?.type === 'income'
                                  ? 'text-gray-500'
                                  : p.amount_minor < 0 ? 'text-red-400' : 'text-emerald-400'
                              }`}>
                                {formatINRSigned(p.amount_minor)}
                              </span>
                            </div>
                          ))}
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
                              onClick={() => void voidOne(t.id)}
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
          )}
        </Card>
      </div>

      <EditTxnModal
        txn={editingTxn}
        accounts={accounts}
        categories={categories}
        sysExpenseAcc={sysExpenseAcc}
        sysIncomeAcc={sysIncomeAcc}
        onClose={() => setEditingTxn(null)}
        onSaved={async () => { await Promise.all([load(), loadSide()]); }}
      />
    </AppShell>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-gray-800 bg-gray-800/60 p-4">
      <div className="truncate text-xs text-gray-400">{label}</div>
      <div className={`tabular mt-1 truncate text-lg font-bold ${tone}`}>{value}</div>
    </div>
  );
}

function Chips({
  items, onRemove, onClear,
}: { items: { key: string; text: string }[]; onRemove: (key: string) => void; onClear: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {items.length === 0 ? <span className="text-xs text-red-400">Nothing selected.</span> : null}
      {items.map(i => (
        <span key={i.key} className="flex items-center gap-1.5 rounded-full border border-blue-700 bg-blue-900/50 px-2.5 py-1 text-xs text-blue-200">
          {i.text}
          <button type="button" onClick={() => onRemove(i.key)} aria-label={`Remove ${i.text}`}
                  className="font-bold hover:text-red-400">×</button>
        </span>
      ))}
      {items.length > 0 ? (
        <button type="button" onClick={onClear} className="ml-1 text-xs text-gray-500 underline hover:text-red-400">
          Clear all
        </button>
      ) : null}
    </div>
  );
}
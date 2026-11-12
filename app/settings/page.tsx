'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { Banner, Card, CardTitle, Field, btn, inputCls } from '@/components/ui';
import { formatINR, parseMoneyToMinor } from '@/lib/money';
import { supabase } from '@/lib/supabase';
import type { AccountRow, BalanceRow, CategoryRow, AccountSubtype } from '@/lib/types';
import { useToday } from '@/lib/use-today';

type Status = { kind: 'info' | 'error' | 'success'; msg: string } | null;

const KINDS: { key: string; label: string; type: 'asset' | 'liability'; subtype: AccountSubtype }[] = [
  { key: 'bank',        label: 'Bank account', type: 'asset',     subtype: 'bank' },
  { key: 'cash',        label: 'Cash in hand', type: 'asset',     subtype: 'cash' },
  { key: 'wallet',      label: 'Wallet / UPI', type: 'asset',     subtype: 'wallet' },
  { key: 'investment',  label: 'Investments',  type: 'asset',     subtype: 'investment' },
  { key: 'fd',          label: 'FD / RD',      type: 'asset',     subtype: 'fd' },
  { key: 'credit_card', label: 'Credit card',  type: 'liability', subtype: 'credit_card' },
  { key: 'loan',        label: 'Loan',         type: 'liability', subtype: 'loan' },
];

export default function Settings() {
  const router = useRouter();
  const today = useToday();
  const [status, setStatus] = useState<Status>(null);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [balances, setBalances] = useState<Record<number, number>>({});
  const [openingMap, setOpeningMap] = useState<Record<number, { amount_minor: number; date: string }>>({});

  const [catName, setCatName] = useState('');
  const [catKind, setCatKind] = useState<'expense' | 'income'>('expense');

  const [accName, setAccName] = useState('');
  const [accKind, setAccKind] = useState('bank');
  const [initialBal, setInitialBal] = useState('');
  const [initialDate, setInitialDate] = useState('2026-10-31');
  const [creditLimit, setCreditLimit] = useState('');
  const [statementDay, setStatementDay] = useState('');

  // Inline Opening Balance Editor state
  const [editingAccId, setEditingAccId] = useState<number | null>(null);
  const [editOpenAmt, setEditOpenAmt] = useState('');
  const [editOpenDate, setEditOpenDate] = useState('');

  const fetchData = useCallback(async () => {
    const db = supabase();
    const [catRes, accRes, balRes, openRes] = await Promise.all([
      db.from('categories').select('id,name,kind,parent_id,is_active').eq('is_active', true).order('kind').order('name'),
      db.from('accounts').select('id,name,type,subtype,currency,is_active,credit_limit_minor,statement_day,due_day').eq('is_active', true).order('name'),
      db.from('account_balances').select('id,balance_minor'),
      db.from('transactions')
        .select('id,txn_date,postings(account_id,amount_minor)')
        .eq('kind', 'opening')
        .is('voided_at', null),
    ]);
    if (catRes.error) setStatus({ kind: 'error', msg: catRes.error.message });
    if (accRes.error) setStatus({ kind: 'error', msg: accRes.error.message });
    setCategories((catRes.data ?? []) as CategoryRow[]);
    setAccounts((accRes.data ?? []) as AccountRow[]);

    const bMap: Record<number, number> = {};
    ((balRes.data ?? []) as BalanceRow[]).forEach(b => { bMap[b.id] = b.balance_minor; });
    setBalances(bMap);

    const oMap: Record<number, { amount_minor: number; date: string }> = {};
    (openRes.data ?? []).forEach((t: any) => {
      (t.postings ?? []).forEach((p: any) => {
        oMap[p.account_id] = { amount_minor: p.amount_minor, date: t.txn_date };
      });
    });
    setOpeningMap(oMap);
  }, []);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const addCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = catName.trim();
    if (!name) return;
    const { error } = await supabase().from('categories').insert({ name, kind: catKind });
    if (error) { setStatus({ kind: 'error', msg: error.message }); return; }
    setStatus({ kind: 'success', msg: `Added category "${name}".` });
    setCatName('');
    await fetchData();
  };

  const addAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = accName.trim();
    if (!name) return;
    const kind = KINDS.find(k => k.key === accKind) ?? KINDS[0];

    let openMinor = 0;
    if (initialBal.trim()) {
      try {
        openMinor = parseMoneyToMinor(initialBal);
      } catch (ex) {
        setStatus({ kind: 'error', msg: ex instanceof Error ? ex.message : String(ex) });
        return;
      }
    }

    const { data: inserted, error } = await supabase().from('accounts').insert({
      name,
      type: kind.type,
      subtype: kind.subtype,
      credit_limit_minor: kind.subtype === 'credit_card' && creditLimit
        ? Math.round(Number(creditLimit) * 100) : null,
      statement_day: kind.subtype === 'credit_card' && statementDay ? Number(statementDay) : null,
    }).select('id').single();

    if (error) { setStatus({ kind: 'error', msg: error.message }); return; }

    if (inserted && openMinor !== 0) {
      const { error: openErr } = await supabase().rpc('set_account_opening_balance', {
        p_account_id: inserted.id,
        p_amount_minor: openMinor,
        p_date: initialDate || today || '2026-10-31',
      });
      if (openErr) {
        setStatus({ kind: 'error', msg: `Account created, but opening balance failed: ${openErr.message}` });
        await fetchData();
        return;
      }
    }

    setStatus({ kind: 'success', msg: `Added account "${name}".` });
    setAccName(''); setInitialBal(''); setCreditLimit(''); setStatementDay('');
    await fetchData();
  };

  const saveOpeningBalance = async (acc: AccountRow) => {
    let minor = 0;
    try {
      minor = editOpenAmt.trim() ? parseMoneyToMinor(editOpenAmt) : 0;
    } catch (ex) {
      setStatus({ kind: 'error', msg: ex instanceof Error ? ex.message : String(ex) });
      return;
    }

    const { error } = await supabase().rpc('set_account_opening_balance', {
      p_account_id: acc.id,
      p_amount_minor: minor,
      p_date: editOpenDate || today || '2026-10-31',
    });

    if (error) {
      setStatus({ kind: 'error', msg: error.message });
      return;
    }

    setEditingAccId(null);
    setStatus({ kind: 'success', msg: `Updated opening balance for "${acc.name}".` });
    await fetchData();
  };

  const archive = async (table: 'accounts' | 'categories', id: number, name: string) => {
    if (!window.confirm(`Archive "${name}"? Past transactions are preserved.`)) return;
    const { error } = await supabase().from(table).update({ is_active: false }).eq('id', id);
    if (error) {
      setStatus({
        kind: 'error',
        msg: error.code === '23503'
          ? `"${name}" is still referenced by existing transactions — archive not possible.`
          : error.message,
      });
      return;
    }
    setStatus({ kind: 'success', msg: `Archived "${name}".` });
    await fetchData();
  };

  const signOut = async () => {
    await supabase().auth.signOut();
    router.replace('/login');
  };

  return (
    <AppShell
      title="Settings"
      subtitle="Accounts, opening balances, categories and session"
      actions={<button type="button" onClick={signOut} className={btn('neutral', 'text-xs')}>Sign out</button>}
    >
      {status ? <div className="mb-4"><Banner kind={status.kind}>{status.msg}</Banner></div> : null}

      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
        {/* CATEGORIES */}
        <div className="flex min-w-0 flex-col gap-4 sm:gap-6">
          <Card>
            <CardTitle>New category</CardTitle>
            <form onSubmit={addCategory} className="space-y-3">
              <Field label="Name" htmlFor="cat-name">
                <input id="cat-name" required value={catName} onChange={e => setCatName(e.target.value)}
                       placeholder="e.g. Travel, Gym, Salary" className={inputCls} />
              </Field>
              <Field label="Type" htmlFor="cat-kind">
                <select id="cat-kind" value={catKind}
                        onChange={e => setCatKind(e.target.value as 'expense' | 'income')} className={inputCls}>
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                </select>
              </Field>
              <button type="submit" className={btn('primary', 'w-full')}>Save category</button>
            </form>
          </Card>

          <Card>
            <CardTitle>Categories ({categories.length})</CardTitle>
            <ul className="max-h-96 space-y-2 overflow-y-auto pr-1">
              {categories.map(c => (
                <li key={c.id} className="flex items-center justify-between gap-3 rounded-lg border border-gray-800 bg-gray-900 p-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-gray-100">{c.name}</div>
                    <div className="text-[11px] capitalize text-gray-500">{c.kind}</div>
                  </div>
                  <button type="button" onClick={() => archive('categories', c.id, c.name)}
                          aria-label={`Archive ${c.name}`}
                          className="min-h-11 min-w-11 shrink-0 rounded text-xs text-gray-500 hover:text-red-400">
                    Archive
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        {/* ACCOUNTS */}
        <div className="flex min-w-0 flex-col gap-4 sm:gap-6">
          <Card>
            <CardTitle>New account</CardTitle>
            <form onSubmit={addAccount} className="space-y-3">
              <Field label="Name" htmlFor="acc-name">
                <input id="acc-name" required value={accName} onChange={e => setAccName(e.target.value)}
                       placeholder="e.g. ICICI Bank 6432" className={inputCls} />
              </Field>
              <Field label="Kind" htmlFor="acc-kind">
                <select id="acc-kind" value={accKind} onChange={e => setAccKind(e.target.value)} className={inputCls}>
                  {KINDS.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
                </select>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Initial / Opening Balance (₹)" htmlFor="acc-open">
                  <input id="acc-open" type="text" inputMode="decimal" value={initialBal}
                         onChange={e => setInitialBal(e.target.value)} placeholder="0.00" className={inputCls} />
                </Field>
                <Field label="Opening Date" htmlFor="acc-open-date">
                  <input id="acc-open-date" type="date" value={initialDate}
                         onChange={e => setInitialDate(e.target.value)} className={inputCls} />
                </Field>
              </div>

              {accKind === 'credit_card' ? (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Credit limit (₹)" htmlFor="acc-limit">
                    <input id="acc-limit" inputMode="decimal" value={creditLimit}
                           onChange={e => setCreditLimit(e.target.value)} placeholder="100000" className={inputCls} />
                  </Field>
                  <Field label="Statement day" htmlFor="acc-stmt">
                    <input id="acc-stmt" inputMode="numeric" value={statementDay}
                           onChange={e => setStatementDay(e.target.value)} placeholder="12" className={inputCls} />
                  </Field>
                </div>
              ) : null}

              <button type="submit" className={btn('primary', 'w-full')}>Save account</button>
            </form>
          </Card>

          <Card>
            <CardTitle>Accounts ({accounts.filter(a => a.type !== 'expense' && a.type !== 'income' && a.type !== 'equity').length})</CardTitle>
            <ul className="max-h-96 space-y-2.5 overflow-y-auto pr-1">
              {accounts
                .filter(a => a.type !== 'expense' && a.type !== 'income' && a.type !== 'equity')
                .map(a => {
                  const openInfo = openingMap[a.id];
                  const openMinor = openInfo
                    ? (a.type === 'liability' ? Math.abs(openInfo.amount_minor) : openInfo.amount_minor)
                    : 0;
                  const currBal = balances[a.id] ?? 0;
                  const displayCurr = a.type === 'liability' ? -currBal : currBal;
                  const isEditing = editingAccId === a.id;

                  return (
                    <li key={a.id} className="rounded-lg border border-gray-800 bg-gray-900 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-gray-100">{a.name}</div>
                          <div className="text-[11px] capitalize text-gray-500">
                            {a.type} · {a.subtype.replace('_', ' ')} · Current: <span className="font-mono text-gray-300">{formatINR(displayCurr)}</span>
                          </div>
                          <div className="mt-0.5 text-[11px] text-gray-400">
                            Opening balance: <span className="font-mono text-blue-300">{formatINR(openMinor)}</span>
                            {openInfo ? ` (as of ${openInfo.date})` : ' (not set)'}
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              if (isEditing) {
                                setEditingAccId(null);
                              } else {
                                setEditingAccId(a.id);
                                setEditOpenAmt((openMinor / 100).toFixed(2));
                                setEditOpenDate(openInfo?.date ?? '2026-10-31');
                              }
                            }}
                            className="min-h-9 rounded border border-gray-700 bg-gray-800 px-2.5 text-xs font-medium text-blue-300 hover:bg-gray-700"
                          >
                            {isEditing ? 'Close' : 'Edit Initial ₹'}
                          </button>
                          <button
                            type="button"
                            onClick={() => archive('accounts', a.id, a.name)}
                            aria-label={`Archive ${a.name}`}
                            className="min-h-9 px-2 text-xs text-gray-500 hover:text-red-400"
                          >
                            Archive
                          </button>
                        </div>
                      </div>

                      {isEditing ? (
                        <div className="mt-3 grid grid-cols-1 gap-2 border-t border-gray-800 pt-3 sm:grid-cols-3">
                          <Field label="Opening Balance (₹)" htmlFor={`ob-amt-${a.id}`}>
                            <input
                              id={`ob-amt-${a.id}`}
                              type="text"
                              inputMode="decimal"
                              value={editOpenAmt}
                              onChange={e => setEditOpenAmt(e.target.value)}
                              className={inputCls}
                            />
                          </Field>
                          <Field label="As of Date" htmlFor={`ob-dt-${a.id}`}>
                            <input
                              id={`ob-dt-${a.id}`}
                              type="date"
                              value={editOpenDate}
                              onChange={e => setEditOpenDate(e.target.value)}
                              className={inputCls}
                            />
                          </Field>
                          <div className="flex items-end">
                            <button
                              type="button"
                              onClick={() => void saveOpeningBalance(a)}
                              className={btn('primary', 'w-full text-xs')}
                            >
                              Save Initial ₹
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
            </ul>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

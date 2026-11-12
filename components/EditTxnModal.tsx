'use client';

import { useEffect, useState } from 'react';
import { Banner, Field, btn, inputCls } from '@/components/ui';
import { parseMoneyToMinor } from '@/lib/money';
import { supabase } from '@/lib/supabase';
import type { AccountRow, CategoryRow, TxnRow } from '@/lib/types';

type EditKind = 'expense' | 'income' | 'transfer';

export default function EditTxnModal({
  txn,
  accounts,
  categories,
  sysExpenseAcc,
  sysIncomeAcc,
  onClose,
  onSaved,
}: {
  txn: TxnRow | null;
  accounts: AccountRow[];
  categories: CategoryRow[];
  sysExpenseAcc: number | null;
  sysIncomeAcc: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [kind, setKind] = useState<EditKind>('expense');
  const [txnDate, setTxnDate] = useState('');
  const [payee, setPayee] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!txn) return;
    setErr(null);
    setTxnDate(txn.txn_date);
    setPayee(txn.payee ?? '');
    setNotes(txn.notes ?? '');

    const realPostings = txn.postings.filter(
      p => p.accounts?.type !== 'expense' && p.accounts?.type !== 'income' && p.accounts?.type !== 'equity'
    );
    const sysPosting = txn.postings.find(
      p => p.accounts?.type === 'expense' || p.accounts?.type === 'income'
    );

    const amtMinor = Math.abs(
      (realPostings[0]?.amount_minor ?? txn.postings[0]?.amount_minor ?? 0)
    );
    setAmount((amtMinor / 100).toFixed(2));

    if (txn.kind === 'transfer' || (realPostings.length >= 2 && !sysPosting)) {
      setKind('transfer');
      const outLeg = realPostings.find(p => p.amount_minor < 0) ?? realPostings[0];
      const inLeg = realPostings.find(p => p.amount_minor > 0) ?? realPostings[1] ?? realPostings[0];
      setFromId(String(outLeg?.account_id ?? accounts[0]?.id ?? ''));
      setToId(String(inLeg?.account_id ?? accounts[1]?.id ?? accounts[0]?.id ?? ''));
    } else if (txn.kind === 'income' || (realPostings[0]?.amount_minor ?? 0) > 0) {
      setKind('income');
      setAccountId(String(realPostings[0]?.account_id ?? accounts[0]?.id ?? ''));
      const incCats = categories.filter(c => c.kind === 'income');
      setCategoryId(String(sysPosting?.category_id ?? incCats[0]?.id ?? ''));
    } else {
      setKind('expense');
      setAccountId(String(realPostings[0]?.account_id ?? accounts[0]?.id ?? ''));
      const expCats = categories.filter(c => c.kind === 'expense');
      setCategoryId(String(sysPosting?.category_id ?? expCats[0]?.id ?? ''));
    }
  }, [txn, accounts, categories]);

  useEffect(() => {
    if (kind === 'transfer') return;
    const list = categories.filter(c => c.kind === kind);
    if (list.length && !list.some(c => String(c.id) === categoryId)) {
      setCategoryId(String(list[0].id));
    }
  }, [kind, categories, categoryId]);

  if (!txn) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);

    let minor: number;
    try {
      minor = Math.abs(parseMoneyToMinor(amount));
      if (minor === 0) throw new Error('Amount must be greater than zero.');
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex));
      return;
    }

    let postings: { account_id: number; amount_minor: number; category_id: number | null }[] = [];

    if (kind === 'expense') {
      if (!accountId || !sysExpenseAcc) {
        setErr('Select a valid account.');
        return;
      }
      postings = [
        { account_id: Number(accountId), amount_minor: -minor, category_id: null },
        { account_id: sysExpenseAcc, amount_minor: minor, category_id: categoryId ? Number(categoryId) : null },
      ];
    } else if (kind === 'income') {
      if (!accountId || !sysIncomeAcc) {
        setErr('Select a valid account.');
        return;
      }
      postings = [
        { account_id: Number(accountId), amount_minor: minor, category_id: null },
        { account_id: sysIncomeAcc, amount_minor: -minor, category_id: categoryId ? Number(categoryId) : null },
      ];
    } else {
      if (!fromId || !toId || fromId === toId) {
        setErr('Choose two different accounts for a transfer.');
        return;
      }
      postings = [
        { account_id: Number(fromId), amount_minor: -minor, category_id: null },
        { account_id: Number(toId), amount_minor: minor, category_id: null },
      ];
    }

    setBusy(true);
    const { error } = await supabase().rpc('update_transaction', {
      p_txn_id: txn.id,
      p_date: txnDate,
      p_payee: kind === 'transfer' && !payee.trim() ? 'Internal Transfer' : payee.trim(),
      p_narration: txn.narration ?? `Edited-${payee.trim() || 'Transfer'}`,
      p_kind: kind,
      p_postings: postings,
      p_notes: notes.trim() || null,
    });
    setBusy(false);

    if (error) {
      setErr(error.message);
      return;
    }

    onSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs">
      <div className="w-full max-w-md rounded-xl border border-gray-700 bg-gray-800 p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold text-white">Edit Transaction #{txn.id}</h3>
          <button
            type="button"
            onClick={onClose}
            className="min-h-9 min-w-9 rounded-lg text-gray-400 hover:bg-gray-700 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="mb-4 flex rounded-lg border border-gray-700 bg-gray-900 p-1">
          {(['income', 'expense', 'transfer'] as EditKind[]).map(t => {
            const activeTone =
              t === 'income' ? 'bg-emerald-600 text-white'
              : t === 'expense' ? 'bg-blue-600 text-white'
              : 'bg-purple-600 text-white';
            return (
              <button
                key={t}
                type="button"
                onClick={() => setKind(t)}
                className={`min-h-9 flex-1 rounded-md text-xs font-semibold capitalize transition-colors ${
                  kind === t ? activeTone : 'text-gray-400 hover:text-white'
                }`}
              >
                {t}
              </button>
            );
          })}
        </div>

        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date" htmlFor="ed-date">
              <input id="ed-date" type="date" required value={txnDate}
                     onChange={e => setTxnDate(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Amount (₹)" htmlFor="ed-amount">
              <input id="ed-amount" type="text" inputMode="decimal" required value={amount}
                     onChange={e => setAmount(e.target.value)} className={inputCls} />
            </Field>
          </div>

          <Field label="Payee" htmlFor="ed-payee">
            <input id="ed-payee" type="text" required={kind !== 'transfer'} value={payee}
                   onChange={e => setPayee(e.target.value)} placeholder="Merchant or payee" className={inputCls} />
          </Field>

          {kind !== 'transfer' ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Account" htmlFor="ed-acc">
                <select id="ed-acc" value={accountId} onChange={e => setAccountId(e.target.value)} className={inputCls}>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </Field>
              <Field label="Category" htmlFor="ed-cat">
                <select id="ed-cat" value={categoryId} onChange={e => setCategoryId(e.target.value)} className={inputCls}>
                  {categories.filter(c => c.kind === kind).map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </Field>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Field label="From account" htmlFor="ed-from">
                <select id="ed-from" value={fromId} onChange={e => setFromId(e.target.value)} className={inputCls}>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </Field>
              <Field label="To account" htmlFor="ed-to">
                <select id="ed-to" value={toId} onChange={e => setToId(e.target.value)} className={inputCls}>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </Field>
            </div>
          )}

          <Field label="Notes (optional)" htmlFor="ed-notes">
            <input id="ed-notes" type="text" value={notes}
                   onChange={e => setNotes(e.target.value)} placeholder="Add memo or note" className={inputCls} />
          </Field>

          {txn.narration ? (
            <div className="rounded border border-gray-700/70 bg-gray-900/70 p-2 font-mono text-[11px] text-gray-400">
              Raw bank text: {txn.narration}
            </div>
          ) : null}

          {err ? <Banner kind="error">{err}</Banner> : null}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className={btn('neutral')}>Cancel</button>
            <button type="submit" disabled={busy} className={btn('primary')}>
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

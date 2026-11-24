'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardTitle, Banner, Field, btn, inputCls } from '@/components/ui';
import type { LiteCategoryRow, LitePayeeRow, LiteEntryRow, LiteKind } from '@/lib/lite/types';

export function LiteEntryForm({
  ownerId, categories, payees, editing, onSaved, onCancel, defaultKind,
}: {
  ownerId: string;
  categories: LiteCategoryRow[];
  payees: LitePayeeRow[];
  editing: LiteEntryRow | null;
  onSaved: () => void;
  onCancel: () => void;
  defaultKind?: LiteKind;
}) {
  const [entryDate, setEntryDate] = useState(editing?.entry_date ?? new Date().toISOString().slice(0, 10));
  const [kind, setKind] = useState<LiteKind>(editing?.kind ?? defaultKind ?? 'expense');
  const [amount, setAmount] = useState(editing ? String(editing.amount_minor / 100) : '');
  const [categoryId, setCategoryId] = useState(editing?.category_id != null ? String(editing.category_id) : '');
  const [payeeId, setPayeeId] = useState(editing?.payee_id != null ? String(editing.payee_id) : '');
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const kindCategories = categories.filter((c) => c.kind === kind && c.is_active);
  const activePayees = payees.filter((p) => p.is_active);

  async function save() {
    const value = Number(amount);
    if (!entryDate || !Number.isFinite(value) || value <= 0) {
      setError('Enter a date and a positive amount in ₹.');
      return;
    }
    setBusy(true);
    setError(null);
    const row = {
      user_id: ownerId,
      entry_date: entryDate,
      kind,
      amount_minor: Math.round(value * 100),
      category_id: categoryId ? Number(categoryId) : null,
      payee_id: payeeId ? Number(payeeId) : null,
      notes: notes.trim() || null,
    };
    const { error: err } = editing
      ? await supabase.from('lite_entries').update(row).eq('id', editing.id)
      : await supabase.from('lite_entries').insert(row);
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    onSaved();
  }

  return (
    <Card>
      <CardTitle>{editing ? 'Edit entry' : 'Add entry'}</CardTitle>
      {error && <Banner kind="error">{error}</Banner>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date" htmlFor="lite-entry-date">
          <input id="lite-entry-date" type="date" className={inputCls} value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
        </Field>
        <Field label="Kind" htmlFor="lite-entry-kind">
          <select id="lite-entry-kind" className={inputCls} value={kind} onChange={(e) => {
            setKind(e.target.value as LiteKind);
            setCategoryId('');
          }}>
            <option value="expense">Expense</option>
            <option value="received">Money Received</option>
          </select>
        </Field>
        <Field label="Amount (₹)" htmlFor="lite-entry-amount">
          <input id="lite-entry-amount" type="number" min="0" step="0.01" className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
        </Field>
        <Field label="Category" htmlFor="lite-entry-category">
          <select id="lite-entry-category" className={inputCls} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">— none —</option>
            {kindCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Payee" htmlFor="lite-entry-payee" className="col-span-2">
          <select id="lite-entry-payee" className={inputCls} value={payeeId} onChange={(e) => setPayeeId(e.target.value)}>
            <option value="">— none —</option>
            {activePayees.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Notes" htmlFor="lite-entry-notes" className="col-span-2">
          <textarea id="lite-entry-notes" className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
      <div className="mt-3 flex gap-2">
        <button className={btn('primary')} onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button className={btn('ghost')} onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </Card>
  );
}

function NameList({
  title, rows, onAdd, onRename, onDelete,
}: {
  title: string;
  rows: { id: number; name: string }[];
  onAdd: (name: string) => Promise<void>;
  onRename: (id: number, name: string) => Promise<void>;
  onDelete: (id: number, name: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add() {
    const n = name.trim();
    if (!n) return;
    setBusy(true); setError(null);
    await onAdd(n);
    setBusy(false);
    setName('');
  }

  async function rename(id: number) {
    const n = window.prompt('Rename', rows.find((r) => r.id === id)?.name ?? '');
    if (!n?.trim()) return;
    setBusy(true); setError(null);
    await onRename(id, n.trim());
    setBusy(false);
  }

  async function del(id: number, name: string) {
    if (!window.confirm(`Delete "${name}"?`)) return;
    setBusy(true); setError(null);
    await onDelete(id, name);
    setBusy(false);
  }

  return (
    <div className="min-w-0">
      <h3 className="mb-2 text-sm font-semibold text-gray-200">{title}</h3>
      {error && <Banner kind="error">{error}</Banner>}
      <div className="flex gap-2">
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="New name" />
        <button className={btn('primary', 'shrink-0')} onClick={add} disabled={busy}>Add</button>
      </div>
      <ul className="mt-2 space-y-1">
        {rows.length === 0 && <li className="text-xs text-gray-500">Nothing yet.</li>}
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-sm text-gray-300">{r.name}</span>
            <button className={btn('ghost', 'shrink-0')} onClick={() => rename(r.id)} disabled={busy}>Rename</button>
            <button className={`${btn('ghost', 'shrink-0')} min-h-[44px] text-rose-400`} onClick={() => del(r.id, r.name)} disabled={busy}>Delete</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LiteManagePanel({
  ownerId, categories, payees, onChanged,
}: {
  ownerId: string;
  categories: LiteCategoryRow[];
  payees: LitePayeeRow[];
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);

  async function addCategory(name: string, kind: LiteKind) {
    const { error: err } = await supabase
      .from('lite_categories')
      .insert({ user_id: ownerId, name, kind, is_active: true });
    if (err) setError(err.message); else onChanged();
  }

  async function renameCategory(id: number, name: string) {
    const { error: err } = await supabase.from('lite_categories').update({ name }).eq('id', id);
    if (err) setError(err.message); else onChanged();
  }

  async function addPayee(name: string) {
    const { error: err } = await supabase
      .from('lite_payees')
      .insert({ user_id: ownerId, name, is_active: true });
    if (err) setError(err.message); else onChanged();
  }

  async function renamePayee(id: number, name: string) {
    const { error: err } = await supabase.from('lite_payees').update({ name }).eq('id', id);
    if (err) setError(err.message); else onChanged();
  }

  async function deleteItem(table: 'lite_categories' | 'lite_payees', id: number, name: string) {
    const { count, error: usageErr } = await supabase
      .from('lite_entries')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', ownerId)
      .eq(table === 'lite_categories' ? 'category_id' : 'payee_id', id);
    if (usageErr) { setError(usageErr.message); return; }
    if (count && count > 0) {
      setError(`"${name}" is used by ${count} entries. Edit or delete those entries first.`);
      return;
    }
    const { error: err } = await supabase.from(table).delete().eq('id', id).eq('user_id', ownerId);
    if (err) setError(err.message); else onChanged();
  }

  return (
    <Card>
      <CardTitle>Manage</CardTitle>
      {error && <Banner kind="error">{error}</Banner>}
      <div className="space-y-4">
        <NameList
          title="Expense categories"
          rows={categories.filter((c) => c.kind === 'expense' && c.is_active)}
          onAdd={(n) => addCategory(n, 'expense')}
          onRename={renameCategory}
          onDelete={(id, n) => deleteItem('lite_categories', id, n)}
        />
        <NameList
          title="Received categories"
          rows={categories.filter((c) => c.kind === 'received' && c.is_active)}
          onAdd={(n) => addCategory(n, 'received')}
          onRename={renameCategory}
          onDelete={(id, n) => deleteItem('lite_categories', id, n)}
        />
        <NameList
          title="Payees"
          rows={payees.filter((p) => p.is_active)}
          onAdd={addPayee}
          onRename={renamePayee}
          onDelete={(id, n) => deleteItem('lite_payees', id, n)}
        />
      </div>
    </Card>
  );
}

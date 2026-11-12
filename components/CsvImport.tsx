'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Banner, btn, inputCls } from '@/components/ui';
import { buildCleanedTemplateCsv, parseBankCsv, type CanonicalRow, type ParseReport } from '@/lib/csv';
import { formatINRSigned } from '@/lib/money';
import { supabase } from '@/lib/supabase';
import type { CategoryRow, ImportResult, RuleRow } from '@/lib/types';

interface Acc { id: number; name: string; type: string }

export default function CsvImport({ onImported }: { onImported?: () => void }) {
  const [accounts, setAccounts] = useState<Acc[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [accountId, setAccountId] = useState('');
  const [fileName, setFileName] = useState('statement.csv');

  const [report, setReport] = useState<ParseReport | null>(null);
  const [stagedRows, setStagedRows] = useState<CanonicalRow[]>([]);
  const [showStaging, setShowStaging] = useState(false);

  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMeta = useCallback(async () => {
    const db = supabase();
    const [accRes, catRes, ruleRes] = await Promise.all([
      db.from('accounts').select('id,name,type').eq('is_active', true).order('name'),
      db.from('categories').select('id,name,kind,parent_id,is_active').eq('is_active', true).order('name'),
      db.from('rules').select('id,name,search_term,payee_name,category_id,priority,is_active').eq('is_active', true).order('priority'),
    ]);

    if (accRes.error) { setError(accRes.error.message); return; }
    const rows = ((accRes.data ?? []) as Acc[]).filter(
      a => a.type !== 'income' && a.type !== 'expense' && a.type !== 'equity'
    );
    setAccounts(rows);
    if (rows.length) setAccountId(prev => prev || String(rows[0].id));
    setCategories((catRes.data ?? []) as CategoryRow[]);
    setRules((ruleRes.data ?? []) as RuleRow[]);
  }, []);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  const catNameById = useMemo(() => {
    const m: Record<number, string> = {};
    categories.forEach(c => { m[c.id] = c.name; });
    return m;
  }, [categories]);

  // Match a row against saved rules (longest / highest-priority match wins)
  const applyRulesToRows = useCallback(
    (rawRows: CanonicalRow[], activeRules: RuleRow[], activeCats: CategoryRow[]): CanonicalRow[] => {
      const defExpCat = activeCats.find(c => c.kind === 'expense')?.id ?? null;
      const defIncCat = activeCats.find(c => c.kind === 'income')?.id ?? null;
      const otherAcc = accounts.find(a => String(a.id) !== accountId)?.id ?? null;

      return rawRows.map(r => {
        const upperNarr = r.narration.toUpperCase();
        const upperKey = (r.rule_key ?? '').toUpperCase();
        const matched = activeRules.find(rule => {
          const term = rule.search_term.trim().toUpperCase();
          if (!term) return false;
          return upperNarr.includes(term) || (upperKey && upperKey.includes(term));
        });

        const kind: 'expense' | 'income' | 'transfer' = r.kind ?? (r.amount_minor < 0 ? 'expense' : 'income');
        const defaultCat = kind === 'expense' ? defExpCat : kind === 'income' ? defIncCat : null;

        return {
          ...r,
          kind,
          payee: matched?.payee_name || r.payee || 'Bank Import',
          category_id: matched?.category_id ?? r.category_id ?? defaultCat,
          transfer_account_id: r.transfer_account_id ?? otherAcc,
        };
      });
    },
    [accounts, accountId],
  );

  const onFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setResult(null);
    setReport(null);
    setError(null);
    setFileName(file.name);

    try {
      if (!accountId) throw new Error('Choose the target account first.');
      const parsed = await parseBankCsv(file);
      setReport(parsed);

      if (!parsed.rows.length) {
        setError('No importable rows found in CSV. Check the parse errors below.');
        return;
      }

      const enriched = applyRulesToRows(parsed.rows, rules, categories);
      setStagedRows(enriched);
      setShowStaging(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [accountId, applyRulesToRows, rules, categories]);

  // Update a row's Payee and auto-propagate to other rows with the same rule_key
  const updateRowPayee = (index: number, newPayee: string) => {
    setStagedRows(prev => {
      const targetKey = (prev[index]?.rule_key ?? '').trim().toUpperCase();
      return prev.map((row, idx) => {
        if (idx === index) return { ...row, payee: newPayee };
        if (targetKey && targetKey.length >= 3 && (row.rule_key ?? '').trim().toUpperCase() === targetKey) {
          return { ...row, payee: newPayee };
        }
        return row;
      });
    });
  };

  // Update a row's Category and auto-propagate to other rows with the same rule_key
  const updateRowCategory = (index: number, newCatId: number | null) => {
    setStagedRows(prev => {
      const targetKey = (prev[index]?.rule_key ?? '').trim().toUpperCase();
      return prev.map((row, idx) => {
        if (idx === index) return { ...row, category_id: newCatId };
        if (
          targetKey &&
          targetKey.length >= 3 &&
          (row.rule_key ?? '').trim().toUpperCase() === targetKey &&
          row.kind === prev[index].kind
        ) {
          return { ...row, category_id: newCatId };
        }
        return row;
      });
    });
  };

  const updateRowKind = (index: number, newKind: 'expense' | 'income' | 'transfer') => {
    const defCat = categories.find(c => c.kind === newKind)?.id ?? null;
    const otherAcc = accounts.find(a => String(a.id) !== accountId)?.id ?? null;
    setStagedRows(prev =>
      prev.map((row, idx) =>
        idx === index
          ? {
              ...row,
              kind: newKind,
              category_id: newKind === 'transfer' ? null : defCat,
              transfer_account_id: newKind === 'transfer' ? (row.transfer_account_id ?? otherAcc) : row.transfer_account_id,
            }
          : row,
      ),
    );
  };

  const updateRowTransferAcc = (index: number, targetAccId: number | null) => {
    setStagedRows(prev =>
      prev.map((row, idx) => (idx === index ? { ...row, transfer_account_id: targetAccId } : row)),
    );
  };

  const removeStagedRow = (index: number) => {
    setStagedRows(prev => prev.filter((_, idx) => idx !== index));
  };

  const downloadCleanedCsv = () => {
    if (!stagedRows.length) return;
    const csvText = buildCleanedTemplateCsv(stagedRows, catNameById);
    const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cleaned-${fileName}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const commitImport = async () => {
    if (!accountId || !stagedRows.length) return;
    setBusy(true);
    setError(null);
    try {
      const { data, error: rpcErr } = await supabase().rpc('import_statement', {
        p_account_id: Number(accountId),
        p_rows: stagedRows,
        p_file_name: fileName,
        p_source_type: 'csv',
      });
      if (rpcErr) throw new Error(rpcErr.message);
      setResult(data as ImportResult);
      setShowStaging(false);
      await loadMeta(); // refresh rules learned during import
      onImported?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-fit flex-col gap-3 rounded-xl border border-dashed border-gray-700 bg-gray-800/70 p-5 shadow-lg">
      <h2 className="text-base font-bold text-white sm:text-lg">Bulk import bank CSV</h2>

      <div>
        <label htmlFor="csv-account" className="mb-1 block text-xs font-medium text-gray-400">
          Target Account
        </label>
        <select
          id="csv-account"
          value={accountId}
          onChange={e => setAccountId(e.target.value)}
          className={inputCls}
        >
          {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          {accounts.length === 0 && <option value="">No accounts — create one in Settings</option>}
        </select>
      </div>

      <label className={btn('primary', 'w-full cursor-pointer')}>
        {busy ? 'Importing…' : 'Choose Raw or Template CSV'}
        <input type="file" accept=".csv,text/csv" className="sr-only" onChange={onFile} disabled={busy} />
      </label>

      <p className="text-xs leading-relaxed text-gray-400">
        Auto-cleans headers & legends, places an editable <strong className="text-gray-200">Payee</strong> column in front of{' '}
        <strong className="text-gray-200">Transaction Remarks</strong>, and remembers your Payee & Category choices automatically.
      </p>

      {error ? <Banner kind="error">{error}</Banner> : null}

      {report && report.failed.length > 0 ? (
        <div className="rounded border border-amber-800/60 bg-amber-950/30 p-2.5 text-xs text-amber-300">
          <div className="font-semibold">Skipped {report.failed.length} non-transaction row(s):</div>
          <ul className="mt-1 max-h-24 space-y-0.5 overflow-y-auto">
            {report.failed.slice(0, 8).map(f => (
              <li key={f.row}>Row {f.row}: {f.reason}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {result ? (
        <div className="rounded-lg border border-gray-700 bg-gray-900 p-3 text-xs space-y-1">
          <p className="font-semibold text-emerald-400">✅ Inserted {result.inserted} transaction(s)</p>
          <p className="text-gray-400">Skipped active duplicates: {result.skipped}</p>
          {result.failed.length > 0 ? (
            <>
              <p className="text-red-400">Rejected: {result.failed.length}</p>
              <ul className="max-h-24 space-y-0.5 overflow-y-auto text-red-300">
                {result.failed.slice(0, 10).map(f => (
                  <li key={f.row}>Row {f.row}: {f.reason}</li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}

      {/* Interactive Staging & Template Cleaner Modal */}
      {showStaging ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-6 backdrop-blur-xs">
          <div className="flex max-h-[92dvh] w-full max-w-6xl flex-col rounded-xl border border-gray-700 bg-gray-900 shadow-2xl">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-800 p-4">
              <div>
                <h3 className="text-base font-bold text-white sm:text-lg">
                  Review & Clean CSV Before Import ({stagedRows.length} rows)
                </h3>
                <p className="text-xs text-gray-400">
                  Target account:{' '}
                  <strong className="text-blue-400">
                    {accounts.find(a => String(a.id) === accountId)?.name ?? 'Selected Account'}
                  </strong>{' '}
                  · Typing a Payee or Category automatically updates matching merchants and saves for next time.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={downloadCleanedCsv}
                  className={btn('neutral', 'text-xs')}
                >
                  ⬇️ Download Cleaned CSV
                </button>
                <button
                  type="button"
                  onClick={() => setShowStaging(false)}
                  className={btn('ghost', 'text-xs')}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busy || stagedRows.length === 0}
                  onClick={() => void commitImport()}
                  className={btn('primary', 'text-xs')}
                >
                  {busy ? 'Importing…' : `Commit ${stagedRows.length} Row(s)`}
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-3 sm:p-4">
              <table className="w-full min-w-[920px] border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-gray-800 bg-gray-950/70 text-gray-400">
                    <th className="p-2.5 w-28">Date</th>
                    <th className="p-2.5 w-52">Payee (Auto-Recalled)</th>
                    <th className="p-2.5">Transaction Remarks (Raw)</th>
                    <th className="p-2.5 w-28">Type</th>
                    <th className="p-2.5 w-48">Category / Transfer To</th>
                    <th className="p-2.5 w-28 text-right">Amount</th>
                    <th className="p-2.5 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/70">
                  {stagedRows.map((row, idx) => {
                    const rowKind = row.kind ?? (row.amount_minor < 0 ? 'expense' : 'income');
                    return (
                      <tr key={idx} className="hover:bg-gray-800/40">
                        <td className="tabular whitespace-nowrap p-2 font-mono text-gray-300">
                          {row.txn_date}
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            value={row.payee ?? ''}
                            onChange={e => updateRowPayee(idx, e.target.value)}
                            placeholder="Enter Payee"
                            className="w-full rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-white focus:border-blue-500 focus:outline-none"
                          />
                        </td>
                        <td className="p-2 font-mono text-[11px] text-gray-400">
                          <div className="max-w-md break-all leading-relaxed">{row.narration}</div>
                        </td>
                        <td className="p-2">
                          <select
                            value={rowKind}
                            onChange={e => updateRowKind(idx, e.target.value as 'expense' | 'income' | 'transfer')}
                            className="w-full rounded border border-gray-700 bg-gray-950 px-2 py-1.5 text-xs text-white"
                          >
                            <option value="expense">Expense</option>
                            <option value="income">Income</option>
                            <option value="transfer">Transfer</option>
                          </select>
                        </td>
                        <td className="p-2">
                          {rowKind === 'transfer' ? (
                            <select
                              value={row.transfer_account_id ?? ''}
                              onChange={e => updateRowTransferAcc(idx, e.target.value ? Number(e.target.value) : null)}
                              className="w-full rounded border border-purple-700/70 bg-gray-950 px-2 py-1.5 text-xs text-purple-200"
                            >
                              {accounts
                                .filter(a => String(a.id) !== accountId)
                                .map(a => (
                                  <option key={a.id} value={a.id}>To: {a.name}</option>
                                ))}
                            </select>
                          ) : (
                            <select
                              value={row.category_id ?? ''}
                              onChange={e => updateRowCategory(idx, e.target.value ? Number(e.target.value) : null)}
                              className="w-full rounded border border-gray-700 bg-gray-950 px-2 py-1.5 text-xs text-white"
                            >
                              {categories
                                .filter(c => c.kind === rowKind)
                                .map(c => (
                                  <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                            </select>
                          )}
                        </td>
                        <td className={`tabular whitespace-nowrap p-2 text-right font-mono font-semibold ${
                          row.amount_minor < 0 ? 'text-red-400' : 'text-emerald-400'
                        }`}>
                          {formatINRSigned(row.amount_minor)}
                        </td>
                        <td className="p-2 text-right">
                          <button
                            type="button"
                            onClick={() => removeStagedRow(idx)}
                            title="Skip this row"
                            className="rounded px-2 py-1 text-gray-500 hover:bg-gray-800 hover:text-red-400"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

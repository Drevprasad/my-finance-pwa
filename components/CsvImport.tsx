// components/CsvImport.tsx
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Banner, btn, inputCls } from '@/components/ui';
import {
  buildCleanedTemplateCsv,
  parseBankCsv,
  type CanonicalRow,
  type ParseReport,
} from '@/lib/csv';
import { formatINR, formatINRSigned } from '@/lib/money';
import { supabase } from '@/lib/supabase';
import type { CategoryRow, ImportResult, RuleRow } from '@/lib/types';

interface Acc {
  id: number;
  name: string;
  type: string;
  subtype: string;
  balance_minor: number;
}

interface StagedRow extends CanonicalRow {
  _uid: string;
}

const pickDefaultCat = (cats: CategoryRow[], kind: 'expense' | 'income'): number | null =>
  cats.find(
    c => c.kind === kind && /^(uncategori[sz]ed|general income|other income)$/i.test(c.name.trim()),
  )?.id ??
  cats.find(c => c.kind === kind)?.id ??
  null;

/**
 * Matches a pipe-delimited category hint (e.g. "groceries|supermarket|food")
 * against the user's actual active categories in Supabase.
 */
function matchCategoryFromHint(
  cats: CategoryRow[],
  kind: 'expense' | 'income',
  hint: string | null | undefined,
): number | null {
  if (!hint) return null;
  const keywords = hint
    .toLowerCase()
    .split('|')
    .map(k => k.trim())
    .filter(Boolean);

  const kindCats = cats.filter(c => c.kind === kind);
  for (const kw of keywords) {
    const exactOrPartial = kindCats.find(c => c.name.toLowerCase().includes(kw));
    if (exactOrPartial) return exactOrPartial.id;
  }
  return null;
}

export default function CsvImport({ onImported }: { onImported?: () => void }) {
  const [accounts, setAccounts] = useState<Acc[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [accountId, setAccountId] = useState('');
  const [fileName, setFileName] = useState('statement.csv');

  const [report, setReport] = useState<ParseReport | null>(null);
  const [stagedRows, setStagedRows] = useState<StagedRow[]>([]);
  const [showStaging, setShowStaging] = useState(false);
  const [syncOpeningBalance, setSyncOpeningBalance] = useState(true);
  const [viewMode, setViewMode] = useState<'all' | 'grouped'>('grouped');
  const [searchFilter, setSearchFilter] = useState('');

  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMeta = useCallback(async () => {
    const db = supabase();
    const [accRes, catRes, ruleRes] = await Promise.all([
      db
        .from('account_balances')
        .select('id,name,type,subtype,balance_minor')
        .eq('is_active', true)
        .order('name'),
      db
        .from('categories')
        .select('id,name,kind,parent_id,is_active')
        .eq('is_active', true)
        .order('name'),
      db
        .from('rules')
        .select('id,name,search_term,payee_name,category_id,priority,is_active')
        .eq('is_active', true)
        .order('priority'),
    ]);

    if (accRes.error) {
      setError(accRes.error.message);
      return;
    }

    const rows = ((accRes.data ?? []) as Acc[]).filter(
      a => a.type !== 'income' && a.type !== 'expense' && a.type !== 'equity',
    );
    setAccounts(rows);
    if (rows.length > 0) {
      setAccountId(prev => prev || String(rows[0].id));
    }
    setCategories((catRes.data ?? []) as CategoryRow[]);
    setRules((ruleRes.data ?? []) as RuleRow[]);
  }, []);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    if (!showStaging) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) setShowStaging(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showStaging, busy]);

  const selectedAccount = useMemo(
    () => accounts.find(a => String(a.id) === accountId) ?? null,
    [accounts, accountId],
  );

  const catNameById = useMemo(() => {
    const map: Record<number, string> = {};
    categories.forEach(c => {
      map[c.id] = c.name;
    });
    return map;
  }, [categories]);

  // Apply saved DB rules + smart narration heuristics + brokerage auto-transfer routing
  const applyRulesToRows = useCallback(
    (
      rawRows: CanonicalRow[],
      activeRules: RuleRow[],
      activeCats: CategoryRow[],
    ): StagedRow[] => {
      const defExpCat = pickDefaultCat(activeCats, 'expense');
      const defIncCat = pickDefaultCat(activeCats, 'income');

      // Locate user's Investment account (e.g. Zerodha) and preferred fallback Bank account
      const investmentAcc =
        accounts.find(
          a =>
            String(a.id) !== accountId &&
            (a.subtype === 'investment' || /zerodha|groww|upstox|kuvera|mf|demat/i.test(a.name)),
        )?.id ?? null;

      const defaultTransferAcc =
        accounts.find(
          a => String(a.id) !== accountId && a.type === 'asset' && a.subtype === 'bank',
        )?.id ??
        accounts.find(a => String(a.id) !== accountId && a.type === 'asset')?.id ??
        accounts.find(a => String(a.id) !== accountId)?.id ??
        null;

      return rawRows.map((r, idx) => {
        const upperNarr = r.narration.toUpperCase();
        const upperKey = (r.rule_key ?? '').toUpperCase();

        // Automatically treat capital transfers to/from Zerodha as Asset-to-Asset Transfers
        const isBrokerageTransfer =
          Boolean(investmentAcc) &&
          (upperKey === 'ZERODHA' ||
            upperNarr.includes('ZERODHA BROKING') ||
            upperNarr.includes('UPI/ZERODHA'));

        const matchedRule = activeRules.find(rule => {
          const term = rule.search_term.trim().toUpperCase();
          if (!term) return false;
          return upperNarr.includes(term) || (Boolean(upperKey) && upperKey.includes(term));
        });

        const kind: 'expense' | 'income' | 'transfer' = isBrokerageTransfer
          ? 'transfer'
          : r.kind === 'transfer' && defaultTransferAcc
            ? 'transfer'
            : r.amount_minor < 0
              ? 'expense'
              : 'income';

        const targetTransferAcc = isBrokerageTransfer
          ? investmentAcc
          : (r.transfer_account_id ?? defaultTransferAcc);

        const hintedCatId =
          kind === 'transfer'
            ? null
            : matchCategoryFromHint(activeCats, kind, r.category_hint);

        const defaultCat =
          kind === 'expense' ? defExpCat : kind === 'income' ? defIncCat : null;

        return {
          ...r,
          _uid: `${r.txn_date}-${r.amount_minor}-${idx}`,
          kind,
          payee: matchedRule?.payee_name || r.payee || 'Bank Import',
          category_id:
            kind === 'transfer'
              ? null
              : (matchedRule?.category_id ?? r.category_id ?? hintedCatId ?? defaultCat),
          transfer_account_id: kind === 'transfer' ? targetTransferAcc : null,
        };
      });
    },
    [accounts, accountId],
  );

  // Statement reconciliation metrics
  const stagingMetrics = useMemo(() => {
    const netChangeMinor = stagedRows.reduce((acc, r) => acc + r.amount_minor, 0);
    const firstWithBal = stagedRows.find(r => r.balance_minor != null);
    const lastWithBal = [...stagedRows].reverse().find(r => r.balance_minor != null);

    const csvOpeningMinor =
      firstWithBal && firstWithBal.balance_minor != null
        ? firstWithBal.balance_minor - firstWithBal.amount_minor
        : (report?.opening_balance_minor ?? null);

    const csvClosingMinor =
      lastWithBal?.balance_minor ?? report?.closing_balance_minor ?? null;

    const currentLedgerMinor = selectedAccount?.balance_minor ?? 0;

    const alreadyReconciled =
      csvClosingMinor != null && Math.abs(currentLedgerMinor - csvClosingMinor) < 5;

    const projectedLedgerMinor =
      syncOpeningBalance && csvOpeningMinor != null
        ? csvOpeningMinor + netChangeMinor
        : alreadyReconciled
          ? currentLedgerMinor
          : currentLedgerMinor + netChangeMinor;

    return {
      netChangeMinor,
      csvOpeningMinor,
      csvClosingMinor,
      projectedLedgerMinor,
      alreadyReconciled,
    };
  }, [stagedRows, report, selectedAccount, syncOpeningBalance]);

  // Unique merchant groups for fast bulk editing
  const groupedMerchants = useMemo(() => {
    const map = new Map<
      string,
      {
        groupKey: string;
        representative: StagedRow;
        count: number;
        totalMinor: number;
      }
    >();

    stagedRows.forEach(row => {
      const rKind = row.kind ?? (row.amount_minor < 0 ? 'expense' : 'income');
      const key = `${(row.rule_key || row.payee || row.narration).trim().toUpperCase()}|${rKind}`;
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
        existing.totalMinor += row.amount_minor;
      } else {
        map.set(key, {
          groupKey: key,
          representative: row,
          count: 1,
          totalMinor: row.amount_minor,
        });
      }
    });

    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [stagedRows]);

  const visibleRows = useMemo(() => {
    const q = searchFilter.trim().toLowerCase();
    const base =
      viewMode === 'grouped'
        ? groupedMerchants.map(g => ({
            ...g.representative,
            _groupCount: g.count,
            _groupTotal: g.totalMinor,
          }))
        : stagedRows.map(r => ({ ...r, _groupCount: 1, _groupTotal: r.amount_minor }));

    if (!q) return base;
    return base.filter(
      r =>
        (r.payee ?? '').toLowerCase().includes(q) ||
        r.narration.toLowerCase().includes(q) ||
        r.txn_date.includes(q),
    );
  }, [viewMode, groupedMerchants, stagedRows, searchFilter]);

  const onFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
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

        const currentBal = selectedAccount?.balance_minor ?? 0;
        const alreadyAtClosing =
          parsed.closing_balance_minor != null &&
          Math.abs(currentBal - parsed.closing_balance_minor) < 5;
        setSyncOpeningBalance(parsed.opening_balance_minor != null && !alreadyAtClosing);

        setViewMode(enriched.length > 25 ? 'grouped' : 'all');
        setSearchFilter('');
        setShowStaging(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [accountId, applyRulesToRows, rules, categories, selectedAccount],
  );

  const updateRowPayee = useCallback((uid: string, newPayee: string) => {
    setStagedRows(prev => {
      const targetRow = prev.find(r => r._uid === uid);
      const targetKey = (targetRow?.rule_key ?? '').trim().toUpperCase();

      return prev.map(row => {
        if (row._uid === uid) return { ...row, payee: newPayee };
        if (
          targetKey.length >= 3 &&
          (row.rule_key ?? '').trim().toUpperCase() === targetKey
        ) {
          return { ...row, payee: newPayee };
        }
        return row;
      });
    });
  }, []);

  const updateRowCategory = useCallback((uid: string, newCatId: number | null) => {
    setStagedRows(prev => {
      const targetRow = prev.find(r => r._uid === uid);
      const targetKey = (targetRow?.rule_key ?? '').trim().toUpperCase();

      return prev.map(row => {
        if (row._uid === uid) return { ...row, category_id: newCatId };
        if (
          targetKey.length >= 3 &&
          (row.rule_key ?? '').trim().toUpperCase() === targetKey &&
          row.kind === targetRow?.kind
        ) {
          return { ...row, category_id: newCatId };
        }
        return row;
      });
    });
  }, []);

  const updateRowKind = useCallback(
    (uid: string, newKind: 'expense' | 'income' | 'transfer') => {
      const defCat = newKind === 'transfer' ? null : pickDefaultCat(categories, newKind);
      const otherAcc =
        accounts.find(a => String(a.id) !== accountId && a.type === 'asset')?.id ??
        accounts.find(a => String(a.id) !== accountId)?.id ??
        null;

      setStagedRows(prev => {
        const targetRow = prev.find(r => r._uid === uid);
        const targetKey = (targetRow?.rule_key ?? '').trim().toUpperCase();

        return prev.map(row => {
          const isMatch =
            row._uid === uid ||
            (targetKey.length >= 3 &&
              (row.rule_key ?? '').trim().toUpperCase() === targetKey &&
              row.kind === targetRow?.kind);

          if (!isMatch) return row;
          return {
            ...row,
            kind: newKind,
            category_id: newKind === 'transfer' ? null : defCat,
            transfer_account_id:
              newKind === 'transfer'
                ? (row.transfer_account_id ?? otherAcc)
                : row.transfer_account_id,
          };
        });
      });
    },
    [categories, accounts, accountId],
  );

  const updateRowTransferAcc = useCallback((uid: string, targetAccId: number | null) => {
    setStagedRows(prev => {
      const targetRow = prev.find(r => r._uid === uid);
      const targetKey = (targetRow?.rule_key ?? '').trim().toUpperCase();

      return prev.map(row => {
        if (row._uid === uid) return { ...row, transfer_account_id: targetAccId };
        if (
          targetKey.length >= 3 &&
          (row.rule_key ?? '').trim().toUpperCase() === targetKey &&
          row.kind === 'transfer'
        ) {
          return { ...row, transfer_account_id: targetAccId };
        }
        return row;
      });
    });
  }, []);

  const removeStagedRow = useCallback(
    (uid: string) => {
      setStagedRows(prev => {
        if (viewMode === 'grouped') {
          const targetRow = prev.find(r => r._uid === uid);
          const targetKey = (targetRow?.rule_key ?? '').trim().toUpperCase();
          if (targetKey.length >= 3) {
            return prev.filter(
              r =>
                !(
                  (r.rule_key ?? '').trim().toUpperCase() === targetKey &&
                  r.kind === targetRow?.kind
                ),
            );
          }
        }
        return prev.filter(row => row._uid !== uid);
      });
    },
    [viewMode],
  );

  const downloadCleanedCsv = useCallback(() => {
    if (!stagedRows.length) return;
    const csvText = buildCleanedTemplateCsv(stagedRows, catNameById);
    const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cleaned-${fileName}`;
    a.click();
    URL.revokeObjectURL(url);
  }, [stagedRows, catNameById, fileName]);

  const commitImport = async () => {
    if (!accountId || !stagedRows.length) return;
    setBusy(true);
    setError(null);

    try {
      const db = supabase();
      const targetAccId = Number(accountId);

      // 1. Calibrate account opening balance from CSV's implied opening balance
      if (syncOpeningBalance && stagingMetrics.csvOpeningMinor != null) {
        const earliestDate = stagedRows.reduce(
          (min, r) => (r.txn_date < min ? r.txn_date : min),
          stagedRows[0].txn_date,
        );
        const openingDateObj = new Date(`${earliestDate}T00:00:00Z`);
        openingDateObj.setUTCDate(openingDateObj.getUTCDate() - 1);
        const openingDateStr = openingDateObj.toISOString().slice(0, 10);

        const { error: openErr } = await db.rpc('set_account_opening_balance', {
          p_account_id: targetAccId,
          p_amount_minor: stagingMetrics.csvOpeningMinor,
          p_date: openingDateStr,
        });
        if (openErr) throw new Error(`Opening balance sync failed: ${openErr.message}`);
      }

      // 2. Commit staged transactions
      const payload: CanonicalRow[] = stagedRows.map(
        ({ _uid, category_hint, ...rest }) => rest,
      );
      const { data, error: rpcErr } = await db.rpc('import_statement', {
        p_account_id: targetAccId,
        p_rows: payload,
        p_file_name: fileName,
        p_source_type: 'csv',
      });

      if (rpcErr) throw new Error(rpcErr.message);

      setResult(data as ImportResult);
      setShowStaging(false);
      await loadMeta();
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
          {accounts.map(a => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
          {accounts.length === 0 && (
            <option value="">No accounts — create one in Settings</option>
          )}
        </select>
      </div>

      <label className={btn('primary', 'w-full cursor-pointer')}>
        {busy ? 'Importing…' : 'Choose Raw or Template CSV'}
        <input
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={onFile}
          disabled={busy}
        />
      </label>

      <p className="text-xs leading-relaxed text-gray-400">
        Auto-extracts <strong className="text-gray-200">Payees, Dividends, Salary & Categories</strong>, groups recurring merchants for 1-click editing, and syncs your statement balance automatically.
      </p>

      {error ? <Banner kind="error">{error}</Banner> : null}

      {report && report.failed.length > 0 ? (
        <div className="rounded border border-amber-800/60 bg-amber-950/30 p-2.5 text-xs text-amber-300">
          <div className="font-semibold">
            Skipped {report.failed.length} non-transaction row(s):
          </div>
          <ul className="mt-1 max-h-24 space-y-0.5 overflow-y-auto">
            {report.failed.slice(0, 8).map(f => (
              <li key={f.row}>
                Row {f.row}: {f.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {result ? (
        <div className="space-y-1 rounded-lg border border-gray-700 bg-gray-900 p-3 text-xs">
          <p className="font-semibold text-emerald-400">
            Inserted {result.inserted} transaction(s)
          </p>
          <p className="text-gray-400">Skipped active duplicates: {result.skipped}</p>
          {result.failed.length > 0 ? (
            <>
              <p className="text-red-400">Rejected: {result.failed.length}</p>
              <ul className="max-h-24 space-y-0.5 overflow-y-auto text-red-300">
                {result.failed.slice(0, 10).map(f => (
                  <li key={f.row}>
                    Row {f.row}: {f.reason}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}

      {/* Interactive Staging & Bulk Merchant Editor Modal */}
      {showStaging ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="staging-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-xs sm:p-6"
        >
          <div className="flex max-h-[92dvh] w-full max-w-7xl flex-col rounded-xl border border-gray-700 bg-gray-900 shadow-2xl">
            {/* Modal Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-800 p-4">
              <div>
                <h3 id="staging-modal-title" className="text-base font-bold text-white sm:text-lg">
                  Review & Categorize CSV ({stagedRows.length} transactions · {groupedMerchants.length} unique merchants)
                </h3>
                <p className="text-xs text-gray-400">
                  Target account:{' '}
                  <strong className="text-blue-400">
                    {selectedAccount?.name ?? 'Selected Account'}
                  </strong>{' '}
                  · Editing a Payee or Category in <strong className="text-gray-200">Unique Merchants</strong> mode updates all matching rows at once.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={downloadCleanedCsv}
                  className={btn('neutral', 'text-xs')}
                >
                  Download Cleaned CSV
                </button>
                <button
                  type="button"
                  disabled={busy}
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

            {error ? (
              <div className="px-4 pt-3">
                <Banner kind="error">{error}</Banner>
              </div>
            ) : null}

            {/* Toolbar: View Mode Toggle + Search + Statement Balance Summary */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-800 bg-gray-950/60 px-4 py-2.5 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-lg border border-gray-700 bg-gray-900 p-0.5">
                  <button
                    type="button"
                    onClick={() => setViewMode('grouped')}
                    className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                      viewMode === 'grouped'
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    Unique Merchants ({groupedMerchants.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('all')}
                    className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                      viewMode === 'all'
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    All Rows ({stagedRows.length})
                  </button>
                </div>

                <input
                  type="search"
                  value={searchFilter}
                  onChange={e => setSearchFilter(e.target.value)}
                  placeholder="Filter payee or remarks…"
                  className="w-48 rounded-lg border border-gray-700 bg-gray-900 px-2.5 py-1 text-xs text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
                />
              </div>

              {/* Compact Statement Balance Bar */}
              <div className="flex flex-wrap items-center gap-4">
                {stagingMetrics.csvOpeningMinor != null && (
                  <div>
                    <span className="text-gray-400">Opening: </span>
                    <strong className="font-mono text-gray-200">
                      {formatINR(stagingMetrics.csvOpeningMinor)}
                    </strong>
                  </div>
                )}
                <div>
                  <span className="text-gray-400">Net: </span>
                  <strong
                    className={`font-mono ${
                      stagingMetrics.netChangeMinor < 0 ? 'text-red-400' : 'text-emerald-400'
                    }`}
                  >
                    {formatINRSigned(stagingMetrics.netChangeMinor)}
                  </strong>
                </div>
                {stagingMetrics.csvClosingMinor != null && (
                  <div>
                    <span className="text-gray-400">Closing Bal: </span>
                    <strong className="font-mono text-emerald-400">
                      {formatINR(stagingMetrics.csvClosingMinor)}
                    </strong>
                  </div>
                )}
                {stagingMetrics.csvOpeningMinor != null && (
                  <label className="flex cursor-pointer items-center gap-1.5 rounded border border-gray-700 bg-gray-900 px-2.5 py-1 text-[11px] text-gray-300">
                    <input
                      type="checkbox"
                      checked={syncOpeningBalance}
                      onChange={e => setSyncOpeningBalance(e.target.checked)}
                      className="rounded border-gray-600 bg-gray-950 text-blue-500"
                    />
                    <span>Calibrate Opening Bal</span>
                  </label>
                )}
              </div>
            </div>

            {/* Staging Table */}
            <div className="flex-1 overflow-auto p-3 sm:p-4">
              <table className="w-full min-w-[1020px] border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-gray-800 bg-gray-950/70 text-gray-400">
                    <th className="w-28 p-2.5">
                      {viewMode === 'grouped' ? 'Txns' : 'Date'}
                    </th>
                    <th className="w-56 p-2.5">Payee (Auto-Extracted)</th>
                    <th className="p-2.5">Sample Transaction Remarks</th>
                    <th className="w-28 p-2.5">Type</th>
                    <th className="w-52 p-2.5">Category / Transfer To</th>
                    <th className="w-32 p-2.5 text-right">
                      {viewMode === 'grouped' ? 'Total Amount' : 'Amount'}
                    </th>
                    {viewMode === 'all' && (
                      <th className="w-32 p-2.5 text-right">Running Bal</th>
                    )}
                    <th className="w-10 p-2.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/70">
                  {visibleRows.map(row => {
                    const rowKind = row.kind ?? (row.amount_minor < 0 ? 'expense' : 'income');
                    const displayAmount =
                      viewMode === 'grouped' ? row._groupTotal : row.amount_minor;

                    return (
                      <tr key={row._uid} className="hover:bg-gray-800/40">
                        <td className="tabular whitespace-nowrap p-2 font-mono text-gray-300">
                          {viewMode === 'grouped' ? (
                            <span className="inline-flex items-center rounded-md border border-blue-800/60 bg-blue-950/70 px-2 py-0.5 text-xs font-semibold text-blue-300">
                              {row._groupCount}×
                            </span>
                          ) : (
                            row.txn_date
                          )}
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            value={row.payee ?? ''}
                            onChange={e => updateRowPayee(row._uid, e.target.value)}
                            placeholder="Enter Payee"
                            className="w-full rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-white focus:border-blue-500 focus:outline-none"
                          />
                        </td>
                        <td className="p-2 font-mono text-[11px] text-gray-400">
                          <div className="max-w-md break-all leading-relaxed">
                            {row.narration}
                          </div>
                        </td>
                        <td className="p-2">
                          <select
                            value={rowKind}
                            onChange={e =>
                              updateRowKind(
                                row._uid,
                                e.target.value as 'expense' | 'income' | 'transfer',
                              )
                            }
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
                              onChange={e =>
                                updateRowTransferAcc(
                                  row._uid,
                                  e.target.value ? Number(e.target.value) : null,
                                )
                              }
                              className="w-full rounded border border-purple-700/70 bg-gray-950 px-2 py-1.5 text-xs text-purple-200"
                            >
                              {accounts
                                .filter(a => String(a.id) !== accountId)
                                .map(a => (
                                  <option key={a.id} value={a.id}>
                                    To: {a.name}
                                  </option>
                                ))}
                            </select>
                          ) : (
                            <select
                              value={row.category_id ?? ''}
                              onChange={e =>
                                updateRowCategory(
                                  row._uid,
                                  e.target.value ? Number(e.target.value) : null,
                                )
                              }
                              className="w-full rounded border border-gray-700 bg-gray-950 px-2 py-1.5 text-xs text-white"
                            >
                              {categories
                                .filter(c => c.kind === rowKind)
                                .map(c => (
                                  <option key={c.id} value={c.id}>
                                    {c.name}
                                  </option>
                                ))}
                            </select>
                          )}
                        </td>
                        <td
                          className={`tabular whitespace-nowrap p-2 text-right font-mono font-semibold ${
                            displayAmount < 0 ? 'text-red-400' : 'text-emerald-400'
                          }`}
                        >
                          {formatINRSigned(displayAmount)}
                        </td>
                        {viewMode === 'all' && (
                          <td className="tabular whitespace-nowrap p-2 text-right font-mono text-gray-300">
                            {row.balance_minor != null ? (
                              formatINR(row.balance_minor)
                            ) : (
                              <span className="text-gray-600">—</span>
                            )}
                          </td>
                        )}
                        <td className="p-2 text-right">
                          <button
                            type="button"
                            onClick={() => removeStagedRow(row._uid)}
                            title={
                              viewMode === 'grouped'
                                ? `Skip all ${row._groupCount} row(s) for this merchant`
                                : 'Skip this row'
                            }
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
import Papa from 'papaparse';
import { parseDateToISO } from './dates';
import { parseMoneyToMinor } from './money';

export interface CanonicalRow {
  txn_date: string;
  amount_minor: number;      // signed: negative = money out
  narration: string;         // raw Transaction Remarks
  payee: string | null;      // user-editable Payee (placed before Transaction Remarks)
  ref: string | null;
  rule_key: string | null;   // merchant stub or VPA used to auto-recall & propagate
  kind?: 'expense' | 'income' | 'transfer';
  category_id?: number | null;
  transfer_account_id?: number | null;
}

export interface ParseReport {
  rows: CanonicalRow[];
  failed: { row: number; reason: string }[];
  headers: string[];
}

const norm = (s: string) =>
  s.trim().toLowerCase().replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();

function findCol(headers: string[], keys: string[], allowContains = false): number {
  for (const k of keys) {
    const i = headers.indexOf(k);
    if (i >= 0) return i;
  }
  for (const k of keys) {
    const i = headers.findIndex(h => h.startsWith(k));
    if (i >= 0) return i;
  }
  if (allowContains) {
    for (const k of keys) {
      const i = headers.findIndex(h => h.includes(k));
      if (i >= 0) return i;
    }
  }
  return -1;
}

/**
 * Extracts a clean Payee candidate and a stable rule_key from Indian bank remarks
 * e.g. "UPI/Trends Pun/XX7-01@jiopay/UPI/JIO PAYMEN/..." -> payeeStub: "Trends Pun", ruleKey: "Trends Pun"
 */
export function extractPayeeAndKey(narration: string): { payeeStub: string; ruleKey: string } {
  const s = narration.trim();
  if (!s) return { payeeStub: '', ruleKey: '' };

  const parts = s.split('/').map(p => p.trim()).filter(Boolean);
  const head = (parts[0] ?? '').toUpperCase();

  if ((head === 'UPI' || head === 'IMPS' || head === 'NEFT' || head === 'RTGS') && parts.length >= 2) {
    const stub = parts[1];
    const vpa = parts[2] && parts[2].includes('@') ? parts[2] : '';
    const key = stub.length >= 3 ? stub : (vpa || stub);
    return { payeeStub: stub, ruleKey: key };
  }

  if (parts.length >= 2 && (head === 'ATD' || head === 'ACH' || head === 'BIL' || head === 'ONL' || head === 'INF' || head === 'INFT')) {
    return { payeeStub: parts[1], ruleKey: parts[1] };
  }

  const fallback = parts[0] ? parts[0].slice(0, 32) : s.slice(0, 32);
  return { payeeStub: fallback, ruleKey: fallback };
}

const DATE_K  = ['transaction date','txn date','value date','posting date','tran date','value dt','date'];
const DEBIT_K = ['withdrawal amount','withdrawal amt','withdrawal amts','withdrawal','debit amount','debit','paid out','dr'];
const CRED_K  = ['deposit amount','deposit amt','deposit','credit amount','credit','paid in','cr'];
const AMT_K   = ['amount'];
const TYPE_K  = ['dr / cr','dr/cr','drcr','cr/dr','type','kind'];
const NARR_K  = ['transaction remarks','narration','description','particulars','transaction details','remarks','details'];
const PAYEE_K = ['payee','merchant','clean payee','payee name','name'];
const REF_K   = ['cheque number','cheque no','chq no','cheque / ref no','chq / ref no','reference','ref'];

export async function parseBankCsv(file: File): Promise<ParseReport> {
  const text = await file.text();
  const grid = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' }).data;
  if (!grid.length) throw new Error('File is empty.');

  const headerIdx = grid.findIndex(r => {
    const hs = r.map(c => norm(String(c ?? '')));
    return hs.some(h => h.includes('date')) &&
           hs.some(h => /amount|debit|credit|withdraw|deposit/.test(h));
  });
  if (headerIdx < 0) {
    throw new Error(
      'No header row found. Expected a row containing a date column and an amount, debit, credit, withdrawal or deposit column.',
    );
  }

  const footerIdx = grid.findIndex((r, i) =>
    i > headerIdx && r.some(c => /legends used in account statement/i.test(String(c ?? ''))),
  );

  const headers = grid[headerIdx].map(c => norm(String(c ?? '')));
  const col = {
    date:  findCol(headers, DATE_K, true),
    debit: findCol(headers, DEBIT_K),
    cred:  findCol(headers, CRED_K),
    amt:   findCol(headers, AMT_K),
    type:  findCol(headers, TYPE_K),
    narr:  findCol(headers, NARR_K),
    payee: findCol(headers, PAYEE_K),
    ref:   findCol(headers, REF_K),
  };

  if (col.date < 0) throw new Error('Could not identify a date column.');
  if (col.debit < 0 && col.cred < 0 && col.amt < 0) {
    throw new Error('Could not identify an amount, debit, credit, withdrawal or deposit column.');
  }

  const rows: CanonicalRow[] = [];
  const failed: ParseReport['failed'] = [];
  const cell = (r: string[], i: number) => (i >= 0 ? String(r[i] ?? '').trim() : '');

  const body = grid.slice(headerIdx + 1, footerIdx < 0 ? undefined : footerIdx);

  body.forEach((r, n) => {
    const rowNo = n + 1;
    try {
      const dateRaw = cell(r, col.date);
      const dRaw = cell(r, col.debit);
      const cRaw = cell(r, col.cred);
      const aRaw = cell(r, col.amt);

      // Wrapped narration continuation line (no date, no amounts)
      if (!dateRaw && !dRaw && !cRaw && !aRaw) {
        const extra = r.map(x => String(x ?? '').trim()).filter(Boolean).join(' ');
        if (extra && rows.length) {
          rows[rows.length - 1].narration += ' ' + extra;
          const updated = extractPayeeAndKey(rows[rows.length - 1].narration);
          if (!rows[rows.length - 1].payee) rows[rows.length - 1].payee = updated.payeeStub;
          if (!rows[rows.length - 1].rule_key) rows[rows.length - 1].rule_key = updated.ruleKey;
        }
        return;
      }

      const iso = parseDateToISO(dateRaw);

      let minor: number;
      if (col.debit >= 0 || col.cred >= 0) {
        const d = dRaw ? parseMoneyToMinor(dRaw) : 0;
        const c = cRaw ? parseMoneyToMinor(cRaw) : 0;
        if (d !== 0 && c !== 0) throw new Error('debit and credit are both non-zero');
        if (d === 0 && c === 0) throw new Error('zero amount');
        minor = d !== 0 ? -Math.abs(d) : Math.abs(c);
      } else {
        minor = parseMoneyToMinor(aRaw);
        if (minor !== 0 && col.type >= 0) {
          const t = cell(r, col.type).toUpperCase();
          if ((t.startsWith('DR') || t === 'EXPENSE') && minor > 0) minor = -minor;
          if ((t.startsWith('CR') || t === 'INCOME') && minor < 0) minor = -minor;
        }
      }
      if (minor === 0) throw new Error('zero amount');

      const narration = cell(r, col.narr) || cell(r, col.payee) || 'Imported';
      const explicitPayee = cell(r, col.payee);
      const { payeeStub, ruleKey } = extractPayeeAndKey(narration);
      const ref = cell(r, col.ref) || null;

      rows.push({
        txn_date: iso,
        amount_minor: minor,
        narration,
        payee: explicitPayee || payeeStub || null,
        ref,
        rule_key: ruleKey || explicitPayee || null,
        kind: minor < 0 ? 'expense' : 'income',
      });
    } catch (e) {
      failed.push({ row: rowNo, reason: e instanceof Error ? e.message : String(e) });
    }
  });

  return { rows, failed, headers };
}

/**
 * Generates a standardized CSV string with the Payee column directly in front of Transaction Remarks.
 */
export function buildCleanedTemplateCsv(
  rows: CanonicalRow[],
  catNameById: Record<number, string> = {},
): string {
  const data = rows.map(r => ({
    'Transaction Date': r.txn_date,
    'Payee': r.payee ?? '',
    'Transaction Remarks': r.narration,
    'Withdrawal Amount(INR)': r.amount_minor < 0 ? (Math.abs(r.amount_minor) / 100).toFixed(2) : '0.00',
    'Deposit Amount(INR)': r.amount_minor > 0 ? (r.amount_minor / 100).toFixed(2) : '0.00',
    'Type': r.kind ?? (r.amount_minor < 0 ? 'expense' : 'income'),
    'Category': r.category_id ? (catNameById[r.category_id] ?? '') : '',
  }));
  return Papa.unparse(data);
}

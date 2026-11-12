import Papa from 'papaparse';
import { parseDateToISO } from './dates';
import { parseMoneyToMinor } from './money';
import type { CanonicalRow } from './types';

export interface ParseReport {
  rows: CanonicalRow[];
  failed: { row: number; reason: string }[];
  headers: string[];
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

function findCol(headers: string[], keys: string[]): number {
  const h = headers.map(norm);
  for (const k of keys) {
    const i = h.indexOf(k);
    if (i >= 0) return i;
  }
  for (const k of keys) {
    const i = h.findIndex(x => x.startsWith(k));
    if (i >= 0) return i;
  }
  return -1;
}

const DATE_K  = ['date','txn date','transaction date','value date','posting date','tran date','value dt'];
const AMT_K   = ['amount','amt','transaction amount','amount (inr)','amount inr'];
const DEBIT_K = ['debit','withdrawal','withdrawal amt','withdrawal amount','withdrawal amt.','dr','debit amount','paid out'];
const CRED_K  = ['credit','deposit','deposit amt','deposit amount','cr','credit amount','paid in'];
const TYPE_K  = ['dr / cr','dr/cr','drcr','type','cr/dr'];
const NARR_K  = ['narration','description','particulars','details','transaction remarks','remarks','transaction details','transaction description'];
const PAYEE_K = ['payee','merchant','name'];
const REF_K   = ['ref','reference','reference no','cheque no','chq no','utr','chq / ref no','cheque / ref no'];

export async function parseBankCsv(file: File): Promise<ParseReport> {
  const text = await file.text();
  const grid = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' }).data;
  if (!grid.length) throw new Error('File is empty.');

  // Bank CSVs usually carry a preamble; find the real header row.
  const headerIdx = grid.findIndex(r =>
    r.some(c => /date/i.test(String(c))) &&
    r.some(c => /amount|debit|credit|withdraw|deposit/i.test(String(c))),
  );
  if (headerIdx < 0) {
    throw new Error('No header row found containing a date column and an amount/debit/credit column.');
  }

  const headers = grid[headerIdx].map(c => String(c ?? '').trim());
  const dateIdx  = findCol(headers, DATE_K);
  const amtIdx   = findCol(headers, AMT_K);
  const debitIdx = findCol(headers, DEBIT_K);
  const credIdx  = findCol(headers, CRED_K);
  const typeIdx  = findCol(headers, TYPE_K);
  const narrIdx  = findCol(headers, NARR_K);
  const payeeIdx = findCol(headers, PAYEE_K);
  const refIdx   = findCol(headers, REF_K);

  if (dateIdx < 0) throw new Error('Could not identify a date column.');
  if (debitIdx < 0 && credIdx < 0 && amtIdx < 0) {
    throw new Error('Could not identify an amount, debit or credit column.');
  }

  const rows: CanonicalRow[] = [];
  const failed: ParseReport['failed'] = [];
  const cell = (r: string[], i: number) => (i >= 0 ? String(r[i] ?? '').trim() : '');

  grid.slice(headerIdx + 1).forEach((r, n) => {
    const rowNo = n + 1;
    try {
      const iso = parseDateToISO(cell(r, dateIdx));

      let minor: number;
      const dRaw = cell(r, debitIdx);
      const cRaw = cell(r, credIdx);

      if (dRaw || cRaw) {
        if (dRaw && cRaw) throw new Error('both debit and credit columns are populated');
        minor = dRaw ? -Math.abs(parseMoneyToMinor(dRaw)) : Math.abs(parseMoneyToMinor(cRaw));
      } else {
        minor = parseMoneyToMinor(cell(r, amtIdx));
        if (minor !== 0 && typeIdx >= 0) {
          const t = cell(r, typeIdx).toUpperCase();
          if (t.startsWith('DR') && minor > 0) minor = -minor;
          if (t.startsWith('CR') && minor < 0) minor = -minor;
        }
      }
      if (minor === 0) throw new Error('zero amount');

      const narration = cell(r, narrIdx) || cell(r, payeeIdx) || 'Imported';
      const ref = cell(r, refIdx) ||
        (narration.match(/\b(?:UTR|REF|RRN)[:\s]*([A-Z0-9]{6,})/i)?.[1] ?? '') || null;

      rows.push({
        txn_date: iso,
        amount_minor: minor,
        narration,
        payee: cell(r, payeeIdx) || null,
        ref,
      });
    } catch (e) {
      failed.push({ row: rowNo, reason: e instanceof Error ? e.message : String(e) });
    }
  });

  return { rows, failed, headers };
}
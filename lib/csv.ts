// lib/csv.ts
import { parseMoneyToMinor } from '@/lib/money';

export interface CanonicalRow {
  txn_date: string; // YYYY-MM-DD
  narration: string;
  payee?: string;
  amount_minor: number; // signed paise (-ve expense, +ve income)
  balance_minor?: number | null; // running closing balance in paise after txn
  ref?: string | null;
  rule_key?: string | null;
  kind?: 'expense' | 'income' | 'transfer';
  category_id?: number | null;
  transfer_account_id?: number | null;
  category_hint?: string | null; // internal hint for smart category auto-matching
}

export interface ParseFailure {
  row: number;
  reason: string;
}

export interface ParseReport {
  rows: CanonicalRow[];
  failed: ParseFailure[];
  opening_balance_minor: number | null;
  closing_balance_minor: number | null;
}

const DATE_HEADERS = /^(txn\s*date|transaction\s*date|value\s*date|date|posting\s*date)$/i;
const NARR_HEADERS = /^(transaction\s*remarks|narration|description|particulars|remarks|details)$/i;
const PAYEE_HEADERS = /^(payee|merchant|beneficiary|party)$/i;
const DEBIT_HEADERS = /^(withdrawal\s*amount(\s*\(inr\))?|debit(\s*amount)?|dr|withdrawal|paid\s*out)$/i;
const CREDIT_HEADERS = /^(deposit\s*amount(\s*\(inr\))?|credit(\s*amount)?|cr|deposit|paid\s*in)$/i;
const AMOUNT_HEADERS = /^(amount(\s*\(inr\))?|txn\s*amount|transaction\s*amount)$/i;
const TYPE_HEADERS = /^(cr\s*\/?\s*dr|dr\s*\/?\s*cr|type|txn\s*type|indicator)$/i;
const BALANCE_HEADERS = /^(balance(\s*\(inr\))?|closing\s*balance(\s*\(inr\))?|running\s*balance(\s*\(inr\))?|available\s*balance|bal)$/i;
const REF_HEADERS = /^(chq\.?\s*\/?\s*ref\.?\s*no\.?|cheque\s*number|reference(\s*no\.?)?|ref\s*no|utr|cheque\s*no|txn\s*id)$/i;
const CATEGORY_HEADERS = /^(category|category\s*name)$/i;

export function parseSignedBalanceCell(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const cleaned = raw.trim();
  if (!cleaned || /^(-|--|null|na|n\/a)$/i.test(cleaned)) return null;

  const isDr = /\bdr\.?$/i.test(cleaned) || /^\(.*\)$/.test(cleaned) || cleaned.startsWith('-');
  const isCr = /\bcr\.?$/i.test(cleaned);

  const numericStr = cleaned
    .replace(/\b(cr|dr)\.?$/i, '')
    .replace(/[(),₹$\s]/g, '')
    .trim();

  if (!numericStr || isNaN(Number(numericStr))) return null;

  const minor = parseMoneyToMinor(numericStr);
  if (minor === null || isNaN(minor)) return null;

  const absMinor = Math.abs(minor);
  if (isDr && !isCr) return -absMinor;
  return absMinor;
}

function toTitleCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/\b[a-z]/g, ch => ch.toUpperCase())
    .trim();
}

export interface SmartNarrationResult {
  payee: string;
  rule_key: string;
  kind?: 'expense' | 'income' | 'transfer';
  category_hint: string | null;
  ref: string | null;
}

/**
 * Intelligent Indian Bank Narration Analyzer (ICICI / HDFC / SBI / Axis)
 * Extracts clean Payee name, deterministic rule_key, transaction reference, and category hint.
 */
export function analyzeIndianNarration(
  narration: string,
  amount_minor: number,
): SmartNarrationResult {
  const raw = narration.trim();
  const upper = raw.toUpperCase();
  const isExpense = amount_minor < 0;
  const slashParts = raw.split('/').map(s => s.trim()).filter(Boolean);

  // 1. UPI Transactions: UPI/<Name>/<VPA>/<Remark>/<Bank>/<RRN>/<TxnId>
  if (upper.startsWith('UPI/') && slashParts.length >= 2) {
    const rawName = slashParts[1];
    const upperName = rawName.toUpperCase();
    const vpa = slashParts[2] ?? '';
    const remark = slashParts[3] ?? '';
    const rrn = slashParts.find(p => /^\d{12}$/.test(p)) ?? null;

    let payee = toTitleCase(rawName);
    let rule_key = `UPI/${upperName}`;
    let kind: 'expense' | 'income' | 'transfer' | undefined;
    let category_hint: string | null = null;

    // Unify recurring family / self / merchant aliases
    if (upperName.includes('ASHOK SAHE') || upperName.includes('ASHOKRAOSA')) {
      payee = 'Ashokrao Salunke';
      rule_key = 'ASHOK SAHE';
      category_hint = 'family|parents|household|personal';
    } else if (upperName.includes('MANDAKINI')) {
      payee = 'Mandakini Salunke';
      rule_key = 'MANDAKINI';
      category_hint = 'family|parents|other income';
    } else if (upperName.includes('DATTPRASAD') || vpa.toLowerCase().includes('salunke.dprasa')) {
      payee = 'Self Transfer (IDFC First)';
      rule_key = 'SELF/DATTPRASAD';
      category_hint = 'transfer|personal';
    } else if (upperName.includes('GOOGLE PLA')) {
      payee = 'Google Play';
      rule_key = 'GOOGLE PLAY';
      category_hint = 'subscription|entertainment|software|bills';
    } else if (upperName.includes('MSEDCL')) {
      payee = 'MSEDCL Electricity';
      rule_key = 'MSEDCL';
      category_hint = 'electricity|utilities|bills';
    } else if (upperName.includes('MAHARASHTR') || upper.includes('MNGL')) {
      payee = 'MNGL Piped Gas';
      rule_key = 'MNGL GAS';
      category_hint = 'gas|utilities|bills';
    } else if (upperName.includes('NOBROKER')) {
      payee = 'NoBroker Society Maintenance';
      rule_key = 'NOBROKER';
      category_hint = 'maintenance|housing|society|bills';
    } else if (upperName.includes('DMART')) {
      payee = 'DMart';
      rule_key = 'DMART';
      category_hint = 'groceries|supermarket|shopping';
    } else if (upperName.includes('STAR BAZAA')) {
      payee = 'Star Bazaar';
      rule_key = 'STAR BAZAAR';
      category_hint = 'groceries|supermarket|shopping';
    } else if (upperName.includes('BLINKIT')) {
      payee = 'Blinkit';
      rule_key = 'BLINKIT';
      category_hint = 'groceries|food';
    } else if (upperName.includes('SWIGGY')) {
      payee = 'Swiggy Instamart';
      rule_key = 'SWIGGY';
      category_hint = 'groceries|food|dining';
    } else if (upperName.includes('MC DONALDS')) {
      payee = "McDonald's";
      rule_key = 'MC DONALDS';
      category_hint = 'dining|food|restaurant|snacks';
    } else if (upperName.includes('BIKANER SW')) {
      payee = 'Bikaner Sweets';
      rule_key = 'BIKANER SWEETS';
      category_hint = 'food|snacks|dining';
    } else if (upperName.includes('DAIRY FARM')) {
      payee = 'Dairy Farm';
      rule_key = 'DAIRY FARM';
      category_hint = 'milk|dairy|groceries|food';
    } else if (upperName.includes('PATHARE DA')) {
      payee = 'Pathare Dairy';
      rule_key = 'PATHARE DAIRY';
      category_hint = 'milk|dairy|groceries|food';
    } else if (upperName.includes('ZERODHA')) {
      payee = 'Zerodha Broking';
      rule_key = 'ZERODHA';
      category_hint = 'investment|stocks|mutual fund|sip';
    } else if (upperName.includes('ACKO')) {
      payee = 'ACKO General Insurance';
      rule_key = 'ACKO INSURANCE';
      category_hint = 'insurance|vehicle|automobile|car|bike';
    } else if (upperName.includes('HRIDAAN MO')) {
      payee = 'Hridaan Motors (Royal Enfield)';
      rule_key = 'HRIDAAN MOTORS';
      category_hint = 'vehicle|bike|automobile|maintenance|shopping';
    } else if (upperName.includes('TRENDS PUN')) {
      payee = 'Reliance Trends';
      rule_key = 'RELIANCE TRENDS';
      category_hint = 'clothing|apparel|shopping';
    } else if (upperName.includes('PUMA')) {
      payee = 'Puma Store';
      rule_key = 'PUMA';
      category_hint = 'clothing|apparel|shopping';
    } else if (upperName.includes('JIO')) {
      payee = 'Jio / Reliance Retail';
      rule_key = 'UPI/JIO';
      category_hint = 'telecom|recharge|utilities|shopping';
    } else if (upperName.includes('MSRTC')) {
      payee = 'MSRTC Bus';
      rule_key = 'MSRTC';
      category_hint = 'transport|travel|bus';
    } else if (
      upperName.includes('VINAYAK FU') ||
      upperName.includes('SHIVNERI F') ||
      upperName.includes('SACHIN GRA')
    ) {
      payee = toTitleCase(rawName);
      rule_key = `UPI/${upperName}`;
      category_hint = 'fuel|petrol|vehicle|transport';
    } else if (
      upperName.includes('RONAK PHAR') ||
      upperName.includes('PRAKASH ME') ||
      upperName.includes('SANDEEP SO') ||
      upperName.includes('DARSHAN SH')
    ) {
      payee = toTitleCase(rawName);
      rule_key = `UPI/${upperName}`;
      category_hint = 'medical|health|doctor|pharmacy';
    }

    // Check explicit user UPI note/remark in slot 3 (e.g., dentist, milk, bike, medical, School Pic, paper bill, bhishi)
    const remLower = remark.toLowerCase();
    if (remLower.includes('dentist') || remLower.includes('medical')) {
      category_hint = 'medical|health|doctor';
    } else if (remLower.includes('milk')) {
      category_hint = 'milk|dairy|groceries|food';
    } else if (remLower.includes('bike') || remLower === 're') {
      category_hint = 'vehicle|bike|automobile|maintenance';
    } else if (remLower.includes('school')) {
      category_hint = 'education|school|kids|child';
    } else if (remLower.includes('paper')) {
      category_hint = 'utilities|newspaper|subscriptions|household';
    } else if (remLower.includes('bhishi')) {
      category_hint = 'investment|savings|chit|family';
    }

    return { payee, rule_key, kind, category_hint, ref: rrn };
  }

  // 2. ACH & CMS Credits (Dividends) and Debits (ECS / SIP / Loan EMI)
  if (upper.startsWith('ACH/') || upper.startsWith('CMS/')) {
    const rawComp = slashParts[1] ?? raw;
    const refPart = slashParts[2] ?? null;

    if (!isExpense) {
      let cleanComp = rawComp
        .replace(/\b(DIV\s*\d*[\-\d]*|FNLDIV\s*\d*|FIN\.?DIV\s*[\d\-]*|FNL\d+|INDIV\d+)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!cleanComp || cleanComp.toUpperCase() === 'CMS') {
        cleanComp = slashParts[2]?.replace(/dividend.*/i, '').trim() || 'Equity';
      }
      return {
        payee: `${toTitleCase(cleanComp)} (Dividend)`,
        rule_key: `DIV/${cleanComp.toUpperCase().slice(0, 22)}`,
        category_hint: 'dividend|investment|other income|income',
        ref: refPart,
      };
    } else {
      if (upper.includes('TP ACH HDFCSTANDARD')) {
        return {
          payee: 'HDFC Life / Mutual Fund ACH',
          rule_key: 'TP ACH HDFCSTANDARD',
          category_hint: 'insurance|investment|sip|bills',
          ref: slashParts[slashParts.length - 1] ?? null,
        };
      }
      if (upper.includes('IDBI BANK')) {
        return {
          payee: 'IDBI Bank Home Loan EMI',
          rule_key: 'IDBI HOME LOAN',
          category_hint: 'loan|emi|housing|mortgage',
          ref: slashParts[slashParts.length - 1] ?? null,
        };
      }
      return {
        payee: toTitleCase(rawComp),
        rule_key: `ACH/${rawComp.toUpperCase().slice(0, 22)}`,
        category_hint: 'bills|emi|utilities',
        ref: refPart,
      };
    }
  }

  // 3. BIL/NEFT or BIL/INFT (Bill Payments, Loan Foreclosure, Internal Transfers)
  if (upper.startsWith('BIL/')) {
    const refNo = slashParts[2] ?? null;
    if (upper.includes('IDBI BANK') || upper.includes('SRA OPERAT')) {
      return {
        payee: 'IDBI Bank Home Loan',
        rule_key: 'IDBI HOME LOAN',
        category_hint: 'loan|emi|housing|mortgage',
        ref: refNo,
      };
    }
    if (upper.includes('SANDVIK AS')) {
      return {
        payee: 'Sandvik Asia',
        rule_key: 'SANDVIK ASIA',
        category_hint: 'work|office|transfer|shopping',
        ref: refNo,
      };
    }
    if (upper.includes('GITESH SUDAM')) {
      return {
        payee: 'Gitesh Sudam Alhat',
        rule_key: 'GITESH SUDAM',
        category_hint: 'friends|family|other income|transfer',
        ref: refNo,
      };
    }
    const party = slashParts[4] || slashParts[3] || 'Bill Payment';
    return {
      payee: toTitleCase(party),
      rule_key: `BIL/${party.toUpperCase().slice(0, 22)}`,
      category_hint: 'bills|transfer',
      ref: refNo,
    };
  }

  // 4. NEFT- Credits (Salary, Insurance Payouts, Zerodha Payouts, Loan Refund)
  if (upper.startsWith('NEFT-')) {
    const dashParts = raw.split('-').map(s => s.trim()).filter(Boolean);
    const utr = dashParts[1] ?? null;

    if (upper.includes('SANDVIK COROMANT')) {
      return {
        payee: 'Sandvik Coromant India (Salary)',
        rule_key: 'SANDVIK COROMANT SALARY',
        category_hint: 'salary|paycheck|income|general income',
        ref: utr,
      };
    }
    if (upper.includes('NATIONAL INSURANCE')) {
      return {
        payee: 'National Insurance Co. (Claim)',
        rule_key: 'NATIONAL INSURANCE',
        category_hint: 'insurance|medical|reimbursement|other income',
        ref: utr,
      };
    }
    if (upper.includes('ZERODHA')) {
      return {
        payee: 'Zerodha Broking Payout',
        rule_key: 'ZERODHA',
        category_hint: 'investment|stocks|other income',
        ref: utr,
      };
    }
    if (upper.includes('EXCESS REFUND') || upper.includes('SRA  RTGS')) {
      return {
        payee: 'IDBI Home Loan Excess Refund',
        rule_key: 'IDBI HOME LOAN REFUND',
        category_hint: 'refund|loan|other income',
        ref: utr,
      };
    }
    const sender = dashParts[2] ?? 'NEFT Transfer';
    return {
      payee: toTitleCase(sender),
      rule_key: `NEFT/${sender.toUpperCase().slice(0, 22)}`,
      category_hint: isExpense ? 'expense' : 'other income',
      ref: utr,
    };
  }

  // 5. MMT/IMPS (Mobile Money Transfers)
  if (upper.startsWith('MMT/IMPS')) {
    const rrn = slashParts[2] ?? null;
    const ben = slashParts[3] ?? 'IMPS Transfer';
    if (ben.toUpperCase().includes('DATTPRASAD')) {
      return {
        payee: 'Self Transfer (IDFC First)',
        rule_key: 'SELF/DATTPRASAD',
        category_hint: 'transfer|personal',
        ref: rrn,
      };
    }
    return {
      payee: toTitleCase(ben),
      rule_key: `IMPS/${ben.toUpperCase().slice(0, 22)}`,
      category_hint: 'transfer|family',
      ref: rrn,
    };
  }

  // 6. Auto Debit Credit Card Bill (ATD/Auto Debit CC...)
  if (upper.startsWith('ATD/AUTO DEBIT CC')) {
    return {
      payee: 'ICICI Credit Card Auto-Debit',
      rule_key: 'ATD/AUTO DEBIT CC',
      category_hint: 'credit card|bills|transfer',
      ref: null,
    };
  }

  // 7. Quarterly Savings Account Interest (:Int.Pd:)
  if (upper.includes(':INT.PD:')) {
    return {
      payee: 'ICICI Bank Savings Interest',
      rule_key: 'BANK SAVINGS INTEREST',
      category_hint: 'interest|other income|income',
      ref: null,
    };
  }

  // Fallback
  const fallbackKey = upper.replace(/[0-9]{4,}/g, '').replace(/\s+/g, ' ').slice(0, 28).trim();
  return {
    payee: toTitleCase(slashParts[0] ?? raw.slice(0, 28)),
    rule_key: fallbackKey || 'BANK IMPORT',
    category_hint: null,
    ref: null,
  };
}

export function extractRuleKey(narration: string): string {
  return analyzeIndianNarration(narration, -100).rule_key;
}

function tokenizeCsv(text: string): string[][] {
  const cleanText = text.replace(/^\uFEFF/, ''); // strip UTF-8 BOM
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < cleanText.length; i++) {
    const ch = cleanText[i];
    const next = cleanText[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        currentField += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        currentField += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        currentRow.push(currentField.trim());
        currentField = '';
      } else if (ch === '\r' && next === '\n') {
        currentRow.push(currentField.trim());
        rows.push(currentRow);
        currentRow = [];
        currentField = '';
        i++;
      } else if (ch === '\n' || ch === '\r') {
        currentRow.push(currentField.trim());
        rows.push(currentRow);
        currentRow = [];
        currentField = '';
      } else {
        currentField += ch;
      }
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    rows.push(currentRow);
  }

  return rows.filter(r => r.some(cell => cell.length > 0));
}

function normalizeDate(raw: string): string | null {
  const s = raw.trim().replace(/\s+/g, ' ');
  if (!s) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const dmyMatch = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, '0');
    const month = dmyMatch[2].padStart(2, '0');
    let year = dmyMatch[3];
    if (year.length === 2) year = `20${year}`;
    return `${year}-${month}-${day}`;
  }

  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    const yyyy = parsed.getFullYear();
    const mm = String(parsed.getMonth() + 1).padStart(2, '0');
    const dd = String(parsed.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  return null;
}

export async function parseBankCsv(file: File): Promise<ParseReport> {
  const text = await file.text();
  const allRows = tokenizeCsv(text);
  const failed: ParseFailure[] = [];
  const parsedRows: (CanonicalRow & { _rawIndex: number })[] = [];

  let headerRowIdx = -1;
  let colMap = {
    date: -1,
    narr: -1,
    payee: -1,
    debit: -1,
    credit: -1,
    amount: -1,
    type: -1,
    balance: -1,
    ref: -1,
    category: -1,
  };

  for (let i = 0; i < Math.min(allRows.length, 40); i++) {
    const row = allRows[i];
    const cleanCols = row.map(c => c.replace(/^["']|["']$/g, '').trim());
    const txnDateIdx = cleanCols.findIndex(c => /^transaction\s*date$/i.test(c));
    const anyDateIdx =
      txnDateIdx !== -1 ? txnDateIdx : cleanCols.findIndex(c => DATE_HEADERS.test(c));
    const narrIdx = cleanCols.findIndex(c => NARR_HEADERS.test(c));

    if (anyDateIdx !== -1 && narrIdx !== -1) {
      headerRowIdx = i;
      colMap = {
        date: anyDateIdx,
        narr: narrIdx,
        payee: cleanCols.findIndex(c => PAYEE_HEADERS.test(c)),
        debit: cleanCols.findIndex(c => DEBIT_HEADERS.test(c)),
        credit: cleanCols.findIndex(c => CREDIT_HEADERS.test(c)),
        amount: cleanCols.findIndex(c => AMOUNT_HEADERS.test(c)),
        type: cleanCols.findIndex(c => TYPE_HEADERS.test(c)),
        balance: cleanCols.findIndex(c => BALANCE_HEADERS.test(c)),
        ref: cleanCols.findIndex(c => REF_HEADERS.test(c)),
        category: cleanCols.findIndex(c => CATEGORY_HEADERS.test(c)),
      };
      break;
    }
  }

  if (headerRowIdx === -1) {
    throw new Error('Could not find valid transaction headers (Date & Narration/Remarks) in CSV.');
  }

  for (let i = headerRowIdx + 1; i < allRows.length; i++) {
    const r = allRows[i];
    const rowNum = i + 1;

    const joinedRowText = r.join(' ').trim();
    if (/legends?\s+used\s+in\s+account\s+statement/i.test(joinedRowText)) {
      break;
    }

    const rawDate = (r[colMap.date] ?? '').trim();
    const rawNarr = (r[colMap.narr] ?? '').trim();

    if (!rawDate && !rawNarr) continue;

    let amount_minor: number | null = null;

    if (colMap.debit !== -1 || colMap.credit !== -1) {
      const drVal = colMap.debit !== -1 ? parseSignedBalanceCell(r[colMap.debit]) : null;
      const crVal = colMap.credit !== -1 ? parseSignedBalanceCell(r[colMap.credit]) : null;

      if (drVal !== null && Math.abs(drVal) > 0) {
        amount_minor = -Math.abs(drVal);
      } else if (crVal !== null && Math.abs(crVal) > 0) {
        amount_minor = Math.abs(crVal);
      }
    }

    if (amount_minor === null && colMap.amount !== -1) {
      const rawAmt = parseSignedBalanceCell(r[colMap.amount]);
      if (rawAmt !== null && rawAmt !== 0) {
        const typeStr = colMap.type !== -1 ? (r[colMap.type] ?? '').trim().toUpperCase() : '';
        if (/^(DR|DEBIT|EXPENSE|WITHDRAWAL|D)$/.test(typeStr)) {
          amount_minor = -Math.abs(rawAmt);
        } else if (/^(CR|CREDIT|INCOME|DEPOSIT|C)$/.test(typeStr)) {
          amount_minor = Math.abs(rawAmt);
        } else {
          amount_minor = rawAmt;
        }
      }
    }

    const txn_date = normalizeDate(rawDate);

    // Stitch ICICI multi-line wrapped narrations
    if (!txn_date) {
      if (amount_minor === null || amount_minor === 0) {
        if (rawNarr && parsedRows.length > 0) {
          const prev = parsedRows[parsedRows.length - 1];
          const sep = /^[a-z0-9@._\/-]+$/i.test(rawNarr) ? '' : ' ';
          prev.narration = `${prev.narration}${sep}${rawNarr}`.trim();
          const reanalyzed = analyzeIndianNarration(prev.narration, prev.amount_minor);
          if (!prev.payee || prev.payee === 'Bank Import') prev.payee = reanalyzed.payee;
          prev.rule_key = reanalyzed.rule_key;
          prev.category_hint = reanalyzed.category_hint;
          prev.ref = prev.ref || reanalyzed.ref;
        }
        continue;
      }

      failed.push({ row: rowNum, reason: `Invalid or missing date "${rawDate}"` });
      continue;
    }

    if (!rawNarr) {
      failed.push({ row: rowNum, reason: 'Missing transaction narration/remarks' });
      continue;
    }

    if (amount_minor === null || amount_minor === 0) {
      failed.push({ row: rowNum, reason: 'Zero or unparseable transaction amount' });
      continue;
    }

    const balance_minor =
      colMap.balance !== -1 ? parseSignedBalanceCell(r[colMap.balance]) : null;
    const explicitPayee = colMap.payee !== -1 ? r[colMap.payee]?.trim() : '';
    const explicitRef = colMap.ref !== -1 ? r[colMap.ref]?.trim() : '';

    const smart = analyzeIndianNarration(rawNarr, amount_minor);

    parsedRows.push({
      _rawIndex: i,
      txn_date,
      narration: rawNarr,
      payee: explicitPayee || smart.payee,
      amount_minor,
      balance_minor,
      ref: explicitRef || smart.ref,
      rule_key: smart.rule_key,
      kind: smart.kind,
      category_hint: smart.category_hint,
    });
  }

  // Ensure chronological order (oldest -> newest)
  if (parsedRows.length >= 2) {
    const firstDate = parsedRows[0].txn_date;
    const lastDate = parsedRows[parsedRows.length - 1].txn_date;

    if (firstDate > lastDate) {
      parsedRows.reverse();
    } else if (firstDate === lastDate) {
      const r0 = parsedRows[0];
      const r1 = parsedRows[1];
      if (
        r0.balance_minor != null &&
        r1.balance_minor != null &&
        Math.abs(r1.balance_minor + r0.amount_minor - r0.balance_minor) < 5
      ) {
        parsedRows.reverse();
      }
    }
  }

  const firstWithBal = parsedRows.find(r => r.balance_minor != null);
  const lastWithBal = [...parsedRows].reverse().find(r => r.balance_minor != null);

  const opening_balance_minor =
    firstWithBal && firstWithBal.balance_minor != null
      ? firstWithBal.balance_minor - firstWithBal.amount_minor
      : null;

  const closing_balance_minor = lastWithBal?.balance_minor ?? null;

  return {
    rows: parsedRows.map(({ _rawIndex, ...rest }) => rest),
    failed,
    opening_balance_minor,
    closing_balance_minor,
  };
}

export function buildCleanedTemplateCsv(
  rows: CanonicalRow[],
  catNameById: Record<number, string>,
): string {
  const headers = [
    'Date',
    'Payee',
    'Transaction Remarks',
    'Type',
    'Category',
    'Amount (INR)',
    'Balance (INR)',
    'Reference',
  ];

  const escapeCsv = (val: string) =>
    /[",\n\r]/.test(val) ? `"${val.replace(/"/g, '""')}"` : val;

  const lines = rows.map(r => {
    const kind = r.kind ?? (r.amount_minor < 0 ? 'expense' : 'income');
    const catName = r.category_id ? (catNameById[r.category_id] ?? '') : '';
    const amtInr = (r.amount_minor / 100).toFixed(2);
    const balInr = r.balance_minor != null ? (r.balance_minor / 100).toFixed(2) : '';

    return [
      r.txn_date,
      escapeCsv(r.payee ?? ''),
      escapeCsv(r.narration),
      kind,
      escapeCsv(catName),
      amtInr,
      balInr,
      escapeCsv(r.ref ?? ''),
    ].join(',');
  });

  return [headers.join(','), ...lines].join('\n');
}
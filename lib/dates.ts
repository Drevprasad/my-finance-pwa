export type RangeKey = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'all';
export interface DateRange { from: string | null; to: string | null; label: string }

const pad = (n: number) => String(n).padStart(2, '0');

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_LONG  = ['January','February','March','April','May','June','July','August',
                     'September','October','November','December'];
const MONTH_MAP: Record<string, string> = {
  jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06',
  jul:'07', aug:'08', sep:'09', sept:'09', oct:'10', nov:'11', dec:'12',
};

/** A Date you already hold -> local ISO. Pure. */
export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Reads the clock. Call ONLY from useEffect / event handlers / server code —
 * never during render (Next 16 blocks it with cacheComponents).
 */
export function todayISO(): string {
  return toISODate(new Date());
}

export function isISODate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function ymd(iso: string): [number, number, number] {
  if (!isISODate(iso)) throw new Error(`expected YYYY-MM-DD, got "${iso}"`);
  return [Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), Number(iso.slice(8, 10))];
}

/** Pure day arithmetic in UTC so it can never be affected by DST or timezone. */
export function addDaysISO(iso: string, delta: number): string {
  const [y, m, d] = ymd(iso);
  const t = new Date(Date.UTC(y, m - 1, d) + delta * 86_400_000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function startOfMonthISO(iso: string): string {
  const [y, m] = ymd(iso);
  return `${y}-${pad(m)}-01`;
}

export function endOfMonthISO(iso: string): string {
  const [y, m] = ymd(iso);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 of next month
  return `${y}-${pad(m)}-${pad(lastDay)}`;
}

export function startOfYearISO(iso: string): string {
  return `${ymd(iso)[0]}-01-01`;
}

/* ---------------- labels (locale-independent, so SSR and CSR agree) ---------------- */

export function longDateLabel(iso: string): string {
  const [y, m, d] = ymd(iso);
  return `${d} ${MONTH_LONG[m - 1]} ${y}`;
}
export function monthYearLabel(iso: string): string {
  const [y, m] = ymd(iso);
  return `${MONTH_LONG[m - 1]} ${y}`;
}
export function shortMonthLabel(iso: string): string {
  const [y, m] = ymd(iso);
  return `${MONTH_SHORT[m - 1]} '${String(y).slice(2)}`;
}

/* ---------------- ranges ---------------- */

/** `today` must come from useToday() / an effect — never `new Date()` in render. */
export function rangeFor(key: RangeKey, today: string): DateRange {
  switch (key) {
    case 'daily':
      return { from: today, to: today, label: longDateLabel(today) };
    case 'weekly':
      return { from: addDaysISO(today, -6), to: today, label: 'Last 7 days (incl. today)' };
    case 'monthly':
      return {
        from: startOfMonthISO(today),
        to: today,
        label: `${monthYearLabel(today)} · month to date`,
      };
    case 'yearly':
      return {
        from: startOfYearISO(today),
        to: today,
        label: `${ymd(today)[0]} · year to date`,
      };
    case 'all':
    default:
      return { from: null, to: null, label: 'All time' };
  }
}

/** Whole calendar month. */
export function monthRange(year: number, month1to12: number): DateRange {
  const first = `${year}-${pad(month1to12)}-01`;
  return {
    from: first,
    to: endOfMonthISO(first),
    label: shortMonthLabel(first),
  };
}

export function yearRange(year: number): DateRange {
  return { from: `${year}-01-01`, to: `${year}-12-31`, label: String(year) };
}

export function dayRange(iso: string): DateRange {
  return { from: iso, to: iso, label: shortMonthLabel(iso) };
}

/** 'YYYY-MM' or 'YYYY-MM-DD' -> axis label */
export function periodLabel(p: string): string {
  const [y, m, d] = p.split('-');
  if (d) return `${Number(d)} ${MONTH_SHORT[Number(m) - 1]}`;
  return `${MONTH_SHORT[Number(m) - 1]} '${y.slice(2)}`;
}

/** Date pickers / bank CSV parsing (dd/mm/yyyy, dd-MMM-yyyy, ...). */
export function parseDateToISO(input: unknown): string {
  if (input instanceof Date) return toISODate(input);
  const raw = String(input ?? '').trim().replace(/\s+/g, ' ');
  if (!raw) throw new Error('missing date');

  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${pad(Number(iso[2]))}-${pad(Number(iso[3]))}`;

  const dmy = raw.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (dmy) {
    const y = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
    return `${y}-${pad(Number(dmy[2]))}-${pad(Number(dmy[1]))}`;
  }

  const dmony = raw.match(/^(\d{1,2})[ \-]([A-Za-z]{3,4})[ \-](\d{2,4})$/);
  if (dmony) {
    const mm = MONTH_MAP[dmony[2].toLowerCase()];
    if (!mm) throw new Error(`unrecognised month in "${raw}"`);
    const y = dmony[3].length === 2 ? `20${dmony[3]}` : dmony[3];
    return `${y}-${mm}-${pad(Number(dmony[1]))}`;
  }
  throw new Error(`unrecognised date: "${raw}"`);
}
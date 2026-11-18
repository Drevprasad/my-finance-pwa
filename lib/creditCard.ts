// Credit card date helpers. All functions take `today` as an ISO string (YYYY-MM-DD) from
// useToday(), never new Date() in render, to avoid hydration mismatches.
// Keep the logic in sync with public.credit_card_summary() in credit_card_summary.sql.

export interface CardSummary {
  account_id: number;
  name: string;
  credit_limit_minor: number | null;
  outstanding_minor: number;
  statement_balance_minor: number;
  amount_due_minor: number;
  last_statement: string;
  next_statement: string;
  last_due: string | null;
  next_due: string | null;
  last_payment_date: string | null;
  last_payment_minor: number | null;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function parseIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function toIso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Day `day` of month `m` (0-based, may overflow into other years), clamped to month length. */
function clamped(y: number, m: number, day: number): Date {
  const last = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(day, last));
}

/** Due day-of-month for a statement day plus grace days (reference: a 31-day month). */
export function dueDayFromGrace(statementDay: number, graceDays: number): number {
  const d = new Date(2026, 0, statementDay);
  d.setDate(d.getDate() + graceDays);
  return d.getDate();
}

/** Approximate grace days implied by a statement day and due day. */
export function graceFromDue(statementDay: number, dueDay: number): number {
  return dueDay > statementDay ? dueDay - statementDay : dueDay + 31 - statementDay;
}

/** Due date for a given statement date. */
export function dueDateFor(statement: Date, statementDay: number, dueDay: number): Date {
  const offset = dueDay <= statementDay ? 1 : 0;
  return clamped(statement.getFullYear(), statement.getMonth() + offset, dueDay);
}

/** Next statement date and the due date that follows it (for the Settings preview). */
export function previewCard(statementDay: number, graceDays: number, todayIso: string) {
  const t = parseIso(todayIso);
  const thisMonth = clamped(t.getFullYear(), t.getMonth(), statementDay);
  const next = thisMonth > t
    ? thisMonth
    : clamped(t.getFullYear(), t.getMonth() + 1, statementDay);
  const dueDay = dueDayFromGrace(statementDay, graceDays);
  const due = dueDateFor(next, statementDay, dueDay);
  return { nextStatement: toIso(next), nextDue: toIso(due), dueDay };
}

export function daysUntil(iso: string, todayIso: string): number {
  return Math.round((parseIso(iso).getTime() - parseIso(todayIso).getTime()) / 86_400_000);
}

export function fmtDate(iso: string): string {
  return parseIso(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function dueText(days: number | null): string {
  if (days === null) return '';
  if (days < 0) return `${-days} day${days === -1 ? '' : 's'} overdue`;
  if (days === 0) return 'today';
  return `in ${days} day${days === 1 ? '' : 's'}`;
}
export const MINOR_PER_RUPEE = 100;

/**
 * String-based money parser. NEVER use parseFloat: "1,234.56" -> 1.
 * Handles ₹ / commas / nbsp / "(1,234.00)" / "-1234" / "1234.00 Dr".
 */
export function parseMoneyToMinor(input: unknown): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new Error(`invalid amount: ${input}`);
    return Math.round(input * MINOR_PER_RUPEE);
  }
  let s = String(input ?? '').trim();
  if (!s) throw new Error('missing amount');

  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (/^-/.test(s))       { negative = true; s = s.slice(1); }
  if (/\bdr\.?$/i.test(s)) { negative = true; s = s.replace(/\bdr\.?$/i, ''); }
  s = s.replace(/\bcr\.?$/i, '').replace(/[₹,\s\u00a0]/g, '');

  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`invalid amount: "${input}"`);

  const [intPart, fracPart = ''] = s.split('.');
  const frac = (fracPart + '00').slice(0, 2);          // exact, no float rounding
  const minor = Number(intPart || '0') * MINOR_PER_RUPEE + Number(frac);
  if (!Number.isSafeInteger(minor)) throw new Error(`amount out of range: "${input}"`);
  return negative ? -minor : minor;
}

const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatINR(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  return `${sign}₹${inr.format(Math.abs(minor) / MINOR_PER_RUPEE)}`;
}

export function formatINRSigned(minor: number): string {
  return `${minor > 0 ? '+' : ''}${formatINR(minor)}`;
}

/** Axis ticks: ₹1.2Cr / ₹4.5L / ₹12k */
export function formatINRCompact(minor: number): string {
  const r = Math.abs(minor) / MINOR_PER_RUPEE;
  const s = minor < 0 ? '-' : '';
  if (r >= 1e7) return `${s}₹${(r / 1e7).toFixed(1)}Cr`;
  if (r >= 1e5) return `${s}₹${(r / 1e5).toFixed(1)}L`;
  if (r >= 1e3) return `${s}₹${Math.round(r / 1e3)}k`;
  return `${s}₹${Math.round(r)}`;
}
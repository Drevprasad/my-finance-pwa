import type { DateRange } from '@/lib/dates';

export interface ReportFilterState {
  accountIds: number[];
  categoryIds: number[];
}

export const EMPTY_FILTERS: ReportFilterState = { accountIds: [], categoryIds: [] };

export interface RangePayload { from: string; to: string }

/** DateRange[] -> the [{from,to}] array the RPCs expect. Empty array = all time. */
export function rangesToPayload(ranges: DateRange[]): RangePayload[] {
  const out: RangePayload[] = [];
  for (const r of ranges) {
    const from = r.from ?? r.to;
    const to = r.to ?? r.from;
    if (from && to) out.push({ from, to });
  }
  return out;
}

/** Earliest from / latest to across all ranges (ISO strings compare correctly). */
export function spanOf(payload: RangePayload[]): RangePayload | null {
  if (!payload.length) return null;
  let from = payload[0].from;
  let to = payload[0].to;
  for (const r of payload) {
    if (r.from < from) from = r.from;
    if (r.to > to) to = r.to;
  }
  return { from, to };
}

/** RPC args must always be sent (never undefined), so empty -> null. */
export function idsOrNull(ids: number[]): number[] | null {
  return ids.length ? ids : null;
}

export function toggleId(list: number[], id: number): number[] {
  return list.includes(id) ? list.filter(x => x !== id) : [...list, id];
}

export function activeFilterCount(f: ReportFilterState): number {
  return (f.accountIds.length ? 1 : 0) + (f.categoryIds.length ? 1 : 0);
}

/** "2 accounts · 1 category" or '' when no filter is active. */
export function filterLabel(f: ReportFilterState): string {
  const parts: string[] = [];
  if (f.accountIds.length) parts.push(`${f.accountIds.length} account${f.accountIds.length > 1 ? 's' : ''}`);
  if (f.categoryIds.length) parts.push(`${f.categoryIds.length} categor${f.categoryIds.length > 1 ? 'ies' : 'y'}`);
  return parts.join(' · ');
}
'use client';

import { useState, type ReactNode } from 'react';
import { Card, CardTitle, btn } from '@/components/ui';
import { activeFilterCount, toggleId, type ReportFilterState } from '@/lib/reportFilters';
import type { AccountRow, CategoryRow } from '@/lib/types';

type Panel = 'accounts' | 'categories' | null;
const KIND_ORDER: CategoryRow['kind'][] = ['expense', 'income', 'transfer'];

export default function ReportFilters({
  accounts, categories, value, onChange,
}: {
  accounts: AccountRow[];
  categories: CategoryRow[];
  value: ReportFilterState;
  onChange: (next: ReportFilterState) => void;
}) {
  const [open, setOpen] = useState<Panel>(null);
  const active = activeFilterCount(value);

  const accName = (id: number) => accounts.find(a => a.id === id)?.name ?? `#${id}`;
  const catName = (id: number) => categories.find(c => c.id === id)?.name ?? `#${id}`;
  const toggle = (p: Exclude<Panel, null>) => setOpen(prev => (prev === p ? null : p));

  return (
    <Card>
      <CardTitle
        right={active ? (
          <span className="rounded-full bg-blue-900/60 px-2 py-0.5 text-[11px] font-semibold text-blue-200">
            {active} active
          </span>
        ) : undefined}
      >
        Filters
      </CardTitle>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <MultiSelect
          id="flt-acc" label="Accounts" allText="All accounts"
          count={value.accountIds.length} open={open === 'accounts'}
          onToggle={() => toggle('accounts')}
          onClear={() => onChange({ ...value, accountIds: [] })}
        >
          {accounts.length === 0 ? <p className="p-3 text-xs text-gray-500">No accounts yet.</p> : null}
          {accounts.map(a => (
            <Option key={a.id} label={a.name} hint={a.subtype.replace('_', ' ')}
                    checked={value.accountIds.includes(a.id)}
                    onChange={() => onChange({ ...value, accountIds: toggleId(value.accountIds, a.id) })} />
          ))}
        </MultiSelect>

        <MultiSelect
          id="flt-cat" label="Categories" allText="All categories"
          count={value.categoryIds.length} open={open === 'categories'}
          onToggle={() => toggle('categories')}
          onClear={() => onChange({ ...value, categoryIds: [] })}
        >
          {categories.length === 0 ? <p className="p-3 text-xs text-gray-500">No categories yet.</p> : null}
          {KIND_ORDER.map(kind => {
            const items = categories.filter(c => c.kind === kind);
            if (!items.length) return null;
            return (
              <div key={kind}>
                <div className="px-2 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">{kind}</div>
                {items.map(c => (
                  <Option key={c.id} label={c.name}
                          checked={value.categoryIds.includes(c.id)}
                          onChange={() => onChange({ ...value, categoryIds: toggleId(value.categoryIds, c.id) })} />
                ))}
              </div>
            );
          })}
        </MultiSelect>
      </div>

      {active > 0 ? (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            {value.accountIds.map(id => (
              <Chip key={`a${id}`} text={accName(id)}
                    onRemove={() => onChange({ ...value, accountIds: value.accountIds.filter(x => x !== id) })} />
            ))}
            {value.categoryIds.map(id => (
              <Chip key={`c${id}`} text={catName(id)}
                    onRemove={() => onChange({ ...value, categoryIds: value.categoryIds.filter(x => x !== id) })} />
            ))}
          </div>
          <button type="button" className={btn('neutral', 'w-full text-xs sm:w-auto')}
                  onClick={() => onChange({ accountIds: [], categoryIds: [] })}>
            Clear filters
          </button>
        </div>
      ) : null}

      <p className="mt-3 text-[11px] leading-relaxed text-gray-500">
        Nothing ticked = no filter. Account: a transaction shows if any of its legs touches a selected account
        (a transfer shows once). Category: transfers have no category, so they are hidden.
      </p>
    </Card>
  );
}

function MultiSelect({
  id, label, allText, count, open, onToggle, onClear, children,
}: {
  id: string; label: string; allText: string; count: number; open: boolean;
  onToggle: () => void; onClear: () => void; children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-xs font-medium text-gray-400">{label}</div>
      <button
        type="button" onClick={onToggle}
        aria-expanded={open} aria-controls={`${id}-panel`}
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-gray-700 bg-gray-900 px-3 text-sm text-white hover:border-gray-500"
      >
        <span className="min-w-0 truncate">{count === 0 ? allText : `${count} selected`}</span>
        <span aria-hidden className="shrink-0 text-gray-400">{open ? '▴' : '▾'}</span>
      </button>

      {open ? (
        <div id={`${id}-panel`} className="mt-2 rounded-lg border border-gray-700 bg-gray-900">
          <div className="flex items-center justify-between gap-2 border-b border-gray-800 px-3 py-1 text-[11px] text-gray-500">
            <span>Tick to include</span>
            {count > 0 ? (
              <button type="button" onClick={onClear}
                      className="min-h-9 px-2 text-xs text-gray-300 underline hover:text-white">
                Clear
              </button>
            ) : null}
          </div>
          <div className="max-h-64 overflow-y-auto p-1">{children}</div>
        </div>
      ) : null}
    </div>
  );
}

function Option({
  checked, onChange, label, hint,
}: { checked: boolean; onChange: () => void; label: string; hint?: string }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-gray-800">
      <input type="checkbox" checked={checked} onChange={onChange}
             className="h-5 w-5 shrink-0 accent-blue-500" />
      <span className="min-w-0 flex-1 truncate text-sm text-gray-200">{label}</span>
      {hint ? <span className="shrink-0 text-[11px] capitalize text-gray-500">{hint}</span> : null}
    </label>
  );
}

function Chip({ text, onRemove }: { text: string; onRemove: () => void }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-blue-700 bg-blue-900/50 py-0.5 pl-2.5 pr-1 text-xs text-blue-200">
      <span className="truncate">{text}</span>
      <button type="button" onClick={onRemove} aria-label={`Remove ${text}`}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-bold hover:text-red-400">
        ×
      </button>
    </span>
  );
}
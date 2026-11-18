'use client';

import type { ReactNode } from 'react';

import { daysUntil, dueText, fmtDate, type CardSummary } from '@/lib/creditCard';
import { formatINR } from '@/lib/money';
import type { AccountRow, BalanceRow } from '@/lib/types';

type Group = 'bank' | 'card' | 'invest' | 'loan';

const META: Record<Group, { title: string; label: string; border: string; chip: string; tile: string }> = {
  bank:   { title: 'Cash and bank',  label: 'Bank',        border: 'border-l-sky-500',     chip: 'bg-sky-500/15 text-sky-300',         tile: 'bg-gray-800/60' },
  card:   { title: 'Credit cards',   label: 'Credit card', border: 'border-l-amber-500',   chip: 'bg-amber-500/15 text-amber-300',     tile: 'bg-gradient-to-br from-amber-950/70 via-gray-800/70 to-gray-800/60' },
  invest: { title: 'Investments',    label: 'Investment',  border: 'border-l-emerald-500', chip: 'bg-emerald-500/15 text-emerald-300', tile: 'bg-gradient-to-br from-emerald-950/60 to-gray-800/60' },
  loan:   { title: 'Loans',          label: 'Loan',        border: 'border-l-rose-500',    chip: 'bg-rose-500/15 text-rose-300',       tile: 'bg-gradient-to-br from-rose-950/60 to-gray-800/60' },
};
const ORDER: Group[] = ['bank', 'card', 'invest', 'loan'];

const ICON_PATHS: Record<Group, ReactNode> = {
  bank: <path d="M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18" />,
  card: <><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18M7 15h3" /></>,
  invest: <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />,
  loan: <path d="M4 7h16M4 12h16M4 17h10" />,
};

function GroupIcon({ g }: { g: Group }) {
  return (
    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${META[g].chip}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
           strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        {ICON_PATHS[g]}
      </svg>
    </span>
  );
}

function groupOf(b: BalanceRow): Group {
  if (b.subtype === 'credit_card') return 'card';
  if (b.type === 'liability') return 'loan';
  if (b.subtype === 'investment' || b.subtype === 'fd') return 'invest';
  return 'bank';
}

function Stat({ label, minor, strong = false }: { label: string; minor: number; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-xs text-gray-400">{label}</div>
      <div className={`tabular truncate font-bold text-white ${strong ? 'text-xl sm:text-2xl' : 'text-base sm:text-lg'}`}>
        {formatINR(minor)}
      </div>
    </div>
  );
}

function CardInfo({ owed, acc, card, today }: {
  owed: number; acc: AccountRow | undefined; card: CardSummary | undefined; today: string | null;
}) {
  if (!acc?.statement_day) {
    return <p className="mt-3 text-xs text-amber-300">Add a statement day in Settings to see due dates.</p>;
  }
  const limit = acc.credit_limit_minor;
  const pct = limit && limit > 0 ? Math.min(100, Math.max(0, Math.round((owed / limit) * 100))) : null;
  const barTone = pct === null ? '' : pct >= 70 ? 'bg-red-500' : pct >= 30 ? 'bg-amber-500' : 'bg-emerald-500';

  const payNow = !!card && card.amount_due_minor > 0 && !!card.last_due;
  const dueIso = payNow ? card!.last_due : null;
  const days = today && dueIso ? daysUntil(dueIso, today) : null;
  const tone = days === null ? 'text-gray-300' : days < 0 ? 'text-red-400' : days <= 5 ? 'text-amber-300' : 'text-emerald-300';

  return (
    <div className="mt-3 space-y-1.5 text-xs text-gray-400">
      {pct !== null && limit ? (
        <div>
          <div className="h-1.5 overflow-hidden rounded-full bg-gray-700" role="progressbar"
               aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Credit limit used">
            <div className={`h-full ${barTone}`} style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1">{pct}% of {formatINR(limit)} used</div>
        </div>
      ) : null}

      {card ? (
        <>
          {payNow && dueIso ? (
            <p className="text-gray-300">
              Pay <span className="font-semibold text-white">{formatINR(card.amount_due_minor)}</span> by {fmtDate(dueIso)}
              {days !== null ? <span className={`ml-1 font-medium ${tone}`}>({dueText(days)})</span> : null}
            </p>
          ) : (
            <p className="text-gray-300">Nothing due right now</p>
          )}
          <p>
            Next statement {fmtDate(card.next_statement)}
            {card.next_due ? `, payment due ${fmtDate(card.next_due)}` : ''}
          </p>
          <p>
            Last payment:{' '}
            {card.last_payment_date
              ? `${formatINR(card.last_payment_minor ?? 0)} on ${fmtDate(card.last_payment_date)}`
              : 'none recorded'}
          </p>
        </>
      ) : null}
    </div>
  );
}

export default function AccountCards({ accounts, balances, cards, today }: {
  accounts: AccountRow[]; balances: BalanceRow[]; cards: CardSummary[]; today: string | null;
}) {
  if (balances.length === 0) return null;

  const accById = new Map(accounts.map(a => [a.id, a]));
  const cardById = new Map(cards.map(c => [c.account_id, c]));
  const groups: Record<Group, BalanceRow[]> = { bank: [], card: [], invest: [], loan: [] };
  balances.forEach(b => groups[groupOf(b)].push(b));

  const assets = balances.filter(b => b.type === 'asset').reduce((s, b) => s + b.balance_minor, 0);
  const owed = balances.filter(b => b.type === 'liability').reduce((s, b) => s - b.balance_minor, 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-3 gap-3 rounded-xl border border-gray-800 bg-gray-800/60 p-4">
        <Stat label="Net worth" minor={assets - owed} strong />
        <Stat label="Assets" minor={assets} />
        <Stat label="Owed (cards and loans)" minor={owed} />
      </div>

      {ORDER.filter(g => groups[g].length > 0).map(g => {
        const m = META[g];
        return (
          <section key={g} aria-label={m.title}>
            <h2 className="mb-2 text-sm font-semibold text-gray-300">
              {m.title}
              {g === 'invest' ? <span className="ml-2 text-xs font-normal text-gray-500">cost basis, not market value</span> : null}
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {groups[g].map(b => {
                const shown = b.type === 'liability' ? -b.balance_minor : b.balance_minor;
                return (
                  <div key={b.id} className={`min-w-0 rounded-xl border border-l-4 border-gray-800 ${m.border} ${m.tile} p-4`}>
                    <div className="flex items-center gap-3">
                      <GroupIcon g={g} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-gray-100">{b.name}</div>
                        <div className="text-[11px] text-gray-400">{m.label}</div>
                      </div>
                    </div>
                    <div className="tabular mt-3 truncate text-xl font-bold text-white">
                      {formatINR(shown)}
                      {g === 'card' ? <span className="ml-2 text-xs font-normal text-gray-400">owed</span> : null}
                    </div>
                    {g === 'card' ? (
                      <CardInfo owed={shown} acc={accById.get(b.id)} card={cardById.get(b.id)} today={today} />
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

import type { ReactNode } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-xl border border-gray-800 bg-gray-800/60 p-4 shadow-sm sm:p-6 ${className}`}>
      {children}
    </section>
  );
}

export function CardTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h2 className="min-w-0 text-base font-semibold text-gray-100 sm:text-lg">{children}</h2>
      {right}
    </div>
  );
}

type Variant = 'primary' | 'neutral' | 'danger' | 'ghost';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-blue-600 text-white hover:bg-blue-500',
  neutral: 'bg-gray-700 text-white hover:bg-gray-600',
  danger:  'bg-red-900/60 text-red-200 hover:bg-red-900',
  ghost:   'text-gray-300 hover:text-white',
};

/** min-h-11 = 44px touch target. */
export function btn(variant: Variant = 'primary', extra = ''): string {
  return `inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${extra}`;
}

export function Banner({ kind, children }: { kind: 'info' | 'error' | 'success'; children: ReactNode }) {
  const map = {
    info:    'border-gray-700 bg-gray-900 text-gray-300',
    error:   'border-red-800 bg-red-950/50 text-red-300',
    success: 'border-emerald-800 bg-emerald-950/40 text-emerald-300',
  } as const;
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`min-w-0 rounded-lg border p-3 text-sm ${map[kind]}`}>
      {children}
    </div>
  );
}

export function Field({
  label, htmlFor, hint, children, className = '',
}: { label: string; htmlFor: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-gray-400">{label}</label>
      {children}
      {hint ? <p className="mt-1 text-[11px] text-gray-500">{hint}</p> : null}
    </div>
  );
}

export const inputCls =
  'w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-white placeholder:text-gray-500 focus:border-blue-500 focus:outline-none';
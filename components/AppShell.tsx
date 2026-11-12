'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

const TABS = [
  { href: '/', label: 'Home', icon: '🏠' },
  { href: '/reports', label: 'Reports', icon: '📊' },
  { href: '/settings', label: 'Settings', icon: '⚙️' },
];

export default function AppShell({
  title, subtitle, actions, children,
}: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  const pathname = usePathname();

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);

  return (
    <div className="min-h-dvh bg-gray-900 text-gray-100" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <header className="sticky top-0 z-30 border-b border-gray-800 bg-gray-900/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold text-white sm:text-xl">{title}</h1>
            {subtitle ? <p className="truncate text-xs text-gray-400 sm:text-sm">{subtitle}</p> : null}
          </div>

          <nav aria-label="Primary" className="hidden sm:block">
            <ul className="flex items-center gap-1 rounded-lg border border-gray-800 bg-gray-950/60 p-1">
              {TABS.map(t => {
                const active = pathname === t.href;
                return (
                  <li key={t.href}>
                    <Link
                      href={t.href}
                      aria-current={active ? 'page' : undefined}
                      className={`inline-flex min-h-9 items-center gap-2 rounded-md px-3 text-sm font-medium ${
                        active ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      <span aria-hidden>{t.icon}</span>
                      {t.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-4 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-6 sm:pb-8">
        {children}
      </main>

      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-800 bg-gray-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden"
      >
        <ul className="mx-auto flex w-full max-w-md">
          {TABS.map(t => {
            const active = pathname === t.href;
            return (
              <li key={t.href} className="flex-1">
                <Link
                  href={t.href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
                    active ? 'text-blue-400' : 'text-gray-400'
                  }`}
                >
                  <span aria-hidden className="text-lg leading-none">{t.icon}</span>
                  {t.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

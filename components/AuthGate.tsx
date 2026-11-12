'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isPublic = pathname === '/login';
  const [status, setStatus] = useState<'checking' | 'in' | 'out'>('checking');

  useEffect(() => {
    const db = getSupabase();
    let alive = true;

    db.auth.getSession().then(({ data }) => {
      if (alive) setStatus(data.session ? 'in' : 'out');
    });

    const { data: sub } = db.auth.onAuthStateChange((_event, session) => {
      if (alive) setStatus(session ? 'in' : 'out');
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (status === 'out' && !isPublic) router.replace('/login');
    if (status === 'in' && isPublic) router.replace('/');
  }, [status, isPublic, router]);

  useEffect(() => {
    if (status !== 'in') return;
    void getSupabase().rpc('ensure_defaults').then(({ error }) => {
      if (error) console.warn('ensure_defaults:', error.message);
    });
  }, [status]);

  if (isPublic) return <>{children}</>;

  if (status !== 'in') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-900 text-sm text-gray-400">
        {status === 'checking' ? 'Loading…' : 'Redirecting…'}
      </div>
    );
  }

  return <>{children}</>;
}

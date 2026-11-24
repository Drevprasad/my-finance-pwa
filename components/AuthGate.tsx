'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import type { UiMode } from '@/lib/lite/types';

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isPublic = pathname === '/login';
  const [status, setStatus] = useState<'checking' | 'in' | 'out'>('checking');
  const [userId, setUserId] = useState<string | null>(null);
  const [uiMode, setUiMode] = useState<UiMode>('full');

  useEffect(() => {
    const db = getSupabase();
    let alive = true;

    db.auth.getSession().then(({ data }) => {
      if (!alive) return;
      if (data.session) {
        setUserId(data.session.user.id);
        setStatus('in');
      } else {
        setStatus('out');
      }
    });

    const { data: sub } = db.auth.onAuthStateChange((_event, session) => {
      if (!alive) return;
      if (session) {
        setUserId(session.user.id);
        setStatus('in');
      } else {
        setUserId(null);
        setUiMode('full');
        setStatus('out');
      }
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

  // Resolve ui_mode for the logged-in user (default 'full' if no row).
  useEffect(() => {
    if (status !== 'in' || !userId) return;
    let alive = true;

    getSupabase()
      .from('user_profiles')
      .select('ui_mode')
      .eq('user_id', userId)
      .limit(1)
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) {
          console.warn('user_profiles lookup:', error.message);
          return;
        }
        const mode = (data?.[0]?.ui_mode as UiMode) ?? 'full';
        setUiMode(mode);
        if (mode === 'lite' && !pathname.startsWith('/lite')) router.replace('/lite');
      });

    return () => {
      alive = false;
    };
  }, [status, userId, pathname, router]);

  useEffect(() => {
    if (status !== 'in') return;
    if (uiMode === 'lite') return; // lite users skip full-mode defaults
    void getSupabase().rpc('ensure_defaults').then(({ error }) => {
      if (error) console.warn('ensure_defaults:', error.message);
    });
  }, [status, uiMode]);

  if (isPublic) return <>{children}</>;

  if (status !== 'in') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-gray-900 text-sm text-gray-400">
        {status === 'checking' ? 'Loading…' : 'Redirecting…'}
      </div>
    );
  }

  return <>{children}</>;
}
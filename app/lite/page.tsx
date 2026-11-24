'use client';

import { useEffect, useState } from 'react';
import LiteDashboard from '@/components/LiteDashboard';
import { Banner, Card } from '@/components/ui';
import { getSupabase } from '@/lib/supabase';

export default function LitePage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getSupabase()
      .auth.getUser()
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) {
          setError(error.message);
          return;
        }
        if (!data.user) {
          setError('Please sign in to view your expenses.');
          return;
        }
        setUserId(data.user.id);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="min-h-dvh bg-gray-900 text-gray-100" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      {error ? (
        <Banner kind="error">{error}</Banner>
      ) : !userId ? (
        <Card>
          <p className="text-sm text-gray-400">Loading your account…</p>
        </Card>
      ) : (
        <LiteDashboard ownerId={userId} readOnly={false} title="My Expenses" />
      )}
    </div>
  );
}

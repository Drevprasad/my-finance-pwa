'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import LiteDashboard from '@/components/LiteDashboard';
import { Banner, Card } from '@/components/ui';
import { getSupabase } from '@/lib/supabase';
import type { LiteShareRow } from '@/lib/lite/types';

export default function DadPage() {
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    const db = getSupabase();

    (async () => {
      const { data: userData, error: authError } = await db.auth.getUser();
      if (!alive) return;
      if (authError) {
        setError(authError.message);
        setLoaded(true);
        return;
      }
      if (!userData.user) {
        setError('Please sign in to view shared accounts.');
        setLoaded(true);
        return;
      }

      const { data: rows, error: queryError } = await db
        .from('lite_shares')
        .select('id, owner_id, viewer_id, role, created_at')
        .eq('viewer_id', userData.user.id)
        .limit(1);

      if (!alive) return;
      if (queryError) {
        setError(queryError.message);
        setLoaded(true);
        return;
      }

      const share = (rows as LiteShareRow[] | null)?.[0];
      setOwnerId(share?.owner_id ?? null);
      setLoaded(true);
    })();

    return () => {
      alive = false;
    };
  }, []);

  return (
    <AppShell title="Dad's Expenses (Read-Only)" subtitle="Shared account">
      {error ? (
        <Banner kind="error">{error}</Banner>
      ) : !loaded ? (
        <Card>
          <p className="text-sm text-gray-400">Loading shared accounts…</p>
        </Card>
      ) : !ownerId ? (
        <Card>
          <p className="text-sm text-gray-400">
            No shared accounts yet. Ask an owner to share their expenses with you to see them here.
          </p>
        </Card>
      ) : (
        <LiteDashboard ownerId={ownerId} readOnly={true} title="Dad's Expenses (Read-Only)" />
      )}
    </AppShell>
  );
}

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

/** Canonical accessor — use this in all new code. */
export function getSupabase(): SupabaseClient {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      'Supabase env missing: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local',
    );
  }

  client = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return client;
}

/**
 * TEMPORARY COMPATIBILITY SHIM — delete once every caller uses getSupabase().
 *
 * Satisfies both styles while the migration lands:
 *   supabase.from('transactions').select()   // restored pages
 *   supabase().from('transactions')          // AppShell, /login
 *
 * Lazy: nothing connects at import time, so a missing env var surfaces at
 * first use instead of breaking the build.
 */
type SupabaseCompat = SupabaseClient & (() => SupabaseClient);

export const supabase: SupabaseCompat = new Proxy(
  (() => getSupabase()) as unknown as SupabaseCompat,
  {
    apply() {
      return getSupabase();
    },
    get(_target, prop) {
      const c = getSupabase();
      const value = Reflect.get(c, prop, c);
      return typeof value === 'function' ? value.bind(c) : value;
    },
  },
);
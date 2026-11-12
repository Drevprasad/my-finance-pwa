'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Banner, Card, Field, btn, inputCls } from '@/components/ui';
import { supabase } from '@/lib/supabase';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase().auth.signInWithPassword({ email, password });
    setBusy(false);
    if (err) { setError(err.message); return; }
    router.replace('/');
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-gray-900 px-4 py-10 text-gray-100">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-bold text-white">My Finance</h1>
        <p className="mb-6 text-sm text-gray-400">Sign in to your ledger.</p>

        <Card>
          <form onSubmit={submit} className="space-y-4">
            <Field label="Email" htmlFor="login-email">
              <input id="login-email" type="email" autoComplete="email" required
                     value={email} onChange={e => setEmail(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Password" htmlFor="login-password">
              <input id="login-password" type="password" autoComplete="current-password" required
                     value={password} onChange={e => setPassword(e.target.value)} className={inputCls} />
            </Field>
            {error ? <Banner kind="error">{error}</Banner> : null}
            <button type="submit" disabled={busy} className={btn('primary', 'w-full')}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </Card>

        <p className="mt-4 text-xs leading-relaxed text-gray-500">
          There is no sign-up here on purpose. Create your single user in Supabase →
          Authentication → Users → “Add user”, then sign in. Every table is protected by
          row-level security scoped to that user.
        </p>
      </div>
    </div>
  );
}
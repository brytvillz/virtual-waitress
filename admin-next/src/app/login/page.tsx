'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });

    if (authError) {
      setError(authError.message === 'Invalid login credentials'
        ? 'Incorrect email or password.'
        : authError.message);
      setLoading(false);
      return;
    }

    router.push('/dashboard');
    router.refresh();
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0f0f0f] px-4">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-10">
          <div className="w-9 h-9 rounded-[10px] bg-[#C41E3A] flex items-center justify-center">
            <span className="text-white text-[10px] font-black tracking-wide">VW</span>
          </div>
          <span className="text-[#F0EDE8] text-base font-semibold tracking-tight">Virtual Waitress</span>
        </div>

        {/* Card */}
        <div className="bg-[#161616] border border-white/[0.07] rounded-2xl p-8">
          <h1 className="text-[#F0EDE8] text-xl font-bold mb-1">Sign in</h1>
          <p className="text-[#6B6570] text-sm mb-7">Manage your restaurant from one place.</p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-[#9a9098] text-xs font-medium uppercase tracking-wider">Email</span>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                className="bg-[#1f1f1f] border border-white/[0.08] rounded-xl px-4 py-3 text-[#F0EDE8] text-sm placeholder-[#4a4a4a] outline-none focus:border-[#C41E3A]/50 transition-colors"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[#9a9098] text-xs font-medium uppercase tracking-wider">Password</span>
              <input
                type="password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                className="bg-[#1f1f1f] border border-white/[0.08] rounded-xl px-4 py-3 text-[#F0EDE8] text-sm placeholder-[#4a4a4a] outline-none focus:border-[#C41E3A]/50 transition-colors"
              />
            </label>

            {error && (
              <p className="text-[#ff6b6b] text-sm bg-[#ff6b6b]/10 border border-[#ff6b6b]/20 rounded-xl px-4 py-3">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-1 bg-[#C41E3A] hover:bg-[#a01830] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl py-3 transition-colors"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>

        <p className="text-center text-[#4a4a4a] text-xs mt-6">
          Don&apos;t have an account?{' '}
          <a href="/signup" className="text-[#9a9098] hover:text-[#F0EDE8] transition-colors">
            Sign up
          </a>
        </p>
      </div>
    </div>
  );
}

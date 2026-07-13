'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

const RULES = [
  { id: 'len',   label: '8+ characters',   test: (p: string) => p.length >= 8 },
  { id: 'upper', label: 'Uppercase (A–Z)', test: (p: string) => /[A-Z]/.test(p) },
  { id: 'lower', label: 'Lowercase (a–z)', test: (p: string) => /[a-z]/.test(p) },
  { id: 'num',   label: 'Number (0–9)',    test: (p: string) => /[0-9]/.test(p) },
];

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  );
}

type Screen = 'checking' | 'invalid' | 'form' | 'done';

export default function ResetPasswordPage() {
  const router = useRouter();
  const supabase = createClient();

  const [screen,      setScreen]      = useState<Screen>('checking');
  const [password,    setPassword]    = useState('');
  const [confirm,     setConfirm]     = useState('');
  const [showPass,    setShowPass]    = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error,       setError]       = useState('');
  const [loading,     setLoading]     = useState(false);

  useEffect(() => {
    // Supabase fires PASSWORD_RECOVERY when the page loads with a valid recovery hash
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setScreen('form');
      }
    });

    // Check for error in URL hash (e.g. otp_expired)
    const hash = new URLSearchParams(window.location.hash.slice(1));
    if (hash.get('error')) {
      setScreen('invalid');
      return;
    }

    // Fallback: if no recovery event within 6 seconds, link is expired
    const timeout = setTimeout(() => {
      setScreen(s => s === 'checking' ? 'invalid' : s);
    }, 6000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const passOk = RULES.every(r => r.test(password));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!passOk) { setError('Password must meet all the requirements below.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError('Failed to update password. Try requesting a new reset link.');
      setLoading(false);
      return;
    }

    setScreen('done');
    setTimeout(() => router.push('/dashboard'), 2000);
  }

  // ── Checking / loading ────────────────────────────────────────────────────
  if (screen === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0f0f0f]">
        <div className="flex items-center gap-3 text-[#6B6570] text-sm">
          <span className="w-4 h-4 border-2 border-[#6B6570] border-t-transparent rounded-full animate-spin" />
          Verifying your reset link…
        </div>
      </div>
    );
  }

  // ── Invalid / expired link ────────────────────────────────────────────────
  if (screen === 'invalid') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0f0f0f] px-4">
        <div className="w-full max-w-sm text-center">
          <div className="w-12 h-12 rounded-full bg-[#ff6b6b]/10 border border-[#ff6b6b]/20 flex items-center justify-center mx-auto mb-5">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ff6b6b" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </div>
          <h1 className="text-[#F0EDE8] text-xl font-bold tracking-tight mb-2">Link expired</h1>
          <p className="text-[#6B6570] text-sm mb-8 leading-relaxed">
            This password reset link is invalid or has expired.<br />
            Request a new one from the login page.
          </p>
          <a
            href="/login"
            className="inline-block bg-[#161616] border border-white/[0.08] text-[#F0EDE8] text-sm font-medium rounded-xl px-6 py-3 hover:border-white/[0.14] transition-colors"
          >
            Back to Login
          </a>
        </div>
      </div>
    );
  }

  // ── Done state ────────────────────────────────────────────────────────────
  if (screen === 'done') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0f0f0f] px-4">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full bg-[#10b981]/10 border border-[#10b981]/30 flex items-center justify-center mx-auto mb-5">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6L9 17l-5-5"/>
            </svg>
          </div>
          <h2 className="text-[#F0EDE8] text-xl font-bold tracking-tight mb-2">Password updated</h2>
          <p className="text-[#6B6570] text-sm">Redirecting you to the dashboard…</p>
        </div>
      </div>
    );
  }

  // ── Password form ─────────────────────────────────────────────────────────
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

        <div className="bg-[#161616] border border-white/[0.07] rounded-2xl p-8">
          <h1 className="text-[#F0EDE8] text-xl font-bold mb-1">New password</h1>
          <p className="text-[#6B6570] text-sm mb-7">Choose a strong password for your account.</p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-5">

            {/* Password */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[#9a9098] text-xs font-medium uppercase tracking-wider">New password</label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Min 8 chars, uppercase &amp; number"
                  autoComplete="new-password"
                  required
                  className="w-full bg-[#1f1f1f] border border-white/[0.08] rounded-xl px-4 py-3 pr-11 text-[#F0EDE8] text-sm placeholder-[#4a4a4a] outline-none focus:border-[#C41E3A]/50 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#4a4a4a] hover:text-[#9a9098] transition-colors p-1"
                >
                  <EyeIcon open={showPass} />
                </button>
              </div>
              {/* Strength rules */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-1">
                {RULES.map(rule => {
                  const pass = rule.test(password);
                  const fail = password.length > 0 && !pass;
                  return (
                    <div key={rule.id} className={`flex items-center gap-1.5 text-xs transition-colors ${pass ? 'text-[#10b981]' : fail ? 'text-[#ff6b6b]' : 'text-[#4a4a4a]'}`}>
                      <span className="text-[10px]">{pass ? '✓' : fail ? '✕' : '○'}</span>
                      {rule.label}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Confirm */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[#9a9098] text-xs font-medium uppercase tracking-wider">Confirm password</label>
              <div className="relative">
                <input
                  type={showConfirm ? 'text' : 'password'}
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="Repeat your password"
                  autoComplete="new-password"
                  required
                  className="w-full bg-[#1f1f1f] border border-white/[0.08] rounded-xl px-4 py-3 pr-11 text-[#F0EDE8] text-sm placeholder-[#4a4a4a] outline-none focus:border-[#C41E3A]/50 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#4a4a4a] hover:text-[#9a9098] transition-colors p-1"
                >
                  <EyeIcon open={showConfirm} />
                </button>
              </div>
            </div>

            {error && (
              <p className="text-[#ff6b6b] text-sm bg-[#ff6b6b]/[0.08] border border-[#ff6b6b]/20 rounded-xl px-4 py-3">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#C41E3A] hover:bg-[#a01830] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl py-3.5 transition-colors"
            >
              {loading ? 'Updating…' : 'Update Password'}
            </button>
          </form>
        </div>

        <p className="text-center mt-5">
          <a href="/login" className="text-[#4a4a4a] hover:text-[#6B6570] text-xs transition-colors">
            Back to Login
          </a>
        </p>
      </div>
    </div>
  );
}

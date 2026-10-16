'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();

  // Password step
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  // OTP step (reached when email not yet confirmed)
  const [step,      setStep]      = useState<'password' | 'otp' | 'done'>('password');
  const [otp,       setOtp]       = useState<string[]>(Array(8).fill(''));
  const [otpError,  setOtpError]  = useState('');
  const [verifying, setVerifying] = useState(false);
  const [resendCd,  setResendCd]  = useState(0);
  const [resendHint,setResendHint]= useState('');

  const otpRefs = useRef<(HTMLInputElement | null)[]>(Array(8).fill(null));

  useEffect(() => {
    if (resendCd <= 0) return;
    const t = setTimeout(() => setResendCd(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCd]);

  // ── Password sign-in ─────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });

    if (authError) {
      if (authError.message === 'Email not confirmed') {
        // Auto-send a fresh OTP and move to the verification step
        await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
        setStep('otp');
        setResendHint(`We sent a fresh code to ${email}.`);
        setLoading(false);
        setTimeout(() => otpRefs.current[0]?.focus(), 80);
        return;
      }
      setError(authError.message === 'Invalid login credentials'
        ? 'Incorrect email or password.'
        : authError.message);
      setLoading(false);
      return;
    }

    router.push('/dashboard');
    router.refresh();
  }

  // ── OTP logic ────────────────────────────────────────────────────────────
  const otpValue = otp.join('');

  async function submitOtp() {
    if (otpValue.length < 8 || verifying) return;
    setVerifying(true);
    setOtpError('');

    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({ email, token: otpValue, type: 'email' });

    if (error) {
      setOtpError('Invalid or expired code. Please try again.');
      setOtp(Array(8).fill(''));
      otpRefs.current[0]?.focus();
      setVerifying(false);
      return;
    }

    setStep('done');
    setTimeout(() => { router.push('/dashboard'); router.refresh(); }, 1200);
  }

  function handleOtpInput(idx: number, value: string) {
    const digits = value.replace(/\D/g, '');
    if (!digits) return;
    if (digits.length > 1) {
      const next = [...otp];
      digits.split('').forEach((d, i) => { if (idx + i < 8) next[idx + i] = d; });
      setOtp(next);
      const focus = Math.min(idx + digits.length, 7);
      otpRefs.current[focus]?.focus();
      if (next.join('').length === 8) setTimeout(submitOtp, 50);
      return;
    }
    const next = [...otp]; next[idx] = digits[0]; setOtp(next);
    if (idx < 7) otpRefs.current[idx + 1]?.focus();
    if (next.join('').length === 8) setTimeout(submitOtp, 50);
  }

  function handleOtpKey(idx: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace') {
      if (otp[idx]) {
        const next = [...otp]; next[idx] = ''; setOtp(next);
      } else if (idx > 0) {
        const next = [...otp]; next[idx - 1] = ''; setOtp(next);
        otpRefs.current[idx - 1]?.focus();
      }
    }
  }

  async function handlePaste() {
    try {
      const text = await navigator.clipboard.readText();
      const digits = text.replace(/\D/g, '').slice(0, 8);
      if (digits.length === 8) { setOtp(digits.split('')); setTimeout(submitOtp, 80); }
    } catch { /* clipboard denied */ }
  }

  async function handleResend() {
    if (resendCd > 0) return;
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    setResendHint(error ? 'Could not resend — try again shortly.' : 'New code sent!');
    setResendCd(60);
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0f0f0f] px-4">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="flex items-center justify-center mb-10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-white.svg" alt="Virtual Waitress" className="h-9 w-auto" />
        </div>

        {/* ── Password step ── */}
        {step === 'password' && (
          <div className="bg-[#161616] border border-white/[0.07] rounded-2xl p-8">
            <h1 className="text-[#F0EDE8] text-xl font-bold mb-1">Sign in</h1>
            <p className="text-[#6B6570] text-sm mb-7">Manage your business from one place.</p>

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

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[#9a9098] text-xs font-medium uppercase tracking-wider">Password</span>
                  <a href="/reset-password" className="text-[#6B6570] hover:text-[#C41E3A] text-xs transition-colors">Forgot password?</a>
                </div>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="bg-[#1f1f1f] border border-white/[0.08] rounded-xl px-4 py-3 text-[#F0EDE8] text-sm placeholder-[#4a4a4a] outline-none focus:border-[#C41E3A]/50 transition-colors"
                />
              </div>

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
        )}

        {/* ── OTP step (unconfirmed email) ── */}
        {step === 'otp' && (
          <div className="bg-[#161616] border border-white/[0.07] rounded-2xl p-8">
            <h1 className="text-[#F0EDE8] text-xl font-bold mb-1">Confirm your email</h1>
            <p className="text-[#6B6570] text-sm mb-1">{resendHint}</p>
            <p className="text-[#F0EDE8] text-sm font-semibold mb-7 break-all">{email}</p>

            <div className="flex gap-1.5 sm:gap-2 justify-center mb-2">
              {otp.map((digit, i) => (
                <input
                  key={i}
                  ref={el => { otpRefs.current[i] = el; }}
                  type="text"
                  inputMode="numeric"
                  maxLength={8}
                  value={digit}
                  onChange={e => handleOtpInput(i, e.target.value)}
                  onKeyDown={e => handleOtpKey(i, e)}
                  onFocus={e => e.target.select()}
                  className="w-8 h-11 sm:w-10 sm:h-12 bg-[#1f1f1f] border border-white/[0.08] rounded-xl text-center text-[#F0EDE8] text-base sm:text-lg font-bold outline-none focus:border-[#C41E3A]/60 transition-colors caret-transparent"
                />
              ))}
            </div>

            <button
              type="button"
              onClick={handlePaste}
              className="w-full text-[#C41E3A] text-sm font-medium py-1 mb-1 hover:underline transition-colors"
            >
              Paste code
            </button>

            {otpError && (
              <p className="text-[#ff6b6b] text-sm text-center mt-2 mb-1">{otpError}</p>
            )}

            <button
              onClick={submitOtp}
              disabled={otpValue.length < 8 || verifying}
              className="w-full mt-4 bg-[#C41E3A] hover:bg-[#a01830] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl py-3 transition-colors"
            >
              {verifying ? 'Verifying…' : 'Verify and sign in'}
            </button>

            <button
              onClick={handleResend}
              disabled={resendCd > 0}
              className="w-full mt-3 border border-white/[0.08] hover:border-white/[0.14] disabled:opacity-40 disabled:cursor-not-allowed text-[#F0EDE8] text-sm font-medium rounded-xl py-3 transition-colors"
            >
              {resendCd > 0 ? `Resend in ${resendCd}s` : 'Resend code'}
            </button>

            <button
              onClick={() => { setStep('password'); setOtp(Array(8).fill('')); setOtpError(''); }}
              className="w-full mt-4 text-[#4a4a4a] hover:text-[#6B6570] text-xs transition-colors py-2"
            >
              Back to sign in
            </button>
          </div>
        )}

        {/* ── Done state ── */}
        {step === 'done' && (
          <div className="bg-[#161616] border border-white/[0.07] rounded-2xl p-8 flex flex-col items-center text-center">
            <svg width="48" height="48" viewBox="0 0 52 52" fill="none">
              <circle cx="26" cy="26" r="25" stroke="#10b981" strokeWidth="2" fill="rgba(16,185,129,0.1)"/>
              <path d="M15 26l8 8 14-14" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <h2 className="text-[#F0EDE8] text-xl font-bold tracking-tight mt-5 mb-2">Verified</h2>
            <p className="text-[#6B6570] text-sm">
              Signing you in
              <span className="inline-flex gap-0.5 ml-0.5">
                {[0, 1, 2].map(i => (
                  <span key={i} className="animate-bounce text-[#6B6570]" style={{ animationDelay: `${i * 0.15}s` }}>.</span>
                ))}
              </span>
            </p>
          </div>
        )}

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

'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

const SUPABASE_URL     = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// ── Helpers ───────────────────────────────────────────────────────────────────
function toSlug(name: string) {
  return name.toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

const RULES = [
  { id: 'len',   label: '8+ characters',      test: (p: string) => p.length >= 8 },
  { id: 'upper', label: 'Uppercase (A–Z)',     test: (p: string) => /[A-Z]/.test(p) },
  { id: 'lower', label: 'Lowercase (a–z)',     test: (p: string) => /[a-z]/.test(p) },
  { id: 'num',   label: 'Number (0–9)',        test: (p: string) => /[0-9]/.test(p) },
];

function passStrong(p: string) { return RULES.every(r => r.test(p)); }

// ── Eye icon ──────────────────────────────────────────────────────────────────
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

// ── Check icon ────────────────────────────────────────────────────────────────
function CheckCircle() {
  return (
    <svg width="52" height="52" viewBox="0 0 52 52" fill="none">
      <circle cx="26" cy="26" r="25" stroke="#10b981" strokeWidth="2" fill="rgba(16,185,129,0.1)"/>
      <path d="M15 26l8 8 14-14" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

// ── Feature check ─────────────────────────────────────────────────────────────
function FeatureItem({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <svg className="mt-0.5 shrink-0" width="15" height="15" viewBox="0 0 15 15" fill="none">
        <circle cx="7.5" cy="7.5" r="7.5" fill="rgba(196,30,58,0.15)"/>
        <path d="M4.5 7.5l2 2 4-4" stroke="#C41E3A" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      <span className="text-[#9a9098] text-sm leading-snug">{children}</span>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function SignupPage() {
  const router = useRouter();
  const supabase = createClient();

  // Step 1 form state
  const [restaurantName, setRestaurantName] = useState('');
  const [email,          setEmail]          = useState('');
  const [password,       setPassword]       = useState('');
  const [confirmPass,    setConfirmPass]     = useState('');
  const [promoCode,      setPromoCode]       = useState('');
  const [agreed,         setAgreed]          = useState(false);
  const [showPass,       setShowPass]        = useState(false);
  const [showConfirm,    setShowConfirm]     = useState(false);
  const [step1Error,     setStep1Error]      = useState('');
  const [submitting,     setSubmitting]      = useState(false);

  // Step 2 OTP state
  const [step,       setStep]       = useState<1 | 2 | 'done'>(1);
  const [otp,        setOtp]        = useState<string[]>(Array(8).fill(''));
  const [otpError,   setOtpError]   = useState('');
  const [verifying,  setVerifying]  = useState(false);
  const [resendCd,   setResendCd]   = useState(0);
  const [resendHint, setResendHint] = useState("Didn't get it? Check your spam folder.");

  // Saved from step 1 for OTP submit
  const slugRef = useRef('');
  const otpRefs = useRef<(HTMLInputElement | null)[]>(Array(8).fill(null));

  // Derived
  const slug    = toSlug(restaurantName);
  const urlShow = slug ? `app.virtualwaitress.com/${slug}/1` : '';

  // Resend countdown
  useEffect(() => {
    if (resendCd <= 0) return;
    const t = setTimeout(() => setResendCd(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCd]);

  // ── Step 1 submit ───────────────────────────────────────────────────────────
  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setStep1Error('');

    if (!restaurantName.trim()) { setStep1Error('Please enter your restaurant name.'); return; }
    if (!email.trim())          { setStep1Error('Please enter your email address.'); return; }
    if (!passStrong(password))  { setStep1Error('Password must meet all requirements below.'); return; }
    if (password !== confirmPass) { setStep1Error('Passwords do not match.'); return; }

    setSubmitting(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/create-restaurant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
        body: JSON.stringify({
          restaurant_name: restaurantName.trim(),
          email: email.trim(),
          password,
          promo_code: promoCode.trim() || null,
        }),
      });
      const result = await res.json();
      if (!res.ok || result.error) {
        setStep1Error(result.error || 'Something went wrong. Please try again.');
        return;
      }

      slugRef.current = result.slug ?? slug;

      const { error: otpErr } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { shouldCreateUser: false },
      });
      if (otpErr) {
        setStep1Error('Account created but could not send verification code. Go to login to sign in.');
        return;
      }

      setStep(2);
      setTimeout(() => otpRefs.current[0]?.focus(), 50);
    } catch {
      setStep1Error('Network error — check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  // ── OTP logic ───────────────────────────────────────────────────────────────
  const otpValue = otp.join('');

  async function submitOtp() {
    if (otpValue.length < 8 || verifying) return;
    setVerifying(true);
    setOtpError('');

    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: otpValue,
      type: 'email',
    });

    if (error) {
      setOtpError('Invalid or expired code. Please try again.');
      setOtp(Array(8).fill(''));
      otpRefs.current[0]?.focus();
      setVerifying(false);
      return;
    }

    // Send welcome email (fire and forget)
    fetch(`${SUPABASE_URL}/functions/v1/send-welcome`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ email: email.trim(), restaurant_name: restaurantName.trim(), slug: slugRef.current }),
    }).catch(() => {});

    setStep('done');
    setTimeout(() => router.push('/dashboard'), 1800);
  }

  function handleOtpInput(idx: number, value: string) {
    const digits = value.replace(/\D/g, '');
    if (!digits) return;

    // Paste handling — fill from idx
    if (digits.length > 1) {
      const next = [...otp];
      digits.split('').forEach((d, i) => { if (idx + i < 8) next[idx + i] = d; });
      setOtp(next);
      const focus = Math.min(idx + digits.length, 7);
      otpRefs.current[focus]?.focus();
      if (next.join('').length === 8) setTimeout(submitOtp, 50);
      return;
    }

    const next = [...otp]; next[idx] = digits[0];
    setOtp(next);
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

  async function handleResend() {
    if (resendCd > 0) return;
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false },
    });
    setResendHint(error ? 'Could not resend — try again shortly.' : 'New code sent!');
    setResendCd(60);
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex bg-[#0f0f0f]">

      {/* ── Left branding panel ── */}
      <div className="hidden lg:flex flex-col justify-center px-16 py-12 w-[480px] shrink-0 border-r border-white/[0.06] relative overflow-hidden">
        {/* Radial glow */}
        <div className="absolute -top-32 -left-32 w-[500px] h-[500px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(196,30,58,0.08) 0%, transparent 65%)' }} />

        <a href="https://virtualwaitress.com" className="flex items-center gap-3 mb-16 relative">
          <div className="w-9 h-9 rounded-[10px] bg-[#C41E3A] flex items-center justify-center shrink-0">
            <span className="text-white text-[10px] font-black tracking-wide">VW</span>
          </div>
          <span className="text-[#F0EDE8] text-base font-semibold">Virtual Waitress</span>
        </a>

        <blockquote className="relative mb-12">
          <p className="text-[#F0EDE8] text-2xl font-bold leading-tight tracking-tight" style={{ fontFamily: 'Georgia, serif' }}>
            &ldquo;From paper menus to live digital ordering &mdash; in one afternoon.&rdquo;
          </p>
        </blockquote>

        <div className="flex flex-col gap-5 relative">
          <FeatureItem>Works on any phone — no app download needed</FeatureItem>
          <FeatureItem>Orders go live to your waiter dashboard instantly</FeatureItem>
          <FeatureItem>Setup takes less than an hour</FeatureItem>
          <FeatureItem>Free to start, no credit card required</FeatureItem>
        </div>
      </div>

      {/* ── Right form panel ── */}
      <div className="flex-1 flex items-center justify-center px-6 py-12 overflow-y-auto">
        <div className="w-full max-w-[400px]">

          {/* Mobile logo */}
          <div className="flex items-center gap-3 mb-10 lg:hidden">
            <div className="w-8 h-8 rounded-[9px] bg-[#C41E3A] flex items-center justify-center">
              <span className="text-white text-[9px] font-black tracking-wide">VW</span>
            </div>
            <span className="text-[#F0EDE8] text-sm font-semibold">Virtual Waitress</span>
          </div>

          {/* ── Step 1: Account form ── */}
          {step === 1 && (
            <>
              <h1 className="text-[#F0EDE8] text-2xl font-bold tracking-tight mb-1">Set up your restaurant</h1>
              <p className="text-[#6B6570] text-sm mb-8">Create your free account and go live today.</p>

              <form onSubmit={handleSignup} noValidate className="flex flex-col gap-5">

                {/* Restaurant name */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-[#9a9098] text-xs font-medium uppercase tracking-wider">
                    Restaurant name
                  </label>
                  <input
                    type="text"
                    value={restaurantName}
                    onChange={e => setRestaurantName(e.target.value)}
                    placeholder="e.g. Mama Ngozi's Kitchen"
                    autoComplete="organization"
                    maxLength={80}
                    required
                    className="bg-[#1f1f1f] border border-white/[0.08] rounded-xl px-4 py-3 text-[#F0EDE8] text-sm placeholder-[#4a4a4a] outline-none focus:border-[#C41E3A]/50 transition-colors"
                  />
                  {urlShow && (
                    <p className="text-[#10b981] text-xs mt-0.5">app.virtualwaitress.com/{slug}/1</p>
                  )}
                  {!urlShow && (
                    <p className="text-[#4a4a4a] text-xs mt-0.5">Your menu URL will appear here</p>
                  )}
                </div>

                {/* Email */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-[#9a9098] text-xs font-medium uppercase tracking-wider">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@restaurant.com"
                    autoComplete="email"
                    required
                    className="bg-[#1f1f1f] border border-white/[0.08] rounded-xl px-4 py-3 text-[#F0EDE8] text-sm placeholder-[#4a4a4a] outline-none focus:border-[#C41E3A]/50 transition-colors"
                  />
                </div>

                {/* Password */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-[#9a9098] text-xs font-medium uppercase tracking-wider">Password</label>
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
                      aria-label={showPass ? 'Hide password' : 'Show password'}
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

                {/* Confirm password */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-[#9a9098] text-xs font-medium uppercase tracking-wider">Confirm password</label>
                  <div className="relative">
                    <input
                      type={showConfirm ? 'text' : 'password'}
                      value={confirmPass}
                      onChange={e => setConfirmPass(e.target.value)}
                      placeholder="Repeat your password"
                      autoComplete="new-password"
                      required
                      className="w-full bg-[#1f1f1f] border border-white/[0.08] rounded-xl px-4 py-3 pr-11 text-[#F0EDE8] text-sm placeholder-[#4a4a4a] outline-none focus:border-[#C41E3A]/50 transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirm(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#4a4a4a] hover:text-[#9a9098] transition-colors p-1"
                      aria-label={showConfirm ? 'Hide password' : 'Show password'}
                    >
                      <EyeIcon open={showConfirm} />
                    </button>
                  </div>
                </div>

                {/* Promo code */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-[#9a9098] text-xs font-medium uppercase tracking-wider">
                    Promo code <span className="normal-case font-normal opacity-50">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={promoCode}
                    onChange={e => setPromoCode(e.target.value.toUpperCase())}
                    placeholder="e.g. VWPRO30"
                    autoComplete="off"
                    maxLength={32}
                    className="bg-[#1f1f1f] border border-white/[0.08] rounded-xl px-4 py-3 text-[#F0EDE8] text-sm placeholder-[#4a4a4a] outline-none focus:border-[#C41E3A]/50 transition-colors tracking-widest font-semibold"
                  />
                </div>

                {/* Error */}
                {step1Error && (
                  <p className="text-[#ff6b6b] text-sm bg-[#ff6b6b]/[0.08] border border-[#ff6b6b]/20 rounded-xl px-4 py-3">
                    {step1Error}
                  </p>
                )}

                {/* Terms */}
                <label className="flex items-start gap-3 cursor-pointer">
                  <div className="relative mt-0.5 shrink-0">
                    <input
                      type="checkbox"
                      checked={agreed}
                      onChange={e => setAgreed(e.target.checked)}
                      className="sr-only"
                    />
                    <div className={`w-4.5 h-4.5 w-[18px] h-[18px] rounded-[5px] border flex items-center justify-center transition-colors ${
                      agreed
                        ? 'bg-[#C41E3A] border-[#C41E3A]'
                        : 'bg-[#1f1f1f] border-white/[0.12]'
                    }`}>
                      {agreed && (
                        <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                          <path d="M1 4l2.5 2.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </div>
                  </div>
                  <span className="text-[#6B6570] text-sm leading-snug">
                    I agree to the{' '}
                    <a href="https://virtualwaitress.com/terms" target="_blank" rel="noopener" className="text-[#C41E3A] hover:underline">Terms of Service</a>
                    {' '}and{' '}
                    <a href="https://virtualwaitress.com/privacy" target="_blank" rel="noopener" className="text-[#C41E3A] hover:underline">Privacy Policy</a>
                  </span>
                </label>

                {/* Submit */}
                <button
                  type="submit"
                  disabled={!agreed || submitting}
                  className="w-full bg-[#C41E3A] hover:bg-[#a01830] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl py-3.5 transition-colors shadow-[0_6px_20px_rgba(196,30,58,0.28)]"
                >
                  {submitting ? 'Creating your restaurant…' : 'Create My Restaurant'}
                </button>
              </form>

              <p className="text-center text-[#4a4a4a] text-xs mt-6">
                Already have an account?{' '}
                <a href="/login" className="text-[#9a9098] hover:text-[#F0EDE8] transition-colors">Sign in</a>
              </p>
            </>
          )}

          {/* ── Step 2: OTP verification ── */}
          {step === 2 && (
            <>
              <h1 className="text-[#F0EDE8] text-2xl font-bold tracking-tight mb-1">Check your email</h1>
              <p className="text-[#6B6570] text-sm mb-1">We sent an 8-digit code to:</p>
              <p className="text-[#F0EDE8] text-sm font-semibold mb-8 break-all">{email}</p>

              {/* OTP boxes */}
              <div className="flex gap-2 justify-center mb-2">
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
                    className="w-10 h-12 bg-[#1f1f1f] border border-white/[0.08] rounded-xl text-center text-[#F0EDE8] text-lg font-bold outline-none focus:border-[#C41E3A]/60 transition-colors caret-transparent"
                  />
                ))}
              </div>

              {otpError && (
                <p className="text-[#ff6b6b] text-sm text-center mt-2 mb-1">{otpError}</p>
              )}

              <button
                onClick={submitOtp}
                disabled={otpValue.length < 8 || verifying}
                className="w-full mt-4 bg-[#C41E3A] hover:bg-[#a01830] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl py-3.5 transition-colors"
              >
                {verifying ? 'Verifying…' : 'Verify & Sign In'}
              </button>

              <button
                onClick={handleResend}
                disabled={resendCd > 0}
                className="w-full mt-3 border border-white/[0.08] hover:border-white/[0.14] disabled:opacity-40 disabled:cursor-not-allowed text-[#F0EDE8] text-sm font-medium rounded-xl py-3 transition-colors"
              >
                {resendCd > 0 ? `Resend in ${resendCd}s` : 'Resend code'}
              </button>

              <p className="text-[#4a4a4a] text-xs text-center mt-3">{resendHint}</p>

              <button
                onClick={() => { setStep(1); setOtp(Array(8).fill('')); setOtpError(''); }}
                className="w-full mt-4 text-[#4a4a4a] hover:text-[#6B6570] text-xs transition-colors py-2"
              >
                Not your email? Go back
              </button>
            </>
          )}

          {/* ── Done state ── */}
          {step === 'done' && (
            <div className="flex flex-col items-center text-center py-8">
              <CheckCircle />
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

        </div>
      </div>
    </div>
  );
}

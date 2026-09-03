'use client';

import { useState, useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { createContext, useContext } from 'react';
import type { User } from '@supabase/supabase-js';

const IDLE_TIMEOUT_MS = 8 * 60 * 60 * 1000; // 8 hours

type Restaurant = {
  id: string; name: string; slug: string; plan: string;
  plan_status: string | null; plan_expires_at: string | null; trial_ends_at: string | null;
} | null;

function getTrialStatus(r: NonNullable<Restaurant>) {
  const now = new Date();
  const planExpiry = r.plan_expires_at ? new Date(r.plan_expires_at) : null;
  const isPro = r.plan === 'pro' && r.plan_status === 'active' && (!planExpiry || planExpiry > now);
  if (isPro) return { type: 'pro' as const, daysLeft: 0 };

  const trialEnd = r.trial_ends_at ? new Date(r.trial_ends_at) : null;
  if (trialEnd && trialEnd > now) {
    const daysLeft = Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (daysLeft > 7) return { type: 'trial-early' as const, daysLeft };
    return { type: 'trial-warning' as const, daysLeft };
  }

  // 2-day grace period after trial ends before admin buttons are locked
  const graceEnd = trialEnd ? new Date(trialEnd.getTime() + 2 * 86_400_000) : null;
  if (!graceEnd || graceEnd > now) return { type: 'expired-grace' as const, daysLeft: 0 };
  return { type: 'locked' as const, daysLeft: 0 };
}

const RestaurantContext = createContext<Restaurant>(null);
export function useRestaurant() { return useContext(RestaurantContext); }

const NAV = [
  { href: '/dashboard',          label: 'Analytics',  icon: IconChart },
  { href: '/dashboard/orders',   label: 'Orders',     icon: IconOrders },
  { href: '/dashboard/menu',     label: 'Menu',       icon: IconMenu },
  { href: '/dashboard/tables',   label: 'Tables',     icon: IconTable },
  { href: '/dashboard/staff',    label: 'Staff',      icon: IconStaff },
  { href: '/dashboard/qr',       label: 'QR Codes',   icon: IconQr },
  { href: '/dashboard/settings', label: 'Settings',   icon: IconSettings },
];

export default function DashboardShell({
  user,
  restaurant,
  isOwner,
  children,
}: {
  user: User;
  restaurant: Restaurant;
  isOwner: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [emailBannerDismissed, setEmailBannerDismissed] = useState(false);
  const [graceBannerDismissed, setGraceBannerDismissed] = useState(false);
  const [resendSent, setResendSent] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const emailUnconfirmed = !user.email_confirmed_at;
  const trialStatus = restaurant ? getTrialStatus(restaurant) : null;

  async function resendConfirmation() {
    const supabase = createClient();
    await supabase.auth.resend({ type: 'signup', email: user.email! });
    setResendSent(true);
  }

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  useEffect(() => {
    function resetTimer() {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(signOut, IDLE_TIMEOUT_MS);
    }
    const events = ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'];
    events.forEach(e => window.addEventListener(e, resetTimer, { passive: true }));
    resetTimer();
    return () => {
      events.forEach(e => window.removeEventListener(e, resetTimer));
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sidebar = (
    <aside className={`
      fixed inset-y-0 left-0 z-40 w-64 flex flex-col bg-[#111111] border-r border-white/[0.06]
      transition-transform duration-200 ease-in-out
      md:relative md:w-56 md:translate-x-0 md:z-auto md:shrink-0
      ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
    `}>
      {/* Logo + close */}
      <div className="flex items-center justify-between px-5 py-5 border-b border-white/[0.06]">
        <div className="flex items-center gap-2.5 min-w-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-white.svg" alt="Virtual Waitress" className="h-5 w-auto shrink-0" />
          <div className="min-w-0">
            <p className="text-[#F0EDE8] text-sm font-semibold truncate leading-tight">
              {restaurant?.name ?? 'Virtual Waitress'}
            </p>
            <p className="text-[#4a4a4a] text-[10px] uppercase tracking-wider font-medium capitalize">
              {trialStatus?.type === 'pro'
                ? 'Pro plan'
                : (trialStatus?.type === 'trial-early' || trialStatus?.type === 'trial-warning')
                ? `Trial — ${trialStatus.daysLeft}d left`
                : (trialStatus?.type === 'expired-grace' || trialStatus?.type === 'locked')
                ? 'Trial ended'
                : 'Trial'}
            </p>
          </div>
        </div>
        {/* Close button — mobile only */}
        <button
          onClick={() => setMobileOpen(false)}
          className="md:hidden text-[#6B6570] hover:text-[#F0EDE8] transition-colors p-1 -mr-1 shrink-0"
          aria-label="Close menu"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 flex flex-col gap-0.5">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === '/dashboard' ? pathname === href : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={() => setMobileOpen(false)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                active
                  ? 'bg-[#C41E3A]/15 text-[#F0EDE8]'
                  : 'text-[#6B6570] hover:text-[#c4bec9] hover:bg-white/[0.04]'
              }`}
            >
              <Icon active={active} />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* User + sign out */}
      <div className="px-3 pb-4 pt-2 border-t border-white/[0.06]">
        <div className="px-3 py-2 mb-1">
          <p className="text-[#6B6570] text-xs truncate">{user.email}</p>
        </div>
        <button
          onClick={signOut}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-[#6B6570] hover:text-[#ff6b6b] hover:bg-white/[0.04] transition-colors"
        >
          <IconSignOut />
          Sign out
        </button>
      </div>
    </aside>
  );

  return (
    <RestaurantContext.Provider value={restaurant}>
      <div className="flex min-h-screen bg-[#0f0f0f]">

        {/* Mobile backdrop */}
        {mobileOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/60 md:hidden"
            onClick={() => setMobileOpen(false)}
          />
        )}

        {sidebar}

        {/* Right side */}
        <div className="flex-1 min-w-0 flex flex-col">

          {/* Mobile top bar */}
          <header className="md:hidden flex items-center justify-between px-4 py-3 bg-[#111111] border-b border-white/[0.06] sticky top-0 z-20">
            <div className="flex items-center gap-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-white.svg" alt="Virtual Waitress" className="h-5 w-auto shrink-0" />
              <span className="text-[#F0EDE8] text-sm font-semibold truncate max-w-[140px]">
                {restaurant?.name}
              </span>
            </div>
            <button
              onClick={() => setMobileOpen(true)}
              className="text-[#6B6570] hover:text-[#F0EDE8] transition-colors p-1"
              aria-label="Open menu"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="3" y1="6" x2="21" y2="6"/>
                <line x1="3" y1="12" x2="21" y2="12"/>
                <line x1="3" y1="18" x2="21" y2="18"/>
              </svg>
            </button>
          </header>

          {/* Trial warning banner — admin only, days 7–14 */}
          {isOwner && trialStatus?.type === 'trial-warning' && (
            <div className={`flex items-center gap-3 px-4 py-3 border-b text-xs flex-wrap ${
              trialStatus.daysLeft <= 3
                ? 'bg-red-500/10 border-red-500/20 text-red-400'
                : 'bg-amber-500/10 border-amber-500/20 text-amber-400'
            }`}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
              <span className="flex-1">
                Your free trial ends in <strong>{trialStatus.daysLeft} day{trialStatus.daysLeft !== 1 ? 's' : ''}</strong>. Upgrade to Pro to keep full access — ₦9,900/month.
              </span>
              <a
                href="mailto:support@virtualwaitress.com?subject=Upgrade to Pro"
                className="underline hover:no-underline shrink-0 font-medium"
              >
                Upgrade now
              </a>
            </div>
          )}

          {/* Grace period banner — admin only, 2 days after trial ends */}
          {isOwner && trialStatus?.type === 'expired-grace' && !graceBannerDismissed && (
            <div className="flex items-center gap-3 px-4 py-3 bg-red-500/10 border-b border-red-500/20 text-red-400 text-xs flex-wrap">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              <span className="flex-1">
                Your 14-day trial has ended. Your dashboard locks in <strong>2 days</strong> — upgrade now to keep all features.{' '}
                <a href="mailto:support@virtualwaitress.com?subject=Upgrade to Pro" className="underline hover:no-underline font-medium">Upgrade to Pro — ₦9,900/month</a>
              </span>
              <button onClick={() => setGraceBannerDismissed(true)} aria-label="Dismiss" className="text-red-400/60 hover:text-red-400 transition-colors shrink-0">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          )}

          {/* Locked banner — admin only, persistent after grace period */}
          {isOwner && trialStatus?.type === 'locked' && (
            <div className="flex items-center gap-3 px-4 py-3 bg-[#C41E3A]/10 border-b border-[#C41E3A]/25 text-[#e87a8a] text-xs flex-wrap">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              <span className="flex-1">
                Dashboard is <strong>view-only</strong>. Upgrade to Pro to unlock menus, orders, and all actions — ₦9,900/month.{' '}
                <a href="mailto:support@virtualwaitress.com?subject=Upgrade to Pro" className="underline hover:no-underline font-medium">Upgrade now</a>
              </span>
            </div>
          )}

          {/* Email confirmation banner */}
          {emailUnconfirmed && !emailBannerDismissed && (
            <div className="flex items-center gap-3 px-4 py-3 bg-amber-500/10 border-b border-amber-500/20 text-amber-400 text-xs flex-wrap">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <span className="flex-1">Please confirm your email address — check your inbox for a verification link.</span>
              {resendSent ? (
                <span className="text-emerald-400 font-medium shrink-0">Sent!</span>
              ) : (
                <button onClick={resendConfirmation} className="underline hover:no-underline shrink-0 font-medium">
                  Resend email
                </button>
              )}
              <button onClick={() => setEmailBannerDismissed(true)} aria-label="Dismiss" className="text-amber-400/60 hover:text-amber-400 transition-colors shrink-0">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          )}

          {/* Page content */}
          <main
            className="flex-1 overflow-auto"
            {...(isOwner && trialStatus?.type === 'locked' ? { 'data-locked': 'true' } : {})}
          >
            {children}
          </main>
        </div>
      </div>
    </RestaurantContext.Provider>
  );
}

/* ── Icons ─────────────────────────────────────────────────────────────────── */
function IconChart({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={active ? '#C41E3A' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/>
      <line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/>
    </svg>
  );
}
function IconOrders({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={active ? '#C41E3A' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
      <rect x="9" y="3" width="6" height="4" rx="1"/>
      <path d="M9 12h6M9 16h4"/>
    </svg>
  );
}
function IconMenu({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={active ? '#C41E3A' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 2h18"/><path d="M3 12h18"/><path d="M3 22h18"/>
    </svg>
  );
}
function IconTable({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={active ? '#C41E3A' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/>
      <line x1="9" y1="9" x2="9" y2="21"/>
    </svg>
  );
}
function IconStaff({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={active ? '#C41E3A' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  );
}
function IconQr({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={active ? '#C41E3A' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
      <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="3" height="3"/>
    </svg>
  );
}
function IconSettings({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={active ? '#C41E3A' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  );
}
function IconSignOut() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
      <polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
    </svg>
  );
}

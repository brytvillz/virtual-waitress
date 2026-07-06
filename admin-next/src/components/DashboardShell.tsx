'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { createContext, useContext } from 'react';
import type { User } from '@supabase/supabase-js';

type Restaurant = { id: string; name: string; slug: string; plan: string } | null;

const RestaurantContext = createContext<Restaurant>(null);
export function useRestaurant() { return useContext(RestaurantContext); }

const NAV = [
  { href: '/dashboard',          label: 'Analytics',  icon: IconChart },
  { href: '/dashboard/menu',     label: 'Menu',       icon: IconMenu },
  { href: '/dashboard/tables',   label: 'Tables',     icon: IconTable },
  { href: '/dashboard/staff',    label: 'Staff',      icon: IconStaff },
  { href: '/dashboard/qr',       label: 'QR Codes',   icon: IconQr },
  { href: '/dashboard/settings', label: 'Settings',   icon: IconSettings },
];

export default function DashboardShell({
  user,
  restaurant,
  children,
}: {
  user: User;
  restaurant: Restaurant;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

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
          <div className="w-8 h-8 rounded-[8px] bg-[#C41E3A] flex items-center justify-center shrink-0">
            <span className="text-white text-[9px] font-black tracking-wide">VW</span>
          </div>
          <div className="min-w-0">
            <p className="text-[#F0EDE8] text-sm font-semibold truncate leading-tight">
              {restaurant?.name ?? 'Virtual Waitress'}
            </p>
            <p className="text-[#4a4a4a] text-[10px] uppercase tracking-wider font-medium capitalize">
              {restaurant?.plan ?? 'free'} plan
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
          const active = pathname === href;
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
              <div className="w-7 h-7 rounded-[7px] bg-[#C41E3A] flex items-center justify-center">
                <span className="text-white text-[8px] font-black tracking-wide">VW</span>
              </div>
              <span className="text-[#F0EDE8] text-sm font-semibold truncate max-w-[160px]">
                {restaurant?.name ?? 'Virtual Waitress'}
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

          {/* Page content */}
          <main className="flex-1 overflow-auto">
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

'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;

type Stats = {
  restaurants: { total: number; newThisWeek: number; newThisMonth: number };
  orders: { total: number; revenue: number };
  breakdown: Array<{
    id: string; name: string; slug: string;
    created_at: string; orders: number; revenue: number; lastOrder: string | null;
  }>;
  monthlySignups: Array<{ month: string; count: number }>;
};

function fmt(n: number) {
  return '₦' + (n || 0).toLocaleString('en-NG');
}

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

function ColumnChart({ labels, values }: { labels: string[]; values: number[] }) {
  const W = 340, H = 180, PT = 28, PR = 12, PB = 36, PL = 28;
  const cW = W - PL - PR, cH = H - PT - PB;
  const max = Math.max(...values, 1);
  const step = cW / labels.length;
  const barW = Math.min(step * 0.55, 44);

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`}>
      {[0.25, 0.5, 0.75, 1].map(f => {
        const y = PT + cH * (1 - f);
        return (
          <g key={f}>
            <line x1={PL} y1={y} x2={W - PR} y2={y} stroke="#ffffff08" strokeWidth={1} />
            <text x={PL - 5} y={y + 4} textAnchor="end" fontSize={9} fill="#444">{Math.round(max * f)}</text>
          </g>
        );
      })}
      <line x1={PL} y1={PT + cH} x2={W - PR} y2={PT + cH} stroke="#222" strokeWidth={1} />
      {labels.map((label, i) => {
        const x = PL + step * i + (step - barW) / 2;
        const barH = values[i] > 0 ? Math.max((values[i] / max) * cH, 3) : 0;
        const y = PT + cH - barH;
        return (
          <g key={i}>
            {barH > 0 && (
              <>
                <rect x={x} y={y} width={barW} height={barH} fill="#C41E3A" rx={3} />
                <text x={x + barW / 2} y={y - 6} textAnchor="middle" fontSize={11} fill="#C41E3A" fontWeight={700}>{values[i]}</text>
              </>
            )}
            <text x={x + barW / 2} y={PT + cH + 16} textAnchor="middle" fontSize={10} fill="#555">{label}</text>
          </g>
        );
      })}
    </svg>
  );
}

function HBarChart({ labels, values, formatFn }: { labels: string[]; values: number[]; formatFn: (n: number) => string }) {
  if (!labels.length) return <p className="text-[#4a4a4a] text-sm py-4">No orders yet</p>;
  const W = 340, BAR_H = 28, BAR_G = 10;
  const PL = 114, PR = 86, PT = 4, PB = 4;
  const H = PT + labels.length * (BAR_H + BAR_G) - BAR_G + PB;
  const cW = W - PL - PR;
  const max = Math.max(...values, 1);

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`}>
      {labels.map((label, i) => {
        const y = PT + i * (BAR_H + BAR_G);
        const barLen = values[i] > 0 ? Math.max((values[i] / max) * cW, 4) : 0;
        const name = label.length > 13 ? label.slice(0, 12) + '…' : label;
        return (
          <g key={i}>
            <rect x={PL} y={y} width={cW} height={BAR_H} fill="#18181b" rx={4} />
            {barLen > 0 && <rect x={PL} y={y} width={barLen} height={BAR_H} fill="#C41E3A" rx={4} opacity={0.88} />}
            <text x={PL - 8} y={y + BAR_H / 2 + 4} textAnchor="end" fontSize={12} fill="#ccc">{name}</text>
            <text x={PL + cW + 10} y={y + BAR_H / 2 + 4} fontSize={11} fill="#C41E3A" fontWeight={700}>{formatFn(values[i])}</text>
          </g>
        );
      })}
    </svg>
  );
}

export default function SuperAdminPage() {
  const [view, setView] = useState<'loading' | 'login' | 'dashboard' | 'denied'>('loading');
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsError, setStatsError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState('');

  const fetchStats = useCallback(async (token: string) => {
    setStatsError('');
    const res = await fetch(`${SUPABASE_URL}/functions/v1/platform-stats`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (res.status === 403) { setView('denied'); return; }
    if (!res.ok) { setStatsError('Failed to load stats — please try again.'); return; }
    const data = await res.json();
    setStats(data);
    setLastUpdated(new Date().toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }));
    setView('dashboard');
  }, []);

  useEffect(() => {
    createClient().auth.getSession().then(({ data: { session } }) => {
      if (session) fetchStats(session.access_token);
      else setView('login');
    });
  }, [fetchStats]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError('');
    setLoginLoading(true);
    const { data, error } = await createClient().auth.signInWithPassword({ email, password });
    setLoginLoading(false);
    if (error || !data.session) { setLoginError('Login failed — check your credentials.'); return; }
    await fetchStats(data.session.access_token);
  }

  async function handleLogout() {
    await createClient().auth.signOut();
    setView('login');
    setStats(null);
  }

  if (view === 'loading') {
    return (
      <div className="min-h-screen bg-[#0D0D0D] flex items-center justify-center">
        <span className="w-6 h-6 border-2 border-[#C41E3A] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (view === 'denied') {
    return (
      <div className="min-h-screen bg-[#0D0D0D] flex items-center justify-center p-4 text-center">
        <div>
          <p className="text-[#F0EDE8] text-lg font-semibold mb-2">Access Denied</p>
          <p className="text-[#6B6570] text-sm">This account is not a platform administrator.</p>
        </div>
      </div>
    );
  }

  if (view === 'login') {
    return (
      <div className="min-h-screen bg-[#0D0D0D] flex items-center justify-center p-4">
        <form onSubmit={handleLogin} className="bg-[#161616] border border-white/[0.06] rounded-2xl p-8 w-full max-w-sm flex flex-col gap-4">
          <div className="mb-2">
            <h1 className="text-[#F0EDE8] text-xl font-bold">Platform Admin</h1>
            <p className="text-[#4a4a4a] text-sm mt-1">Virtual Waitress — Internal</p>
          </div>
          <input
            type="email" required placeholder="Email" value={email}
            onChange={e => setEmail(e.target.value)}
            className="bg-[#111] border border-white/[0.08] rounded-xl px-4 py-3 text-[#F0EDE8] text-sm placeholder-[#4a4a4a] outline-none focus:border-[#C41E3A]/50 transition-colors"
          />
          <div className="relative">
            <input
              type={showPass ? 'text' : 'password'} required placeholder="Password" value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full bg-[#111] border border-white/[0.08] rounded-xl px-4 py-3 pr-11 text-[#F0EDE8] text-sm placeholder-[#4a4a4a] outline-none focus:border-[#C41E3A]/50 transition-colors"
            />
            <button type="button" onClick={() => setShowPass(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#4a4a4a] hover:text-[#9a9098] transition-colors p-1">
              {showPass ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                </svg>
              )}
            </button>
          </div>
          {loginError && <p className="text-[#ff6b6b] text-sm">{loginError}</p>}
          <button
            type="submit" disabled={loginLoading}
            className="bg-[#C41E3A] hover:bg-[#a01830] disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-colors"
          >
            {loginLoading ? 'Logging in…' : 'Log In'}
          </button>
          <a href="/reset-password" className="text-center text-[#6B6570] hover:text-[#C41E3A] text-xs transition-colors">
            Forgot password?
          </a>
        </form>
      </div>
    );
  }

  const s = stats!;
  const monthLabels = s.monthlySignups.map(({ month }) => {
    const [y, mo] = month.split('-');
    return new Date(Number(y), Number(mo) - 1).toLocaleDateString('en', { month: 'short' });
  });
  const topByRevenue = [...s.breakdown]
    .filter(r => r.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 6);

  return (
    <div className="min-h-screen bg-[#0D0D0D]">
      <header className="border-b border-white/[0.06] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-[8px] bg-[#C41E3A] flex items-center justify-center">
            <span className="text-white text-xs font-black">VW</span>
          </div>
          <div>
            <p className="text-[#F0EDE8] text-sm font-semibold leading-tight">Virtual Waitress</p>
            <p className="text-[#4a4a4a] text-[10px] uppercase tracking-wider">Platform Admin</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {lastUpdated && <p className="text-[#4a4a4a] text-xs hidden sm:block">Updated {lastUpdated}</p>}
          <button onClick={handleLogout} className="text-[#6B6570] hover:text-[#ff6b6b] text-sm font-medium transition-colors">
            Log out
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 flex flex-col gap-8">
        {statsError && (
          <p className="text-[#ff6b6b] text-sm bg-[#ff6b6b]/10 border border-[#ff6b6b]/20 rounded-xl px-4 py-3">{statsError}</p>
        )}

        {/* Stat cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {[
            { label: 'Restaurants',    value: s.restaurants.total },
            { label: 'New this week',  value: s.restaurants.newThisWeek },
            { label: 'New this month', value: s.restaurants.newThisMonth },
            { label: 'Total orders',   value: s.orders.total },
            { label: 'Total revenue',  value: fmt(s.orders.revenue) },
          ].map(({ label, value }) => (
            <div key={label} className="bg-[#161616] border border-white/[0.06] rounded-2xl p-5">
              <p className="text-[#4a4a4a] text-xs uppercase tracking-wider mb-2">{label}</p>
              <p className="text-[#F0EDE8] text-2xl font-bold">{value}</p>
            </div>
          ))}
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-[#161616] border border-white/[0.06] rounded-2xl p-5">
            <p className="text-[#F0EDE8] text-sm font-semibold mb-4">Monthly Signups</p>
            <ColumnChart labels={monthLabels} values={s.monthlySignups.map(m => m.count)} />
          </div>
          <div className="bg-[#161616] border border-white/[0.06] rounded-2xl p-5">
            <p className="text-[#F0EDE8] text-sm font-semibold mb-4">Top by Revenue</p>
            <HBarChart labels={topByRevenue.map(r => r.name)} values={topByRevenue.map(r => r.revenue)} formatFn={fmt} />
          </div>
        </div>

        {/* Restaurants table */}
        <div className="bg-[#161616] border border-white/[0.06] rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-white/[0.05]">
            <p className="text-[#F0EDE8] text-sm font-semibold">All Restaurants</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.05]">
                  {['Name', 'Slug', 'Joined', 'Orders', 'Revenue', 'Last Order'].map(h => (
                    <th key={h} className="px-5 py-3 text-left text-[#4a4a4a] text-xs uppercase tracking-wider font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.03]">
                {s.breakdown.length === 0 ? (
                  <tr><td colSpan={6} className="px-5 py-8 text-[#4a4a4a] text-center">No restaurants yet</td></tr>
                ) : s.breakdown.map(r => (
                  <tr key={r.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-5 py-3 text-[#F0EDE8] font-medium whitespace-nowrap">{r.name}</td>
                    <td className="px-5 py-3 text-[#6B6570] font-mono text-xs">{r.slug}</td>
                    <td className="px-5 py-3 text-[#6B6570] whitespace-nowrap">{fmtDate(r.created_at)}</td>
                    <td className="px-5 py-3 text-[#6B6570]">{r.orders}</td>
                    <td className="px-5 py-3 text-[#F0EDE8] whitespace-nowrap">{fmt(r.revenue)}</td>
                    <td className="px-5 py-3 text-[#6B6570] whitespace-nowrap">{fmtDate(r.lastOrder)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}

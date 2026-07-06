'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRestaurant } from '@/components/DashboardShell';
import CopyButton from '@/components/CopyButton';

const WAITER_LOGIN_URL = 'https://app.virtualwaitress.com/waiter.html';

type StaffMember = {
  id: string;
  name: string;
  role: 'waiter' | 'manager';
  access_code: string | null;
  restaurant_id: string;
};

type WaiterStats = { orders: number; revenue: number };

function todayDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function generateCode() {
  return 'WTR-' + Math.floor(1000 + Math.random() * 9000);
}

function fmt(n: number) {
  return '₦' + n.toLocaleString('en-NG');
}

export default function StaffPage() {
  const restaurant = useRestaurant();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [waiterTables, setWaiterTables] = useState<Record<string, number[]>>({});
  const [waiterStats, setWaiterStats] = useState<Record<string, WaiterStats>>({});
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [waiterName, setWaiterName] = useState('');
  const [addError, setAddError] = useState('');
  const [creating, setCreating] = useState(false);
  const [newWaiter, setNewWaiter] = useState<{ name: string; access_code: string } | null>(null);

  const load = useCallback(async (restaurantId: string) => {
    const supabase = createClient();
    const today = todayDate();

    const [{ data: staffList }, { data: assignments }, { data: orders }] = await Promise.all([
      supabase.from('staff').select('*').eq('restaurant_id', restaurantId).order('name'),
      supabase
        .from('shift_assignments')
        .select('waiter_id, tables(table_number)')
        .eq('restaurant_id', restaurantId)
        .eq('assigned_date', today),
      supabase
        .from('orders')
        .select('handled_by, total')
        .eq('restaurant_id', restaurantId)
        .gte('created_at', startOfToday()),
    ]);

    const tables: Record<string, number[]> = {};
    (assignments ?? []).forEach((a: { waiter_id: string; tables: { table_number: number }[] | null }) => {
      if (!tables[a.waiter_id]) tables[a.waiter_id] = [];
      const nums = Array.isArray(a.tables) ? a.tables.map(t => t.table_number) : [];
      tables[a.waiter_id].push(...nums);
    });

    const stats: Record<string, WaiterStats> = {};
    (orders ?? []).forEach((o: { handled_by: string; total: number }) => {
      if (!o.handled_by) return;
      if (!stats[o.handled_by]) stats[o.handled_by] = { orders: 0, revenue: 0 };
      stats[o.handled_by].orders++;
      stats[o.handled_by].revenue += o.total;
    });

    setStaff((staffList ?? []) as StaffMember[]);
    setWaiterTables(tables);
    setWaiterStats(stats);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!restaurant) return;
    load(restaurant.id);
  }, [restaurant, load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!restaurant || !waiterName.trim()) return;
    setCreating(true);
    setAddError('');

    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setAddError('Session expired — refresh and try again.'); setCreating(false); return; }

    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/create-waiter`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ name: waiterName.trim(), restaurant_id: restaurant.id }),
        }
      );
      const result = await res.json();
      if (!res.ok || result.error) throw new Error(result.error || 'Failed to create waiter');

      setNewWaiter({ name: result.staff.name, access_code: result.staff.access_code });
      setModalOpen(false);
      setWaiterName('');
      await load(restaurant.id);
    } catch (err) {
      setAddError((err as Error).message || 'Something went wrong. Try again.');
    } finally {
      setCreating(false);
    }
  }

  async function handleRegenCode(staffId: string) {
    const supabase = createClient();
    let newCode = '';
    for (let i = 0; i < 5; i++) {
      const candidate = generateCode();
      const { data } = await supabase.from('staff').select('id').eq('access_code', candidate).maybeSingle();
      if (!data) { newCode = candidate; break; }
    }
    if (!newCode) { alert('Could not generate a unique code — try again.'); return; }
    const { error } = await supabase.from('staff').update({ access_code: newCode }).eq('id', staffId);
    if (error) { alert('Failed to update code.'); return; }
    await load(restaurant!.id);
  }

  async function handleRemove(member: StaffMember) {
    if (!confirm(`Remove ${member.name}? Their code will stop working. Order history is kept.`)) return;
    const supabase = createClient();
    await supabase.from('staff').update({ access_code: null }).eq('id', member.id);
    await load(restaurant!.id);
  }

  if (!restaurant) return null;

  const waiters = staff.filter(s => s.role === 'waiter');
  const managers = staff.filter(s => s.role === 'manager');

  return (
    <div className="p-8 max-w-4xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[#F0EDE8] text-2xl font-bold tracking-tight">Staff</h1>
          <p className="text-[#6B6570] text-sm mt-1">
            {waiters.length} waiter{waiters.length !== 1 ? 's' : ''} · {managers.length} manager{managers.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={() => { setModalOpen(true); setWaiterName(''); setAddError(''); }}
          className="bg-[#C41E3A] hover:bg-[#a01830] text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors"
        >
          + Add waiter
        </button>
      </div>

      {/* Waiter login link bar */}
      <div className="bg-[#161616] border border-white/[0.06] rounded-xl px-4 py-3 flex items-center gap-3 mb-8 flex-wrap">
        <span className="text-[#6B6570] text-xs font-medium shrink-0">Waiter login link:</span>
        <a
          href={WAITER_LOGIN_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#9a9098] text-xs hover:text-[#F0EDE8] transition-colors flex-1 truncate"
        >
          {WAITER_LOGIN_URL}
        </a>
        <CopyButton text={WAITER_LOGIN_URL} />
      </div>

      {/* New waiter success banner */}
      {newWaiter && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-5 py-4 mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-emerald-400 text-sm font-semibold mb-1">Waiter created — {newWaiter.name}</p>
            <p className="text-[#9a9098] text-xs">
              Share this code with them:{' '}
              <span className="text-[#F0EDE8] font-mono font-bold">{newWaiter.access_code}</span>
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <CopyButton text={newWaiter.access_code} />
            <button onClick={() => setNewWaiter(null)} className="text-[#4a4a4a] hover:text-[#9a9098] text-lg leading-none">×</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-[#6B6570] text-sm">
          <span className="w-4 h-4 border-2 border-[#6B6570] border-t-transparent rounded-full animate-spin" />
          Loading staff…
        </div>
      ) : staff.length === 0 ? (
        <div className="bg-[#161616] border border-white/[0.06] rounded-2xl p-12 text-center">
          <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-[#1f1f1f] flex items-center justify-center">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4a4a4a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          </div>
          <h2 className="text-[#F0EDE8] text-lg font-semibold mb-2">No staff yet</h2>
          <p className="text-[#6B6570] text-sm mb-6">Add waiters and share their login code.</p>
          <button
            onClick={() => setModalOpen(true)}
            className="bg-[#C41E3A] hover:bg-[#a01830] text-white text-sm font-semibold px-5 py-3 rounded-xl transition-colors"
          >
            + Add your first waiter
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">

          {/* Waiters */}
          {waiters.map(member => {
            const tables = (waiterTables[member.id] ?? []).sort((a, b) => a - b);
            const stats = waiterStats[member.id] ?? { orders: 0, revenue: 0 };
            return (
              <div key={member.id} className="bg-[#161616] border border-white/[0.06] rounded-2xl p-5">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-[#C41E3A]/15 flex items-center justify-center shrink-0">
                      <span className="text-[#C41E3A] text-sm font-bold">
                        {(member.name || '?')[0].toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <p className="text-[#F0EDE8] text-sm font-semibold">{member.name || 'Unnamed'}</p>
                      <span className="inline-block mt-0.5 bg-[#C41E3A]/10 text-[#C41E3A] text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider">
                        waiter
                      </span>
                    </div>
                  </div>

                  {/* Today's stats */}
                  <div className="text-right shrink-0">
                    <p className="text-[#F0EDE8] text-sm font-semibold">{fmt(stats.revenue)}</p>
                    <p className="text-[#6B6570] text-xs">{stats.orders} order{stats.orders !== 1 ? 's' : ''} today</p>
                  </div>
                </div>

                {/* Tables today */}
                <p className="text-[#6B6570] text-xs mb-3">
                  {tables.length
                    ? 'Tables today: ' + tables.join(', ')
                    : 'No tables assigned today'}
                </p>

                {/* Access code row */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="bg-[#1f1f1f] border border-white/[0.08] text-[#F0EDE8] font-mono text-sm px-3 py-1.5 rounded-lg">
                    {member.access_code ?? 'Deactivated'}
                  </span>
                  {member.access_code && <CopyButton text={member.access_code} />}
                  <button
                    onClick={() => handleRegenCode(member.id)}
                    className="px-2.5 py-1 rounded-lg text-xs font-medium bg-white/[0.05] text-[#9a9098] border border-white/[0.08] hover:bg-white/[0.08] transition-colors"
                  >
                    ↺ New code
                  </button>
                  <button
                    onClick={() => handleRemove(member)}
                    className="px-2.5 py-1 rounded-lg text-xs font-medium border border-[#ff6b6b]/20 text-[#ff6b6b] hover:bg-[#ff6b6b]/10 transition-colors ml-auto"
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })}

          {/* Managers */}
          {managers.map(member => (
            <div key={member.id} className="bg-[#161616] border border-white/[0.06] rounded-2xl p-5 flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-white/[0.05] flex items-center justify-center shrink-0">
                <span className="text-[#9a9098] text-sm font-bold">
                  {(member.name || '?')[0].toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[#F0EDE8] text-sm font-semibold">{member.name || 'Unnamed'}</p>
                <span className="inline-block mt-0.5 bg-white/[0.06] text-[#9a9098] text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider">
                  manager
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Waiter Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
          <div className="bg-[#1a1a1a] border border-white/[0.08] rounded-2xl w-full max-w-sm p-6">
            <h2 className="text-[#F0EDE8] text-lg font-semibold mb-1">Add Waiter</h2>
            <p className="text-[#6B6570] text-xs mb-5">A login code will be generated automatically.</p>

            <form onSubmit={handleCreate} className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-[#9a9098] text-xs font-medium uppercase tracking-wider">Waiter Name *</span>
                <input
                  type="text"
                  required
                  value={waiterName}
                  onChange={e => setWaiterName(e.target.value)}
                  placeholder="e.g. Chidi Okafor"
                  autoFocus
                  className="bg-[#111] border border-white/[0.08] rounded-xl px-4 py-3 text-[#F0EDE8] text-sm placeholder-[#4a4a4a] outline-none focus:border-[#C41E3A]/50 transition-colors"
                />
              </label>

              {addError && (
                <p className="text-[#ff6b6b] text-sm bg-[#ff6b6b]/10 border border-[#ff6b6b]/20 rounded-xl px-4 py-3">
                  {addError}
                </p>
              )}

              <div className="flex gap-3 mt-1">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="flex-1 py-3 rounded-xl border border-white/[0.08] text-[#9a9098] text-sm font-medium hover:bg-white/[0.04] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="flex-1 py-3 rounded-xl bg-[#C41E3A] hover:bg-[#a01830] disabled:opacity-50 text-white text-sm font-semibold transition-colors"
                >
                  {creating ? 'Creating…' : 'Create Waiter'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

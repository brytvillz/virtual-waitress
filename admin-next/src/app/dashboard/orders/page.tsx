'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRestaurant } from '@/components/DashboardShell';

type OrderItem = { item_name: string; quantity: number; price: number };

type Order = {
  id: string;
  status: 'pending' | 'preparing' | 'served' | 'completed' | 'cancelled';
  total: number;
  table_number: number;
  created_at: string;
  handled_by: string | null;
  order_items: OrderItem[];
};

type Staff = { id: string; name: string };

const STATUS_META: Record<string, { label: string; dot: string; card: string }> = {
  pending:   { label: 'Pending',   dot: 'bg-amber-400 animate-pulse', card: 'border-amber-500/20 bg-amber-500/[0.04]' },
  preparing: { label: 'Preparing', dot: 'bg-blue-400',                card: 'border-blue-500/20 bg-blue-500/[0.04]'  },
  served:    { label: 'Served',    dot: 'bg-emerald-400',             card: 'border-emerald-500/20'                   },
  completed: { label: 'Completed', dot: 'bg-[#4a4a4a]',              card: 'border-white/[0.06]'                     },
  cancelled: { label: 'Cancelled', dot: 'bg-[#ff6b6b]',              card: 'border-[#ff6b6b]/10'                     },
};

const NEXT_STATUS: Partial<Record<string, string>> = {
  pending:   'preparing',
  preparing: 'served',
  served:    'completed',
};

const NEXT_LABEL: Partial<Record<string, string>> = {
  pending:   'Start preparing',
  preparing: 'Mark as served',
  served:    'Mark complete',
};

function fmt(n: number) {
  return '₦' + n.toLocaleString('en-NG');
}

function timeAgo(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60)  return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export default function OrdersPage() {
  const restaurant = useRestaurant();
  const [orders, setOrders]     = useState<Order[]>([]);
  const [staff, setStaff]       = useState<Staff[]>([]);
  const [loading, setLoading]   = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [tick, setTick]         = useState(0); // forces time-ago refresh
  const channelRef = useRef<ReturnType<typeof createClient>['channel'] | null>(null);

  // Refresh "X min ago" every 60 seconds
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async (restaurantId: string) => {
    const supabase = createClient();
    const [{ data: orderData }, { data: staffData }] = await Promise.all([
      supabase
        .from('orders')
        .select('id, status, total, table_number, created_at, handled_by, order_items(item_name, quantity, price)')
        .eq('restaurant_id', restaurantId)
        .gte('created_at', startOfToday())
        .order('created_at', { ascending: false }),
      supabase
        .from('staff')
        .select('id, name')
        .eq('restaurant_id', restaurantId),
    ]);
    setOrders((orderData ?? []) as Order[]);
    setStaff((staffData ?? []) as Staff[]);
    setLoading(false);
  }, []);

  // Real-time subscription
  const setupRealtime = useCallback((restaurantId: string) => {
    const supabase = createClient();

    const channel = supabase
      .channel(`orders-${restaurantId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${restaurantId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            // Fetch full order with items
            supabase
              .from('orders')
              .select('id, status, total, table_number, created_at, handled_by, order_items(item_name, quantity, price)')
              .eq('id', (payload.new as { id: string }).id)
              .single()
              .then(({ data }) => {
                if (data) setOrders(prev => [data as Order, ...prev]);
              });
          } else if (payload.eventType === 'UPDATE') {
            setOrders(prev =>
              prev.map(o => o.id === (payload.new as Order).id ? { ...o, ...(payload.new as Order) } : o)
            );
          } else if (payload.eventType === 'DELETE') {
            setOrders(prev => prev.filter(o => o.id !== (payload.old as { id: string }).id));
          }
        }
      )
      .subscribe();

    channelRef.current = channel as unknown as ReturnType<typeof createClient>['channel'];
    return () => { supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    if (!restaurant) return;
    load(restaurant.id);
    const cleanup = setupRealtime(restaurant.id);
    return cleanup;
  }, [restaurant, load, setupRealtime]);

  async function advanceStatus(order: Order) {
    const next = NEXT_STATUS[order.status];
    if (!next || updating) return;
    setUpdating(order.id);
    const supabase = createClient();
    const { error } = await supabase.from('orders').update({ status: next }).eq('id', order.id);
    if (!error) {
      setOrders(prev =>
        prev.map(o => o.id === order.id ? { ...o, status: next as Order['status'] } : o)
      );
    }
    setUpdating(null);
  }

  if (!restaurant) return null;

  const staffMap = Object.fromEntries(staff.map(s => [s.id, s.name]));

  const active    = orders.filter(o => o.status === 'pending' || o.status === 'preparing');
  const completed = orders.filter(o => o.status === 'served' || o.status === 'completed' || o.status === 'cancelled');

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[#F0EDE8] text-2xl font-bold tracking-tight">Live Orders</h1>
          <p className="text-[#6B6570] text-sm mt-1">
            {active.length > 0
              ? `${active.length} active order${active.length !== 1 ? 's' : ''} right now`
              : "No active orders right now"}
          </p>
        </div>
        {active.length > 0 && (
          <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-amber-400 text-xs font-semibold">{active.length} active</span>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-[#6B6570] text-sm">
          <span className="w-4 h-4 border-2 border-[#6B6570] border-t-transparent rounded-full animate-spin" />
          Loading orders…
        </div>
      ) : (
        <>
          {/* ── Active Orders ─────────────────────────────────────────────── */}
          {active.length === 0 ? (
            <div className="bg-[#161616] border border-white/[0.06] rounded-2xl p-10 text-center mb-6">
              <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-[#1f1f1f] flex items-center justify-center">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#4a4a4a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
                  <rect x="9" y="3" width="6" height="4" rx="1"/>
                  <path d="M9 12h6M9 16h4"/>
                </svg>
              </div>
              <p className="text-[#F0EDE8] text-sm font-medium mb-1">All clear</p>
              <p className="text-[#4a4a4a] text-xs">New orders will appear here instantly when customers place them.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3 mb-8">
              {active.map(order => (
                <OrderCard
                  key={order.id}
                  order={order}
                  staffMap={staffMap}
                  onAdvance={() => advanceStatus(order)}
                  advancing={updating === order.id}
                  tick={tick}
                />
              ))}
            </div>
          )}

          {/* ── Completed Today ───────────────────────────────────────────── */}
          {completed.length > 0 && (
            <>
              <h2 className="text-[#6B6570] text-xs font-semibold uppercase tracking-wider mb-3">
                Completed today
              </h2>
              <div className="flex flex-col gap-2">
                {completed.map(order => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    staffMap={staffMap}
                    tick={tick}
                    compact
                  />
                ))}
              </div>
            </>
          )}

          {orders.length === 0 && (
            <p className="text-[#4a4a4a] text-sm text-center py-8">No orders today yet.</p>
          )}
        </>
      )}
    </div>
  );
}

// ── Order Card ──────────────────────────────────────────────────────────────

function OrderCard({
  order,
  staffMap,
  onAdvance,
  advancing,
  tick: _tick,
  compact,
}: {
  order: Order;
  staffMap: Record<string, string>;
  onAdvance?: () => void;
  advancing?: boolean;
  tick?: number;
  compact?: boolean;
}) {
  const meta   = STATUS_META[order.status] ?? STATUS_META.pending;
  const next   = NEXT_STATUS[order.status];
  const waiter = order.handled_by ? (staffMap[order.handled_by] ?? 'Unknown') : '—';

  if (compact) {
    return (
      <div className={`flex items-center gap-4 px-4 py-3 rounded-xl border ${meta.card} bg-transparent`}>
        <span className={`w-2 h-2 rounded-full shrink-0 ${meta.dot}`} />
        <span className="text-[#9a9098] text-sm font-medium w-16 shrink-0">Table {order.table_number}</span>
        <span className="text-[#6B6570] text-xs flex-1 truncate">
          {order.order_items?.map(i => `${i.item_name} ×${i.quantity}`).join(', ') || '—'}
        </span>
        <span className="text-[#6B6570] text-xs shrink-0">{timeAgo(order.created_at)}</span>
        <span className="text-[#9a9098] text-sm font-semibold shrink-0">{fmt(order.total)}</span>
      </div>
    );
  }

  return (
    <div className={`rounded-2xl border p-5 ${meta.card}`}>
      {/* Top row */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/[0.06] flex items-center justify-center shrink-0">
            <span className="text-[#F0EDE8] text-sm font-bold">{order.table_number}</span>
          </div>
          <div>
            <p className="text-[#F0EDE8] text-sm font-semibold">Table {order.table_number}</p>
            <p className="text-[#6B6570] text-xs mt-0.5">{timeAgo(order.created_at)} · {waiter}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`w-2 h-2 rounded-full ${meta.dot}`} />
          <span className="text-xs font-medium text-[#9a9098]">{meta.label}</span>
        </div>
      </div>

      {/* Items */}
      <div className="flex flex-col gap-1.5 mb-4">
        {(order.order_items ?? []).map((item, i) => (
          <div key={i} className="flex items-center justify-between">
            <span className="text-[#F0EDE8] text-sm">
              <span className="text-[#6B6570] font-mono mr-2">{item.quantity}×</span>
              {item.item_name}
            </span>
            <span className="text-[#6B6570] text-xs">{fmt(item.quantity * item.price)}</span>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-white/[0.06]">
        <span className="text-[#F0EDE8] font-semibold text-sm">{fmt(order.total)}</span>
        {next && onAdvance && (
          <button
            onClick={onAdvance}
            disabled={!!advancing}
            className="bg-[#C41E3A] hover:bg-[#a01830] disabled:opacity-50 text-white text-xs font-semibold px-4 py-2 rounded-xl transition-colors"
          >
            {advancing ? 'Updating…' : NEXT_LABEL[order.status]}
          </button>
        )}
      </div>
    </div>
  );
}

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
  // Payment columns added in migration 021
  is_paid: boolean;
  paid_at: string | null;
  paid_by: string | null;
  payment_method: 'cash' | 'transfer' | 'pos' | null;
  order_items: OrderItem[];
};

type Staff = { id: string; name: string };

type CancellationRequest = {
  id: string;
  order_id: string;
  restaurant_id: string;
  reason: string;
  status: 'pending' | 'approved' | 'declined';
  requested_by: string | null;
  created_at: string;
};

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Cash',
  transfer: 'Transfer',
  pos: 'POS',
};

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

const CANCEL_REASONS = [
  'Customer changed their mind',
  'Wrong order taken',
  'Item unavailable / out of stock',
  'Other',
];

function fmt(n: number) {
  return '₦' + n.toLocaleString('en-NG');
}

function timeAgo(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60)  return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function playBeep() {
  try {
    const ctx = new ((window as any).AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 660;
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    osc.start();
    osc.stop(ctx.currentTime + 0.18);
  } catch { /* audio unavailable */ }
}

const ORDER_SELECT = 'id, status, total, table_number, created_at, handled_by, is_paid, paid_at, paid_by, payment_method, order_items(item_name, quantity, price)';

export default function OrdersPage() {
  const restaurant = useRestaurant();
  const [orders, setOrders]                   = useState<Order[]>([]);
  const [staff, setStaff]                     = useState<Staff[]>([]);
  const [loading, setLoading]                 = useState(true);
  const [updating, setUpdating]               = useState<string | null>(null);
  const [canManagePayments, setCanManage]     = useState(false);
  const [payingOrderId, setPayingOrderId]     = useState<string | null>(null);
  const [payingError, setPayingError]         = useState<string | null>(null);
  const [confirmUnpaidId, setConfirmUnpaidId] = useState<string | null>(null);
  const [markUnpaidError, setMarkUnpaidError] = useState<string | null>(null);
  const [tick, setTick]                       = useState(0);

  // Cancellation request state
  const [cancelReqs, setCancelReqs]           = useState<CancellationRequest[]>([]);
  const [decidingId, setDecidingId]           = useState<string | null>(null);
  const [decisionError, setDecisionError]     = useState<Record<string, string>>({});
  // Cancel-order state (manager/owner direct cancel on a card)
  const [cancelingOrderId, setCancelingOrderId] = useState<string | null>(null);
  const [cancelStep, setCancelStep]           = useState<'pick' | 'other'>('pick');
  const [cancelOther, setCancelOther]         = useState('');
  const [cancelSubmitting, setCancelSubmitting] = useState(false);
  const [cancelRpcError, setCancelRpcError]   = useState<string | null>(null);

  const channelRef = useRef<ReturnType<typeof createClient>['channel'] | null>(null);

  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async (restaurantId: string) => {
    const supabase = createClient();
    const [
      { data: orderData },
      { data: staffData },
      { data: cancelData },
      { data: { user } },
    ] = await Promise.all([
      supabase
        .from('orders')
        .select(ORDER_SELECT)
        .eq('restaurant_id', restaurantId)
        .gte('created_at', startOfToday())
        .order('created_at', { ascending: false }),
      supabase
        .from('staff')
        .select('id, name')
        .eq('restaurant_id', restaurantId),
      supabase
        .from('cancellation_requests')
        .select('id, order_id, restaurant_id, reason, status, requested_by, created_at')
        .eq('restaurant_id', restaurantId)
        .eq('status', 'pending')
        .order('created_at', { ascending: true }),
      supabase.auth.getUser(),
    ]);

    setOrders((orderData ?? []) as Order[]);
    setStaff((staffData ?? []) as Staff[]);
    setCancelReqs((cancelData ?? []) as CancellationRequest[]);

    if (user) {
      const { data: ownerRow } = await supabase
        .from('restaurants')
        .select('id')
        .eq('id', restaurantId)
        .eq('owner_id', user.id)
        .maybeSingle();

      if (ownerRow) {
        setCanManage(true);
      } else {
        const { data: staffRow } = await supabase
          .from('staff')
          .select('role')
          .eq('id', user.id)
          .eq('restaurant_id', restaurantId)
          .maybeSingle();
        setCanManage(staffRow?.role === 'manager');
      }
    }

    setLoading(false);
  }, []);

  const setupRealtime = useCallback((restaurantId: string) => {
    const supabase = createClient();
    const channel = supabase
      .channel(`orders-cancel-${restaurantId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${restaurantId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            supabase
              .from('orders')
              .select(ORDER_SELECT)
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
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'cancellation_requests', filter: `restaurant_id=eq.${restaurantId}` },
        (payload) => {
          const r = payload.new as CancellationRequest;
          if (r.status === 'pending') {
            playBeep();
            setCancelReqs(prev => [...prev, r]);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'cancellation_requests', filter: `restaurant_id=eq.${restaurantId}` },
        (payload) => {
          const r = payload.new as CancellationRequest;
          // Remove from pending list if no longer pending
          setCancelReqs(prev =>
            r.status === 'pending'
              ? prev.map(x => x.id === r.id ? r : x)
              : prev.filter(x => x.id !== r.id)
          );
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

  async function recordPayment(orderId: string, method: string) {
    setPayingError(null);
    const supabase = createClient();
    const { error } = await supabase
      .from('orders')
      .update({ payment_method: method, is_paid: true })
      .eq('id', orderId);
    if (error) {
      setPayingError(error.message);
      return;
    }
    setPayingOrderId(null);
    setOrders(prev =>
      prev.map(o => o.id === orderId
        ? { ...o, payment_method: method as Order['payment_method'], is_paid: true }
        : o
      )
    );
  }

  async function markUnpaid(orderId: string) {
    setMarkUnpaidError(null);
    const supabase = createClient();
    const { error } = await supabase
      .from('orders')
      .update({ is_paid: false })
      .eq('id', orderId);
    if (error) {
      setMarkUnpaidError(error.message);
      return;
    }
    setConfirmUnpaidId(null);
    setOrders(prev =>
      prev.map(o => o.id === orderId
        ? { ...o, is_paid: false, paid_at: null, paid_by: null, payment_method: null }
        : o
      )
    );
  }

  async function approveRequest(requestId: string) {
    setDecidingId(requestId);
    setDecisionError(prev => ({ ...prev, [requestId]: '' }));
    const supabase = createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).rpc('approve_cancellation_request', { p_request_id: requestId });
    setDecidingId(null);
    if (error) {
      setDecisionError(prev => ({ ...prev, [requestId]: error.message }));
    }
    // On success, realtime UPDATE on cancellation_requests removes it from state.
    // Realtime UPDATE on orders changes status to 'cancelled'.
  }

  async function declineRequest(requestId: string) {
    setDecidingId(requestId);
    setDecisionError(prev => ({ ...prev, [requestId]: '' }));
    const supabase = createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).rpc('decline_cancellation_request', { p_request_id: requestId });
    setDecidingId(null);
    if (error) {
      setDecisionError(prev => ({ ...prev, [requestId]: error.message }));
    }
  }

  async function cancelOrder(orderId: string, reason: string) {
    setCancelSubmitting(true);
    setCancelRpcError(null);
    const supabase = createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).rpc('cancel_order', { p_order_id: orderId, p_reason: reason });
    setCancelSubmitting(false);
    if (error) {
      setCancelRpcError(error.message);
      return;
    }
    setCancelingOrderId(null);
    setCancelStep('pick');
    setCancelOther('');
  }

  function openCancelOrder(orderId: string) {
    setCancelingOrderId(orderId);
    setCancelStep('pick');
    setCancelOther('');
    setCancelRpcError(null);
    // Close payment UI if open
    if (payingOrderId === orderId) setPayingOrderId(null);
  }

  function closeCancelOrder() {
    setCancelingOrderId(null);
    setCancelStep('pick');
    setCancelOther('');
    setCancelRpcError(null);
  }

  if (!restaurant) return null;

  const staffMap = Object.fromEntries(staff.map(s => [s.id, s.name]));
  const orderMap = Object.fromEntries(orders.map(o => [o.id, o]));

  const active    = orders.filter(o => o.status === 'pending' || o.status === 'preparing');
  const completed = orders.filter(o => o.status === 'served' || o.status === 'completed' || o.status === 'cancelled');

  const sharedCardProps = (order: Order) => ({
    order,
    staffMap,
    tick,
    canManagePayments,
    isPayingThis:        payingOrderId === order.id,
    payingError:         payingOrderId === order.id ? payingError : null,
    isConfirmingUnpaid:  confirmUnpaidId === order.id,
    markUnpaidError:     confirmUnpaidId === order.id ? markUnpaidError : null,
    isCancelingThis:     cancelingOrderId === order.id,
    cancelStep,
    cancelOther,
    cancelSubmitting,
    cancelRpcError:      cancelingOrderId === order.id ? cancelRpcError : null,
    onStartPayment:      () => { setPayingOrderId(order.id); setPayingError(null); },
    onCancelPayment:     () => { setPayingOrderId(null); setPayingError(null); },
    onRecordPayment:     (method: string) => recordPayment(order.id, method),
    onStartMarkUnpaid:   () => { setConfirmUnpaidId(order.id); setMarkUnpaidError(null); },
    onCancelMarkUnpaid:  () => { setConfirmUnpaidId(null); setMarkUnpaidError(null); },
    onConfirmMarkUnpaid: () => markUnpaid(order.id),
    onStartCancel:       () => openCancelOrder(order.id),
    onCloseCancel:       closeCancelOrder,
    onCancelReasonPick:  (r: string) => {
      if (r === '__other__') { setCancelStep('other'); return; }
      cancelOrder(order.id, r);
    },
    onCancelOtherChange: setCancelOther,
    onCancelOtherSubmit: () => cancelOrder(order.id, cancelOther.trim()),
    onCancelBackStep:    () => { setCancelStep('pick'); setCancelRpcError(null); },
  });

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
          {/* ── Pending Cancellation Requests ──────────────────────────────── */}
          {cancelReqs.length > 0 && (
            <div className="mb-6 rounded-2xl border border-orange-500/30 bg-orange-500/[0.04] overflow-hidden">
              <div className="flex items-center gap-3 px-5 py-3 border-b border-orange-500/20">
                <span className="w-2 h-2 rounded-full bg-orange-400 animate-pulse shrink-0" />
                <span className="text-orange-400 text-sm font-semibold">
                  {cancelReqs.length} cancellation {cancelReqs.length === 1 ? 'request' : 'requests'} waiting
                </span>
              </div>
              <div className="flex flex-col divide-y divide-white/[0.04]">
                {cancelReqs.map(req => (
                  <CancellationRequestCard
                    key={req.id}
                    req={req}
                    order={orderMap[req.order_id]}
                    staffMap={staffMap}
                    isDeciding={decidingId === req.id}
                    error={decisionError[req.id] || null}
                    onApprove={() => approveRequest(req.id)}
                    onDecline={() => declineRequest(req.id)}
                  />
                ))}
              </div>
            </div>
          )}

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
                  {...sharedCardProps(order)}
                  onAdvance={() => advanceStatus(order)}
                  advancing={updating === order.id}
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
                    {...sharedCardProps(order)}
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

// ── Cancellation request card ────────────────────────────────────────────────

function CancellationRequestCard({
  req,
  order,
  staffMap,
  isDeciding,
  error,
  onApprove,
  onDecline,
}: {
  req: CancellationRequest;
  order: Order | undefined;
  staffMap: Record<string, string>;
  isDeciding: boolean;
  error: string | null;
  onApprove: () => void;
  onDecline: () => void;
}) {
  const waiterName = req.requested_by ? (staffMap[req.requested_by] ?? 'Unknown') : '—';
  const totalStr   = order ? fmt(order.total) : '';
  const itemsStr   = order
    ? (order.order_items ?? []).map(i => `${i.item_name} ×${i.quantity}`).join(', ')
    : '';

  return (
    <div className="px-5 py-4">
      <div className="flex items-start justify-between gap-4 mb-2">
        <div>
          <p className="text-[#F0EDE8] text-sm font-semibold">
            Table {order?.table_number ?? '—'} — cancellation requested
          </p>
          <p className="text-[#6B6570] text-xs mt-0.5">{timeAgo(req.created_at)} · by {waiterName}</p>
        </div>
        {totalStr && (
          <span className="text-[#9a9098] text-sm font-semibold shrink-0">{totalStr}</span>
        )}
      </div>
      {itemsStr && (
        <p className="text-[#6B6570] text-xs mb-2 truncate">{itemsStr}</p>
      )}
      <div className="flex items-center gap-2 rounded-lg bg-orange-500/[0.06] border border-orange-500/15 px-3 py-2 mb-3">
        <span className="text-orange-400 text-xs font-semibold shrink-0">Reason:</span>
        <span className="text-[#c4bec9] text-xs">{req.reason}</span>
      </div>
      {error && <p className="text-[#ff6b6b] text-xs mb-2">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          onClick={onApprove}
          disabled={isDeciding}
          className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-[#ff6b6b]/15 hover:bg-[#ff6b6b]/25 text-[#ff6b6b] border border-[#ff6b6b]/25 hover:border-[#ff6b6b]/40 transition-colors disabled:opacity-50"
        >
          {isDeciding ? 'Processing…' : 'Approve — cancel order'}
        </button>
        <button
          onClick={onDecline}
          disabled={isDeciding}
          className="px-4 py-2.5 rounded-xl text-sm font-medium border border-white/10 text-[#6B6570] hover:text-[#c4bec9] hover:border-white/20 transition-colors disabled:opacity-50"
        >
          Decline
        </button>
      </div>
    </div>
  );
}

// ── Payment badge ────────────────────────────────────────────────────────────

function PaymentBadge({ order, staffMap }: { order: Order; staffMap: Record<string, string> }) {
  if (order.status === 'cancelled') return null;

  if (order.is_paid) {
    const payerName  = order.paid_by ? (staffMap[order.paid_by] ?? 'Owner') : '—';
    const methodStr  = order.payment_method ? PAYMENT_LABELS[order.payment_method] : '';
    const timeStr    = order.paid_at ? fmtTime(order.paid_at) : '';
    return (
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
        <span className="text-emerald-400 text-xs font-semibold">
          PAID{methodStr ? ` · ${methodStr}` : ''}{timeStr ? ` · ${timeStr}` : ''} · by {payerName}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
      <span className="text-amber-400 text-xs font-semibold">UNPAID</span>
    </div>
  );
}

// ── Order card ───────────────────────────────────────────────────────────────

type CardProps = {
  order: Order;
  staffMap: Record<string, string>;
  onAdvance?: () => void;
  advancing?: boolean;
  tick?: number;
  compact?: boolean;
  canManagePayments: boolean;
  isPayingThis: boolean;
  payingError: string | null;
  isConfirmingUnpaid: boolean;
  markUnpaidError: string | null;
  isCancelingThis: boolean;
  cancelStep: 'pick' | 'other';
  cancelOther: string;
  cancelSubmitting: boolean;
  cancelRpcError: string | null;
  onStartPayment: () => void;
  onCancelPayment: () => void;
  onRecordPayment: (method: string) => void;
  onStartMarkUnpaid: () => void;
  onCancelMarkUnpaid: () => void;
  onConfirmMarkUnpaid: () => void;
  onStartCancel: () => void;
  onCloseCancel: () => void;
  onCancelReasonPick: (r: string) => void;
  onCancelOtherChange: (v: string) => void;
  onCancelOtherSubmit: () => void;
  onCancelBackStep: () => void;
};

function OrderCard({
  order,
  staffMap,
  onAdvance,
  advancing,
  tick: _tick,
  compact,
  canManagePayments,
  isPayingThis,
  payingError,
  isConfirmingUnpaid,
  markUnpaidError,
  isCancelingThis,
  cancelStep,
  cancelOther,
  cancelSubmitting,
  cancelRpcError,
  onStartPayment,
  onCancelPayment,
  onRecordPayment,
  onStartMarkUnpaid,
  onCancelMarkUnpaid,
  onConfirmMarkUnpaid,
  onStartCancel,
  onCloseCancel,
  onCancelReasonPick,
  onCancelOtherChange,
  onCancelOtherSubmit,
  onCancelBackStep,
}: CardProps) {
  const meta       = STATUS_META[order.status] ?? STATUS_META.pending;
  const next       = NEXT_STATUS[order.status];
  const waiter     = order.handled_by ? (staffMap[order.handled_by] ?? 'Unknown') : '—';
  const isCancelled = order.status === 'cancelled';
  const isActive   = order.status === 'pending' || order.status === 'preparing';

  const paymentRow = !isCancelled && (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <PaymentBadge order={order} staffMap={staffMap} />
      <div className="flex items-center gap-2 shrink-0">
        {!order.is_paid && !isPayingThis && (
          <button
            onClick={onStartPayment}
            className="text-sm font-semibold bg-emerald-600/15 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-600/25 hover:border-emerald-500/50 px-4 py-2.5 rounded-xl transition-colors"
          >
            Record payment
          </button>
        )}
        {order.is_paid && canManagePayments && !isConfirmingUnpaid && (
          <button
            onClick={onStartMarkUnpaid}
            className="text-xs text-[#6B6570] hover:text-[#ff6b6b] border border-white/[0.14] hover:border-[#ff6b6b]/40 px-3 py-2 rounded-lg transition-colors"
          >
            Mark unpaid
          </button>
        )}
        {order.is_paid && canManagePayments && isConfirmingUnpaid && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[#6B6570] text-xs">Reverse payment?</span>
            <button
              onClick={onConfirmMarkUnpaid}
              className="text-xs font-semibold text-[#ff6b6b] hover:bg-[#ff6b6b]/10 px-3 py-1.5 rounded-lg border border-[#ff6b6b]/30 transition-colors"
            >
              Yes, mark unpaid
            </button>
            <button
              onClick={onCancelMarkUnpaid}
              className="text-xs text-[#6B6570] hover:text-[#9a9098] px-2 py-1.5 rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );

  // ── Compact card (served / completed / cancelled) ──────────────────────────
  if (compact) {
    return (
      <div className={`rounded-xl border ${meta.card} bg-transparent overflow-hidden`}>
        <div className="flex items-center gap-4 px-4 py-3">
          <span className={`w-2 h-2 rounded-full shrink-0 ${meta.dot}`} />
          <span className="text-[#9a9098] text-sm font-medium w-16 shrink-0">Table {order.table_number}</span>
          <span className="text-[#6B6570] text-xs flex-1 truncate">
            {order.order_items?.map(i => `${i.item_name} ×${i.quantity}`).join(', ') || '—'}
          </span>
          <span className="text-[#6B6570] text-xs shrink-0">{timeAgo(order.created_at)}</span>
          <span className="text-[#9a9098] text-sm font-semibold shrink-0">{fmt(order.total)}</span>
        </div>
        {!isCancelled && (
          <div className="px-4 pb-3 border-t border-white/[0.04] pt-2.5 space-y-2">
            {paymentRow}
            {isPayingThis && (
              <PaymentMethodPicker
                onSelect={onRecordPayment}
                onCancel={onCancelPayment}
                error={payingError}
              />
            )}
            {markUnpaidError && (
              <p className="text-[#ff6b6b] text-xs">{markUnpaidError}</p>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Full card (active: pending / preparing) ───────────────────────────────
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

      {/* Footer: total + status advance */}
      <div className="flex items-center justify-between pt-3 border-t border-white/[0.06]">
        <span className="text-[#F0EDE8] font-semibold text-sm">{fmt(order.total)}</span>
        {next && onAdvance && (
          <button
            onClick={onAdvance}
            disabled={!!advancing}
            className="bg-[#C41E3A] hover:bg-[#a01830] disabled:opacity-50 text-white text-xs font-semibold px-4 py-2.5 rounded-xl transition-colors"
          >
            {advancing ? 'Updating…' : NEXT_LABEL[order.status]}
          </button>
        )}
      </div>

      {/* Payment section */}
      {!isCancelled && (
        <div className="mt-3 pt-3 border-t border-white/[0.04] space-y-3">
          {paymentRow}
          {isPayingThis && (
            <PaymentMethodPicker
              onSelect={onRecordPayment}
              onCancel={onCancelPayment}
              error={payingError}
            />
          )}
          {markUnpaidError && (
            <p className="text-[#ff6b6b] text-xs">{markUnpaidError}</p>
          )}
        </div>
      )}

      {/* Cancel order section — manager/owner only, active orders only */}
      {canManagePayments && isActive && (
        <div className="mt-3 pt-3 border-t border-white/[0.04]">
          {isCancelingThis ? (
            <CancelOrderPicker
              step={cancelStep}
              otherText={cancelOther}
              submitting={cancelSubmitting}
              error={cancelRpcError}
              onPickReason={onCancelReasonPick}
              onOtherChange={onCancelOtherChange}
              onSubmitOther={onCancelOtherSubmit}
              onBack={onCancelBackStep}
              onClose={onCloseCancel}
            />
          ) : (
            <button
              onClick={onStartCancel}
              className="text-xs text-[#4a4a4a] hover:text-[#ff6b6b] transition-colors"
            >
              Cancel this order
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Cancel order picker (manager/owner direct cancel) ───────────────────────

function CancelOrderPicker({
  step,
  otherText,
  submitting,
  error,
  onPickReason,
  onOtherChange,
  onSubmitOther,
  onBack,
  onClose,
}: {
  step: 'pick' | 'other';
  otherText: string;
  submitting: boolean;
  error: string | null;
  onPickReason: (r: string) => void;
  onOtherChange: (v: string) => void;
  onSubmitOther: () => void;
  onBack: () => void;
  onClose: () => void;
}) {
  return (
    <div>
      <p className="text-[#9a9098] text-xs mb-2 font-medium">
        {step === 'pick' ? 'Reason for cancellation:' : 'Describe the reason:'}
      </p>
      {step === 'pick' ? (
        <div className="flex flex-col gap-1.5">
          {CANCEL_REASONS.map(r => (
            <button
              key={r}
              disabled={submitting}
              onClick={() => onPickReason(r === 'Other' ? '__other__' : r)}
              className="text-left text-sm text-[#c4bec9] hover:text-[#F0EDE8] bg-white/[0.03] hover:bg-[#ff6b6b]/[0.08] border border-white/[0.06] hover:border-[#ff6b6b]/20 rounded-xl px-4 py-3 transition-colors disabled:opacity-50"
            >
              {r}
            </button>
          ))}
          {error && <p className="text-[#ff6b6b] text-xs mt-1">{error}</p>}
          <button
            onClick={onClose}
            className="text-xs text-[#4a4a4a] hover:text-[#6B6570] mt-1 transition-colors"
          >
            Never mind
          </button>
        </div>
      ) : (
        <div>
          <textarea
            rows={2}
            className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-[#F0EDE8] placeholder:text-[#4a4a4a] outline-none focus:border-[#ff6b6b]/40 resize-none mb-2"
            placeholder="e.g. Customer left before order was ready"
            value={otherText}
            onChange={e => onOtherChange(e.target.value)}
            autoFocus
          />
          {error && <p className="text-[#ff6b6b] text-xs mb-2">{error}</p>}
          <div className="flex items-center gap-2">
            <button
              disabled={submitting || !otherText.trim()}
              onClick={onSubmitOther}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-[#ff6b6b]/15 hover:bg-[#ff6b6b]/25 text-[#ff6b6b] border border-[#ff6b6b]/25 transition-colors disabled:opacity-50"
            >
              {submitting ? 'Cancelling…' : 'Cancel order'}
            </button>
            <button
              onClick={onBack}
              className="text-xs text-[#4a4a4a] hover:text-[#6B6570] transition-colors px-2"
            >
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Payment method picker ────────────────────────────────────────────────────

function PaymentMethodPicker({
  onSelect,
  onCancel,
  error,
}: {
  onSelect: (method: string) => void;
  onCancel: () => void;
  error: string | null;
}) {
  const [saving, setSaving] = useState(false);

  async function pick(method: string) {
    setSaving(true);
    await onSelect(method);
    setSaving(false);
  }

  return (
    <div>
      <p className="text-[#9a9098] text-xs mb-2 font-medium">How did they pay?</p>
      <div className="grid grid-cols-3 gap-2">
        {(['cash', 'transfer', 'pos'] as const).map(m => (
          <button
            key={m}
            disabled={saving}
            onClick={() => pick(m)}
            className="py-3 rounded-xl border border-white/10 bg-white/[0.04] hover:bg-emerald-600/20 hover:border-emerald-500/40 text-[#F0EDE8] text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {PAYMENT_LABELS[m]}
          </button>
        ))}
      </div>
      {error && <p className="text-[#ff6b6b] text-xs mt-2">{error}</p>}
      <button
        onClick={onCancel}
        className="mt-2 text-xs text-[#4a4a4a] hover:text-[#6B6570] transition-colors"
      >
        Cancel
      </button>
    </div>
  );
}

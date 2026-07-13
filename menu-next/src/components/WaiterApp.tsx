'use client';

import { createClient } from '@supabase/supabase-js';
import { useState, useEffect, useRef } from 'react';

const SUPABASE_URL     = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const VAPID_PUBLIC_KEY  = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!;

const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { storageKey: 'vw_waiter_auth' },
});

// ── Types ──────────────────────────────────────────────────────────────────────
interface OrderItem  { quantity: number; item_name: string; price: number; }
interface Order {
  id: string;
  table_number: number;
  status: string;
  total: number;
  created_at: string;
  handled_by?: string | null;
  order_items: OrderItem[];
}
interface Call   { id: string; table_number: number; created_at: string; }
interface MenuItem {
  id: string;
  name: string;
  available: boolean;
  menu_categories?: { name: string } | null;
}
interface Toast { id: string; type: 'call' | 'order'; label: string; body: string; }

// ── Utilities ──────────────────────────────────────────────────────────────────
function fmt(n: number) { return '₦' + n.toLocaleString(); }

function elapsedStr(iso: string, now: number) {
  const secs = Math.floor((now - new Date(iso).getTime()) / 1000);
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = String(secs % 60).padStart(2, '0');
  return `${m}m ${s}s`;
}

function urgency(iso: string, now: number): 'normal' | 'warning' | 'urgent' {
  const mins = (now - new Date(iso).getTime()) / 60000;
  if (mins > 10) return 'urgent';
  if (mins > 5)  return 'warning';
  return 'normal';
}

function progressPct(iso: string, now: number, maxMin = 15) {
  return Math.min(((now - new Date(iso).getTime()) / 60000 / maxMin) * 100, 100);
}

function todayDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function playBeep() {
  try {
    const ctx = new ((window as any).AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch { /* audio unavailable */ }
}

function urlBase64ToUint8Array(b64: string) {
  const padding = '='.repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

// ── Icons ──────────────────────────────────────────────────────────────────────
function IcoRefresh() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10"/>
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
    </svg>
  );
}
function IcoAdmin() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
      <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
    </svg>
  );
}
function IcoSignOut() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
      <polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
    </svg>
  );
}

// ── Hourly bar chart (pure SVG) ────────────────────────────────────────────────
function HourlyChart({ orders }: { orders: Order[] }) {
  const buckets = Array.from({ length: 24 }, (_, h) => ({ h, count: 0 }));
  orders.forEach(o => { buckets[new Date(o.created_at).getHours()].count++; });

  // Only show hours that have activity, plus 1 either side
  const active = buckets.filter(b => b.count > 0);
  if (active.length === 0) return null;

  const minH = Math.max(active[0].h - 1, 0);
  const maxH = Math.min(active[active.length - 1].h + 1, 23);
  const visible = buckets.slice(minH, maxH + 1);
  const peak = Math.max(...visible.map(b => b.count), 1);

  return (
    <div className="w-chart-wrap">
      <div className="w-chart-head">
        <span className="w-chart-title">Orders by hour</span>
        <span className="w-chart-sub">Today · {orders.length} total</span>
      </div>
      <div className="w-bar-chart">
        {visible.map(({ h, count }) => {
          const pct = (count / peak) * 100;
          const isPeak = count === peak && count > 0;
          return (
            <div key={h} className="w-bar-col">
              <div
                className={`w-bar-fill${isPeak ? ' peak' : ''}`}
                style={{ height: `${Math.max(pct, 2)}%` }}
                title={`${count} orders`}
              />
              <span className="w-bar-label">{h}h</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function WaiterApp({ slug }: { slug: string | null }) {
  const [isLoggedIn,   setIsLoggedIn]   = useState(false);
  const [loginCode,    setLoginCode]    = useState('');
  const [loginError,   setLoginError]   = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  const [staffName,  setStaffName]  = useState('');
  const [isManager,  setIsManager]  = useState(false);
  const [myTables,   setMyTables]   = useState<Set<number>>(new Set());
  const [orders,     setOrders]     = useState<Order[]>([]);
  const [calls,      setCalls]      = useState<Call[]>([]);
  const [menuItems,  setMenuItems]  = useState<MenuItem[]>([]);
  const [shiftHistory, setShiftHistory] = useState<Order[]>([]);
  const [activeTab,  setActiveTab]  = useState<'live' | 'shift'>('live');
  const [toasts,     setToasts]     = useState<Toast[]>([]);
  const [tick,       setTick]       = useState(0);

  const ridRef     = useRef<string | null>(null);
  const othersRef  = useRef<Set<number>>(new Set());
  const rtRef      = useRef<ReturnType<typeof db.channel> | null>(null);

  // 1-second tick for live timers
  useEffect(() => {
    const iv = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(iv);
  }, []);

  // ── Toast helper ────────────────────────────────────────────────────────────
  function addToast(t: Omit<Toast, 'id'>) {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { ...t, id }]);
    setTimeout(() => setToasts(prev => prev.filter(x => x.id !== id)), 4500);
  }

  // ── Data fetchers ────────────────────────────────────────────────────────────
  async function loadAssignments(rid: string) {
    const { data: { user } } = await db.auth.getUser();
    if (!user) return;
    const { data } = await db
      .from('shift_assignments')
      .select('waiter_id, tables(table_number)')
      .eq('restaurant_id', rid)
      .eq('assigned_date', todayDate());
    const my = new Set<number>(), others = new Set<number>();
    (data || []).forEach((a: any) => {
      const num = a.tables?.table_number;
      if (num == null) return;
      (a.waiter_id === user.id ? my : others).add(num);
    });
    setMyTables(my);
    othersRef.current = others;
  }

  async function fetchOrders(rid: string) {
    let q = db.from('orders').select('*, order_items(*)')
      .eq('restaurant_id', rid).in('status', ['pending', 'preparing'])
      .order('created_at', { ascending: true });
    if (othersRef.current.size > 0)
      q = q.not('table_number', 'in', `(${[...othersRef.current].join(',')})`);
    const { data } = await q;
    setOrders(data || []);
  }

  async function fetchCalls(rid: string) {
    let q = db.from('waiter_calls').select('*')
      .eq('restaurant_id', rid).eq('status', 'pending')
      .order('created_at', { ascending: true });
    if (othersRef.current.size > 0)
      q = q.not('table_number', 'in', `(${[...othersRef.current].join(',')})`);
    const { data } = await q;
    setCalls(data || []);
  }

  async function fetchMenuItems(rid: string) {
    const { data } = await db.from('menu_items')
      .select('id, name, available, menu_categories(name)')
      .eq('restaurant_id', rid).order('name');
    setMenuItems((data || []) as unknown as MenuItem[]);
  }

  async function fetchShiftHistory(rid: string) {
    const { data: { user } } = await db.auth.getUser();
    if (!user) return;
    const ago = new Date(); ago.setDate(ago.getDate() - 7);
    const { data } = await db.from('orders').select('*, order_items(*)')
      .eq('restaurant_id', rid).eq('handled_by', user.id)
      .gte('created_at', ago.toISOString()).order('created_at', { ascending: false });
    setShiftHistory(data || []);
  }

  async function loadProfile(rid: string) {
    const { data: { user } } = await db.auth.getUser();
    if (!user) return;
    const [pr, rr] = await Promise.all([
      db.from('staff').select('name').eq('id', user.id).single(),
      db.from('staff').select('role').eq('id', user.id).single(),
    ]);
    if (pr.data?.name)       setStaffName(pr.data.name);
    if (rr.data?.role === 'manager') setIsManager(true);
  }

  function startRealtime(rid: string) {
    if (rtRef.current) return;
    rtRef.current = db.channel('waiter-' + rid)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders',
          filter: `restaurant_id=eq.${rid}` }, (payload) => {
        playBeep();
        addToast({ type: 'order', label: 'New order', body: `Table ${(payload.new as any).table_number}` });
        fetchOrders(rid);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders',
          filter: `restaurant_id=eq.${rid}` }, () => fetchOrders(rid))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'order_items' },
          () => fetchOrders(rid))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'waiter_calls',
          filter: `restaurant_id=eq.${rid}` }, (payload) => {
        playBeep();
        addToast({ type: 'call', label: 'Waiter called', body: `Table ${(payload.new as any).table_number}` });
        fetchCalls(rid);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'waiter_calls',
          filter: `restaurant_id=eq.${rid}` }, () => fetchCalls(rid))
      .subscribe();
  }

  async function initPushSubscription() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
      const j = sub.toJSON();
      const rid = ridRef.current;
      if (!rid || !j.keys) return;
      await db.from('push_subscriptions').upsert({
        restaurant_id: rid, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth,
      }, { onConflict: 'endpoint' });
    } catch { /* push unavailable */ }
  }

  async function startDashboard(rid: string) {
    ridRef.current = rid;
    await loadAssignments(rid);
    await Promise.all([loadProfile(rid), fetchOrders(rid), fetchCalls(rid), fetchMenuItems(rid)]);
    startRealtime(rid);
    initPushSubscription();
  }

  // ── Auth init ────────────────────────────────────────────────────────────────
  useEffect(() => {
    async function init() {
      const { data: { session } } = await db.auth.getSession();
      if (session) {
        const { data: row } = await db.from('staff').select('restaurant_id').eq('id', session.user.id).single();
        if (row?.restaurant_id) { await startDashboard(row.restaurant_id); setIsLoggedIn(true); }
      }
    }
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 30-second polling
  useEffect(() => {
    if (!isLoggedIn) return;
    const iv = setInterval(async () => {
      const rid = ridRef.current; if (!rid) return;
      await loadAssignments(rid); fetchOrders(rid); fetchCalls(rid);
    }, 30000);
    return () => clearInterval(iv);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn]);

  // Realtime cleanup
  useEffect(() => () => {
    if (rtRef.current) { db.removeChannel(rtRef.current); rtRef.current = null; }
  }, []);

  // ── Actions ──────────────────────────────────────────────────────────────────
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError(''); setLoginLoading(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/waiter-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ access_code: loginCode.toUpperCase(), slug }),
      });
      const result = await res.json();
      if (!res.ok || result.error) { setLoginError('Invalid code — check with your manager.'); return; }
      const { error: se } = await db.auth.verifyOtp({ token_hash: result.hashed_token, type: 'magiclink' });
      if (se) { setLoginError('Login failed — please try again.'); return; }
      await startDashboard(result.staff.restaurant_id);
      setIsLoggedIn(true);
    } catch { setLoginError('Connection error — please try again.'); }
    finally { setLoginLoading(false); }
  }

  async function handleLogout() {
    await db.auth.signOut();
    if (rtRef.current) { db.removeChannel(rtRef.current); rtRef.current = null; }
    ridRef.current = null; othersRef.current = new Set();
    setIsLoggedIn(false); setStaffName(''); setIsManager(false);
    setOrders([]); setCalls([]); setMenuItems([]); setShiftHistory([]); setMyTables(new Set());
  }

  async function updateOrderStatus(orderId: string, status: string) {
    const payload: Record<string, unknown> = { status };
    if (status === 'preparing') {
      const { data: { user } } = await db.auth.getUser();
      if (user) payload.handled_by = user.id;
    }
    await db.from('orders').update(payload).eq('id', orderId);
    const rid = ridRef.current; if (rid) fetchOrders(rid);
  }

  async function acknowledgeCall(callId: string) {
    await db.from('waiter_calls').update({ status: 'acknowledged' }).eq('id', callId);
    const rid = ridRef.current; if (rid) fetchCalls(rid);
  }

  async function toggleMenuItem(itemId: string, available: boolean) {
    setMenuItems(prev => prev.map(i => i.id === itemId ? { ...i, available } : i));
    const { error } = await db.from('menu_items').update({ available }).eq('id', itemId);
    if (error) setMenuItems(prev => prev.map(i => i.id === itemId ? { ...i, available: !available } : i));
  }

  async function handleTabChange(tab: 'live' | 'shift') {
    setActiveTab(tab);
    if (tab === 'shift') { const rid = ridRef.current; if (rid) fetchShiftHistory(rid); }
  }

  async function handleRefresh() {
    const rid = ridRef.current; if (!rid) return;
    await loadAssignments(rid);
    fetchOrders(rid); fetchCalls(rid); fetchMenuItems(rid);
  }

  // ── Derived ──────────────────────────────────────────────────────────────────
  const now = Date.now() + tick * 0; // tick forces re-render each second
  const _ = tick; void _; // ensure tick is read

  const tableBadge = myTables.size > 0
    ? `Tables ${[...myTables].sort((a, b) => a - b).join(', ')}`
    : 'No tables assigned';

  const todayStr = new Date().toLocaleDateString('en-NG');
  const todayOrders = shiftHistory.filter(o => new Date(o.created_at).toLocaleDateString('en-NG') === todayStr);
  const todayRevenue = todayOrders.reduce((s, o) => s + o.total, 0);

  const groupedHistory = shiftHistory.reduce<Record<string, Order[]>>((acc, order) => {
    const key = new Date(order.created_at).toLocaleDateString('en-NG', {
      weekday: 'long', year: 'numeric', month: 'short', day: 'numeric',
    });
    (acc[key] = acc[key] || []).push(order);
    return acc;
  }, {});

  // ── Login screen ──────────────────────────────────────────────────────────────
  if (!isLoggedIn) {
    return (
      <div className="waiter-root w-login-wrap">
        <form className="w-login-card" onSubmit={handleLogin}>
          <div className="w-login-logo">
            <div className="w-login-mark"><span>VW</span></div>
            <div>
              <div className="w-login-name">Virtual Waitress</div>
              <div className="w-login-sub">Staff Portal</div>
            </div>
          </div>
          <h1 className="w-login-title">Sign in</h1>
          <p className="w-login-desc">Enter your access code to view your live dashboard.</p>
          <div className="w-field">
            <label htmlFor="wCode">Access Code</label>
            <input
              id="wCode"
              type="text"
              placeholder="WTR-XXXX"
              value={loginCode}
              onChange={e => setLoginCode(e.target.value.toUpperCase())}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              required
            />
          </div>
          <p className="w-login-error">{loginError}</p>
          <button type="submit" className="w-btn-primary" disabled={loginLoading}>
            {loginLoading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    );
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────────
  const nowMs = Date.now();

  return (
    <div className="waiter-root w-shell">

      {/* Toasts */}
      <div className="w-toasts">
        {toasts.map(t => (
          <div key={t.id} className={`w-toast ${t.type}`}>
            <div className="w-toast-label">{t.label}</div>
            {t.body}
          </div>
        ))}
      </div>

      {/* Top bar */}
      <header className="w-topbar">
        <div className="w-topbar-left">
          <div className="w-topbar-mark"><span>VW</span></div>
          <span className="w-topbar-name">{staffName || 'Staff Dashboard'}</span>
          <span className="w-topbar-table">{tableBadge}</span>
        </div>
        <div className="w-topbar-right">
          <button className="w-icon-btn" onClick={handleRefresh} title="Refresh">
            <IcoRefresh />
          </button>
          {isManager && (
            <a className="w-icon-btn" href="https://dashboard.virtualwaitress.com" title="Admin dashboard">
              <IcoAdmin />
            </a>
          )}
          <button className="w-icon-btn danger" onClick={handleLogout} title="Sign out">
            <IcoSignOut />
          </button>
        </div>
      </header>

      {/* Tabs */}
      <nav className="w-tabs">
        <button
          className={`w-tab${activeTab === 'live' ? ' active' : ''}`}
          onClick={() => handleTabChange('live')}
        >
          <span className="w-live-dot" />
          Live
        </button>
        <button
          className={`w-tab${activeTab === 'shift' ? ' active' : ''}`}
          onClick={() => handleTabChange('shift')}
        >
          My Shift
        </button>
      </nav>

      {/* ── Live view ── */}
      {activeTab === 'live' && (
        <div className="w-live">

          {/* Calls column */}
          <div className="w-col">
            <div className="w-col-head">
              <span className="w-col-title">Calls</span>
              <span className={`w-col-count${calls.length > 0 ? ' has-items' : ''}`}>{calls.length}</span>
            </div>
            <div className="w-col-body">
              {calls.length === 0 ? (
                <p className="w-empty">No active calls</p>
              ) : calls.map(call => {
                const u = urgency(call.created_at, nowMs);
                return (
                  <div key={call.id} className={`w-card ${u}`}>
                    <div className="w-card-row">
                      <span className="w-card-table">Table {call.table_number}</span>
                      <span className={`w-timer ${u}`}>{elapsedStr(call.created_at, nowMs)}</span>
                    </div>
                    <div className="w-progress">
                      <div
                        className={`w-progress-fill ${u}`}
                        style={{ width: `${progressPct(call.created_at, nowMs, 10)}%` }}
                      />
                    </div>
                    <div className="w-actions">
                      <button className="w-action-btn primary" onClick={() => acknowledgeCall(call.id)}>
                        Acknowledge
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Orders column */}
          <div className="w-col">
            <div className="w-col-head">
              <span className="w-col-title">Orders</span>
              <span className={`w-col-count${orders.length > 0 ? ' has-items' : ''}`}>{orders.length}</span>
            </div>
            <div className="w-col-body">
              {orders.length === 0 ? (
                <p className="w-empty">No active orders</p>
              ) : orders.map(order => {
                const isPreparing = order.status === 'preparing';
                const u = urgency(order.created_at, nowMs);
                return (
                  <div key={order.id} className={`w-card ${u}`}>
                    <div className="w-card-row" style={{ marginBottom: 6 }}>
                      <span className="w-card-table">Table {order.table_number}</span>
                      <span className={`w-badge ${order.status}`}>
                        <span className="w-badge-dot" />
                        {isPreparing ? 'Preparing' : 'Pending'}
                      </span>
                    </div>
                    <div className="w-progress">
                      <div
                        className={`w-progress-fill ${u}`}
                        style={{ width: `${progressPct(order.created_at, nowMs)}%` }}
                      />
                    </div>
                    <div className="w-items">
                      {(order.order_items || []).map((item, idx) => (
                        <div key={idx} className="w-item-row">
                          <span>{item.quantity}× {item.item_name}</span>
                          <span>{fmt(item.quantity * item.price)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="w-item-total">
                      {fmt(order.total)}
                      <span style={{ marginLeft: 8, fontSize: '0.72rem', fontWeight: 400, color: 'var(--w-faint, #4a4a4a)', fontVariantNumeric: 'tabular-nums' }}>
                        {elapsedStr(order.created_at, nowMs)}
                      </span>
                    </div>
                    <div className="w-actions">
                      <button
                        className="w-action-btn primary"
                        onClick={() => updateOrderStatus(order.id, isPreparing ? 'served' : 'preparing')}
                      >
                        {isPreparing ? 'Mark Served' : 'Start Preparing'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Menu column */}
          <div className="w-col">
            <div className="w-col-head">
              <span className="w-col-title">Menu</span>
              <span className="w-col-count">{menuItems.length}</span>
            </div>
            <div className="w-col-body">
              {menuItems.length === 0 ? (
                <p className="w-empty">No items loaded</p>
              ) : menuItems.map(item => (
                <div key={item.id} className="w-card w-toggle-card">
                  <div className="w-toggle-info">
                    <span className="w-toggle-name">{item.name}</span>
                    <span className="w-toggle-cat">{item.menu_categories?.name ?? ''}</span>
                  </div>
                  <label className="w-switch">
                    <input
                      type="checkbox"
                      checked={item.available}
                      onChange={e => toggleMenuItem(item.id, e.target.checked)}
                    />
                    <span className="w-slider" />
                  </label>
                </div>
              ))}
            </div>
          </div>

        </div>
      )}

      {/* ── Shift view ── */}
      {activeTab === 'shift' && (
        <div className="w-shift">

          {/* Stat chips */}
          <div className="w-shift-stats">
            <div className="w-stat-chip">
              <div className="w-stat-label">Today&apos;s Orders</div>
              <div className="w-stat-value">{todayOrders.length}</div>
            </div>
            <div className="w-stat-chip">
              <div className="w-stat-label">Today&apos;s Revenue</div>
              <div className="w-stat-value accent">{fmt(todayRevenue)}</div>
            </div>
          </div>

          {/* Hourly chart */}
          {todayOrders.length > 0 && <HourlyChart orders={todayOrders} />}

          {/* History */}
          {shiftHistory.length === 0 ? (
            <p className="w-empty" style={{ textAlign: 'left', paddingTop: 0 }}>No orders in the last 7 days</p>
          ) : Object.entries(groupedHistory).map(([date, dayOrders]) => {
            const dayTotal = dayOrders.reduce((s, o) => s + o.total, 0);
            return (
              <div key={date} className="w-day-group">
                <div className="w-day-header">
                  <span className="w-day-date">{date}</span>
                  <span className="w-day-summary">
                    {dayOrders.length} order{dayOrders.length !== 1 ? 's' : ''} · {fmt(dayTotal)}
                  </span>
                </div>
                <div className="w-history-list">
                  {dayOrders.map(order => {
                    const items = (order.order_items || []).map(i => `${i.quantity}× ${i.item_name}`).join(', ');
                    const time  = new Date(order.created_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });
                    return (
                      <div key={order.id} className="w-history-card">
                        <div className="w-history-row">
                          <span className="w-history-table">Table {order.table_number}</span>
                          <span className="w-history-time">{time}</span>
                        </div>
                        <div className="w-history-items">{items || '—'}</div>
                        <div className="w-history-total">{fmt(order.total)}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

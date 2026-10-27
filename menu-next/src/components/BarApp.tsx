'use client';

import { createClient } from '@supabase/supabase-js';
import { useState, useEffect, useRef, useCallback } from 'react';

const SUPABASE_URL      = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { storageKey: 'vw_bar_auth' },
});

// ── Types ──────────────────────────────────────────────────────────────────────
interface BarItem {
  id: string;
  order_id: string;
  item_name: string;
  quantity: number;
  item_status: string;
  station: string | null;
}

interface BarOrder {
  id: string;
  table_number: number | null;
  source: string;
  status: string;
  created_at: string;
  items: BarItem[];
}

interface MenuItem {
  id: string;
  name: string;
  price: number;
  station: string | null;
  available: boolean | null;
  category_id: string | null;
}

interface MenuCategory {
  id: string;
  name: string;
  emoji: string | null;
}

// ── Audio ─────────────────────────────────────────────────────────────────────
function playChime() {
  try {
    const AudioCtx = (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    const ctx = new (window.AudioContext ?? AudioCtx!)();
    [880, 1100].forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.12;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.22, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
      osc.start(t);
      osc.stop(t + 0.55);
    });
  } catch { /* audio unavailable */ }
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function elapsed(iso: string, now: number): string {
  const secs = Math.floor((now - new Date(iso).getTime()) / 1000);
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function urgency(iso: string, now: number): 'normal' | 'warn' | 'urgent' {
  const m = (now - new Date(iso).getTime()) / 60000;
  if (m > 8) return 'urgent';
  if (m > 4) return 'warn';
  return 'normal';
}

// ── Styles ───────────────────────────────────────────────────────────────────
const S = {
  page:           { background: '#0a0a0a', minHeight: '100dvh', display: 'flex', flexDirection: 'column' as const, fontFamily: 'system-ui, -apple-system, sans-serif' },
  connBanner:     { background: '#dc2626', padding: '10px 16px', textAlign: 'center' as const, fontSize: 15, fontWeight: 700, color: '#fff', letterSpacing: '0.04em', flexShrink: 0 },
  header:         { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #1f1f1f', flexShrink: 0 },
  headerLeft:     { display: 'flex', alignItems: 'center', gap: 10 },
  connDot:        { width: 10, height: 10, borderRadius: '50%', flexShrink: 0 },
  headerLabel:    { color: '#9a9098', fontSize: 13, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' as const },
  headerRight:    { display: 'flex', alignItems: 'center', gap: 8 },
  audioBtn:       { padding: '6px 14px', background: '#1f1f1f', border: '1px solid #333', borderRadius: 8, color: '#9a9098', fontSize: 12, cursor: 'pointer' },
  counterBtn:     { padding: '6px 14px', background: '#1f1f1f', border: '1px solid #C41E3A', borderRadius: 8, color: '#C41E3A', fontSize: 12, fontWeight: 600, cursor: 'pointer', touchAction: 'manipulation' as const },
  board:          { flex: 1, overflowY: 'auto' as const, padding: '16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16, alignContent: 'start' },
  empty:          { gridColumn: '1 / -1', textAlign: 'center' as const, color: '#333', fontSize: 20, fontWeight: 600, padding: '80px 0' },
  card:           { background: '#141414', border: '1px solid #252525', borderRadius: 16, padding: '20px 20px 16px', display: 'flex', flexDirection: 'column' as const, gap: 14 },
  cardTop:        { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' },
  tableLabel:     { fontSize: 32, fontWeight: 800, lineHeight: 1, color: '#F0EDE8', letterSpacing: '-0.02em' },
  sourceLabel:    { fontSize: 12, color: '#6B6570', marginTop: 4, fontWeight: 500 },
  timeLabel:      { fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums' },
  divider:        { borderColor: '#252525', borderStyle: 'solid', borderTopWidth: 1 },
  itemRow:        { display: 'flex', alignItems: 'baseline', gap: 8, color: '#c4bec9', fontSize: 16, lineHeight: 1.4 },
  qty:            { color: '#F0EDE8', fontWeight: 700, minWidth: 24, fontSize: 18 },
  readyBtn:       { width: '100%', padding: '16px 0', borderRadius: 12, border: 'none', fontSize: 18, fontWeight: 800, letterSpacing: '0.04em', cursor: 'pointer', transition: 'opacity 0.1s' },
  // pairing
  pairPage:       { background: '#0a0a0a', minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, -apple-system, sans-serif', padding: 24 },
  pairBox:        { width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column' as const, gap: 24 },
  pairTitle:      { color: '#F0EDE8', fontSize: 24, fontWeight: 800, textAlign: 'center' as const, letterSpacing: '-0.01em', margin: 0 },
  pairSub:        { color: '#6B6570', fontSize: 14, textAlign: 'center' as const, marginTop: 8 },
  pairInput:      { background: '#1a1a1a', border: '1px solid #333', borderRadius: 12, padding: '18px 20px', color: '#F0EDE8', fontSize: 28, fontWeight: 700, textAlign: 'center' as const, letterSpacing: '0.2em', outline: 'none', width: '100%', boxSizing: 'border-box' as const, textTransform: 'uppercase' as const },
  pairBtn:        { width: '100%', padding: '16px 0', background: '#C41E3A', border: 'none', borderRadius: 12, color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer', boxSizing: 'border-box' as const },
  pairErr:        { background: '#dc2626/10', border: '1px solid rgba(220,38,38,0.3)', borderRadius: 10, padding: '12px 16px', color: '#f87171', fontSize: 14, textAlign: 'center' as const },
  // counter entry panel
  counterOverlay:     { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 100, display: 'flex', flexDirection: 'column' as const, justifyContent: 'flex-end' },
  counterPanel:       { background: '#141414', borderRadius: '20px 20px 0 0', maxHeight: '85dvh', display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' },
  counterHeader:      { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px 12px', borderBottom: '1px solid #1f1f1f', flexShrink: 0 },
  counterScrollArea:  { flex: 1, overflowY: 'auto' as const, padding: '0 16px' },
  counterCatHd:       { color: '#6B6570', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' as const, padding: '14px 0 6px' },
  counterItemRow:     { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #1a1a1a' },
  counterItemName:    { color: '#F0EDE8', fontSize: 15, fontWeight: 500 },
  counterItemPrice:   { color: '#6B6570', fontSize: 13, marginTop: 2 },
  counterQtyRow:      { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 },
  counterQtyBtn:      { width: 44, height: 44, borderRadius: 12, border: 'none', fontSize: 22, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: 'manipulation' as const },
  counterQtyNum:      { color: '#F0EDE8', fontSize: 17, fontWeight: 700, minWidth: 22, textAlign: 'center' as const },
  counterFooter:      { padding: '16px 20px 20px', borderTop: '1px solid #1f1f1f', flexShrink: 0, display: 'flex', flexDirection: 'column' as const, gap: 10 },
  counterTableInput:  { background: '#1a1a1a', border: '1px solid #333', borderRadius: 10, padding: '12px 16px', color: '#F0EDE8', fontSize: 15, outline: 'none', width: '100%', boxSizing: 'border-box' as const },
  counterSaveBtn:     { width: '100%', padding: '16px 0', background: '#C41E3A', border: 'none', borderRadius: 12, color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer', touchAction: 'manipulation' as const },
  counterCancelBtn:   { width: '100%', padding: '12px 0', background: 'transparent', border: '1px solid #2a2a2a', borderRadius: 12, color: '#6B6570', fontSize: 15, cursor: 'pointer' },
};

// ── Component ─────────────────────────────────────────────────────────────────
export default function BarApp() {
  const [phase, setPhase]               = useState<'checking' | 'pair' | 'live'>('checking');
  const [pairCode, setPairCode]         = useState('');
  const [pairError, setPairError]       = useState('');
  const [pairLoading, setPairLoading]   = useState(false);
  const [connected, setConnected]       = useState(false);
  const [orders, setOrders]             = useState<BarOrder[]>([]);
  const [now, setNow]                   = useState(Date.now());
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [pendingChime, setPendingChime] = useState(false);
  const [readying, setReadying]         = useState<Record<string, boolean>>({});
  // counter entry
  const [deviceId, setDeviceId]         = useState<string | null>(null);
  const [restaurantId, setRestaurantId] = useState<string | null>(null);
  const [menuItems, setMenuItems]       = useState<MenuItem[]>([]);
  const [menuCats, setMenuCats]         = useState<MenuCategory[]>([]);
  const [counterOpen, setCounterOpen]   = useState(false);
  const [cart, setCart]                 = useState<Record<string, { qty: number; price: number; name: string }>>({});
  const [counterTable, setCounterTable] = useState('');
  const [counterSaving, setCounterSaving] = useState(false);
  const [counterError, setCounterError] = useState<string | null>(null);

  const rtRef            = useRef<ReturnType<typeof db.channel> | null>(null);
  const prevCountRef     = useRef(0);
  const audioUnlockedRef = useRef(false);
  const cleanupRef       = useRef<(() => void) | null>(null);
  const counterSavingRef = useRef(false);

  // Clock tick for elapsed times
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  // Check existing session on mount
  useEffect(() => {
    (async () => {
      const { data: { session } } = await db.auth.getSession();
      if (!session) { setPhase('pair'); return; }
      const { data: device } = await db
        .from('devices')
        .select('id, restaurant_id, revoked_at')
        .eq('auth_user_id', session.user.id)
        .maybeSingle();
      if (!device || device.revoked_at) {
        await db.auth.signOut();
        setPhase('pair');
        return;
      }
      setDeviceId(device.id);
      setRestaurantId(device.restaurant_id);
      setPhase('live');
    })();
  }, []);

  // Start realtime + polling when phase becomes 'live'
  useEffect(() => {
    if (phase !== 'live') return;
    const cleanup = startLive();
    cleanupRef.current = cleanup;
    return cleanup;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const loadOrders = useCallback(async () => {
    const [{ data: rawOrders }, { data: rawItems }] = await Promise.all([
      db.from('orders')
        .select('id, table_number, source, status, created_at')
        .eq('status', 'pending')
        .order('created_at', { ascending: true }),
      db.from('order_items_for_device')
        .select('id, order_id, item_name, quantity, item_status, station'),
    ]);

    const itemsByOrder: Record<string, BarItem[]> = {};
    for (const item of rawItems ?? []) {
      if (!itemsByOrder[item.order_id]) itemsByOrder[item.order_id] = [];
      itemsByOrder[item.order_id].push(item);
    }

    const enriched: BarOrder[] = (rawOrders ?? [])
      .map(o => ({
        ...o,
        items: (itemsByOrder[o.id] ?? []).filter(i => i.item_status !== 'void'),
      }))
      .filter(o => o.items.length > 0);

    const prevCount = prevCountRef.current;
    prevCountRef.current = enriched.length;

    if (enriched.length > prevCount) {
      if (audioUnlockedRef.current) {
        playChime();
      } else {
        setPendingChime(true);
      }
    }

    setOrders(enriched);
  }, []);

  function startLive() {
    loadOrders();

    const pollIv = setInterval(loadOrders, 30000);

    const onVisible = () => {
      if (document.visibilityState === 'visible') loadOrders();
    };
    document.addEventListener('visibilitychange', onVisible);

    // Heartbeat — keeps last_seen_at current so admin can tell the device is alive
    const heartbeatIv = setInterval(async () => {
      const { data: { session } } = await db.auth.getSession();
      if (!session) return;
      await db.from('devices')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('auth_user_id', session.user.id);
    }, 30000);

    const channel = db.channel('bar-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, () => {
        loadOrders();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, (payload) => {
        const status = (payload.new as { status: string }).status;
        if (status === 'served' || status === 'cancelled' || status === 'ready') {
          setOrders(prev => prev.filter(o => o.id !== (payload.new as { id: string }).id));
        } else {
          loadOrders();
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'order_items' }, () => {
        loadOrders();
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await loadOrders();
          setConnected(true);
        } else {
          setConnected(false);
        }
      });

    rtRef.current = channel;

    return () => {
      clearInterval(pollIv);
      clearInterval(heartbeatIv);
      document.removeEventListener('visibilitychange', onVisible);
      db.removeChannel(channel);
      rtRef.current = null;
    };
  }

  async function handlePair(e: React.FormEvent) {
    e.preventDefault();
    setPairError('');
    setPairLoading(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/pair-device`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ code: pairCode.toUpperCase() }),
      });
      const result = await res.json();
      if (!res.ok || result.error) {
        setPairError(result.error || 'Invalid code — check with your manager.');
        return;
      }
      const { error: otpErr } = await db.auth.verifyOtp({
        token_hash: result.hashed_token,
        type: 'magiclink',
      });
      if (otpErr) { setPairError('Pairing failed — please try again.'); return; }
      // fetch device id and restaurant for counter entry
      const { data: { session: newSess } } = await db.auth.getSession();
      if (newSess) {
        const { data: dev } = await db
          .from('devices')
          .select('id, restaurant_id')
          .eq('auth_user_id', newSess.user.id)
          .maybeSingle();
        if (dev) { setDeviceId(dev.id); setRestaurantId(dev.restaurant_id); }
      }
      setPhase('live');
    } catch {
      setPairError('Connection error — check your network.');
    } finally {
      setPairLoading(false);
    }
  }

  function unlockAudio() {
    audioUnlockedRef.current = true;
    setAudioUnlocked(true);
    if (pendingChime) {
      playChime();
      setPendingChime(false);
    }
  }

  async function handleReady(orderId: string) {
    if (!audioUnlockedRef.current) unlockAudio();
    setReadying(prev => ({ ...prev, [orderId]: true }));
    try {
      await db.from('orders').update({ status: 'ready' }).eq('id', orderId);
      setOrders(prev => prev.filter(o => o.id !== orderId));
    } finally {
      setReadying(prev => { const n = { ...prev }; delete n[orderId]; return n; });
    }
  }

  async function loadMenu() {
    if (!restaurantId) return;
    const { data } = await db
      .from('menu_items')
      .select('id, name, price, station, available, category_id, menu_categories(id, name, emoji)')
      .eq('restaurant_id', restaurantId)
      .order('sort_order');
    if (!data) return;
    const cats: MenuCategory[] = [];
    const seenCatIds = new Set<string>();
    const items: MenuItem[] = (data as unknown as Array<{
      id: string; name: string; price: number; station: string | null;
      available: boolean | null; category_id: string | null;
      menu_categories: { id: string; name: string; emoji: string | null } | null;
    }>).map(row => {
      const cat = row.menu_categories;
      if (cat && !seenCatIds.has(cat.id)) {
        seenCatIds.add(cat.id);
        cats.push({ id: cat.id, name: cat.name, emoji: cat.emoji });
      }
      return { id: row.id, name: row.name, price: row.price, station: row.station, available: row.available, category_id: row.category_id };
    });
    setMenuItems(items);
    setMenuCats(cats);
  }

  async function handleCounterSave() {
    if (!deviceId || !restaurantId) return;
    const cartEntries = Object.entries(cart).filter(([, c]) => c.qty > 0);
    if (cartEntries.length === 0) return;
    if (counterSavingRef.current) return;
    counterSavingRef.current = true;
    setCounterSaving(true);
    setCounterError(null);
    try {
      const total = cartEntries.reduce((s, [, c]) => s + c.qty * c.price, 0);
      const tableNumRaw = counterTable.trim() ? parseInt(counterTable.trim(), 10) : null;
      const tableNum = tableNumRaw !== null && !isNaN(tableNumRaw) ? tableNumRaw : null;
      const orderPayload: Record<string, unknown> = {
        restaurant_id: restaurantId,
        source: 'counter',
        ordered_by: null,
        entered_by_device: deviceId,
        total,
        status: 'pending',
      };
      if (tableNum !== null) orderPayload.table_number = tableNum;
      const { data: order, error: orderErr } = await db
        .from('orders')
        .insert(orderPayload)
        .select('id')
        .single();
      if (orderErr || !order) throw orderErr ?? new Error('order insert failed');
      const { error: itemsErr } = await db.from('order_items').insert(
        cartEntries.map(([itemId, c]) => {
          const mi = menuItems.find(m => m.id === itemId);
          return {
            order_id: order.id,
            menu_item_id: itemId,
            item_name: c.name,
            quantity: c.qty,
            price: c.price,
            station: mi?.station ?? null,
          };
        })
      );
      if (itemsErr) throw itemsErr;
      setCounterOpen(false);
      setCart({});
      setCounterTable('');
    } catch (err: unknown) {
      setCounterError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
    } finally {
      counterSavingRef.current = false;
      setCounterSaving(false);
    }
  }

  function closeCounter() {
    if (counterSaving) return;
    setCounterOpen(false);
    setCart({});
    setCounterTable('');
    setCounterError(null);
  }

  const cartTotal = Object.values(cart).reduce((s, c) => s + c.qty * c.price, 0);
  const cartHasItems = Object.keys(cart).length > 0;

  // ── Phases ─────────────────────────────────────────────────────────────────

  if (phase === 'checking') {
    return (
      <div style={{ ...S.page, alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#555', fontSize: 15 }}>Loading…</div>
      </div>
    );
  }

  if (phase === 'pair') {
    return (
      <div style={S.pairPage}>
        <div style={S.pairBox}>
          <div>
            <h1 style={S.pairTitle}>Bar Screen</h1>
            <p style={S.pairSub}>Enter the pairing code from your manager</p>
          </div>

          <form onSubmit={handlePair} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input
              style={S.pairInput}
              type="text"
              inputMode="text"
              maxLength={6}
              value={pairCode}
              onChange={e => setPairCode(e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ''))}
              placeholder="XXXXXX"
              autoFocus
              autoComplete="off"
            />
            {pairError && <p style={S.pairErr}>{pairError}</p>}
            <button
              type="submit"
              style={{ ...S.pairBtn, opacity: pairLoading ? 0.6 : 1 }}
              disabled={pairLoading || pairCode.length < 6}
            >
              {pairLoading ? 'Pairing…' : 'Pair this screen'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ── Live board ──────────────────────────────────────────────────────────────
  return (
    <div style={S.page}>

      {/* Disconnected banner */}
      {!connected && (
        <div style={S.connBanner}>
          DISCONNECTED — reconnecting…
        </div>
      )}

      {/* Header */}
      <div style={S.header}>
        <div style={S.headerLeft}>
          <div style={{ ...S.connDot, background: connected ? '#22c55e' : '#555' }} />
          <span style={S.headerLabel}>Bar Screen</span>
        </div>
        <div style={S.headerRight}>
          {!audioUnlocked && (
            <button style={S.audioBtn} onClick={unlockAudio}>
              🔇 Tap to enable sound
            </button>
          )}
          <button
            style={S.counterBtn}
            onClick={() => { setCounterOpen(true); loadMenu(); }}
          >
            + Counter
          </button>
        </div>
      </div>

      {/* Order board */}
      <div style={S.board}>
        {orders.length === 0 ? (
          <div style={S.empty}>No pending orders</div>
        ) : (
          orders.map(order => {
            const u = urgency(order.created_at, now);
            const timeColor = u === 'urgent' ? '#ef4444' : u === 'warn' ? '#f59e0b' : '#6B6570';
            const cardBorder = u === 'urgent' ? '1px solid rgba(239,68,68,0.35)' : u === 'warn' ? '1px solid rgba(245,158,11,0.25)' : '1px solid #252525';
            const btnBg = readying[order.id] ? '#555' : '#16a34a';

            return (
              <div key={order.id} style={{ ...S.card, border: cardBorder }}>
                {/* Top row: table + time */}
                <div style={S.cardTop}>
                  <div>
                    <div style={S.tableLabel}>
                      {order.table_number != null ? `Table ${order.table_number}` : 'No table'}
                    </div>
                    <div style={S.sourceLabel}>
                      {order.source === 'counter' ? 'Counter entry' : order.source === 'customer' ? 'Customer order' : 'Waiter order'}
                    </div>
                  </div>
                  <div style={{ ...S.timeLabel, color: timeColor }}>
                    {elapsed(order.created_at, now)}
                  </div>
                </div>

                <hr style={S.divider} />

                {/* Items */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {order.items.map(item => (
                    <div key={item.id} style={S.itemRow}>
                      <span style={S.qty}>{item.quantity}×</span>
                      <span>{item.item_name}</span>
                    </div>
                  ))}
                </div>

                {/* Ready button */}
                <button
                  style={{ ...S.readyBtn, background: btnBg, color: '#fff', opacity: readying[order.id] ? 0.6 : 1 }}
                  onClick={() => handleReady(order.id)}
                  disabled={!!readying[order.id]}
                >
                  {readying[order.id] ? 'Marking…' : 'READY'}
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Counter entry panel */}
      {counterOpen && (
        <div style={S.counterOverlay} onClick={closeCounter}>
          <div style={S.counterPanel} onClick={e => e.stopPropagation()}>

            {/* Panel header */}
            <div style={S.counterHeader}>
              <span style={{ color: '#F0EDE8', fontSize: 17, fontWeight: 700 }}>Counter Entry</span>
              <button
                style={{ background: 'none', border: 'none', color: '#6B6570', fontSize: 22, cursor: 'pointer', padding: '4px 8px', lineHeight: 1 }}
                onClick={closeCounter}
                aria-label="Close"
              >✕</button>
            </div>

            {/* Scrollable menu */}
            <div style={S.counterScrollArea}>
              {menuCats.length === 0 ? (
                <div style={{ color: '#555', fontSize: 14, textAlign: 'center', padding: '32px 0' }}>Loading menu…</div>
              ) : (
                menuCats.map(cat => {
                  const catItems = menuItems.filter(mi => mi.category_id === cat.id && mi.available !== false);
                  if (catItems.length === 0) return null;
                  return (
                    <div key={cat.id}>
                      <div style={S.counterCatHd}>{cat.emoji ? `${cat.emoji} ` : ''}{cat.name}</div>
                      {catItems.map(item => {
                        const entry = cart[item.id];
                        const qty = entry?.qty ?? 0;
                        return (
                          <div key={item.id} style={S.counterItemRow}>
                            <div style={{ flex: 1, marginRight: 12 }}>
                              <div style={S.counterItemName}>{item.name}</div>
                              <div style={S.counterItemPrice}>₦{item.price.toLocaleString('en-NG')}</div>
                            </div>
                            <div style={S.counterQtyRow}>
                              {qty > 0 && (
                                <>
                                  <button
                                    style={{ ...S.counterQtyBtn, background: '#2a2a2a', color: '#F0EDE8' }}
                                    onClick={() => setCart(prev => {
                                      const n = { ...prev };
                                      if ((n[item.id]?.qty ?? 0) <= 1) { delete n[item.id]; return n; }
                                      return { ...n, [item.id]: { ...n[item.id], qty: n[item.id].qty - 1 } };
                                    })}
                                    aria-label={`Remove one ${item.name}`}
                                  >−</button>
                                  <span style={S.counterQtyNum}>{qty}</span>
                                </>
                              )}
                              <button
                                style={{ ...S.counterQtyBtn, background: '#C41E3A', color: '#fff' }}
                                onClick={() => setCart(prev => ({
                                  ...prev,
                                  [item.id]: { qty: (prev[item.id]?.qty ?? 0) + 1, price: item.price, name: item.name }
                                }))}
                                aria-label={qty === 0 ? `Add ${item.name}` : `Add one more ${item.name}`}
                              >+</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })
              )}
              <div style={{ height: 8 }} />
            </div>

            {/* Footer */}
            <div style={S.counterFooter}>
              {counterError && (
                <div style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.3)', borderRadius: 8, padding: '10px 14px', color: '#f87171', fontSize: 13 }}>
                  {counterError}
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ color: '#9a9098', fontSize: 14, fontWeight: 600 }}>Total</span>
                <span style={{ color: '#F0EDE8', fontSize: 20, fontWeight: 800 }}>
                  ₦{cartTotal.toLocaleString('en-NG')}
                </span>
              </div>
              <input
                style={S.counterTableInput}
                type="number"
                inputMode="numeric"
                placeholder="Table number (optional)"
                value={counterTable}
                onChange={e => setCounterTable(e.target.value)}
              />
              <button
                style={{ ...S.counterSaveBtn, opacity: (counterSaving || !cartHasItems) ? 0.5 : 1 }}
                disabled={counterSaving || !cartHasItems}
                onClick={handleCounterSave}
              >
                {counterSaving ? 'Saving…' : 'Save order'}
              </button>
              <button
                style={S.counterCancelBtn}
                disabled={counterSaving}
                onClick={closeCounter}
              >
                Cancel
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';

// ── Constants ──────────────────────────────────────────────────────────────────

const SUPABASE_URL      = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { storageKey: 'vw_customer_auth' },
});

const THEME_ADA: Record<string, string> = {
  'nightlife-dark':   '/images/ada.png',
  'cafe-light':       '/images/chisom.png',
  'street-energy':    '/images/emeka.png',
  'heritage-gold':    '/images/mamachef.png',
  'pure-luxury':      '/images/cheftunde.png',
  'tropical-bright':  '/images/ada.png',
  'custom':           '/images/ada.png',
};

// Themes where the restaurant's own accent_color should override the CSS variable.
// Predefined themes have their own designed accent — let the CSS define it.
const ACCENT_OVERRIDE_THEMES = new Set(['nightlife-dark', 'custom']);

// ── Types ──────────────────────────────────────────────────────────────────────

interface MenuItem {
  name: string; price: number; description: string;
  ada: string; available: boolean; image_url: string | null;
}
interface MenuCategory { id: string; name: string; emoji: string; image_url: string | null; items: MenuItem[] }
interface RestaurantData {
  name: string; tagline: string; whatsapp: string; accentColor: string;
  plan: string; plan_status: string;
  plan_expires_at: string | null; menu_theme: string;
  customer_ordering_enabled: boolean;
}
interface AdaData {
  name: string; emoji: string; welcome: string; idle: string;
  categoryMessages: Record<string, string>;
}
interface MenuData { restaurant: RestaurantData; ada: AdaData; categories: MenuCategory[] }
interface OrderItem { qty: number; price: number; item_name: string }
type OrderState = Record<string, OrderItem>;  // keyed by menu_item_id (uuid)
interface MyOrder {
  id: string; status: string; total: number; created_at: string; table_number: number;
  order_items: { item_name: string; quantity: number; price: number }[];
}
interface StoredOrder { id: string; table: string; placedAt: number }

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(amount: number) { return '₦' + Number(amount).toLocaleString('en-NG'); }

function isPaidPlan(r: RestaurantData) {
  const notExpired = !r.plan_expires_at || new Date(r.plan_expires_at) > new Date();
  return r.plan_status === 'active' && r.plan !== 'free' && notExpired;
}

function orderStatus(s: string) {
  if (s === 'preparing') return { label: 'Preparing', icon: '👨‍🍳', cls: 'status-preparing' };
  if (s === 'served')    return { label: 'Served',    icon: '✅',  cls: 'status-served' };
  if (s === 'cancelled') return { label: 'CANCELLED', icon: '✖',  cls: 'status-cancelled' };
  return { label: 'Pending', icon: '⏳', cls: 'status-pending' };
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function MenuApp({ slug, table }: { slug: string; table: string }) {
  // ── Data ─────────────────────────────────────────────────────────────────────
  const [menuData, setMenuData]           = useState<MenuData | null>(null);
  const [restaurantId, setRestaurantId]   = useState<string | null>(null);
  const [dataError, setDataError]         = useState<string | null>(null);

  // ── Character ─────────────────────────────────────────────────────────────────
  const [charImg, setCharImg]             = useState('/images/ada.png');

  // ── Ada ───────────────────────────────────────────────────────────────────────
  const [adaVisible, setAdaVisible]       = useState(false);
  const [adaBubbleVisible, setAdaBubbleVisible] = useState(false);
  const [adaSpeaking, setAdaSpeaking]     = useState(false);
  const [adaMessage, setAdaMessage]       = useState('');
  const adaTimerRef                       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleTimerRef                      = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Order ─────────────────────────────────────────────────────────────────────
  const [orderState, setOrderState]       = useState<OrderState>({});
  const [orderConfirm, setOrderConfirm]   = useState<{ table: string; itemCount: number; total: number } | null>(null);
  const [orderConfirmVisible, setOrderConfirmVisible] = useState(false);
  const [callWaiterDisabled, setCallWaiterDisabled]   = useState(false);
  const [placeOrderDisabled, setPlaceOrderDisabled]   = useState(false);

  // ── Side menu ─────────────────────────────────────────────────────────────────
  const [cmenuVisible, setCmenuVisible]   = useState(false);
  const [cmenuOpen, setCmenuOpen]         = useState(false);

  // ── My Orders ─────────────────────────────────────────────────────────────────
  const [myOrderOpen, setMyOrderOpen]     = useState(false);
  const [myOrders, setMyOrders]           = useState<MyOrder[]>([]);
  const [myOrdersLoading, setMyOrdersLoading] = useState(false);

  // ── Accordion category ────────────────────────────────────────────────────────
  const [openCatId, setOpenCatId]         = useState<string | null>(null);
  const catRefs                           = useRef<Record<string, HTMLDivElement | null>>({});
  const menuDataRef                       = useRef<MenuData | null>(null);


  // Derived order values
  const orderItems = Object.values(orderState);
  const itemCount  = orderItems.reduce((s, i) => s + i.qty, 0);
  const orderTotal = orderItems.reduce((s, i) => s + i.qty * i.price, 0);
  const cacheKey   = `vw_menu_cache_${slug}`;

  // ── Ada control ───────────────────────────────────────────────────────────────

  const adaSpeak = useCallback((message: string, duration = 5000) => {
    if (adaTimerRef.current) clearTimeout(adaTimerRef.current);
    setAdaMessage(message);
    setAdaVisible(true);
    setAdaBubbleVisible(true);
    setAdaSpeaking(true);
    adaTimerRef.current = setTimeout(() => {
      setAdaBubbleVisible(false);
      setAdaSpeaking(false);
      setAdaVisible(false);
    }, duration);
  }, []);

  const adaHide = useCallback(() => {
    if (adaTimerRef.current) clearTimeout(adaTimerRef.current);
    setAdaBubbleVisible(false);
    setAdaSpeaking(false);
    setAdaVisible(false);
  }, []);

  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    const idle = menuDataRef.current?.ada?.idle;
    if (idle) {
      idleTimerRef.current = setTimeout(() => adaSpeak(idle, 6000), 30000);
    }
  }, [adaSpeak]);

  // ── Accordion toggle ──────────────────────────────────────────────────────────

  const toggleCat = useCallback((id: string) => {
    setOpenCatId(prev => {
      if (prev === id) return null;
      requestAnimationFrame(() => {
        const el = catRefs.current[id];
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      return id;
    });
  }, []);

  // ── Side menu open/close ──────────────────────────────────────────────────────

  const openCmenu = useCallback(() => {
    setCmenuVisible(true);
    requestAnimationFrame(() => setCmenuOpen(true));
  }, []);

  const closeCmenu = useCallback(() => {
    setCmenuOpen(false);
    setTimeout(() => setCmenuVisible(false), 280);
  }, []);

  // ── Load menu data ─────────────────────────────────────────────────────────────

  const loadMenuData = useCallback(async (rid: string): Promise<MenuData> => {
    const [{ data: restaurant, error: rErr }, { data: categories, error: cErr }, { data: items, error: iErr }] =
      await Promise.all([
        db.from('restaurants').select('*').eq('id', rid).single(),
        db.from('menu_categories').select('*').eq('restaurant_id', rid).order('sort_order'),
        db.from('menu_items').select('*').eq('restaurant_id', rid).order('sort_order'),
      ]);
    if (rErr) throw rErr;
    if (cErr) throw cErr;
    if (iErr) throw iErr;

    const catMsgs: Record<string, string> = {
      all: "Here's everything we serve — tap any dish to learn more, or hit + to order.",
    };
    categories!.forEach((c: Record<string, unknown>) => { catMsgs[c.slug as string] = c.ada_message as string; });

    const data: MenuData = {
      restaurant: {
        name:            restaurant!.name as string,
        tagline:         restaurant!.tagline as string,
        whatsapp:        restaurant!.whatsapp as string,
        accentColor:     restaurant!.accent_color as string,
        plan:            (restaurant!.plan as string)            || 'free',
        plan_status:     (restaurant!.plan_status as string)     || 'inactive',
        plan_expires_at: (restaurant!.plan_expires_at as string) || null,
        menu_theme:      (restaurant!.menu_theme as string)      || 'nightlife-dark',
        customer_ordering_enabled: (restaurant!.customer_ordering_enabled as boolean) ?? true,
      },
      ada: {
        name:    restaurant!.ada_name as string,
        emoji:   restaurant!.ada_emoji as string,
        welcome: restaurant!.ada_welcome as string,
        idle:    restaurant!.ada_idle as string,
        categoryMessages: catMsgs,
      },
      categories: (categories!).map((c: Record<string, unknown>) => ({
        id:        c.slug as string,
        name:      c.name as string,
        emoji:     c.emoji as string,
        image_url: (c.image_url as string) || null,
        items: (items!).filter((i: Record<string, unknown>) => i.category_id === c.id).map((i: Record<string, unknown>) => ({
          name:        i.name as string,
          price:       i.price as number,
          description: i.description as string,
          ada:         i.ada_message as string,
          available:   i.available as boolean,
          image_url:   (i.image_url as string) || null,
        })),
      })),
    };

    try { localStorage.setItem(cacheKey, JSON.stringify(data)); } catch (_) { /* quota */ }
    return data;
  }, [db, cacheKey]);

  // ── Boot ───────────────────────────────────────────────────────────────────────

  function applyTheme(r: RestaurantData) {
    const theme = r.menu_theme || 'nightlife-dark';
    document.documentElement.setAttribute('data-theme', theme);
    if (ACCENT_OVERRIDE_THEMES.has(theme)) {
      document.documentElement.style.setProperty('--accent', r.accentColor || '#C41E3A');
    } else {
      document.documentElement.style.removeProperty('--accent');
    }
    setCharImg(THEME_ADA[theme] || '/images/ada.png');
  }

  useEffect(() => {
    (async () => {
      const { data: restaurantRow, error: slugError } = await db
        .from('restaurants').select('id').eq('slug', slug).single();

      if (slugError || !restaurantRow) {
        setDataError('Restaurant not found. Please scan the QR code again.');
        return;
      }

      const rid = restaurantRow.id as string;
      setRestaurantId(rid);

      let cachedRaw: string | null = null;
      try { cachedRaw = localStorage.getItem(cacheKey); } catch (_) { /* ignore */ }
      const cached = cachedRaw ? JSON.parse(cachedRaw) as MenuData : null;

      if (cached) {
        menuDataRef.current = cached;
        setMenuData(cached);
        applyTheme(cached.restaurant);

        // Background refresh
        loadMenuData(rid).then(fresh => {
          if (JSON.stringify(fresh) !== JSON.stringify(cached)) {
            menuDataRef.current = fresh;
            setMenuData(fresh);
            applyTheme(fresh.restaurant);
          }
        }).catch(() => {});
      } else {
        try {
          const data = await loadMenuData(rid);
          menuDataRef.current = data;
          setMenuData(data);
          applyTheme(data.restaurant);
        } catch {
          setDataError('Unable to load menu — please reload the page.');
        }
      }

      // Ada welcome message after menu is ready
      const adaName = menuDataRef.current?.ada?.name || 'Ada';
      const welcome = menuDataRef.current?.ada?.welcome || 'Browse our menu and tap + to order.';
      setTimeout(() => {
        adaSpeak(`Hi! I'm ${adaName}. ${welcome}`, 7000);
        resetIdleTimer();
      }, 800);
    })();

    return () => {
      if (adaTimerRef.current) clearTimeout(adaTimerRef.current);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Scroll hides Ada ───────────────────────────────────────────────────────────

  useEffect(() => {
    const handler = () => adaHide();
    window.addEventListener('scroll', handler, { passive: true });
    return () => window.removeEventListener('scroll', handler);
  }, [adaHide]);

  // ── Qty change ─────────────────────────────────────────────────────────────────

  const changeQty = useCallback((id: string, item_name: string, price: number, delta: number) => {
    setOrderState(prev => {
      const current = prev[id] || { qty: 0, price, item_name };
      const next    = Math.max(0, current.qty + delta);
      const updated = { ...prev };
      if (next === 0) delete updated[id];
      else updated[id] = { qty: next, price, item_name };
      return updated;
    });
  }, []);

  // ── Call waiter ────────────────────────────────────────────────────────────────

  const handleCallWaiter = useCallback(async () => {
    setCallWaiterDisabled(true);
    const { error } = await db.from('waiter_calls').insert({
      restaurant_id: restaurantId,
      table_number:  Number(table),
      status:        'pending',
    });
    setCallWaiterDisabled(false);
    if (error) {
      adaSpeak("Hmm, that didn't go through — please try again 🙏", 5500);
    } else {
      adaSpeak(table ? `I've called your waiter! 😊 Someone will be at Table ${table} shortly.` : `I've called your waiter! 😊 Someone will be with you shortly.`, 6000);
    }
    resetIdleTimer();
  }, [db, restaurantId, table, adaSpeak, resetIdleTimer]);

  // ── Place order ────────────────────────────────────────────────────────────────

  const handlePlaceOrder = useCallback(async () => {
    const items = Object.entries(orderState);
    if (!items.length) {
      adaSpeak("Your order is empty! Tap Add next to a dish to add it first 😊", 5000);
      resetIdleTimer();
      return;
    }
    const total         = items.reduce((s, [, i]) => s + i.qty * i.price, 0);
    const clientOrderId = crypto.randomUUID();
    setPlaceOrderDisabled(true);

    const { data: dbOrderId, error } = await db.rpc('customer_place_order', {
      p_client_order_id: clientOrderId,
      p_restaurant_id:   restaurantId,
      p_table_number:    table ? Number(table) : null,
      p_items:           items.map(([id, i]) => ({ menu_item_id: id, quantity: i.qty })),
    });

    setPlaceOrderDisabled(false);

    if (error || !dbOrderId) {
      adaSpeak("Hmm, that didn't go through — please try again 🙏", 5500);
      resetIdleTimer();
      return;
    }

    // Persist the database-generated order id so "My orders" survives a page refresh.
    // Key is per-restaurant so a device visiting multiple restaurants keeps
    // separate histories. Each entry stores the table for display; entries
    // older than 24 hours are pruned on the next read.
    if (restaurantId) {
      try {
        const lsKey = `vw_orders_${restaurantId}`;
        const raw = localStorage.getItem(lsKey);
        const entries: StoredOrder[] = raw ? JSON.parse(raw) : [];
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        const fresh = entries.filter(e => e.placedAt > cutoff);
        fresh.push({ id: dbOrderId as string, table, placedAt: Date.now() });
        localStorage.setItem(lsKey, JSON.stringify(fresh));
      } catch (_) { /* storage unavailable or quota full */ }
    }

    const count = items.reduce((s, [, i]) => s + i.qty, 0);
    setOrderConfirm({ table, itemCount: count, total });
    setOrderConfirmVisible(false);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setOrderConfirmVisible(true));
    });
    adaSpeak(`Your order has been sent. Sit tight!`, 6000);
    resetIdleTimer();
    setOrderState({});

    setTimeout(() => {
      setOrderConfirmVisible(false);
      setTimeout(() => setOrderConfirm(null), 400);
    }, 4000);
  }, [orderState, db, restaurantId, table, adaSpeak, resetIdleTimer]);

  // ── Demo auto-navigation (activated via ?demo=1) ──────────────────────────────

  const searchParams = useSearchParams();
  const isDemo = searchParams.get('demo') === '1';

  useEffect(() => {
    if (!isDemo || !menuData) return;

    const categories = menuData.categories.filter(c => c.items.some(i => i.available !== false));
    if (categories.length === 0) return;

    // Ghost cursor element
    const cursor = document.createElement('div');
    cursor.style.cssText = [
      'position:fixed', 'width:22px', 'height:22px', 'border-radius:50%',
      'background:rgba(74,124,30,0.55)', 'border:2px solid rgba(74,124,30,0.9)',
      'pointer-events:none', 'z-index:99999',
      'transform:translate(-50%,-50%)',
      'transition:left 0.55s cubic-bezier(0.4,0,0.2,1),top 0.55s cubic-bezier(0.4,0,0.2,1),opacity 0.3s,transform 0.15s',
      'opacity:0', 'left:50%', 'top:50%',
    ].join(';');
    document.body.appendChild(cursor);

    const timers: ReturnType<typeof setTimeout>[] = [];
    let alive = true;

    function at(el: Element | null) {
      if (!el) return;
      const r = el.getBoundingClientRect();
      cursor.style.opacity = '1';
      cursor.style.left = (r.left + r.width / 2) + 'px';
      cursor.style.top  = (r.top  + r.height / 2) + 'px';
    }

    function tap(el: Element | null, cb?: () => void) {
      if (!el) { cb?.(); return; }
      at(el);
      timers.push(setTimeout(() => {
        cursor.style.transform = 'translate(-50%,-50%) scale(0.68)';
        timers.push(setTimeout(() => {
          cursor.style.transform = 'translate(-50%,-50%) scale(1)';
          (el as HTMLElement).click();
          cb?.();
        }, 180));
      }, 600));
    }

    function step(ms: number, fn: () => void) {
      const t = setTimeout(fn, ms);
      timers.push(t);
    }

    function run() {
      if (!alive) return;

      const cat1 = categories[0];
      const cat2 = categories[1] ?? categories[0];

      const card       = (id: string) => document.getElementById('cat-' + id);
      const cardHeader = (id: string) => card(id)?.querySelector('.cat-card-header') as Element | null;
      const addBtn     = (id: string) => card(id)?.querySelector('.add-btn') as Element | null;
      const plusBtn    = (id: string) => card(id)?.querySelector('.stepper-btn.stepper-plus') as Element | null;
      const waiter     = () => document.querySelector('.call-waiter-btn') as Element | null;

      const scrollTo = (el: Element | null) => {
        if (!el) return;
        window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 72, behavior: 'smooth' });
      };

      // Open first category card
      step(0,     () => scrollTo(card(cat1.id)));
      step(800,   () => tap(cardHeader(cat1.id)));
      // After card opens, move to Add button
      step(2000,  () => at(addBtn(cat1.id)));
      // Tap Add
      step(2700,  () => tap(addBtn(cat1.id)));
      // Tap + to add a second
      step(4000,  () => tap(plusBtn(cat1.id)));
      // Open second category card
      step(5500,  () => scrollTo(card(cat2.id)));
      step(6300,  () => tap(cardHeader(cat2.id)));
      // Tap Add in second category
      step(7800,  () => at(addBtn(cat2.id)));
      step(8500,  () => tap(addBtn(cat2.id)));
      // Move to call waiter — visual only, no DB write
      step(10000, () => at(waiter()));
      step(10700, () => {
        const btn = waiter();
        if (btn) at(btn);
        cursor.style.transform = 'translate(-50%,-50%) scale(0.68)';
        timers.push(setTimeout(() => {
          cursor.style.transform = 'translate(-50%,-50%) scale(1)';
          adaSpeak(table ? `I've called your waiter! 😊 Someone will be at Table ${table} shortly.` : `I've called your waiter! 😊 Someone will be with you shortly.`, 4500);
        }, 220));
      });
      // Hide cursor, reset, loop
      step(15000, () => {
        cursor.style.opacity = '0';
        window.scrollTo({ top: 0, behavior: 'smooth' });
        setOrderState({});
        setOpenCatId(null);
      });
      step(16500, () => { if (alive) run(); });
    }

    timers.push(setTimeout(run, 1200));

    return () => {
      alive = false;
      timers.forEach(clearTimeout);
      if (cursor.parentNode) cursor.parentNode.removeChild(cursor);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuData, isDemo]);

  // ── My orders ──────────────────────────────────────────────────────────────────

  const loadMyOrders = useCallback(async () => {
    if (!restaurantId) return;
    setMyOrdersLoading(true);
    try {
      // Read placed order IDs from localStorage. Prune entries older than 24 hours.
      // The list is per-restaurant so histories from different restaurants don't mix.
      const lsKey = `vw_orders_${restaurantId}`;
      let orderIds: string[] = [];
      try {
        const raw = localStorage.getItem(lsKey);
        if (raw) {
          const entries: StoredOrder[] = JSON.parse(raw);
          const cutoff = Date.now() - 24 * 60 * 60 * 1000;
          const fresh = entries.filter(e => e.placedAt > cutoff);
          if (fresh.length !== entries.length) {
            try { localStorage.setItem(lsKey, JSON.stringify(fresh)); } catch (_) {}
          }
          orderIds = fresh.map(e => e.id);
        }
      } catch (_) { /* storage unavailable */ }

      if (orderIds.length === 0) {
        setMyOrders([]);
        return;
      }

      const res = await fetch(`${SUPABASE_URL}/functions/v1/table-orders`, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ order_ids: orderIds }),
      });
      const { orders, error } = await res.json();
      if (error || !res.ok) throw new Error(error || 'Failed');
      setMyOrders(orders || []);
    } catch {
      setMyOrders([]);
    } finally {
      setMyOrdersLoading(false);
    }
  }, [restaurantId]);

  const openMyOrders = useCallback(() => {
    setMyOrderOpen(true);
    loadMyOrders();
  }, [loadMyOrders]);

  // Poll for order status updates while the modal is open (15-second interval).
  useEffect(() => {
    if (!myOrderOpen) return;
    const iv = setInterval(loadMyOrders, 15000);
    return () => clearInterval(iv);
  }, [myOrderOpen, loadMyOrders]);

  // ── Rendering helpers ──────────────────────────────────────────────────────────

  const restaurant      = menuData?.restaurant;
  const paid            = restaurant ? isPaidPlan(restaurant) : false;
  const orderingEnabled = restaurant?.customer_ordering_enabled ?? true;

  function AddControl({ item }: { item: MenuItem }) {
    if (item.available === false) return <span className="item-sold-out-tag">Sold Out</span>;
    if (!orderingEnabled) return null;
    const qty = (orderState[item.id] || {}).qty || 0;
    if (qty === 0) {
      return (
        <button
          className="add-btn"
          aria-label={`Add ${item.name}`}
          onClick={e => { e.stopPropagation(); changeQty(item.id, item.name, item.price, 1); }}
        >
          Add
        </button>
      );
    }
    return (
      <div className="item-stepper">
        <button
          className="stepper-btn stepper-minus"
          aria-label="Remove one"
          onClick={e => { e.stopPropagation(); changeQty(item.id, item.name, item.price, -1); }}
        >−</button>
        <span className="stepper-count">{qty}</span>
        <button
          className="stepper-btn stepper-plus"
          aria-label="Add one more"
          onClick={e => { e.stopPropagation(); changeQty(item.id, item.name, item.price, 1); }}
        >+</button>
      </div>
    );
  }

  function ItemRow({ item }: { item: MenuItem }) {
    return (
      <div
        className={`item-row${item.available === false ? ' item-sold-out' : ''}`}
        onClick={() => { if (item.ada) { adaSpeak(item.ada, 5500); resetIdleTimer(); } }}
      >
        {item.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="item-thumb" src={item.image_url} alt={item.name} loading="lazy" />
        )}
        <div className="item-info">
          <p className="item-name">{item.name}</p>
          {item.description && <p className="item-desc">{item.description}</p>}
          <p className="item-price">{fmt(item.price)}</p>
        </div>
        <div className="item-controls">
          <AddControl item={item} />
        </div>
      </div>
    );
  }

  function CategoryList({ categories }: { categories: MenuCategory[] }) {
    if (!categories.length) return <div className="mag-empty">Menu coming soon — check back shortly.</div>;
    return (
      <div className="cat-list">
        {categories.filter(c => c.items.length).map(cat => {
          const isOpen = openCatId === cat.id;
          return (
            <div
              key={cat.id}
              id={`cat-${cat.id}`}
              className={`cat-card${isOpen ? ' open' : ''}`}
              ref={el => { catRefs.current[cat.id] = el; }}
            >
              <div className="cat-card-header" onClick={() => toggleCat(cat.id)}>
                <div className="cat-card-img-wrap">
                  {cat.image_url
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img className="cat-card-img" src={cat.image_url} alt={cat.name} loading="lazy" />
                    : <div className="cat-card-emoji-bg">{cat.emoji || '🍽️'}</div>
                  }
                </div>
                <div className="cat-card-row">
                  <div>
                    <p className="cat-card-name">{cat.name}</p>
                    <p className="cat-card-count">{cat.items.filter(i => i.available !== false).length} items</p>
                  </div>
                  <span className="cat-card-chevron">▾</span>
                </div>
              </div>
              {isOpen && (
                <div className="cat-items">
                  {cat.items.map(item => <ItemRow key={item.name} item={item} />)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // ── JSX ────────────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Main App ──────────────────────────────────────────────────── */}
      <div id="app" className="visible">

        {/* Error state */}
        {dataError && (
          <div className="mag-empty" style={{ paddingTop: '40vh', fontSize: '1rem', color: 'rgba(255,255,255,0.5)' }}>
            {dataError}
          </div>
        )}

        {/* ── Compact sticky header ──────────────────────────────────── */}
        <header className="mag-header">
          <div className="mag-header-left">
            <span className="mag-header-name">{restaurant?.name ?? '—'}</span>
            {table && <span className="mag-header-table">Table {table}</span>}
          </div>
          <div className="mag-header-right">
            <a href="https://dashboard.virtualwaitress.com" className="mag-header-signin">Sign In</a>
            <button className="mag-header-menu-btn" onClick={openCmenu} aria-label="Open menu">☰</button>
          </div>
        </header>

        {/* ── Menu content ──────────────────────────────────────────── */}
        <main id="magContent" className="mag-content">
          {!menuData && !dataError ? (
            <div className="menu-content">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="skeleton-item" style={{ marginBottom: 10 }} />
              ))}
            </div>
          ) : menuData ? (
            <CategoryList categories={menuData.categories} />
          ) : null}
        </main>

        {/* ── Ada character ─────────────────────────────────────────── */}
        <div className={`ada-container${adaVisible ? ' visible' : ''}${itemCount > 0 ? ' lifted' : ''}`}>
          <div
            className={`speech-bubble${adaBubbleVisible ? ' visible' : ''}`}
            role="status"
            aria-live="polite"
          >
            <p>{adaMessage}</p>
          </div>
          <button
            className={`ada-character${adaSpeaking ? ' speaking' : ''}`}
            aria-label="Chat with your virtual waitress"
            onClick={() => {
              adaSpeak(menuDataRef.current?.ada?.welcome || 'Welcome!', 5500);
              resetIdleTimer();
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={charImg} alt="Virtual waitress" className="ada-img" />
          </button>
        </div>

        {/* ── Order summary bar ─────────────────────────────────────── */}
        <div className={`order-summary-bar${(itemCount > 0 && orderingEnabled) ? ' visible' : ''}`}>
          <span id="orderItemCount">{itemCount === 1 ? '1 item' : `${itemCount} items`}</span>
          <span id="orderTotal">{fmt(orderTotal)}</span>
        </div>

        {/* ── Action bar ────────────────────────────────────────────── */}
        <div className="action-bar">
          <button
            className="call-waiter-btn"
            onClick={handleCallWaiter}
            disabled={callWaiterDisabled}
          >
            <span className="btn-icon">📲</span>
            <span>Call Waiter</span>
          </button>
          {orderingEnabled ? (
            <button
              className="place-order-btn"
              onClick={handlePlaceOrder}
              disabled={placeOrderDisabled}
            >
              <span className="place-order-badge">{itemCount}</span>
              <span className="place-order-main">🛒 Place Order</span>
              <span className="place-order-sub">and get served</span>
            </button>
          ) : (
            <span className="browse-only-notice">To order, please call your waiter.</span>
          )}
        </div>

        {/* ── Powered by badge (free plan) ────────────────────────────── */}
        <div className={`vw-powered-badge${paid ? ' vw-badge-hidden' : ''}`}>
          <a
            href="https://virtualwaitress.com?ref=powered"
            target="_blank"
            rel="noopener"
            className="vw-powered-link"
          >
            Powered by <strong>Virtual Waitress</strong>
          </a>
        </div>
      </div>

      {/* ── Customer side menu ────────────────────────────────────────── */}
      {cmenuVisible && (
        <div
          className="cmenu-overlay"
          onClick={closeCmenu}
        />
      )}
      <nav
        className={`cmenu-panel${cmenuVisible ? '' : ' admin-hidden'}${cmenuOpen ? ' open' : ''}`}
        aria-label="Customer menu"
      >
        <div className="cmenu-header">
          <div className="cmenu-restaurant">
            <p className="cmenu-restaurant-name">{restaurant?.name ?? '—'}</p>
            {table && <p className="cmenu-table-label">Table {table}</p>}
          </div>
          <button className="cmenu-close" onClick={closeCmenu} aria-label="Close menu">✕</button>
        </div>
        <div className="cmenu-body">
          {orderingEnabled && (
            <button
              className="cmenu-item"
              onClick={() => { closeCmenu(); openMyOrders(); }}
            >
              <span className="cmenu-item-icon">📋</span>
              <span className="cmenu-item-label">My Orders</span>
              <span className="cmenu-item-arrow">›</span>
            </button>
          )}
          <button
            className="cmenu-item"
            onClick={() => { closeCmenu(); handleCallWaiter(); }}
          >
            <span className="cmenu-item-icon">📲</span>
            <span className="cmenu-item-label">Call Waiter</span>
            <span className="cmenu-item-arrow">›</span>
          </button>
        </div>
        <p className="cmenu-footer">Powered by Virtual Waitress</p>
      </nav>

      {/* ── My Orders modal ───────────────────────────────────────────── */}
      {myOrderOpen && (
        <div
          className="my-order-overlay"
          onClick={e => { if (e.target === e.currentTarget) setMyOrderOpen(false); }}
        >
          <div className="my-order-card">
            <div className="my-order-header">
              <div className="my-order-header-left">
                <span className="my-order-title">My Orders</span>
                {table && <span className="my-order-table-pill">Table {table}</span>}
              </div>
              <div className="my-order-header-right">
                <button className="my-order-refresh-icon" onClick={loadMyOrders} type="button" title="Refresh">↻</button>
                <button className="my-order-close" onClick={() => setMyOrderOpen(false)} type="button">✕</button>
              </div>
            </div>

            <div id="myOrderContent">
              {myOrdersLoading ? (
                <p className="my-order-empty">Loading…</p>
              ) : myOrders.length === 0 ? (
                <div className="my-order-empty-state">
                  <p className="my-order-empty-icon">🍽️</p>
                  <p className="my-order-empty-text">No orders yet at this table.</p>
                  <p className="my-order-empty-sub">Tap Add on any dish to start your order.</p>
                </div>
              ) : (
                <>
                  {myOrders.map(order => {
                    const { label, icon, cls } = orderStatus(order.status);
                    const time = new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    return (
                      <div key={order.id} className={`my-order-block${order.status === 'cancelled' ? ' my-order-block-cancelled' : ''}`}>
                        <div className="my-order-block-header">
                          <div className="my-order-status-group">
                            <span className={`my-order-status ${cls}`}>{icon} {label}</span>
                            <span className="my-order-time">{time}</span>
                          </div>
                          <span className="my-order-subtotal">₦{order.total.toLocaleString()}</span>
                        </div>
                        <div className="my-order-items">
                          {(order.order_items || []).map((item, idx) => (
                            <div key={idx} className="my-order-item-row">
                              <span className="my-order-item-name">
                                <span className="my-order-item-qty">{item.quantity}×</span> {item.item_name}
                              </span>
                              <span className="my-order-item-price">₦{(item.quantity * item.price).toLocaleString()}</span>
                            </div>
                          ))}
                        </div>
                        {order.status === 'cancelled' && (
                          <div className="my-order-cancelled-notice">
                            This order was cancelled. Please speak to your waiter.
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <div className="my-order-total-row">
                    <span>Total Bill</span>
                    <span>₦{myOrders.reduce((s, o) => s + o.total, 0).toLocaleString()}</span>
                  </div>
                  <p className="my-order-hint">Tap ↻ to check for updates</p>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Order confirmation overlay ─────────────────────────────────── */}
      {orderConfirm && (
        <div className={`oc-overlay${orderConfirmVisible ? ' oc-visible' : ''}`}>
          <div className="oc-card">
            <div className="oc-check">✓</div>
            <h2 className="oc-title">Order Confirmed!</h2>
            <p className="oc-meta">
              Table {orderConfirm.table} · {orderConfirm.itemCount} item{orderConfirm.itemCount !== 1 ? 's' : ''} · {fmt(orderConfirm.total)}
            </p>
            <p className="oc-sub">Your waiter has been notified.<br />Sit back and enjoy!</p>
            <button
              className="oc-btn"
              onClick={() => {
                setOrderConfirmVisible(false);
                setTimeout(() => setOrderConfirm(null), 400);
              }}
            >
              Back to Menu
            </button>
            <div className="oc-progress">
              <div className="oc-progress-bar" />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

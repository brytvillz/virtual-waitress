'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';

// ── Constants ──────────────────────────────────────────────────────────────────

const SUPABASE_URL      = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SPLASH_MIN_MS = 5000;

const CAT_IMAGES: Record<string, string> = {
  soups: '/images/cat-soups.jpg',
  swallows: '/images/cat-swallows.jpg',
  rice: '/images/cat-rice.jpg',
  grills: '/images/cat-grills.jpg',
  'small-chops': '/images/cat-small-chops.jpg',
  drinks: '/images/cat-drinks.jpg',
};

const CHARACTERS: Record<string, { src: string; name: string; role: string }> = {
  ada:       { src: '/images/ada.png',       name: 'Ada',        role: 'Friendly & attentive' },
  chisom:    { src: '/images/chisom.png',    name: 'Chisom',     role: 'Warm & welcoming' },
  emeka:     { src: '/images/emeka.png',     name: 'Emeka',      role: 'Quick & sharp' },
  mamachef:  { src: '/images/mamachef.png',  name: 'Mama Chef',  role: 'Knows every dish' },
  cheftunde: { src: '/images/cheftunde.png', name: 'Chef Tunde', role: 'The grill master' },
};

const CATEGORY_CHARACTER: Record<string, string> = {
  soups: 'ada', swallows: 'ada', rice: 'emeka',
  grills: 'cheftunde', 'small-chops': 'chisom', drinks: 'chisom',
};

const COVER_MSGS = [
  { l1: 'No menu to wait for.',        l2: 'Browse everything from your table.' },
  { l1: 'Order at your own pace —',    l2: 'your waiter is notified instantly.' },
  { l1: 'No need to flag anyone down.', l2: 'Track your order in real time.'   },
];

const SPLASH_CHARS = [
  '/images/splash-waitress.png', '/images/splash-waitress.png',
  '/images/splash-waitress.png', '/images/splash-chef.png',
];

// ── Types ──────────────────────────────────────────────────────────────────────

interface MenuItem {
  name: string; price: number; description: string;
  ada: string; available: boolean; image_url: string | null;
}
interface MenuCategory { id: string; name: string; emoji: string; items: MenuItem[] }
interface RestaurantData {
  name: string; tagline: string; whatsapp: string; accentColor: string;
  cover_image: string | null; plan: string; plan_status: string;
  plan_expires_at: string | null; menu_layout: string;
}
interface AdaData {
  name: string; emoji: string; welcome: string; idle: string;
  categoryMessages: Record<string, string>;
}
interface MenuData { restaurant: RestaurantData; ada: AdaData; categories: MenuCategory[] }
interface OrderItem { qty: number; price: number }
type OrderState = Record<string, OrderItem>;
interface MyOrder {
  id: string; status: string; total: number; created_at: string;
  order_items: { item_name: string; quantity: number; price: number }[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(amount: number) { return '₦' + Number(amount).toLocaleString('en-NG'); }

function isPaidPlan(r: RestaurantData) {
  const notExpired = !r.plan_expires_at || new Date(r.plan_expires_at) > new Date();
  return r.plan_status === 'active' && r.plan !== 'free' && notExpired;
}

function orderStatus(s: string) {
  if (s === 'preparing') return { label: 'Preparing', icon: '👨‍🍳', cls: 'status-preparing' };
  if (s === 'served')    return { label: 'Served',    icon: '✅',  cls: 'status-served' };
  return { label: 'Pending', icon: '⏳', cls: 'status-pending' };
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function MenuApp({ slug, table }: { slug: string; table: string }) {
  // ── Data ─────────────────────────────────────────────────────────────────────
  const [menuData, setMenuData]           = useState<MenuData | null>(null);
  const [restaurantId, setRestaurantId]   = useState<string | null>(null);
  const [dataError, setDataError]         = useState<string | null>(null);

  // ── App visibility ────────────────────────────────────────────────────────────
  const [appVisible, setAppVisible]       = useState(false);
  const [headerVisible, setHeaderVisible] = useState(false);
  const [navVisible, setNavVisible]       = useState(false);

  // ── Splash ────────────────────────────────────────────────────────────────────
  const [splashHiding, setSplashHiding]   = useState(false);
  const [splashGone, setSplashGone]       = useState(false);
  const [splashChar, setSplashChar]       = useState('/images/splash-waitress.png');
  const splashStartRef                    = useRef<number>(0);

  // ── Cover ─────────────────────────────────────────────────────────────────────
  const [coverExiting, setCoverExiting]   = useState(false);
  const [coverGone, setCoverGone]         = useState(false);
  const [coverMsgIdx, setCoverMsgIdx]     = useState(0);
  const [coverMsgFading, setCoverMsgFading] = useState(false);

  // ── Character ─────────────────────────────────────────────────────────────────
  const [selectedChar, setSelectedChar]   = useState('ada');
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

  // ── Active category (scroll spy) ──────────────────────────────────────────────
  const [activeCat, setActiveCat]         = useState('');
  const navInnerRef                       = useRef<HTMLDivElement>(null);
  const menuDataRef                       = useRef<MenuData | null>(null);

  // Stable supabase client
  const db = useRef(createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { storageKey: 'vw_customer_auth' },
  })).current;

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
        cover_image:     (restaurant!.cover_image as string) || null,
        plan:            (restaurant!.plan as string)            || 'free',
        plan_status:     (restaurant!.plan_status as string)     || 'inactive',
        plan_expires_at: (restaurant!.plan_expires_at as string) || null,
        menu_layout:     (restaurant!.menu_layout as string)     || 'magazine',
      },
      ada: {
        name:    restaurant!.ada_name as string,
        emoji:   restaurant!.ada_emoji as string,
        welcome: restaurant!.ada_welcome as string,
        idle:    restaurant!.ada_idle as string,
        categoryMessages: catMsgs,
      },
      categories: (categories!).map((c: Record<string, unknown>) => ({
        id:    c.slug as string,
        name:  c.name as string,
        emoji: c.emoji as string,
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

  // ── Splash hide ────────────────────────────────────────────────────────────────

  const hideSplash = useCallback(async () => {
    const elapsed   = Date.now() - splashStartRef.current;
    const remaining = Math.max(0, SPLASH_MIN_MS - elapsed);
    await new Promise(r => setTimeout(r, remaining));
    setSplashHiding(true);
    await new Promise(r => setTimeout(r, 600));
    setSplashGone(true);
  }, []);

  // ── Boot ───────────────────────────────────────────────────────────────────────

  useEffect(() => {
    splashStartRef.current = Date.now();
    const randIdx = Math.floor(Math.random() * SPLASH_CHARS.length);
    setSplashChar(SPLASH_CHARS[randIdx]);

    const savedChar = (typeof localStorage !== 'undefined' && localStorage.getItem('vw_selected_char')) || 'ada';
    setSelectedChar(savedChar);
    setCharImg(CHARACTERS[savedChar]?.src || '/images/ada.png');

    (async () => {
      const { data: restaurantRow, error: slugError } = await db
        .from('restaurants').select('id').eq('slug', slug).single();

      if (slugError || !restaurantRow) {
        setSplashHiding(true);
        setTimeout(() => setSplashGone(true), 600);
        setDataError('Restaurant not found. Please scan the QR code again.');
        setAppVisible(true);
        return;
      }

      const rid = restaurantRow.id as string;
      setRestaurantId(rid);
      setAppVisible(true);

      let cachedRaw: string | null = null;
      try { cachedRaw = localStorage.getItem(cacheKey); } catch (_) { /* ignore */ }
      const cached = cachedRaw ? JSON.parse(cachedRaw) as MenuData : null;

      if (cached) {
        menuDataRef.current = cached;
        setMenuData(cached);
        document.documentElement.style.setProperty('--accent', cached.restaurant.accentColor || '#C41E3A');

        // Background refresh
        loadMenuData(rid).then(fresh => {
          if (JSON.stringify(fresh) !== JSON.stringify(cached)) {
            menuDataRef.current = fresh;
            setMenuData(fresh);
            document.documentElement.style.setProperty('--accent', fresh.restaurant.accentColor || '#C41E3A');
          }
        }).catch(() => {});

        await hideSplash();
      } else {
        try {
          const [data] = await Promise.all([loadMenuData(rid), hideSplash()]);
          menuDataRef.current = data;
          setMenuData(data);
          document.documentElement.style.setProperty('--accent', data.restaurant.accentColor || '#C41E3A');
        } catch {
          setDataError('Unable to load menu — please reload the page.');
        }
      }
    })();

    return () => {
      if (adaTimerRef.current) clearTimeout(adaTimerRef.current);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Cover carousel ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (coverGone) return;
    const interval = setInterval(() => {
      setCoverMsgFading(true);
      setTimeout(() => {
        setCoverMsgIdx(prev => (prev + 1) % COVER_MSGS.length);
        setCoverMsgFading(false);
      }, 380);
    }, 3500);
    return () => clearInterval(interval);
  }, [coverGone]);

  // ── Scroll spy + category nav ──────────────────────────────────────────────────

  useEffect(() => {
    if (!menuData) return;

    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          const catId = (entry.target as HTMLElement).dataset.cat;
          if (!catId) return;

          setActiveCat(catId);

          // Scroll active pill into view
          if (navInnerRef.current) {
            const pill = navInnerRef.current.querySelector(`[data-cat="${catId}"]`) as HTMLElement | null;
            if (pill) pill.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
          }

          // Change character and have Ada speak
          const charKey = CATEGORY_CHARACTER[catId] || 'ada';
          setCharImg(CHARACTERS[charKey]?.src || '/images/ada.png');
          const msg = menuDataRef.current?.ada?.categoryMessages?.[catId];
          if (msg) adaSpeak(msg, 5000);
        });
      },
      { threshold: 0.25, rootMargin: '-52px 0px -55% 0px' }
    );

    const sections = document.querySelectorAll('.mag-section, .classic-section, .vgrid-section');
    sections.forEach(s => observer.observe(s));

    return () => observer.disconnect();
  }, [menuData, adaSpeak]);

  // ── Scroll hides Ada ───────────────────────────────────────────────────────────

  useEffect(() => {
    const handler = () => adaHide();
    window.addEventListener('scroll', handler, { passive: true });
    return () => window.removeEventListener('scroll', handler);
  }, [adaHide]);

  // ── Cover hide ─────────────────────────────────────────────────────────────────

  const handleCoverCta = useCallback(() => {
    setCoverExiting(true);
    setTimeout(() => {
      setCoverGone(true);
      setHeaderVisible(true);
      setNavVisible(true);
    }, 740);

    setTimeout(() => {
      const charKey  = (typeof localStorage !== 'undefined' && localStorage.getItem('vw_selected_char')) || 'ada';
      const charName = CHARACTERS[charKey]?.name || 'Ada';
      setCharImg(CHARACTERS[charKey]?.src || '/images/ada.png');
      const base = menuDataRef.current?.ada?.welcome || 'Browse our menu and tap + to order.';
      adaSpeak(`Hi! I'm ${charName}. ${base}`, 7000);
      resetIdleTimer();
    }, 800);
  }, [adaSpeak, resetIdleTimer]);

  // ── Character selection ────────────────────────────────────────────────────────

  const handleCharSelect = useCallback((key: string) => {
    setSelectedChar(key);
    try { localStorage.setItem('vw_selected_char', key); } catch (_) { /* ignore */ }
  }, []);

  // ── Qty change ─────────────────────────────────────────────────────────────────

  const changeQty = useCallback((name: string, price: number, delta: number) => {
    setOrderState(prev => {
      const current = prev[name] || { qty: 0, price };
      const next    = Math.max(0, current.qty + delta);
      const updated = { ...prev };
      if (next === 0) delete updated[name];
      else updated[name] = { qty: next, price };
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
      adaSpeak(`I've called your waiter! 😊 Someone will be at Table ${table} shortly.`, 6000);
    }
    resetIdleTimer();
  }, [db, restaurantId, table, adaSpeak, resetIdleTimer]);

  // ── Place order ────────────────────────────────────────────────────────────────

  const handlePlaceOrder = useCallback(async () => {
    const items = Object.entries(orderState);
    if (!items.length) {
      adaSpeak("Your order is empty! Tap + next to a dish to add it first 😊", 5000);
      resetIdleTimer();
      return;
    }
    const total   = items.reduce((s, [, i]) => s + i.qty * i.price, 0);
    const orderId = crypto.randomUUID();
    setPlaceOrderDisabled(true);

    const { error: orderError } = await db.from('orders').insert({
      id: orderId, restaurant_id: restaurantId, table_number: Number(table), status: 'pending', total,
    });

    if (orderError) {
      setPlaceOrderDisabled(false);
      adaSpeak("Hmm, that didn't go through — please try again 🙏", 5500);
      resetIdleTimer();
      return;
    }

    const { error: itemsError } = await db.from('order_items').insert(
      items.map(([name, i]) => ({ order_id: orderId, item_name: name, quantity: i.qty, price: i.price }))
    );

    setPlaceOrderDisabled(false);

    if (itemsError) {
      adaSpeak("Order started but something went wrong — please call your waiter to confirm 🙏", 6000);
      resetIdleTimer();
      return;
    }

    const count = items.reduce((s, [, i]) => s + i.qty, 0);
    setOrderConfirm({ table, itemCount: count, total });
    setOrderConfirmVisible(false);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setOrderConfirmVisible(true));
    });
    adaSpeak(`Order sent! 🎉 The kitchen has your order for Table ${table}. Sit tight!`, 6000);
    resetIdleTimer();
    setOrderState({});

    setTimeout(() => {
      setOrderConfirmVisible(false);
      setTimeout(() => setOrderConfirm(null), 400);
    }, 4000);
  }, [orderState, db, restaurantId, table, adaSpeak, resetIdleTimer]);

  // ── My orders ──────────────────────────────────────────────────────────────────

  const loadMyOrders = useCallback(async () => {
    setMyOrdersLoading(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/table-orders`, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ restaurant_id: restaurantId, table_number: Number(table) }),
      });
      const { orders, error } = await res.json();
      if (error || !res.ok) throw new Error(error || 'Failed');
      setMyOrders(orders || []);
    } catch {
      setMyOrders([]);
    } finally {
      setMyOrdersLoading(false);
    }
  }, [restaurantId, table]);

  const openMyOrders = useCallback(() => {
    setMyOrderOpen(true);
    loadMyOrders();
  }, [loadMyOrders]);

  // ── Rendering helpers ──────────────────────────────────────────────────────────

  function QtyStepper({ item, isMag }: { item: MenuItem; isMag?: boolean }) {
    if (item.available === false) return <span className="item-sold-out-tag">Sold Out</span>;
    const qty = (orderState[item.name] || {}).qty || 0;
    return (
      <div
        className={`qty-stepper${isMag ? ' mag-stepper' : ''}`}
        data-item={item.name}
        data-price={item.price}
      >
        <button
          className="qty-btn qty-minus"
          aria-label="Remove"
          onClick={e => { e.stopPropagation(); changeQty(item.name, item.price, -1); }}
        >−</button>
        <span className="qty-value">{qty}</span>
        <button
          className="qty-btn qty-plus"
          aria-label="Add"
          onClick={e => { e.stopPropagation(); changeQty(item.name, item.price, 1); }}
        >+</button>
      </div>
    );
  }

  function MagazineLayout({ categories }: { categories: MenuCategory[] }) {
    if (!categories.length) return <div className="mag-empty">Menu coming soon — check back shortly.</div>;
    return (
      <>
        {categories.filter(c => c.items.length).map(cat => {
          const catImg = CAT_IMAGES[cat.id] || null;
          return (
            <section key={cat.id} className="mag-section" id={`cat-${cat.id}`} data-cat={cat.id}>
              <div className="mag-cat-banner">
                {catImg && <img className="mag-cat-banner-img" src={catImg} alt={cat.name} loading="lazy" />}
                <div className="mag-cat-banner-overlay" />
                <div className="mag-cat-banner-body">
                  <span className="mag-cat-banner-emoji">{cat.emoji || '🍽️'}</span>
                  <h2 className="mag-cat-banner-name">{cat.name}</h2>
                </div>
              </div>
              <div className="mag-grid">
                {cat.items.map(item => (
                  <div
                    key={item.name}
                    className={`mag-card${item.available === false ? ' sold-out' : ''}`}
                    data-item={item.name}
                    data-cat={cat.id}
                    onClick={() => { if (item.ada) { adaSpeak(item.ada, 5500); resetIdleTimer(); } }}
                  >
                    <div className="mag-card-img-wrap">
                      {item.image_url && <img className="mag-card-img" src={item.image_url} alt={item.name} loading="lazy" />}
                    </div>
                    <div className="mag-card-body">
                      <p className="mag-card-name">{item.name}</p>
                      <div className="mag-card-footer">
                        <span className="mag-card-price">{fmt(item.price)}</span>
                        <QtyStepper item={item} isMag />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </>
    );
  }

  function ClassicLayout({ categories }: { categories: MenuCategory[] }) {
    if (!categories.length) return <div className="mag-empty">Menu coming soon — check back shortly.</div>;
    return (
      <>
        {categories.filter(c => c.items.length).map(cat => (
          <section key={cat.id} className="classic-section" id={`cat-${cat.id}`} data-cat={cat.id}>
            <div className="classic-cat-header">
              <span className="classic-cat-emoji">{cat.emoji || ''}</span>
              <h2 className="classic-cat-name">{cat.name}</h2>
            </div>
            <div className="classic-items">
              {cat.items.map(item => (
                <div
                  key={item.name}
                  className={`classic-item${item.available === false ? ' sold-out' : ''}`}
                  data-item={item.name}
                  data-cat={cat.id}
                  onClick={() => { if (item.ada) { adaSpeak(item.ada, 5500); resetIdleTimer(); } }}
                >
                  <div className="classic-item-body">
                    <p className="classic-item-name">{item.name}</p>
                    {item.description && <p className="classic-item-desc">{item.description}</p>}
                  </div>
                  <div className="classic-item-right">
                    <p className="classic-item-price">{fmt(item.price)}</p>
                    <QtyStepper item={item} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </>
    );
  }

  function VisualGridLayout({ categories }: { categories: MenuCategory[] }) {
    if (!categories.length) return <div className="mag-empty">Menu coming soon — check back shortly.</div>;
    return (
      <>
        {categories.filter(c => c.items.length).map(cat => {
          const fallback = CAT_IMAGES[cat.id] || null;
          return (
            <section key={cat.id} className="vgrid-section" id={`cat-${cat.id}`} data-cat={cat.id}>
              <div className="vgrid-cat-header">
                <span className="vgrid-cat-emoji">{cat.emoji || ''}</span>
                <h2 className="vgrid-cat-name">{cat.name}</h2>
              </div>
              <div className="vgrid-items">
                {cat.items.map(item => {
                  const imgSrc = item.image_url || fallback;
                  return (
                    <div
                      key={item.name}
                      className={`vgrid-card${item.available === false ? ' sold-out' : ''}`}
                      data-item={item.name}
                      data-cat={cat.id}
                      onClick={() => { if (item.ada) { adaSpeak(item.ada, 5500); resetIdleTimer(); } }}
                    >
                      <div className="vgrid-img-wrap">
                        {imgSrc
                          ? <img className="vgrid-img" src={imgSrc} alt={item.name} loading="lazy" />
                          : <div className="vgrid-img-placeholder">🍽️</div>
                        }
                        {item.available === false && <span className="vgrid-sold-badge">Sold Out</span>}
                      </div>
                      <div className="vgrid-body">
                        <p className="vgrid-name">{item.name}</p>
                        <div className="vgrid-footer">
                          <span className="vgrid-price">{fmt(item.price)}</span>
                          <QtyStepper item={item} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </>
    );
  }

  function MenuContent() {
    const categories = menuData?.categories ?? [];
    const layout     = menuData?.restaurant?.menu_layout || 'magazine';
    if (layout === 'classic') return <ClassicLayout categories={categories} />;
    if (layout === 'grid')    return <VisualGridLayout categories={categories} />;
    return <MagazineLayout categories={categories} />;
  }

  const restaurant = menuData?.restaurant;
  const paid       = restaurant ? isPaidPlan(restaurant) : false;

  // ── JSX ────────────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Splash Screen ─────────────────────────────────────────────── */}
      {!splashGone && (
        <div
          id="splashScreen"
          className={`splash-screen${splashHiding ? ' splash-hiding' : ''}`}
          aria-label="Loading menu"
        >
          <div className="splash-content">
            <div className="splash-header">
              <p className="splash-restaurant">{restaurant?.name ?? ''}</p>
              <p className="splash-tagline-text">{restaurant?.tagline ?? ''}</p>
            </div>
            <div className="splash-character-wrap">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="splash-character-img" src={splashChar} alt="" aria-hidden="true" />
            </div>
            <div className="splash-dots" aria-hidden="true">
              <span className="splash-dot" />
              <span className="splash-dot" />
              <span className="splash-dot" />
            </div>
          </div>
        </div>
      )}

      {/* ── Main App ──────────────────────────────────────────────────── */}
      <div id="app" className={appVisible ? 'visible' : ''}>

        {/* Error state */}
        {dataError && (
          <div className="mag-empty" style={{ paddingTop: '40vh', fontSize: '1rem', color: 'rgba(255,255,255,0.5)' }}>
            {dataError}
          </div>
        )}

        {/* ── Cover Page ─────────────────────────────────────────────── */}
        {!coverGone && !dataError && (
          <div className={`cover-page${coverExiting ? ' cover-exit' : ''}`}>
            <div
              className="cover-bg"
              style={restaurant?.cover_image ? { backgroundImage: `url('${restaurant.cover_image}')` } : undefined}
            />
            <div className="cover-vignette" />

            {/* Pain-point carousel */}
            <div className="cover-hero-msg">
              <p className={`cover-msg-line1${coverMsgFading ? ' fading' : ''}`}>
                {COVER_MSGS[coverMsgIdx].l1}
              </p>
              <p className={`cover-msg-line2${coverMsgFading ? ' fading' : ''}`}>
                {COVER_MSGS[coverMsgIdx].l2}
              </p>
              <div className="cover-msg-dots">
                {COVER_MSGS.map((_, i) => (
                  <span key={i} className={`cover-msg-dot${i === coverMsgIdx ? ' active' : ''}`} />
                ))}
              </div>
            </div>

            <div className="cover-content">
              <p className="cover-table-badge">Table {table}</p>
              <div className="cover-text">
                <h1 className="cover-restaurant-name">{restaurant?.name ?? '—'}</h1>
                <p className="cover-tagline">{restaurant?.tagline ?? ''}</p>
              </div>

              {/* Character selection */}
              <div className="cover-char-section">
                <p className="cover-char-label">Your waiter tonight</p>
                <div className="cover-char-row">
                  {Object.entries(CHARACTERS).map(([key, char]) => (
                    <button
                      key={key}
                      className={`cover-char-btn${selectedChar === key ? ' selected' : ''}`}
                      onClick={() => handleCharSelect(key)}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={char.src} alt={char.name} className="cover-char-btn-img" />
                      <span className="cover-char-btn-name">{char.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              <button className="cover-cta" onClick={handleCoverCta}>
                <span>🍽️</span>
                <span>Open Menu</span>
              </button>
              <p className="cover-hint">Scroll to browse · Tap + to order</p>
            </div>
          </div>
        )}

        {/* ── Compact sticky header ──────────────────────────────────── */}
        <header className={`mag-header${headerVisible ? '' : ' mag-header-hidden'}`}>
          <div className="mag-header-left">
            <span className="mag-header-name">{restaurant?.name ?? '—'}</span>
            <span className="mag-header-table">Table {table}</span>
          </div>
          <div className="mag-header-right">
            <a href="https://dashboard.virtualwaitress.com" className="mag-header-signin">Sign In</a>
            <button className="mag-header-menu-btn" onClick={openCmenu} aria-label="Open menu">☰</button>
          </div>
        </header>

        {/* ── Category pill nav ──────────────────────────────────────── */}
        <nav className={`mag-nav${navVisible ? '' : ' mag-nav-hidden'}`} aria-label="Menu categories">
          <div className="mag-nav-inner" ref={navInnerRef}>
            {menuData?.categories.filter(c => c.items.length).map(c => (
              <button
                key={c.id}
                className={`mag-pill${activeCat === c.id ? ' active' : ''}`}
                data-cat={c.id}
                onClick={() => {
                  const section = document.getElementById('cat-' + c.id);
                  if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
              >
                {c.emoji || ''} {c.name}
              </button>
            ))}
          </div>
        </nav>

        {/* ── Menu content ──────────────────────────────────────────── */}
        <main id="magContent" className="mag-content">
          {!menuData && !dataError ? (
            <div className="menu-content">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="skeleton-item" style={{ marginBottom: 10 }} />
              ))}
            </div>
          ) : menuData ? (
            <MenuContent />
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
        <div className={`order-summary-bar${itemCount > 0 ? ' visible' : ''}`}>
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
          <button
            className="place-order-btn"
            onClick={handlePlaceOrder}
            disabled={placeOrderDisabled}
          >
            <span className="place-order-badge">{itemCount}</span>
            <span className="place-order-main">🛒 Place Order</span>
            <span className="place-order-sub">and get served</span>
          </button>
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
            <p className="cmenu-table-label">Table {table}</p>
          </div>
          <button className="cmenu-close" onClick={closeCmenu} aria-label="Close menu">✕</button>
        </div>
        <div className="cmenu-body">
          <button
            className="cmenu-item"
            onClick={() => { closeCmenu(); openMyOrders(); }}
          >
            <span className="cmenu-item-icon">📋</span>
            <span className="cmenu-item-label">My Orders</span>
            <span className="cmenu-item-arrow">›</span>
          </button>
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
                <span className="my-order-table-pill">Table {table}</span>
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
                  <p className="my-order-empty-sub">Tap the + on any dish to start your order.</p>
                </div>
              ) : (
                <>
                  {myOrders.map(order => {
                    const { label, icon, cls } = orderStatus(order.status);
                    const time = new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    return (
                      <div key={order.id} className="my-order-block">
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

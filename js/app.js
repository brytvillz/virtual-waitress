// Virtual Waitress — Magazine layout

const CAT_IMAGES = {
  soups:         'images/cat-soups.jpg',
  swallows:      'images/cat-swallows.jpg',
  rice:          'images/cat-rice.jpg',
  grills:        'images/cat-grills.jpg',
  'small-chops': 'images/cat-small-chops.jpg',
  drinks:        'images/cat-drinks.jpg',
};

const CHARACTERS = {
  ada:       { src: 'images/ada.png',       name: 'Ada'        },
  chisom:    { src: 'images/chisom.png',    name: 'Chisom'     },
  emeka:     { src: 'images/emeka.png',     name: 'Emeka'      },
  mamachef:  { src: 'images/mamachef.png',  name: 'Mama Chef'  },
  cheftunde: { src: 'images/cheftunde.png', name: 'Chef Tunde' },
};

const CATEGORY_CHARACTER = {
  soups:         'ada',
  swallows:      'ada',
  rice:          'emeka',
  grills:        'cheftunde',
  'small-chops': 'chisom',
  drinks:        'chisom',
};

let MENU_CACHE_KEY;
let menuData   = null;
let idleTimer  = null;
let orderState = {};

function getRestaurantSlug() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts.length >= 1 && /^[a-z0-9][a-z0-9-]*$/.test(parts[0])) return parts[0];
  const raw = new URLSearchParams(window.location.search).get('r');
  return (raw && /^[a-z0-9-]+$/.test(raw)) ? raw : null;
}

function getTableNumber() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts.length >= 2 && /^\d+$/.test(parts[1])) {
    const n = parseInt(parts[1], 10);
    if (n >= 1 && n <= 999) return String(n);
  }
  const raw = new URLSearchParams(window.location.search).get('table');
  const n   = parseInt(raw, 10);
  return (Number.isInteger(n) && n >= 1 && n <= 999) ? String(n) : '1';
}

function formatPrice(amount) {
  return '₦' + Number(amount).toLocaleString('en-NG');
}

// ── Data loading ──────────────────────────────────────────────────────────────

async function loadMenuData() {
  try {
    const [{ data: restaurant, error: rErr }, { data: categories, error: cErr }, { data: items, error: iErr }] = await Promise.all([
      db.from('restaurants').select('*').eq('id', RESTAURANT_ID).single(),
      db.from('menu_categories').select('*').eq('restaurant_id', RESTAURANT_ID).order('sort_order'),
      db.from('menu_items').select('*').eq('restaurant_id', RESTAURANT_ID).order('sort_order'),
    ]);
    if (rErr) throw rErr;
    if (cErr) throw cErr;
    if (iErr) throw iErr;

    const categoryMessages = { all: "Here's everything we serve — tap any dish to learn more, or hit + to order." };
    categories.forEach(c => { categoryMessages[c.slug] = c.ada_message; });

    const data = {
      restaurant: {
        name:            restaurant.name,
        tagline:         restaurant.tagline,
        whatsapp:        restaurant.whatsapp,
        accentColor:     restaurant.accent_color,
        cover_image:     restaurant.cover_image || null,
        plan:            restaurant.plan            || 'free',
        plan_status:     restaurant.plan_status     || 'inactive',
        plan_expires_at: restaurant.plan_expires_at || null,
      },
      ada: {
        name:    restaurant.ada_name,
        emoji:   restaurant.ada_emoji,
        welcome: restaurant.ada_welcome,
        idle:    restaurant.ada_idle,
        categoryMessages,
      },
      categories: categories.map(c => ({
        id:    c.slug,
        name:  c.name,
        emoji: c.emoji,
        items: items
          .filter(i => i.category_id === c.id)
          .map(i => ({
            name:        i.name,
            price:       i.price,
            description: i.description,
            ada:         i.ada_message,
            available:   i.available,
            image_url:   i.image_url || null,
          })),
      })),
    };

    localStorage.setItem(MENU_CACHE_KEY, JSON.stringify(data));
    return data;
  } catch (err) {
    console.error('Supabase fetch failed — trying cache', err);
    const cached = localStorage.getItem(MENU_CACHE_KEY);
    if (cached) return JSON.parse(cached);
    throw err;
  }
}

// ── Character swap ────────────────────────────────────────────────────────────

function setCharacter(key) {
  const char = CHARACTERS[key];
  if (!char) return;
  const img = document.getElementById('adaImg');
  if (!img) return;
  const test = new Image();
  test.onload = () => {
    img.style.opacity = '0';
    img.style.transform = 'scale(0.85)';
    setTimeout(() => {
      img.src = char.src;
      img.style.transition = 'opacity 0.35s ease, transform 0.35s ease';
      img.style.opacity = '1';
      img.style.transform = 'scale(1)';
    }, 200);
  };
  test.src = char.src;
}

// ── Ada controller ────────────────────────────────────────────────────────────

const Ada = {
  speakTimer: null,

  speak(message, duration = 5000) {
    const container = document.getElementById('adaContainer');
    const bubble    = document.getElementById('speechBubble');
    const text      = document.getElementById('speechText');
    const avatar    = document.getElementById('adaCharacter');
    if (!container) return;
    clearTimeout(this.speakTimer);
    text.textContent = message;
    container.classList.add('visible');
    bubble.classList.add('visible');
    avatar.classList.add('speaking');
    this.speakTimer = setTimeout(() => {
      bubble.classList.remove('visible');
      avatar.classList.remove('speaking');
      container.classList.remove('visible');
    }, duration);
  },

  hide() {
    clearTimeout(this.speakTimer);
    const container = document.getElementById('adaContainer');
    const bubble    = document.getElementById('speechBubble');
    const avatar    = document.getElementById('adaCharacter');
    if (!container) return;
    bubble.classList.remove('visible');
    avatar.classList.remove('speaking');
    container.classList.remove('visible');
  },

  resetIdleTimer() {
    clearTimeout(idleTimer);
    if (menuData?.ada?.idle) {
      idleTimer = setTimeout(() => Ada.speak(menuData.ada.idle, 6000), 30000);
    }
  },
};

// ── Order state ───────────────────────────────────────────────────────────────

function changeQty(name, price, delta) {
  const current = orderState[name] || { qty: 0, price };
  const next    = Math.max(0, current.qty + delta);
  if (next === 0) delete orderState[name];
  else orderState[name] = { qty: next, price };
  syncQtyDisplays();
  updateOrderSummary();
}

function syncQtyDisplays() {
  document.querySelectorAll('.qty-stepper').forEach(stepper => {
    const qty = (orderState[stepper.dataset.item] || {}).qty || 0;
    stepper.querySelector('.qty-value').textContent = qty;
  });
}

function updateOrderSummary() {
  const items     = Object.values(orderState);
  const itemCount = items.reduce((s, i) => s + i.qty, 0);
  const total     = items.reduce((s, i) => s + i.qty * i.price, 0);

  document.getElementById('orderItemCount').textContent = itemCount === 1 ? '1 item' : `${itemCount} items`;
  document.getElementById('orderTotal').textContent     = formatPrice(total);
  document.getElementById('placeOrderBadge').textContent = itemCount;

  const hasItems = itemCount > 0;
  document.getElementById('orderSummaryBar').classList.toggle('visible', hasItems);
  document.getElementById('adaContainer').classList.toggle('lifted', hasItems);
}

// ── Magazine rendering ────────────────────────────────────────────────────────

function renderHeroItem(item, catId, catImgSrc) {
  const soldOut = item.available === false;
  const qty     = (orderState[item.name] || {}).qty || 0;
  const imgSrc  = item.image_url || catImgSrc;

  const stepper = soldOut
    ? '<span class="item-sold-out-tag">Sold Out</span>'
    : `<div class="qty-stepper" data-item="${item.name}" data-price="${item.price}">
         <button class="qty-btn qty-minus" aria-label="Remove">−</button>
         <span class="qty-value">${qty}</span>
         <button class="qty-btn qty-plus" aria-label="Add">+</button>
       </div>`;

  return `
    <div class="mag-hero ${soldOut ? 'sold-out' : ''}" data-item="${item.name}" data-cat="${catId}">
      <div class="mag-hero-visual">
        ${imgSrc ? `<img class="mag-hero-img" src="${imgSrc}" alt="${item.name}" loading="lazy" />` : ''}
        <div class="mag-hero-overlay"></div>
        <div class="mag-hero-body">
          <h3 class="mag-hero-name">${item.name}</h3>
          ${item.description ? `<p class="mag-hero-desc">${item.description}</p>` : ''}
          <div class="mag-hero-footer">
            <span class="mag-hero-price">${formatPrice(item.price)}</span>
            ${stepper}
          </div>
        </div>
      </div>
    </div>`;
}

function renderGridCard(item, catId) {
  const soldOut = item.available === false;
  const qty     = (orderState[item.name] || {}).qty || 0;

  const stepper = soldOut
    ? '<span class="item-sold-out-tag">Sold Out</span>'
    : `<div class="qty-stepper mag-stepper" data-item="${item.name}" data-price="${item.price}">
         <button class="qty-btn qty-minus" aria-label="Remove">−</button>
         <span class="qty-value">${qty}</span>
         <button class="qty-btn qty-plus" aria-label="Add">+</button>
       </div>`;

  return `
    <div class="mag-card ${soldOut ? 'sold-out' : ''}" data-item="${item.name}" data-cat="${catId}">
      <div class="mag-card-img-wrap">
        ${item.image_url ? `<img class="mag-card-img" src="${item.image_url}" alt="${item.name}" loading="lazy" />` : ''}
      </div>
      <div class="mag-card-body">
        <p class="mag-card-name">${item.name}</p>
        <div class="mag-card-footer">
          <span class="mag-card-price">${formatPrice(item.price)}</span>
          ${stepper}
        </div>
      </div>
    </div>`;
}

function renderCategorySection(cat) {
  if (!cat.items.length) return '';
  const [hero, ...rest] = cat.items;
  const catImg = CAT_IMAGES[cat.id] || null;

  return `
    <section class="mag-section" id="cat-${cat.id}" data-cat="${cat.id}">
      <div class="mag-section-label">
        <div class="mag-section-line"></div>
        <span class="mag-section-emoji">${cat.emoji || '🍽️'}</span>
        <h2 class="mag-section-title">${cat.name}</h2>
        <div class="mag-section-line"></div>
      </div>
      ${renderHeroItem(hero, cat.id, catImg)}
      ${rest.length ? `<div class="mag-grid">${rest.map(i => renderGridCard(i, cat.id)).join('')}</div>` : ''}
    </section>`;
}

function wireQtySteppers(container, allItems) {
  container.querySelectorAll('.qty-stepper').forEach(stepper => {
    const name  = stepper.dataset.item;
    const price = Number(stepper.dataset.price);
    const item  = allItems[name];
    if (!item || item.available === false) return;
    stepper.querySelector('.qty-minus').addEventListener('click', e => { e.stopPropagation(); changeQty(name, price, -1); });
    stepper.querySelector('.qty-plus').addEventListener('click',  e => { e.stopPropagation(); changeQty(name, price, 1);  });
  });

  // Item tap → Ada speaks item message
  container.querySelectorAll('[data-item]').forEach(el => {
    const item = allItems[el.dataset.item];
    if (item?.ada) {
      el.addEventListener('click', () => {
        Ada.speak(item.ada, 5500);
        Ada.resetIdleTimer();
      });
    }
  });
}

function initCategoryNav(categories) {
  const inner = document.getElementById('magNavInner');
  inner.innerHTML = categories
    .filter(c => c.items.length)
    .map(c => `<button class="mag-pill" data-cat="${c.id}">${c.emoji || ''} ${c.name}</button>`)
    .join('');

  inner.querySelectorAll('.mag-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const section = document.getElementById('cat-' + pill.dataset.cat);
      if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  // Scroll spy — highlight pill + trigger Ada as each section enters view
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const catId = entry.target.dataset.cat;

      // Update pill
      inner.querySelectorAll('.mag-pill').forEach(p => p.classList.toggle('active', p.dataset.cat === catId));
      const activePill = inner.querySelector('.mag-pill.active');
      if (activePill) activePill.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });

      // Character + Ada message
      setCharacter(CATEGORY_CHARACTER[catId] || 'ada');
      const msg = menuData?.ada?.categoryMessages?.[catId];
      if (msg) Ada.speak(msg, 5000);
    });
  }, { threshold: 0.25, rootMargin: '-52px 0px -55% 0px' });

  categories.forEach(cat => {
    const section = document.getElementById('cat-' + cat.id);
    if (section) observer.observe(section);
  });
}

function renderMagazine(categories) {
  const content = document.getElementById('magContent');
  if (!categories.length) {
    content.innerHTML = '<div class="mag-empty">Menu coming soon — check back shortly.</div>';
    return;
  }

  content.innerHTML = categories.map(cat => renderCategorySection(cat)).join('');

  const allItems = {};
  categories.forEach(cat => cat.items.forEach(i => { allItems[i.name] = i; }));
  wireQtySteppers(content, allItems);

  initCategoryNav(categories);
}

// ── Cover page ────────────────────────────────────────────────────────────────

function showCover() {
  const cover = document.getElementById('coverPage');
  if (cover) cover.classList.remove('cover-gone');
}

function hideCover() {
  const cover  = document.getElementById('coverPage');
  const header = document.getElementById('magHeader');
  const nav    = document.getElementById('magNav');
  if (!cover) return;
  cover.classList.add('cover-exit');
  setTimeout(() => {
    cover.classList.add('cover-gone');
    if (header) { header.classList.remove('mag-header-hidden'); }
    if (nav)    { nav.classList.remove('mag-nav-hidden'); }
  }, 740);
}

function initCoverCta() {
  const btn = document.getElementById('coverCta');
  if (!btn) return;
  btn.addEventListener('click', () => {
    hideCover();
    setTimeout(() => {
      if (menuData?.ada?.welcome) {
        Ada.speak(menuData.ada.welcome, 7000);
        Ada.resetIdleTimer();
      }
    }, 800);
  });
}

// ── Branding ──────────────────────────────────────────────────────────────────

function applyBranding(restaurant) {
  splashUpdate(restaurant);
  const table = getTableNumber();

  const el = (id) => document.getElementById(id);
  if (el('coverRestaurantName')) el('coverRestaurantName').textContent = restaurant.name || '';
  if (el('coverTagline'))        el('coverTagline').textContent        = restaurant.tagline || '';
  if (el('coverTable'))          el('coverTable').textContent          = 'Table ' + table;
  if (el('magRestaurantName'))   el('magRestaurantName').textContent   = restaurant.name || '';
  if (el('magTableBadge'))       el('magTableBadge').textContent       = 'Table ' + table;

  document.documentElement.style.setProperty('--accent', restaurant.accentColor || '#C41E3A');

  const coverBg = el('coverBg');
  if (coverBg && restaurant.cover_image) {
    coverBg.style.backgroundImage = `url('${restaurant.cover_image}')`;
  }

  const notExpired = !restaurant.plan_expires_at || new Date(restaurant.plan_expires_at) > new Date();
  const isPaid     = restaurant.plan_status === 'active' && restaurant.plan !== 'free' && notExpired;
  const badge      = el('vwPoweredBadge');
  if (badge) badge.classList.toggle('vw-badge-hidden', isPaid);
}

function applyMagazine(categories, isFirstRender) {
  renderMagazine(categories);
  if (isFirstRender) {
    initCallWaiter();
    initPlaceOrder();
    initAdaClick();
    initMyOrder();
    initHamburgerMenu();
    initCoverCta();
  }
}

// ── Call waiter ───────────────────────────────────────────────────────────────

function initCallWaiter() {
  const table = getTableNumber();
  const btn   = document.getElementById('callWaiterBtn');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const { error } = await db.from('waiter_calls').insert({
      restaurant_id: RESTAURANT_ID,
      table_number:  Number(table),
      status:        'pending',
    });
    btn.disabled = false;
    if (error) {
      Ada.speak("Hmm, that didn't go through — please try again 🙏", 5500);
    } else {
      Ada.speak(`I've called your waiter! 😊 Someone will be at Table ${table} shortly.`, 6000);
    }
    Ada.resetIdleTimer();
  });
}

// ── Place order ───────────────────────────────────────────────────────────────

function showOrderConfirmation(table, itemCount, total) {
  document.getElementById('orderConfirmOverlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'orderConfirmOverlay';
  overlay.className = 'oc-overlay';
  overlay.innerHTML =
    '<div class="oc-card">' +
      '<div class="oc-check">&#10003;</div>' +
      '<h2 class="oc-title">Order Confirmed!</h2>' +
      '<p class="oc-meta">Table ' + table + ' &middot; ' + itemCount + ' item' + (itemCount !== 1 ? 's' : '') + ' &middot; ' + formatPrice(total) + '</p>' +
      '<p class="oc-sub">Your waiter has been notified.<br>Sit back and enjoy!</p>' +
      '<button class="oc-btn" id="ocDismiss">Back to Menu</button>' +
      '<div class="oc-progress"><div class="oc-progress-bar"></div></div>' +
    '</div>';
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('oc-visible'));
  const dismiss = () => { clearTimeout(autoTimer); overlay.classList.remove('oc-visible'); setTimeout(() => overlay.remove(), 400); };
  const autoTimer = setTimeout(dismiss, 4000);
  document.getElementById('ocDismiss').addEventListener('click', dismiss);
}

function initPlaceOrder() {
  const btn = document.getElementById('placeOrderBtn');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    const items = Object.entries(orderState);
    if (!items.length) {
      Ada.speak("Your order is empty! Tap + next to a dish to add it first 😊", 5000);
      Ada.resetIdleTimer();
      return;
    }

    const table   = getTableNumber();
    const total   = items.reduce((s, [, i]) => s + i.qty * i.price, 0);
    const orderId = crypto.randomUUID();
    btn.disabled  = true;

    const { error: orderError } = await db.from('orders').insert({
      id: orderId, restaurant_id: RESTAURANT_ID, table_number: Number(table), status: 'pending', total,
    });

    if (orderError) {
      btn.disabled = false;
      Ada.speak("Hmm, that didn't go through — please try again 🙏", 5500);
      Ada.resetIdleTimer();
      return;
    }

    const { error: itemsError } = await db.from('order_items').insert(
      items.map(([name, i]) => ({ order_id: orderId, item_name: name, quantity: i.qty, price: i.price }))
    );

    btn.disabled = false;

    if (itemsError) {
      Ada.speak("Order started but something went wrong — please call your waiter to confirm 🙏", 6000);
      Ada.resetIdleTimer();
      return;
    }

    showOrderConfirmation(table, items.length, total);
    Ada.speak(`Order sent! 🎉 The kitchen has your order for Table ${table}. Sit tight!`, 6000);
    Ada.resetIdleTimer();
    orderState = {};
    syncQtyDisplays();
    updateOrderSummary();
  });
}

// ── Ada tap ───────────────────────────────────────────────────────────────────

function initAdaClick() {
  const btn = document.getElementById('adaCharacter');
  if (!btn) return;
  btn.addEventListener('click', () => {
    Ada.speak(menuData?.ada?.welcome || "Welcome!", 5500);
    Ada.resetIdleTimer();
  });
  window.addEventListener('scroll', () => Ada.hide(), { passive: true });
}

// ── Hamburger menu ────────────────────────────────────────────────────────────

function initHamburgerMenu() {
  const panel   = document.getElementById('customerMenuPanel');
  const overlay = document.getElementById('customerMenuOverlay');
  const table   = getTableNumber();

  const nameEl  = document.getElementById('cmenuRestaurantName');
  const tableEl = document.getElementById('cmenuTableLabel');
  if (nameEl)  nameEl.textContent  = menuData?.restaurant?.name || '';
  if (tableEl) tableEl.textContent = 'Table ' + table;

  function openPanel() {
    overlay.classList.remove('admin-hidden');
    panel.classList.remove('admin-hidden');
    requestAnimationFrame(() => panel.classList.add('open'));
  }
  function closePanel() {
    panel.classList.remove('open');
    setTimeout(() => { panel.classList.add('admin-hidden'); overlay.classList.add('admin-hidden'); }, 280);
  }

  // Hamburger is now in mag-header
  document.getElementById('magMenuBtn')?.addEventListener('click', openPanel);
  document.getElementById('customerMenuCloseBtn')?.addEventListener('click', closePanel);
  overlay.addEventListener('click', closePanel);

  document.getElementById('cmenuMyOrdersBtn')?.addEventListener('click', () => { closePanel(); openMyOrderModal(); });
  document.getElementById('cmenuCallWaiterBtn')?.addEventListener('click', () => { closePanel(); document.getElementById('callWaiterBtn')?.click(); });
}

// ── My Orders ────────────────────────────────────────────────────────────────

function formatOrderStatus(s) {
  if (s === 'preparing') return { label: 'Preparing', icon: '👨‍🍳', cls: 'status-preparing' };
  if (s === 'served')    return { label: 'Served',    icon: '✅', cls: 'status-served' };
  return { label: 'Pending', icon: '⏳', cls: 'status-pending' };
}
function formatOrderTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

async function loadMyOrders() {
  const table   = getTableNumber();
  const content = document.getElementById('myOrderContent');
  content.innerHTML = '<p class="my-order-empty">Loading…</p>';
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/table-orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ restaurant_id: RESTAURANT_ID, table_number: Number(table) }),
    });
    const { orders, error } = await res.json();
    if (error || !res.ok) throw new Error(error || 'Failed');
    renderMyOrders(orders || []);
  } catch (err) {
    content.innerHTML = '<p class="my-order-empty">Could not load orders — check your connection.</p>';
  }
}

function renderMyOrders(orders) {
  const content = document.getElementById('myOrderContent');
  if (!orders.length) {
    content.innerHTML = `
      <div class="my-order-empty-state">
        <p class="my-order-empty-icon">🍽️</p>
        <p class="my-order-empty-text">No orders yet at this table.</p>
        <p class="my-order-empty-sub">Tap the + on any dish to start your order.</p>
      </div>`;
    return;
  }
  const grandTotal   = orders.reduce((s, o) => s + o.total, 0);
  const orderBlocks  = orders.map(order => {
    const { label, icon, cls } = formatOrderStatus(order.status);
    const time     = formatOrderTime(order.created_at);
    const itemRows = (order.order_items || []).map(i =>
      `<div class="my-order-item-row">
        <span class="my-order-item-name"><span class="my-order-item-qty">${i.quantity}×</span> ${i.item_name}</span>
        <span class="my-order-item-price">₦${(i.quantity * i.price).toLocaleString()}</span>
      </div>`
    ).join('');
    return `
      <div class="my-order-block">
        <div class="my-order-block-header">
          <div class="my-order-status-group">
            <span class="my-order-status ${cls}">${icon} ${label}</span>
            <span class="my-order-time">${time}</span>
          </div>
          <span class="my-order-subtotal">₦${order.total.toLocaleString()}</span>
        </div>
        <div class="my-order-items">${itemRows}</div>
      </div>`;
  }).join('');
  content.innerHTML = orderBlocks +
    `<div class="my-order-total-row"><span>Total Bill</span><span>₦${grandTotal.toLocaleString()}</span></div>
     <p class="my-order-hint">Tap ↻ to check for updates</p>`;
}

function openMyOrderModal() {
  document.getElementById('myOrderModal').classList.remove('admin-hidden');
  loadMyOrders();
}

function initMyOrder() {
  document.getElementById('myOrderTableNum').textContent = getTableNumber();
  document.getElementById('myOrderCloseBtn').addEventListener('click', () => document.getElementById('myOrderModal').classList.add('admin-hidden'));
  document.getElementById('myOrderRefreshBtn').addEventListener('click', loadMyOrders);
  document.getElementById('myOrderModal').addEventListener('click', e => { if (e.target === document.getElementById('myOrderModal')) document.getElementById('myOrderModal').classList.add('admin-hidden'); });
}

// ── Splash ────────────────────────────────────────────────────────────────────

const SPLASH_MIN_MS = 5000;
const SPLASH_CHARS  = ['images/ada.png', 'images/chisom.png', 'images/emeka.png', 'images/mamachef.png', 'images/cheftunde.png'];
let _splashStart = 0;

function splashStart() {
  _splashStart = Date.now();
  const img = document.getElementById('splashAdaImg');
  if (img) img.src = SPLASH_CHARS[Math.floor(Math.random() * SPLASH_CHARS.length)];
}

function splashUpdate(restaurant) {
  const nameEl = document.getElementById('splashRestaurant');
  const tagEl  = document.getElementById('splashTagline');
  if (nameEl) nameEl.textContent = restaurant.name    || '';
  if (tagEl)  tagEl.textContent  = restaurant.tagline || '';
  document.documentElement.style.setProperty('--accent', restaurant.accentColor || '#C41E3A');
}

async function splashHide(fast = false) {
  if (!fast) {
    const elapsed   = Date.now() - _splashStart;
    const remaining = Math.max(0, SPLASH_MIN_MS - elapsed);
    await new Promise(r => setTimeout(r, remaining));
  }
  const el = document.getElementById('splashScreen');
  if (!el) return;
  el.classList.add('splash-hiding');
  setTimeout(() => el.remove(), 600);
}

function splashError(title, sub) {
  const nameEl = document.getElementById('splashRestaurant');
  const tagEl  = document.getElementById('splashTagline');
  const msgEl  = document.querySelector('.splash-message');
  const dots   = document.querySelector('.splash-dots');
  if (nameEl) nameEl.textContent = title;
  if (tagEl)  tagEl.textContent  = sub || 'Please reload or scan the QR code again.';
  if (msgEl)  msgEl.textContent  = '';
  if (dots)   dots.style.display = 'none';
}

// ── Boot ──────────────────────────────────────────────────────────────────────

function revealApp() {
  document.getElementById('app').classList.add('visible');
}

async function init() {
  const slug = getRestaurantSlug() || 'nnewi-buka';
  splashStart();
  MENU_CACHE_KEY = 'vw_menu_cache_' + slug;

  const { data: restaurantRow, error: slugError } = await db
    .from('restaurants').select('id').eq('slug', slug).single();

  if (slugError || !restaurantRow) {
    splashError('Restaurant not found', 'Please scan the QR code at your table again.');
    return;
  }

  RESTAURANT_ID = restaurantRow.id;

  const cachedRaw = localStorage.getItem(MENU_CACHE_KEY);
  const cached    = cachedRaw ? JSON.parse(cachedRaw) : null;

  if (cached) {
    menuData = cached;
    applyBranding(menuData.restaurant);
    applyMagazine(menuData.categories, true);
    revealApp();
    splashHide(true);

    // Refresh in background
    loadMenuData().then(fresh => {
      if (JSON.stringify(fresh) !== JSON.stringify(cached)) {
        menuData = fresh;
        applyBranding(menuData.restaurant);
        applyMagazine(menuData.categories, false);
      }
    }).catch(() => {});
  } else {
    document.getElementById('magContent').innerHTML =
      Array.from({ length: 6 }, () => '<div class="skeleton-item"></div>').join('');
    revealApp();
    splashHide();

    try {
      menuData = await loadMenuData();
    } catch {
      document.getElementById('magContent').innerHTML =
        '<div class="mag-empty">Unable to load menu — please reload the page.</div>';
      return;
    }

    applyBranding(menuData.restaurant);
    applyMagazine(menuData.categories, true);
  }
}

document.addEventListener('DOMContentLoaded', init);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}

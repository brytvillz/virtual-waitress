// Virtual Waitress MVP — NgwaNgwa Digital
// Demo restaurant: Nnewi Buka

// Category images keyed by slug — falls back to emoji if no image for that slug
const CAT_IMAGES = {
  soups:         'images/cat-soups.jpg',
  swallows:      'images/cat-swallows.jpg',
  rice:          'images/cat-rice.jpg',
  grills:        'images/cat-grills.jpg',
  'small-chops': 'images/cat-small-chops.jpg',
  drinks:        'images/cat-drinks.jpg',
};

// Character roster — images added as they're generated
const CHARACTERS = {
  ada:       { src: 'images/ada.png',       name: 'Ada'         },
  chisom:    { src: 'images/chisom.png',    name: 'Chisom'      },
  emeka:     { src: 'images/emeka.png',     name: 'Emeka'       },
  mamachef:  { src: 'images/mamachef.png',  name: 'Mama Chef'   },
  cheftunde: { src: 'images/cheftunde.png', name: 'Chef Tunde'  },
};

// Which character speaks per category
const CATEGORY_CHARACTER = {
  soups:        'ada',
  swallows:     'ada',
  rice:         'emeka',
  grills:       'cheftunde',
  'small-chops':'chisom',
  drinks:       'chisom',
};

// Menu content (restaurant info, categories, items, Ada's messages) now lives
// in Supabase — see loadMenuData() below. A copy is cached in localStorage so
// the menu still loads if a customer opens the app with a bad connection.
// Key uses the slug (known before the ID is resolved) for cache separation per restaurant.
let MENU_CACHE_KEY;

async function loadMenuData() {
  try {
    const [{ data: restaurant, error: rErr }, { data: categories, error: cErr }, { data: items, error: iErr }] = await Promise.all([
      db.from('restaurants').select('*').eq('id', RESTAURANT_ID).single(),
      db.from('menu_categories').select('*').eq('restaurant_id', RESTAURANT_ID).order('sort_order'),
      db.from('menu_items').select('*').eq('restaurant_id', RESTAURANT_ID).order('sort_order')
    ]);
    if (rErr) throw rErr;
    if (cErr) throw cErr;
    if (iErr) throw iErr;

    const categoryMessages = { all: "Here's everything we serve, all in one place! 🍽️ Tap any dish to learn more, or use the + to start your order." };
    categories.forEach(c => { categoryMessages[c.slug] = c.ada_message; });

    const data = {
      restaurant: {
        name: restaurant.name,
        tagline: restaurant.tagline,
        whatsapp: restaurant.whatsapp,
        accentColor: restaurant.accent_color
      },
      ada: {
        name: restaurant.ada_name,
        emoji: restaurant.ada_emoji,
        welcome: restaurant.ada_welcome,
        idle: restaurant.ada_idle,
        categoryMessages
      },
      categories: categories.map(c => ({
        id: c.slug,
        name: c.name,
        emoji: c.emoji,
        items: items
          .filter(i => i.category_id === c.id)
          .map(i => ({ name: i.name, price: i.price, description: i.description, ada: i.ada_message, available: i.available }))
      }))
    };

    localStorage.setItem(MENU_CACHE_KEY, JSON.stringify(data));
    return data;
  } catch (err) {
    console.error('Failed to load menu from Supabase, trying cached copy', err);
    const cached = localStorage.getItem(MENU_CACHE_KEY);
    if (cached) return JSON.parse(cached);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

let menuData       = null;
let activeCategory = null;
let idleTimer      = null;
let orderState      = {}; // { itemName: { qty, price } }
let tabAutoSlideTimer = null;

function getRestaurantSlug() {
  // Path-based: app.virtualwaitress.com/nnewi-buka/1
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts.length >= 1 && /^[a-z0-9][a-z0-9-]*$/.test(parts[0])) {
    return parts[0];
  }
  // Backward compat: ?r=slug (old QR codes still work)
  const raw = new URLSearchParams(window.location.search).get('r');
  return (raw && /^[a-z0-9-]+$/.test(raw)) ? raw : null;
}

function getTableNumber() {
  // Path-based: /nnewi-buka/3
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts.length >= 2 && /^\d+$/.test(parts[1])) {
    const n = parseInt(parts[1], 10);
    if (n >= 1 && n <= 999) return String(n);
  }
  // Backward compat: ?table=N
  const raw = new URLSearchParams(window.location.search).get('table');
  const n   = parseInt(raw, 10);
  return (Number.isInteger(n) && n >= 1 && n <= 999) ? String(n) : '1';
}

function formatPrice(amount) {
  return '₦' + amount.toLocaleString();
}

function getCategoryById(id) {
  if (id === 'all') {
    return {
      id: 'all',
      name: 'All Items',
      emoji: '🍽️',
      items: menuData.categories.flatMap(c => c.items)
    };
  }
  if (id === 'specials') {
    return {
      id: 'specials',
      name: "Today's Specials",
      emoji: '⭐',
      items: menuData.categories
        .flatMap(c => c.items)
        .filter(item => item.description.includes('⭐') || item.description.toUpperCase().includes('FREE'))
    };
  }
  return menuData.categories.find(c => c.id === id);
}

// ── Character swap ────────────────────────────────────────────────────────────

function setCharacter(key) {
  const char = CHARACTERS[key];
  if (!char) return;
  const img = document.getElementById('adaImg');
  if (!img) return;

  // Only swap if image actually exists (gracefully skips ungenerated characters)
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
  test.onerror = () => {
    // Image not yet generated — stay on current character
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
    bubble.classList.remove('visible');
    avatar.classList.remove('speaking');
    container.classList.remove('visible');
  },

  resetIdleTimer() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => Ada.speak(menuData.ada.idle, 6000), 30000);
  }
};

// ── Render tabs ───────────────────────────────────────────────────────────────

function renderTabs(categories, activeId) {
  const container = document.getElementById('categoryTabs');
  const specialsBtn = `<button class="tab-btn tab-specials ${activeId === 'specials' ? 'active' : ''}" data-category="specials">
    <span>⭐</span>
    <span>Specials</span>
  </button>`;
  container.innerHTML = specialsBtn + categories.map(cat => `
    <button class="tab-btn ${cat.id === activeId ? 'active' : ''}" data-category="${cat.id}">
      <span>${cat.emoji}</span>
      <span>${cat.name}</span>
    </button>
  `).join('');

  container.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      switchCategory(btn.dataset.category);
      Ada.resetIdleTimer();
    });
  });
}

// ── Render category box grid ─────────────────────────────────────────────────

function renderCategoryGrid(categories, activeId) {
  const grid = document.getElementById('categoryGrid');
  grid.innerHTML = categories.map(cat => {
    const imgSrc = CAT_IMAGES[cat.id];
    const visual = imgSrc
      ? `<img class="cat-box-img" src="${imgSrc}" alt="${cat.name}" loading="lazy" />`
      : `<span class="cat-box-emoji">${cat.emoji}</span>`;
    return `
      <button class="cat-box ${cat.id === activeId ? 'active' : ''}" data-category="${cat.id}">
        ${visual}
        <span class="cat-box-name">${cat.name}</span>
      </button>`;
  }).join('');

  grid.querySelectorAll('.cat-box').forEach(box => {
    box.addEventListener('click', () => {
      switchCategory(box.dataset.category);
      Ada.resetIdleTimer();
    });
  });

  document.getElementById('allCategoriesBtn').classList.toggle('active', activeId === 'all');
}

// ── Render items ──────────────────────────────────────────────────────────────

function renderItems(category) {
  const container = document.getElementById('menuGrid');

  const heading = `
    <h2 class="category-heading">
      <span>${category.emoji}</span>
      <span>${category.name}</span>
    </h2>
  `;

  if (!category.items.length) {
    container.innerHTML = heading + '<p class="loading" style="padding:40px 20px;text-align:center;opacity:0.5">No items here yet — check back soon!</p>';
    return;
  }

  const cards = category.items.map(item => {
    const desc = item.description || '';
    const isSpecial = desc.includes('⭐') || desc.toUpperCase().includes('FREE');
    const soldOut = item.available === false;
    const qty = (orderState[item.name] && orderState[item.name].qty) || 0;
    return `
      <div class="menu-item ${isSpecial ? 'has-special' : ''} ${soldOut ? 'sold-out' : ''}" data-item="${item.name}">
        <div class="item-info">
          <div class="item-name">${item.name}</div>
          <div class="item-description">${item.description}</div>
          ${soldOut ? '<span class="item-sold-out-tag">Sold Out</span>' : isSpecial ? '<span class="item-special-tag">⭐ Special Offer</span>' : ''}
        </div>
        <div class="item-side">
          ${item.image_url ? `<img class="item-photo" src="${item.image_url}" alt="${item.name}" loading="lazy" />` : ''}
          <div class="item-price">${formatPrice(item.price)}</div>
          <div class="qty-stepper" data-item="${item.name}" data-price="${item.price}">
            <button class="qty-btn qty-minus" aria-label="Decrease quantity" ${soldOut ? 'disabled' : ''}>−</button>
            <span class="qty-value">${qty}</span>
            <button class="qty-btn qty-plus" aria-label="Increase quantity" ${soldOut ? 'disabled' : ''}>+</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = heading + cards;

  container.querySelectorAll('.menu-item').forEach(el => {
    el.addEventListener('click', () => {
      const item = category.items.find(i => i.name === el.dataset.item);
      if (item && item.ada) Ada.speak(item.ada, 5500);
      Ada.resetIdleTimer();
    });
  });

  container.querySelectorAll('.qty-stepper').forEach(stepper => {
    const name  = stepper.dataset.item;
    const price = Number(stepper.dataset.price);
    const item  = category.items.find(i => i.name === name);
    if (item && item.available === false) return;

    stepper.querySelector('.qty-minus').addEventListener('click', (e) => {
      e.stopPropagation();
      changeQty(name, price, -1);
    });
    stepper.querySelector('.qty-plus').addEventListener('click', (e) => {
      e.stopPropagation();
      changeQty(name, price, 1);
    });
  });
}

// ── Order state ───────────────────────────────────────────────────────────────

function changeQty(name, price, delta) {
  const current = orderState[name] || { qty: 0, price };
  const next = Math.max(0, current.qty + delta);

  if (next === 0) {
    delete orderState[name];
  } else {
    orderState[name] = { qty: next, price };
  }

  syncQtyDisplays();
  updateOrderSummary();
}

function syncQtyDisplays() {
  document.querySelectorAll('.qty-stepper').forEach(stepper => {
    const name  = stepper.dataset.item;
    const qty   = (orderState[name] && orderState[name].qty) || 0;
    stepper.querySelector('.qty-value').textContent = qty;
  });
}

function updateOrderSummary() {
  const items     = Object.values(orderState);
  const itemCount = items.reduce((sum, i) => sum + i.qty, 0);
  const total      = items.reduce((sum, i) => sum + i.qty * i.price, 0);

  const bar   = document.getElementById('orderSummaryBar');
  const ada   = document.getElementById('adaContainer');
  const badge = document.getElementById('placeOrderBadge');

  document.getElementById('orderItemCount').textContent = itemCount === 1 ? '1 item' : `${itemCount} items`;
  document.getElementById('orderTotal').textContent     = formatPrice(total);
  badge.textContent = itemCount;

  const hasItems = itemCount > 0;
  bar.classList.toggle('visible', hasItems);
  ada.classList.toggle('lifted', hasItems);
}

// ── Switch category ───────────────────────────────────────────────────────────

function switchCategory(categoryId) {
  activeCategory = categoryId;
  const category = getCategoryById(categoryId);
  if (!category) return;

  renderTabs(menuData.categories, categoryId);
  renderCategoryGrid(menuData.categories, categoryId);
  renderItems(category);
  window.scrollTo({ top: 0, behavior: 'smooth' });

  const charKey = CATEGORY_CHARACTER[categoryId] || 'ada';
  setCharacter(charKey);

  const message = menuData.ada.categoryMessages[categoryId];
  if (message) setTimeout(() => Ada.speak(message, 5500), 350);
}

// ── Call waiter ───────────────────────────────────────────────────────────────

function initCallWaiter() {
  const table = getTableNumber();
  const btn = document.getElementById('callWaiterBtn');

  btn.addEventListener('click', async () => {
    btn.disabled = true;

    const { error } = await db.from('waiter_calls').insert({
      restaurant_id: RESTAURANT_ID,
      table_number: Number(table),
      status: 'pending'
    });

    btn.disabled = false;

    if (error) {
      console.error('Failed to call waiter', error);
      Ada.speak("Hmm, that didn't go through — please try again in a moment 🙏", 5500);
      Ada.resetIdleTimer();
      return;
    }

    Ada.speak(`I've called your waiter! 😊 Someone will be at Table ${table} very shortly.`, 6000);
    Ada.resetIdleTimer();
  });
}

// ── All-categories button ────────────────────────────────────────────────────

function initAllCategoriesButton() {
  document.getElementById('allCategoriesBtn').addEventListener('click', () => {
    switchCategory('all');
    Ada.resetIdleTimer();
  });
}

// ── Place order ───────────────────────────────────────────────────────────────

function initPlaceOrder() {
  const btn = document.getElementById('placeOrderBtn');

  btn.addEventListener('click', async () => {
    const items = Object.entries(orderState);
    if (items.length === 0) {
      Ada.speak("Your order is empty! Tap the + next to a dish to add it first 😊", 5000);
      Ada.resetIdleTimer();
      return;
    }

    const table = getTableNumber();
    const total = items.reduce((sum, [, i]) => sum + i.qty * i.price, 0);

    btn.disabled = true;

    // Generate the order ID client-side so we never have to read the row back —
    // customers (anon) can only INSERT, not SELECT, so .select() after insert
    // would fail under our RLS policies.
    const orderId = crypto.randomUUID();

    const { error: orderError } = await db.from('orders').insert({
      id: orderId,
      restaurant_id: RESTAURANT_ID,
      table_number: Number(table),
      status: 'pending',
      total
    });

    if (orderError) {
      console.error('Failed to place order', orderError);
      btn.disabled = false;
      Ada.speak("Hmm, that didn't go through — please try again in a moment 🙏", 5500);
      Ada.resetIdleTimer();
      return;
    }

    const orderItems = items.map(([name, i]) => ({
      order_id: orderId,
      item_name: name,
      quantity: i.qty,
      price: i.price
    }));

    const { error: itemsError } = await db.from('order_items').insert(orderItems);

    btn.disabled = false;

    if (itemsError) {
      console.error('Failed to save order items', itemsError);
      Ada.speak("Your order started but something went wrong saving the items — please call your waiter to confirm 🙏", 6000);
      Ada.resetIdleTimer();
      return;
    }

    Ada.speak(`Order sent! 🎉 The kitchen has your order for Table ${table}. Sit tight!`, 6000);
    Ada.resetIdleTimer();

    orderState = {};
    syncQtyDisplays();
    updateOrderSummary();
  });
}

// ── Auto-slide category tabs ─────────────────────────────────────────────────

function initAutoSlideTabs() {
  const tabs = document.getElementById('categoryTabs');
  let direction = 1;
  let paused = false;

  const resume = () => { paused = false; };
  const pause = () => {
    paused = true;
    clearTimeout(tabs._resumeTimer);
    tabs._resumeTimer = setTimeout(resume, 3000);
  };

  tabs.addEventListener('touchstart', pause, { passive: true });
  tabs.addEventListener('pointerdown', pause);
  tabs.addEventListener('wheel', pause, { passive: true });

  clearInterval(tabAutoSlideTimer);
  tabAutoSlideTimer = setInterval(() => {
    if (paused) return;
    const maxScroll = tabs.scrollWidth - tabs.clientWidth;
    if (maxScroll <= 0) return;

    if (tabs.scrollLeft >= maxScroll - 2) direction = -1;
    if (tabs.scrollLeft <= 2) direction = 1;

    tabs.scrollLeft += direction * 1.2;
  }, 30);
}

// ── Ada tap ───────────────────────────────────────────────────────────────────

function initAdaClick() {
  document.getElementById('adaCharacter').addEventListener('click', () => {
    const msg = menuData.ada.categoryMessages[activeCategory] || menuData.ada.welcome;
    Ada.speak(msg, 5500);
    Ada.resetIdleTimer();
  });

  // Hide Ada immediately when user starts scrolling
  window.addEventListener('scroll', () => Ada.hide(), { passive: true });
  document.querySelector('.menu-content')?.addEventListener('scroll', () => Ada.hide(), { passive: true });
}

// ── Show app after splash ─────────────────────────────────────────────────────

function revealApp() {
  document.getElementById('app').classList.add('visible');
  if (menuData && menuData.ada) {
    Ada.speak(menuData.ada.welcome, 7000);
    Ada.resetIdleTimer();
  }
}

function splashError(title, sub) {
  const nameEl = document.getElementById('splashRestaurant');
  const tagEl  = document.getElementById('splashTagline');
  const msgEl  = document.querySelector('.splash-message');
  const dots   = document.querySelector('.splash-dots');
  if (nameEl) nameEl.textContent = title;
  if (tagEl)  tagEl.textContent  = sub || 'Please reload the page or scan the QR code again.';
  if (msgEl)  msgEl.textContent  = ''; // clear Ada's bubble
  if (dots)   dots.style.display = 'none';
}

// ── My Order tracker ─────────────────────────────────────────────────────────

function formatOrderStatus(status) {
  if (status === 'preparing') return { label: 'Preparing', icon: '👨‍🍳', cls: 'status-preparing' };
  if (status === 'served')    return { label: 'Served',    icon: '✅', cls: 'status-served' };
  return { label: 'Pending', icon: '⏳', cls: 'status-pending' };
}

function formatOrderTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

async function loadMyOrders() {
  const table = getTableNumber();
  const content = document.getElementById('myOrderContent');
  content.innerHTML = '<p class="my-order-empty">Loading…</p>';

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/table-orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({ restaurant_id: RESTAURANT_ID, table_number: Number(table) })
    });

    const { orders, error } = await res.json();
    if (error || !res.ok) throw new Error(error || 'Request failed');
    renderMyOrders(orders || []);
  } catch (err) {
    console.error('My Order load error', err);
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

  const grandTotal = orders.reduce((sum, o) => sum + o.total, 0);

  const orderBlocks = orders.map(order => {
    const { label, icon, cls } = formatOrderStatus(order.status);
    const time = formatOrderTime(order.created_at);
    const itemRows = (order.order_items || []).map(item =>
      `<div class="my-order-item-row">
        <span class="my-order-item-name"><span class="my-order-item-qty">${item.quantity}×</span> ${item.item_name}</span>
        <span class="my-order-item-price">₦${(item.quantity * item.price).toLocaleString()}</span>
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

  content.innerHTML = `
    ${orderBlocks}
    <div class="my-order-total-row">
      <span>Total Bill</span>
      <span>₦${grandTotal.toLocaleString()}</span>
    </div>
    <p class="my-order-hint">Tap ↻ to check for updates</p>`;
}

function openMyOrderModal() {
  document.getElementById('myOrderModal').classList.remove('admin-hidden');
  loadMyOrders();
}

function initMyOrder() {
  const table = getTableNumber();
  document.getElementById('myOrderTableNum').textContent = table;

  document.getElementById('myOrderCloseBtn').addEventListener('click', () => {
    document.getElementById('myOrderModal').classList.add('admin-hidden');
  });

  document.getElementById('myOrderRefreshBtn').addEventListener('click', loadMyOrders);

  document.getElementById('myOrderModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('myOrderModal')) {
      document.getElementById('myOrderModal').classList.add('admin-hidden');
    }
  });
}

function initHamburgerMenu() {
  const panel   = document.getElementById('customerMenuPanel');
  const overlay = document.getElementById('customerMenuOverlay');
  const table   = getTableNumber();

  document.getElementById('cmenuRestaurantName').textContent = menuData.restaurant.name;
  document.getElementById('cmenuTableLabel').textContent     = 'Table ' + table;

  function openPanel() {
    overlay.classList.remove('admin-hidden');
    panel.classList.remove('admin-hidden');
    requestAnimationFrame(() => panel.classList.add('open'));
  }

  function closePanel() {
    panel.classList.remove('open');
    setTimeout(() => {
      panel.classList.add('admin-hidden');
      overlay.classList.add('admin-hidden');
    }, 280);
  }

  document.getElementById('heroMenuBtn').addEventListener('click', openPanel);
  document.getElementById('customerMenuCloseBtn').addEventListener('click', closePanel);
  overlay.addEventListener('click', closePanel);

  document.getElementById('cmenuMyOrdersBtn').addEventListener('click', () => {
    closePanel();
    openMyOrderModal();
  });

  document.getElementById('cmenuCallWaiterBtn').addEventListener('click', () => {
    closePanel();
    document.getElementById('callWaiterBtn').click();
  });
}

// ── Splash screen ────────────────────────────────────────────────────────────

const SPLASH_MIN_MS = 5000;
const SPLASH_CHARS  = [
  'images/ada.png',
  'images/chisom.png',
  'images/emeka.png',
  'images/mamachef.png',
  'images/cheftunde.png'
];
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

// ── Boot helpers ──────────────────────────────────────────────────────────────

function applyBranding(restaurant) {
  splashUpdate(restaurant);
  document.getElementById('restaurantName').textContent    = restaurant.name;
  document.getElementById('restaurantTagline').textContent = restaurant.tagline;
  document.getElementById('tableBadge').textContent        = 'Table ' + getTableNumber();
  document.documentElement.style.setProperty('--accent', restaurant.accentColor);
}

function applyMenuContent(categories, isFirstRender) {
  if (categories.length === 0) {
    document.getElementById('menuGrid').innerHTML =
      '<div class="loading" style="padding:60px 20px;text-align:center;opacity:0.5">Menu coming soon — check back shortly.</div>';
    if (isFirstRender) initHamburgerMenu();
    return;
  }
  const first = categories[0];
  activeCategory = first.id;
  renderTabs(categories, activeCategory);
  renderCategoryGrid(categories, activeCategory);
  renderItems(first);
  if (isFirstRender) {
    initCallWaiter();
    initPlaceOrder();
    initAllCategoriesButton();
    initAdaClick();
    initAutoSlideTabs();
    initMyOrder();
    initHamburgerMenu();
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────

async function init() {
  const slug = getRestaurantSlug() || 'nnewi-buka';
  splashStart();
  MENU_CACHE_KEY = 'vw_menu_cache_' + slug;

  const { data: restaurantRow, error: slugError } = await db
    .from('restaurants')
    .select('id')
    .eq('slug', slug)
    .single();

  if (slugError || !restaurantRow) {
    splashError('Restaurant not found', 'Please scan the QR code at your table again.');
    return;
  }

  RESTAURANT_ID = restaurantRow.id;

  const cachedRaw = localStorage.getItem(MENU_CACHE_KEY);
  const cached    = cachedRaw ? JSON.parse(cachedRaw) : null;

  if (cached) {
    // Repeat visit — render instantly from cache, then refresh in background
    menuData = cached;
    applyBranding(menuData.restaurant);
    applyMenuContent(menuData.categories, true);
    revealApp();
    splashHide(true);

    loadMenuData().then(fresh => {
      if (JSON.stringify(fresh) !== JSON.stringify(cached)) {
        menuData = fresh;
        applyBranding(menuData.restaurant);
        applyMenuContent(menuData.categories, false);
      }
    }).catch(() => {});
  } else {
    // First visit — show skeleton while data fetches behind the splash
    document.getElementById('menuGrid').innerHTML =
      Array.from({ length: 6 }, () => '<div class="skeleton-item"></div>').join('');
    revealApp();
    splashHide();

    try {
      menuData = await loadMenuData();
    } catch (err) {
      console.error('Could not load the menu', err);
      document.getElementById('menuGrid').innerHTML =
        '<div class="loading">Unable to load menu — please reload the page.</div>';
      return;
    }

    applyBranding(menuData.restaurant);
    applyMenuContent(menuData.categories, true);
    Ada.speak(menuData.ada.welcome, 7000);
    Ada.resetIdleTimer();
  }
}

document.addEventListener('DOMContentLoaded', init);

// Register service worker — moved here so index.html has no inline scripts
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

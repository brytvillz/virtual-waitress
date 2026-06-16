// Virtual Waitress MVP — NgwaNgwa Digital
// Demo restaurant: Nnewi Buka

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
const MENU_CACHE_KEY = 'vw_menu_cache_' + RESTAURANT_ID;

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

function getTableNumber() {
  const raw = new URLSearchParams(window.location.search).get('table');
  const n   = parseInt(raw, 10);
  // Only accept whole numbers between 1 and 999 — reject anything else
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
    const bubble = document.getElementById('speechBubble');
    const text   = document.getElementById('speechText');
    const avatar = document.getElementById('adaCharacter');

    clearTimeout(this.speakTimer);
    text.textContent = message;
    bubble.classList.add('visible');
    avatar.classList.add('speaking');

    this.speakTimer = setTimeout(() => {
      bubble.classList.remove('visible');
      avatar.classList.remove('speaking');
    }, duration);
  },

  resetIdleTimer() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => Ada.speak(menuData.ada.idle, 6000), 30000);
  }
};

// ── Render tabs ───────────────────────────────────────────────────────────────

function renderTabs(categories, activeId) {
  const container = document.getElementById('categoryTabs');
  container.innerHTML = categories.map(cat => `
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
  grid.innerHTML = categories.map(cat => `
    <button class="cat-box ${cat.id === activeId ? 'active' : ''}" data-category="${cat.id}">
      <span class="cat-box-emoji">${cat.emoji}</span>
      <span class="cat-box-name">${cat.name}</span>
    </button>
  `).join('');

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

  const cards = category.items.map(item => {
    const isSpecial = item.description.includes('⭐') || item.description.toUpperCase().includes('FREE');
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
}

// ── Landing ───────────────────────────────────────────────────────────────────

function initLanding() {
  const landing = document.getElementById('landing');
  const app     = document.getElementById('app');

  function dismiss(openSpecials) {
    landing.classList.add('exit');
    app.classList.add('visible');
    app.removeAttribute('aria-hidden');

    setTimeout(() => {
      landing.style.display = 'none';
      Ada.speak(menuData.ada.welcome, 7000);
      Ada.resetIdleTimer();
    }, 600);

    if (openSpecials) {
      setTimeout(() => switchCategory('drinks'), 750);
    }
  }

  document.getElementById('btnViewMenu').addEventListener('click', () => dismiss(false));
  document.getElementById('btnSpecials').addEventListener('click', () => dismiss(true));
}

// ── Boot ──────────────────────────────────────────────────────────────────────

async function init() {
  try {
    menuData = await loadMenuData();
  } catch (err) {
    console.error('Could not load the menu', err);
    document.getElementById('landingTitle').textContent = 'Unable to load menu';
    document.getElementById('landingTagline').textContent = 'Please check your connection and reload the page.';
    return;
  }

  document.getElementById('landingTitle').textContent      = menuData.restaurant.name;
  document.getElementById('landingTagline').textContent    = menuData.restaurant.tagline;
  document.getElementById('restaurantName').textContent    = menuData.restaurant.name;
  document.getElementById('restaurantTagline').textContent = menuData.restaurant.tagline;
  document.getElementById('tableBadge').textContent        = 'Table ' + getTableNumber();
  document.documentElement.style.setProperty('--accent', menuData.restaurant.accentColor);

  const first = menuData.categories[0];
  activeCategory = first.id;
  renderTabs(menuData.categories, activeCategory);
  renderCategoryGrid(menuData.categories, activeCategory);
  renderItems(first);

  initCallWaiter();
  initPlaceOrder();
  initAllCategoriesButton();
  initAdaClick();
  initLanding();
  initAutoSlideTabs();
}

document.addEventListener('DOMContentLoaded', init);

// Register service worker — moved here so index.html has no inline scripts
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

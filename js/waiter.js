// Virtual Waitress — Staff Dashboard
// Logs in staff via Supabase Auth, then shows live orders + waiter calls
// for this restaurant using Supabase Realtime.

let realtimeChannel = null;
let currentStaffRole = null;

function formatPrice(amount) {
  return '₦' + amount.toLocaleString();
}

function timeAgo(isoString) {
  const seconds = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ago`;
}

function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    osc.start();
    osc.stop(ctx.currentTime + 0.18);
  } catch (e) {
    // Audio not available — silently skip, the visual update still happens
  }
}

// ── Auth ─────────────────────────────────────────────────────────────────────

function showDashboard() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('dashboard').classList.add('visible');
  document.getElementById('dashboard').removeAttribute('aria-hidden');
  startDashboard();
}

function showLogin() {
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('dashboard').classList.remove('visible');
  document.getElementById('dashboard').setAttribute('aria-hidden', 'true');
  if (realtimeChannel) {
    db.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}

async function initAuth() {
  const { data: { session } } = await db.auth.getSession();
  if (session) {
    showDashboard();
  }

  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errorEl = document.getElementById('loginError');
    errorEl.textContent = '';

    const { error } = await db.auth.signInWithPassword({ email, password });
    if (error) {
      errorEl.textContent = 'Login failed — check your email and password.';
      return;
    }
    showDashboard();
  });

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await db.auth.signOut();
    showLogin();
  });

  document.getElementById('refreshBtn').addEventListener('click', () => {
    refreshOrders();
    refreshCalls();
    refreshMenuToggleList();
  });
}

// ── Data loading ─────────────────────────────────────────────────────────────

async function refreshOrders() {
  const { data, error } = await db
    .from('orders')
    .select('*, order_items(*)')
    .eq('restaurant_id', RESTAURANT_ID)
    .in('status', ['pending', 'preparing'])
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Failed to load orders', error);
    return;
  }
  renderOrders(data);
}

async function refreshCalls() {
  const { data, error } = await db
    .from('waiter_calls')
    .select('*')
    .eq('restaurant_id', RESTAURANT_ID)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Failed to load waiter calls', error);
    return;
  }
  renderCalls(data);
}

// ── Rendering ────────────────────────────────────────────────────────────────

function renderOrders(orders) {
  const list = document.getElementById('ordersList');
  document.getElementById('ordersCount').textContent = orders.length;

  if (orders.length === 0) {
    list.innerHTML = '<p class="empty-state">No active orders</p>';
    return;
  }

  list.innerHTML = orders.map(order => {
    const itemsHtml = (order.order_items || []).map(item => `
      <div><span>${item.quantity}x ${item.item_name}</span><span>${formatPrice(item.quantity * item.price)}</span></div>
    `).join('');

    const isPreparing = order.status === 'preparing';
    const actionLabel = isPreparing ? 'Mark Served' : 'Start Preparing';
    const nextStatus = isPreparing ? 'served' : 'preparing';

    return `
      <div class="dash-card" data-order-id="${order.id}">
        <div class="dash-card-top">
          <span class="dash-card-table">Table ${order.table_number} ${isPreparing ? '· 👨‍🍳 Preparing' : ''}</span>
          <span class="dash-card-time">${timeAgo(order.created_at)}</span>
        </div>
        <div class="dash-card-items">${itemsHtml}</div>
        <div class="dash-card-total">Total: ${formatPrice(order.total)}</div>
        <div class="dash-card-actions">
          <button class="dash-btn primary" data-action="${nextStatus}">${actionLabel}</button>
        </div>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.dash-card').forEach(card => {
    const btn = card.querySelector('.dash-btn');
    btn.addEventListener('click', () => updateOrderStatus(card.dataset.orderId, btn.dataset.action));
  });
}

function renderCalls(calls) {
  const list = document.getElementById('callsList');
  document.getElementById('callsCount').textContent = calls.length;

  if (calls.length === 0) {
    list.innerHTML = '<p class="empty-state">No active calls</p>';
    return;
  }

  list.innerHTML = calls.map(call => `
    <div class="dash-card" data-call-id="${call.id}">
      <div class="dash-card-top">
        <span class="dash-card-table">🔔 Table ${call.table_number}</span>
        <span class="dash-card-time">${timeAgo(call.created_at)}</span>
      </div>
      <div class="dash-card-actions">
        <button class="dash-btn primary" data-action="acknowledge">Acknowledge</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.dash-card').forEach(card => {
    const btn = card.querySelector('.dash-btn');
    btn.addEventListener('click', () => acknowledgeCall(card.dataset.callId));
  });
}

// ── Actions ──────────────────────────────────────────────────────────────────

async function updateOrderStatus(orderId, status) {
  const { error } = await db.from('orders').update({ status }).eq('id', orderId);
  if (error) console.error('Failed to update order', error);
  refreshOrders();
}

async function acknowledgeCall(callId) {
  const { error } = await db.from('waiter_calls').update({ status: 'acknowledged' }).eq('id', callId);
  if (error) console.error('Failed to acknowledge call', error);
  refreshCalls();
}

// ── Realtime ─────────────────────────────────────────────────────────────────

function startRealtime() {
  if (realtimeChannel) return; // already subscribed — avoid duplicate channel/listeners

  realtimeChannel = db
    .channel('dashboard-' + RESTAURANT_ID)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${RESTAURANT_ID}` }, () => {
      playBeep();
      refreshOrders();
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${RESTAURANT_ID}` }, refreshOrders)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'order_items' }, refreshOrders)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'waiter_calls', filter: `restaurant_id=eq.${RESTAURANT_ID}` }, () => {
      playBeep();
      refreshCalls();
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'waiter_calls', filter: `restaurant_id=eq.${RESTAURANT_ID}` }, refreshCalls)
    .subscribe();
}

async function loadStaffRole() {
  const { data: { user } } = await db.auth.getUser();
  if (!user) return;

  const { data, error } = await db.from('staff').select('role').eq('id', user.id).single();
  if (error) {
    console.error('Failed to load staff role', error);
    return;
  }
  currentStaffRole = data.role;
  document.getElementById('adminLink').style.display = currentStaffRole === 'manager' ? 'inline-block' : 'none';
}

async function refreshMenuToggleList() {
  const { data, error } = await db
    .from('menu_items')
    .select('id, name, available, menu_categories(name)')
    .eq('restaurant_id', RESTAURANT_ID)
    .order('name');

  if (error) {
    console.error('Failed to load menu for sold-out toggles', error);
    return;
  }

  const list = document.getElementById('menuToggleList');
  if (!data.length) {
    list.innerHTML = '<p class="empty-state">No menu items yet</p>';
    return;
  }

  list.innerHTML = data.map(item => `
    <div class="dash-card menu-toggle-card" data-item-id="${item.id}">
      <div class="menu-toggle-info">
        <span class="menu-toggle-name">${item.name}</span>
        <span class="dash-card-time">${item.menu_categories ? item.menu_categories.name : ''}</span>
      </div>
      <label class="toggle-switch">
        <input type="checkbox" class="menu-toggle-input" ${item.available ? 'checked' : ''} />
        <span class="toggle-slider"></span>
      </label>
    </div>
  `).join('');

  list.querySelectorAll('.menu-toggle-input').forEach(input => {
    input.addEventListener('change', async (e) => {
      const card = e.target.closest('.menu-toggle-card');
      const itemId = card.dataset.itemId;
      const { error } = await db.from('menu_items').update({ available: e.target.checked }).eq('id', itemId);
      if (error) {
        console.error('Failed to update item availability', error);
        e.target.checked = !e.target.checked; // revert on failure
      }
    });
  });
}

function startDashboard() {
  loadStaffRole();
  refreshOrders();
  refreshCalls();
  refreshMenuToggleList();
  startRealtime();
  initPushSubscription();
  setInterval(() => { refreshOrders(); refreshCalls(); }, 30000); // keep "Xm ago" labels fresh
}

// ── Web Push subscription ───────────────────────────────────────────────────

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

async function initPushSubscription() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

  try {
    const registration = await navigator.serviceWorker.register('/sw.js');

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });
    }

    const sub = subscription.toJSON();
    const { error } = await db.from('push_subscriptions').upsert({
      restaurant_id: RESTAURANT_ID,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth
    }, { onConflict: 'endpoint' });

    if (error) console.error('Failed to save push subscription', error);
  } catch (err) {
    console.error('Push subscription setup failed', err);
  }
}

document.addEventListener('DOMContentLoaded', initAuth);

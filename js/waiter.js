// Virtual Waitress — Staff Dashboard
// Logs in staff via Supabase Auth, shows live orders + waiter calls filtered
// by today's table assignments, plus a 7-day personal shift history.

let realtimeChannel = null;
let currentStaffRole = null;
let myTableNumbers = new Set();    // tables assigned to this waiter today
let othersTableNumbers = new Set(); // tables assigned to OTHER waiters today

function formatPrice(amount) {
  return '₦' + amount.toLocaleString();
}

function timeAgo(isoString) {
  const seconds = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  return `${Math.floor(seconds / 60)}m ago`;
}

function todayDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
  } catch (e) { /* audio unavailable */ }
}

// ── Auth ──────────────────────────────────────────────────────────────────────

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
  if (realtimeChannel) { db.removeChannel(realtimeChannel); realtimeChannel = null; }
}

async function initAuth() {
  const { data: { session } } = await db.auth.getSession();
  if (session) {
    // Restore restaurant context from the staff record before showing the dashboard
    const { data: staffRow } = await db.from('staff').select('restaurant_id').eq('id', session.user.id).single();
    if (staffRow) RESTAURANT_ID = staffRow.restaurant_id;
    showDashboard();
  }

  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = document.getElementById('loginCode').value.trim().toUpperCase();
    const errorEl = document.getElementById('loginError');
    const btn = e.target.querySelector('button[type="submit"]');
    errorEl.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Logging in…';

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/waiter-login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({ access_code: code })
      });

      const result = await res.json();
      if (!res.ok || result.error) {
        errorEl.textContent = 'Invalid code — check with your manager.';
        return;
      }

      const { error: sessionError } = await db.auth.verifyOtp({
        token_hash: result.hashed_token,
        type: 'magiclink'
      });
      if (sessionError) {
        errorEl.textContent = 'Login failed — please try again.';
        return;
      }

      RESTAURANT_ID = result.staff.restaurant_id;
      showDashboard();
    } catch (err) {
      console.error('Login error', err);
      errorEl.textContent = 'Connection error — please try again.';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Log In';
    }
  });

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await db.auth.signOut();
    showLogin();
  });

  document.getElementById('refreshBtn').addEventListener('click', async () => {
    await loadAssignments();
    refreshOrders();
    refreshCalls();
    refreshMenuToggleList();
  });
}

// ── Table assignments ──────────────────────────────────────────────────────────

async function loadAssignments() {
  const { data: { user } } = await db.auth.getUser();
  if (!user) return;

  const { data, error } = await db
    .from('shift_assignments')
    .select('waiter_id, tables(table_number)')
    .eq('restaurant_id', RESTAURANT_ID)
    .eq('assigned_date', todayDate());

  if (error) { console.error('Failed to load assignments', error); return; }

  myTableNumbers = new Set();
  othersTableNumbers = new Set();

  (data || []).forEach(a => {
    const num = a.tables?.table_number;
    if (num == null) return;
    if (a.waiter_id === user.id) {
      myTableNumbers.add(num);
    } else {
      othersTableNumbers.add(num);
    }
  });
}

// ── Data loading ──────────────────────────────────────────────────────────────

async function refreshOrders() {
  let query = db
    .from('orders')
    .select('*, order_items(*)')
    .eq('restaurant_id', RESTAURANT_ID)
    .in('status', ['pending', 'preparing'])
    .order('created_at', { ascending: true });

  // Exclude tables claimed by other waiters
  if (othersTableNumbers.size > 0) {
    query = query.not('table_number', 'in', `(${[...othersTableNumbers].join(',')})`);
  }

  const { data, error } = await query;
  if (error) { console.error('Failed to load orders', error); return; }
  renderOrders(data);
}

async function refreshCalls() {
  let query = db
    .from('waiter_calls')
    .select('*')
    .eq('restaurant_id', RESTAURANT_ID)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (othersTableNumbers.size > 0) {
    query = query.not('table_number', 'in', `(${[...othersTableNumbers].join(',')})`);
  }

  const { data, error } = await query;
  if (error) { console.error('Failed to load waiter calls', error); return; }
  renderCalls(data);
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderOrders(orders) {
  const list = document.getElementById('ordersList');
  document.getElementById('ordersCount').textContent = orders.length;

  if (orders.length === 0) { list.innerHTML = '<p class="empty-state">No active orders</p>'; return; }

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
          <span class="dash-card-table">Table ${order.table_number}${isPreparing ? ' · 👨‍🍳 Preparing' : ''}</span>
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

  if (calls.length === 0) { list.innerHTML = '<p class="empty-state">No active calls</p>'; return; }

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
    card.querySelector('.dash-btn').addEventListener('click', () => acknowledgeCall(card.dataset.callId));
  });
}

// ── Actions ───────────────────────────────────────────────────────────────────

async function updateOrderStatus(orderId, status) {
  const payload = { status };
  if (status === 'preparing') {
    const { data: { user } } = await db.auth.getUser();
    if (user) payload.handled_by = user.id;
  }
  const { error } = await db.from('orders').update(payload).eq('id', orderId);
  if (error) console.error('Failed to update order', error);
  refreshOrders();
}

async function acknowledgeCall(callId) {
  const { error } = await db.from('waiter_calls').update({ status: 'acknowledged' }).eq('id', callId);
  if (error) console.error('Failed to acknowledge call', error);
  refreshCalls();
}

// ── Realtime ──────────────────────────────────────────────────────────────────

function startRealtime() {
  if (realtimeChannel) return;

  realtimeChannel = db
    .channel('dashboard-' + RESTAURANT_ID)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${RESTAURANT_ID}` }, () => { playBeep(); refreshOrders(); })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${RESTAURANT_ID}` }, refreshOrders)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'order_items' }, refreshOrders)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'waiter_calls', filter: `restaurant_id=eq.${RESTAURANT_ID}` }, () => { playBeep(); refreshCalls(); })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'waiter_calls', filter: `restaurant_id=eq.${RESTAURANT_ID}` }, refreshCalls)
    .subscribe();
}

// ── Staff role + admin link ───────────────────────────────────────────────────

async function loadStaffRole() {
  const { data: { user } } = await db.auth.getUser();
  if (!user) return;
  const { data, error } = await db.from('staff').select('role').eq('id', user.id).single();
  if (error) { console.error('Failed to load staff role', error); return; }
  currentStaffRole = data.role;
  document.getElementById('adminLink').style.display = currentStaffRole === 'manager' ? 'inline-block' : 'none';
}

// ── Menu sold-out toggles ─────────────────────────────────────────────────────

async function refreshMenuToggleList() {
  const { data, error } = await db
    .from('menu_items')
    .select('id, name, available, menu_categories(name)')
    .eq('restaurant_id', RESTAURANT_ID)
    .order('name');

  if (error) { console.error('Failed to load menu for sold-out toggles', error); return; }

  const list = document.getElementById('menuToggleList');
  if (!data.length) { list.innerHTML = '<p class="empty-state">No menu items yet</p>'; return; }

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
      if (error) { console.error('Failed to update item availability', error); e.target.checked = !e.target.checked; }
    });
  });
}

// ── My Shift history ──────────────────────────────────────────────────────────

async function loadShiftHistory() {
  const { data: { user } } = await db.auth.getUser();
  if (!user) return;

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const { data, error } = await db
    .from('orders')
    .select('*, order_items(*)')
    .eq('restaurant_id', RESTAURANT_ID)
    .eq('handled_by', user.id)
    .gte('created_at', sevenDaysAgo.toISOString())
    .order('created_at', { ascending: false });

  if (error) { console.error('Failed to load shift history', error); return; }
  renderShiftHistory(data || []);
}

function renderShiftHistory(orders) {
  const container = document.getElementById('shiftHistory');
  if (!orders.length) {
    container.innerHTML = '<p class="empty-state">No orders in the last 7 days</p>';
    return;
  }

  const grouped = {};
  orders.forEach(order => {
    const d = new Date(order.created_at);
    const key = d.toLocaleDateString('en-NG', { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' });
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(order);
  });

  container.innerHTML = Object.entries(grouped).map(([date, dayOrders]) => {
    const dayTotal = dayOrders.reduce((s, o) => s + o.total, 0);

    const orderCards = dayOrders.map(order => {
      const items = (order.order_items || []).map(i => `${i.quantity}× ${i.item_name}`).join(', ');
      const time = new Date(order.created_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });
      return `
        <div class="dash-card">
          <div class="dash-card-top">
            <span class="dash-card-table">Table ${order.table_number}</span>
            <span class="dash-card-time">${time}</span>
          </div>
          <div class="dash-card-items"><div>${items || '—'}</div></div>
          <div class="dash-card-total">${formatPrice(order.total)}</div>
        </div>
      `;
    }).join('');

    return `
      <div class="shift-day-group">
        <div class="shift-day-header">
          <span class="shift-day-date">${date}</span>
          <span class="shift-day-summary">${dayOrders.length} order${dayOrders.length !== 1 ? 's' : ''} · ${formatPrice(dayTotal)}</span>
        </div>
        <div class="card-list">${orderCards}</div>
      </div>
    `;
  }).join('');
}

// ── Tab switching ─────────────────────────────────────────────────────────────

function initDashTabs() {
  document.querySelectorAll('.dash-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.dash-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      document.getElementById('liveView').classList.toggle('admin-hidden', tab !== 'live');
      document.getElementById('shiftView').classList.toggle('admin-hidden', tab !== 'shift');
      if (tab === 'shift') loadShiftHistory();
    });
  });
}

// ── Web Push ──────────────────────────────────────────────────────────────────

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

// ── Dashboard start ───────────────────────────────────────────────────────────

async function loadWaiterProfile() {
  const { data: { user } } = await db.auth.getUser();
  if (!user) return;
  const { data } = await db.from('staff').select('name').eq('id', user.id).single();
  if (data?.name) {
    document.getElementById('waiterName').textContent = `👋 ${data.name}`;
  }
  updateTableBadge();
}

function updateTableBadge() {
  const badge = document.getElementById('waiterTableBadge');
  if (!badge) return;
  if (myTableNumbers.size > 0) {
    const sorted = [...myTableNumbers].sort((a, b) => a - b).join(', ');
    badge.textContent = `Tables: ${sorted}`;
  } else {
    badge.textContent = 'No tables assigned today';
  }
  badge.classList.remove('admin-hidden');
}

async function startDashboard() {
  await loadAssignments();
  loadWaiterProfile();
  loadStaffRole();
  refreshOrders();
  refreshCalls();
  refreshMenuToggleList();
  initDashTabs();
  startRealtime();
  initPushSubscription();

  setInterval(async () => {
    await loadAssignments();
    updateTableBadge();
    refreshOrders();
    refreshCalls();
  }, 30000);
}

document.addEventListener('DOMContentLoaded', initAuth);

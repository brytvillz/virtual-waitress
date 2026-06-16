// Virtual Waitress — Admin Dashboard
// Manager-only: menu editing (full CRUD) + sales analytics.
// Waiters who log in here are shown an access-denied screen and sent back
// to the staff dashboard — the real enforcement is in the database (RLS +
// the enforce_waiter_menu_update trigger), this is just UX.

let categoriesCache = [];
let itemsCache = [];
let editingItemId = null;
let editingCategoryId = null;

function formatPrice(amount) {
  return '₦' + amount.toLocaleString();
}

// ── Auth ─────────────────────────────────────────────────────────────────────

function showDashboard() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('deniedScreen').style.display = 'none';
  document.getElementById('dashboard').classList.add('visible');
  document.getElementById('dashboard').removeAttribute('aria-hidden');
  loadAnalytics();
  loadMenuEditor();
}

function showDenied() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('dashboard').classList.remove('visible');
  document.getElementById('deniedScreen').style.display = 'flex';
}

function showLogin() {
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('deniedScreen').style.display = 'none';
  document.getElementById('dashboard').classList.remove('visible');
  document.getElementById('dashboard').setAttribute('aria-hidden', 'true');
}

async function checkAccessAndEnter() {
  const { data: { user } } = await db.auth.getUser();
  if (!user) {
    showLogin();
    return;
  }
  const { data, error } = await db.from('staff').select('role').eq('id', user.id).single();
  if (error || !data || data.role !== 'manager') {
    showDenied();
    return;
  }
  showDashboard();
}

async function initAuth() {
  const { data: { session } } = await db.auth.getSession();
  if (session) {
    await checkAccessAndEnter();
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
    await checkAccessAndEnter();
  });

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await db.auth.signOut();
    showLogin();
  });

  document.getElementById('deniedLogoutBtn').addEventListener('click', async () => {
    await db.auth.signOut();
    showLogin();
  });

  document.getElementById('refreshBtn').addEventListener('click', () => {
    loadAnalytics();
    loadMenuEditor();
  });
}

// ── Tabs ─────────────────────────────────────────────────────────────────────

function initTabs() {
  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('analyticsTab').style.display = tab.dataset.tab === 'analytics' ? 'block' : 'none';
      document.getElementById('menuTab').style.display = tab.dataset.tab === 'menu' ? 'block' : 'none';
    });
  });
}

// ── Analytics ────────────────────────────────────────────────────────────────

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

async function loadAnalytics() {
  const [{ data: todayOrders }, { data: allOrders }, { data: orderItems }, { data: recentOrders }] = await Promise.all([
    db.from('orders').select('total').eq('restaurant_id', RESTAURANT_ID).gte('created_at', startOfToday()),
    db.from('orders').select('total').eq('restaurant_id', RESTAURANT_ID),
    db.from('order_items').select('item_name, quantity, price, orders!inner(restaurant_id)').eq('orders.restaurant_id', RESTAURANT_ID),
    db.from('orders').select('*, order_items(*)').eq('restaurant_id', RESTAURANT_ID).order('created_at', { ascending: false }).limit(20)
  ]);

  const todayCount = (todayOrders || []).length;
  const todayRevenue = (todayOrders || []).reduce((sum, o) => sum + o.total, 0);
  const allCount = (allOrders || []).length;
  const allRevenue = (allOrders || []).reduce((sum, o) => sum + o.total, 0);

  document.getElementById('statTodayOrders').textContent = todayCount;
  document.getElementById('statTodayRevenue').textContent = formatPrice(todayRevenue);
  document.getElementById('statAllOrders').textContent = allCount;
  document.getElementById('statAllRevenue').textContent = formatPrice(allRevenue);

  renderBestSellers(orderItems || []);
  renderRecentOrders(recentOrders || []);
}

function renderBestSellers(orderItems) {
  const totals = {};
  orderItems.forEach(i => {
    if (!totals[i.item_name]) totals[i.item_name] = { qty: 0, revenue: 0 };
    totals[i.item_name].qty += i.quantity;
    totals[i.item_name].revenue += i.quantity * i.price;
  });

  const ranked = Object.entries(totals)
    .sort((a, b) => b[1].qty - a[1].qty)
    .slice(0, 5);

  const list = document.getElementById('bestSellersList');
  if (!ranked.length) {
    list.innerHTML = '<p class="empty-state">No orders yet</p>';
    return;
  }

  list.innerHTML = ranked.map(([name, stats], i) => `
    <div class="dash-card best-seller-card">
      <span><span class="best-seller-rank">#${i + 1}</span>${name} — ${stats.qty} sold</span>
      <span>${formatPrice(stats.revenue)}</span>
    </div>
  `).join('');
}

function renderRecentOrders(orders) {
  const list = document.getElementById('recentOrdersList');
  if (!orders.length) {
    list.innerHTML = '<p class="empty-state">No orders yet</p>';
    return;
  }

  list.innerHTML = orders.map(order => {
    const itemsHtml = (order.order_items || []).map(i => `${i.quantity}x ${i.item_name}`).join(', ');
    return `
      <div class="dash-card">
        <div class="dash-card-top">
          <span class="dash-card-table">Table ${order.table_number} · ${order.status}</span>
          <span class="dash-card-time">${new Date(order.created_at).toLocaleString()}</span>
        </div>
        <div class="dash-card-items"><div>${itemsHtml}</div></div>
        <div class="dash-card-total">Total: ${formatPrice(order.total)}</div>
      </div>
    `;
  }).join('');
}

// ── Menu editor ──────────────────────────────────────────────────────────────

async function loadMenuEditor() {
  const [{ data: categories, error: cErr }, { data: items, error: iErr }] = await Promise.all([
    db.from('menu_categories').select('*').eq('restaurant_id', RESTAURANT_ID).order('sort_order'),
    db.from('menu_items').select('*').eq('restaurant_id', RESTAURANT_ID).order('sort_order')
  ]);

  if (cErr || iErr) {
    console.error('Failed to load menu editor', cErr || iErr);
    return;
  }

  categoriesCache = categories;
  itemsCache = items;
  renderMenuEditor();
}

function renderMenuEditor() {
  const container = document.getElementById('categoriesEditor');

  container.innerHTML = categoriesCache.map(cat => {
    const items = itemsCache.filter(i => i.category_id === cat.id);
    const itemsHtml = items.map(item => `
      <div class="item-edit-row" data-item-id="${item.id}">
        <div class="item-edit-info">
          <span class="item-edit-name">${item.name} ${item.available ? '' : '· <span class="sold-out-label">Sold Out</span>'}</span>
          <span class="item-edit-price">${formatPrice(item.price)}</span>
        </div>
        <div class="item-edit-actions">
          <label class="toggle-switch">
            <input type="checkbox" class="item-available-toggle" ${item.available ? 'checked' : ''} />
            <span class="toggle-slider"></span>
          </label>
          <button class="icon-btn edit-item-btn">Edit</button>
          <button class="icon-btn danger delete-item-btn">Delete</button>
        </div>
      </div>
    `).join('') || '<p class="empty-state">No items yet</p>';

    return `
      <div class="category-section" data-category-id="${cat.id}">
        <div class="category-section-header">
          <span class="category-section-title"><span>${cat.emoji || ''}</span> ${cat.name}</span>
          <div class="category-section-actions">
            <button class="icon-btn edit-category-btn">Edit</button>
            <button class="icon-btn danger delete-category-btn">Delete</button>
          </div>
        </div>
        ${itemsHtml}
        <button class="add-item-btn">+ Add item to ${cat.name}</button>
      </div>
    `;
  }).join('');

  wireMenuEditorEvents();
}

function wireMenuEditorEvents() {
  document.querySelectorAll('.category-section').forEach(section => {
    const categoryId = section.dataset.categoryId;
    const category = categoriesCache.find(c => c.id === categoryId);

    section.querySelector('.edit-category-btn').addEventListener('click', () => openCategoryModal(category));
    section.querySelector('.delete-category-btn').addEventListener('click', () => deleteCategory(category));
    section.querySelector('.add-item-btn').addEventListener('click', () => openItemModal(null, categoryId));

    section.querySelectorAll('.item-edit-row').forEach(row => {
      const itemId = row.dataset.itemId;
      const item = itemsCache.find(i => i.id === itemId);

      row.querySelector('.item-available-toggle').addEventListener('change', async (e) => {
        const { error } = await db.from('menu_items').update({ available: e.target.checked }).eq('id', itemId);
        if (error) {
          console.error('Failed to update availability', error);
          e.target.checked = !e.target.checked;
          return;
        }
        item.available = e.target.checked;
        renderMenuEditor();
      });

      row.querySelector('.edit-item-btn').addEventListener('click', () => openItemModal(item, categoryId));
      row.querySelector('.delete-item-btn').addEventListener('click', () => deleteItem(item));
    });
  });
}

async function deleteCategory(category) {
  if (!confirm(`Delete "${category.name}" and all its items? This cannot be undone.`)) return;
  const { error } = await db.from('menu_categories').delete().eq('id', category.id);
  if (error) {
    console.error('Failed to delete category', error);
    alert('Could not delete category — see console for details.');
    return;
  }
  await loadMenuEditor();
}

async function deleteItem(item) {
  if (!confirm(`Delete "${item.name}"?`)) return;
  const { error } = await db.from('menu_items').delete().eq('id', item.id);
  if (error) {
    console.error('Failed to delete item', error);
    alert('Could not delete item — see console for details.');
    return;
  }
  await loadMenuEditor();
}

// ── Item modal ───────────────────────────────────────────────────────────────

function openItemModal(item, categoryId) {
  editingItemId = item ? item.id : null;
  document.getElementById('itemModalTitle').textContent = item ? 'Edit Item' : 'New Item';
  document.getElementById('itemName').value = item ? item.name : '';
  document.getElementById('itemPrice').value = item ? item.price : '';
  document.getElementById('itemDescription').value = item ? (item.description || '') : '';
  document.getElementById('itemAdaMessage').value = item ? (item.ada_message || '') : '';
  document.getElementById('itemForm').dataset.categoryId = categoryId;
  document.getElementById('itemModal').style.display = 'flex';
}

function closeItemModal() {
  document.getElementById('itemModal').style.display = 'none';
  editingItemId = null;
}

function initItemModal() {
  document.getElementById('itemCancelBtn').addEventListener('click', closeItemModal);

  document.getElementById('itemForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const categoryId = e.target.dataset.categoryId;
    const payload = {
      name: document.getElementById('itemName').value.trim(),
      price: Number(document.getElementById('itemPrice').value),
      description: document.getElementById('itemDescription').value.trim(),
      ada_message: document.getElementById('itemAdaMessage').value.trim()
    };

    let error;
    if (editingItemId) {
      ({ error } = await db.from('menu_items').update(payload).eq('id', editingItemId));
    } else {
      ({ error } = await db.from('menu_items').insert({
        ...payload,
        restaurant_id: RESTAURANT_ID,
        category_id: categoryId,
        sort_order: itemsCache.filter(i => i.category_id === categoryId).length + 1
      }));
    }

    if (error) {
      console.error('Failed to save item', error);
      alert('Could not save item — see console for details.');
      return;
    }

    closeItemModal();
    await loadMenuEditor();
  });
}

// ── Category modal ───────────────────────────────────────────────────────────

function openCategoryModal(category) {
  editingCategoryId = category ? category.id : null;
  document.getElementById('categoryModalTitle').textContent = category ? 'Edit Category' : 'New Category';
  document.getElementById('categoryName').value = category ? category.name : '';
  document.getElementById('categoryEmoji').value = category ? (category.emoji || '') : '';
  document.getElementById('categoryAdaMessage').value = category ? (category.ada_message || '') : '';
  document.getElementById('categoryModal').style.display = 'flex';
}

function closeCategoryModal() {
  document.getElementById('categoryModal').style.display = 'none';
  editingCategoryId = null;
}

function slugify(name) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function initCategoryModal() {
  document.getElementById('categoryCancelBtn').addEventListener('click', closeCategoryModal);
  document.getElementById('addCategoryBtn').addEventListener('click', () => openCategoryModal(null));

  document.getElementById('categoryForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('categoryName').value.trim();
    const payload = {
      name,
      emoji: document.getElementById('categoryEmoji').value.trim(),
      ada_message: document.getElementById('categoryAdaMessage').value.trim()
    };

    let error;
    if (editingCategoryId) {
      ({ error } = await db.from('menu_categories').update(payload).eq('id', editingCategoryId));
    } else {
      ({ error } = await db.from('menu_categories').insert({
        ...payload,
        restaurant_id: RESTAURANT_ID,
        slug: slugify(name) + '-' + Date.now().toString(36),
        sort_order: categoriesCache.length + 1
      }));
    }

    if (error) {
      console.error('Failed to save category', error);
      alert('Could not save category — see console for details.');
      return;
    }

    closeCategoryModal();
    await loadMenuEditor();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initAuth();
  initTabs();
  initItemModal();
  initCategoryModal();
});

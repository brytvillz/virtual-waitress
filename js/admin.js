// Virtual Waitress — Admin Dashboard
// Manager-only: analytics, menu editing, staff overview, table assignments, settings.

let categoriesCache = [];
let itemsCache = [];
let editingItemId = null;
let editingCategoryId = null;
let currentSection = 'analytics';
let maxTablesPerWaiter = 3;

function formatPrice(amount) {
  return '₦' + Number(amount).toLocaleString();
}

function todayDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

// ── Auth ──────────────────────────────────────────────────────────────────────

function showDashboard() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('deniedScreen').style.display = 'none';
  document.getElementById('dashboard').classList.add('visible');
  document.getElementById('dashboard').removeAttribute('aria-hidden');
  loadSettings();
  loadAnalytics();
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
  if (!user) { showLogin(); return; }
  const { data, error } = await db.from('staff').select('role').eq('id', user.id).single();
  if (error || !data || data.role !== 'manager') { showDenied(); return; }
  showDashboard();
}

async function initAuth() {
  const { data: { session } } = await db.auth.getSession();
  if (session) await checkAccessAndEnter();

  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errorEl = document.getElementById('loginError');
    errorEl.textContent = '';
    const { error } = await db.auth.signInWithPassword({ email, password });
    if (error) { errorEl.textContent = 'Login failed — check your email and password.'; return; }
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
    SECTION_LOADERS[currentSection]?.();
  });
}

// ── Navigation ────────────────────────────────────────────────────────────────

const SECTION_TITLES = {
  analytics: 'Analytics',
  menu: 'Menu Editor',
  staff: 'Staff',
  tables: 'Tables',
  settings: 'Settings'
};

const SECTION_LOADERS = {
  analytics: () => loadAnalytics(),
  menu: () => loadMenuEditor(),
  staff: () => loadStaff(),
  tables: () => loadTablesSection(),
  settings: () => loadSettings()
};

function navigateTo(section) {
  if (section === currentSection) { closeSidebar(); return; }

  document.getElementById(currentSection + 'Section').classList.add('admin-hidden');
  document.getElementById(section + 'Section').classList.remove('admin-hidden');

  document.querySelectorAll('.sidebar-nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.section === section);
  });
  document.querySelectorAll('.bottom-nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.section === section);
  });

  const titleEl = document.getElementById('topbarTitle');
  if (titleEl) titleEl.textContent = SECTION_TITLES[section] || section;

  currentSection = section;
  SECTION_LOADERS[section]?.();
  closeSidebar();
}

function openSidebar() {
  document.getElementById('adminSidebar').classList.add('open');
  document.getElementById('sidebarOverlay').classList.add('visible');
}

function closeSidebar() {
  document.getElementById('adminSidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('visible');
}

function initNav() {
  document.querySelectorAll('.sidebar-nav-item, .bottom-nav-item').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.section));
  });
  document.getElementById('sidebarToggleBtn').addEventListener('click', openSidebar);
  document.getElementById('sidebarOverlay').addEventListener('click', closeSidebar);
}

// ── Analytics ─────────────────────────────────────────────────────────────────

async function loadAnalytics() {
  const [
    { data: todayOrders },
    { data: allOrders },
    { data: orderItems },
    { data: recentOrders },
    { data: staffList }
  ] = await Promise.all([
    db.from('orders').select('total, handled_by').eq('restaurant_id', RESTAURANT_ID).gte('created_at', startOfToday()),
    db.from('orders').select('total').eq('restaurant_id', RESTAURANT_ID),
    db.from('order_items').select('item_name, quantity, price, orders!inner(restaurant_id)').eq('orders.restaurant_id', RESTAURANT_ID),
    db.from('orders').select('*, order_items(*)').eq('restaurant_id', RESTAURANT_ID).order('created_at', { ascending: false }).limit(20),
    db.from('staff').select('id, name, role').eq('restaurant_id', RESTAURANT_ID).order('name')
  ]);

  const todayCount = (todayOrders || []).length;
  const todayRevenue = (todayOrders || []).reduce((s, o) => s + o.total, 0);
  const allCount = (allOrders || []).length;
  const allRevenue = (allOrders || []).reduce((s, o) => s + o.total, 0);

  document.getElementById('statTodayOrders').textContent = todayCount;
  document.getElementById('statTodayRevenue').textContent = formatPrice(todayRevenue);
  document.getElementById('statAllOrders').textContent = allCount;
  document.getElementById('statAllRevenue').textContent = formatPrice(allRevenue);

  renderWaiterPerformance(staffList || [], todayOrders || []);
  renderBestSellers(orderItems || []);
  renderRecentOrders(recentOrders || []);
}

function renderWaiterPerformance(staffList, todayOrders) {
  const stats = {};
  todayOrders.forEach(o => {
    if (!o.handled_by) return;
    if (!stats[o.handled_by]) stats[o.handled_by] = { count: 0, revenue: 0 };
    stats[o.handled_by].count++;
    stats[o.handled_by].revenue += o.total;
  });

  const waiters = staffList.filter(s => s.role === 'waiter');
  const list = document.getElementById('waiterPerformanceList');

  if (!waiters.length) {
    list.innerHTML = '<p class="empty-state">No waiter accounts found</p>';
    return;
  }

  list.innerHTML = waiters.map(w => {
    const s = stats[w.id] || { count: 0, revenue: 0 };
    return `
      <div class="dash-card waiter-perf-card">
        <div>
          <div class="waiter-perf-name">${w.name || 'Unnamed'}</div>
          <div class="waiter-perf-meta">${s.count} order${s.count !== 1 ? 's' : ''} handled today</div>
        </div>
        <div class="waiter-perf-right">
          <span class="waiter-perf-revenue">${formatPrice(s.revenue)}</span>
        </div>
      </div>
    `;
  }).join('');
}

function renderBestSellers(orderItems) {
  const totals = {};
  orderItems.forEach(i => {
    if (!totals[i.item_name]) totals[i.item_name] = { qty: 0, revenue: 0 };
    totals[i.item_name].qty += i.quantity;
    totals[i.item_name].revenue += i.quantity * i.price;
  });

  const ranked = Object.entries(totals).sort((a, b) => b[1].qty - a[1].qty).slice(0, 5);
  const list = document.getElementById('bestSellersList');

  if (!ranked.length) { list.innerHTML = '<p class="empty-state">No orders yet</p>'; return; }

  list.innerHTML = ranked.map(([name, s], i) => `
    <div class="dash-card best-seller-card">
      <span><span class="best-seller-rank">#${i + 1}</span>${name} — ${s.qty} sold</span>
      <span>${formatPrice(s.revenue)}</span>
    </div>
  `).join('');
}

function renderRecentOrders(orders) {
  const list = document.getElementById('recentOrdersList');
  if (!orders.length) { list.innerHTML = '<p class="empty-state">No orders yet</p>'; return; }

  list.innerHTML = orders.map(order => {
    const items = (order.order_items || []).map(i => `${i.quantity}× ${i.item_name}`).join(', ');
    return `
      <div class="dash-card">
        <div class="dash-card-top">
          <span class="dash-card-table">Table ${order.table_number} · ${order.status}</span>
          <span class="dash-card-time">${new Date(order.created_at).toLocaleString()}</span>
        </div>
        <div class="dash-card-items"><div>${items}</div></div>
        <div class="dash-card-total">Total: ${formatPrice(order.total)}</div>
      </div>
    `;
  }).join('');
}

// ── Menu editor ───────────────────────────────────────────────────────────────

async function loadMenuEditor() {
  const [{ data: categories, error: cErr }, { data: items, error: iErr }] = await Promise.all([
    db.from('menu_categories').select('*').eq('restaurant_id', RESTAURANT_ID).order('sort_order'),
    db.from('menu_items').select('*').eq('restaurant_id', RESTAURANT_ID).order('sort_order')
  ]);

  if (cErr || iErr) { console.error('Failed to load menu editor', cErr || iErr); return; }
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
          <span class="category-section-title"><span>${cat.emoji || ''}</span>${cat.name}</span>
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
        if (error) { console.error('Failed to update availability', error); e.target.checked = !e.target.checked; return; }
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
  if (error) { console.error('Failed to delete category', error); alert('Could not delete category.'); return; }
  await loadMenuEditor();
}

async function deleteItem(item) {
  if (!confirm(`Delete "${item.name}"?`)) return;
  const { error } = await db.from('menu_items').delete().eq('id', item.id);
  if (error) { console.error('Failed to delete item', error); alert('Could not delete item.'); return; }
  await loadMenuEditor();
}

// ── Item modal ────────────────────────────────────────────────────────────────

function openItemModal(item, categoryId) {
  editingItemId = item ? item.id : null;
  document.getElementById('itemModalTitle').textContent = item ? 'Edit Item' : 'New Item';
  document.getElementById('itemName').value = item ? item.name : '';
  document.getElementById('itemPrice').value = item ? item.price : '';
  document.getElementById('itemDescription').value = item ? (item.description || '') : '';
  document.getElementById('itemAdaMessage').value = item ? (item.ada_message || '') : '';
  document.getElementById('itemForm').dataset.categoryId = categoryId;
  document.getElementById('itemModal').classList.remove('admin-hidden');
}

function closeItemModal() {
  document.getElementById('itemModal').classList.add('admin-hidden');
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

    if (error) { console.error('Failed to save item', error); alert('Could not save item.'); return; }
    closeItemModal();
    await loadMenuEditor();
  });
}

// ── Category modal ────────────────────────────────────────────────────────────

function openCategoryModal(category) {
  editingCategoryId = category ? category.id : null;
  document.getElementById('categoryModalTitle').textContent = category ? 'Edit Category' : 'New Category';
  document.getElementById('categoryName').value = category ? category.name : '';
  document.getElementById('categoryEmoji').value = category ? (category.emoji || '') : '';
  document.getElementById('categoryAdaMessage').value = category ? (category.ada_message || '') : '';
  document.getElementById('categoryModal').classList.remove('admin-hidden');
}

function closeCategoryModal() {
  document.getElementById('categoryModal').classList.add('admin-hidden');
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

    if (error) { console.error('Failed to save category', error); alert('Could not save category.'); return; }
    closeCategoryModal();
    await loadMenuEditor();
  });
}

// ── Staff ─────────────────────────────────────────────────────────────────────

async function loadStaff() {
  const today = todayDate();
  const [
    { data: staffList, error: sErr },
    { data: assignments },
    { data: todayOrders }
  ] = await Promise.all([
    db.from('staff').select('*').eq('restaurant_id', RESTAURANT_ID).order('name'),
    db.from('shift_assignments')
      .select('waiter_id, tables(table_number)')
      .eq('restaurant_id', RESTAURANT_ID)
      .eq('assigned_date', today),
    db.from('orders')
      .select('handled_by, total')
      .eq('restaurant_id', RESTAURANT_ID)
      .gte('created_at', startOfToday())
  ]);

  if (sErr) { console.error('Failed to load staff', sErr); return; }

  const waiterTables = {};
  (assignments || []).forEach(a => {
    if (!waiterTables[a.waiter_id]) waiterTables[a.waiter_id] = [];
    waiterTables[a.waiter_id].push(a.tables?.table_number ?? '?');
  });

  const waiterStats = {};
  (todayOrders || []).forEach(o => {
    if (!o.handled_by) return;
    if (!waiterStats[o.handled_by]) waiterStats[o.handled_by] = { count: 0, revenue: 0 };
    waiterStats[o.handled_by].count++;
    waiterStats[o.handled_by].revenue += o.total;
  });

  renderStaff(staffList || [], waiterTables, waiterStats);
}

function generateWaiterCode() {
  return 'WTR-' + Math.floor(1000 + Math.random() * 9000);
}

function renderStaff(staffList, waiterTables, waiterStats) {
  const list = document.getElementById('staffList');
  if (!staffList.length) { list.innerHTML = '<p class="empty-state">No staff found</p>'; return; }

  list.innerHTML = staffList.map(member => {
    const isWaiter = member.role === 'waiter';
    const tables = (waiterTables[member.id] || []).sort((a, b) => a - b);
    const stats = waiterStats[member.id] || { count: 0, revenue: 0 };

    const tablesHtml = isWaiter
      ? `<span class="staff-tables-assigned">${tables.length ? 'Tables: ' + tables.join(', ') : 'No tables assigned today'}</span>`
      : '';

    const statsHtml = isWaiter
      ? `<span class="waiter-perf-stat">${stats.count} orders</span><span class="waiter-perf-revenue">${formatPrice(stats.revenue)}</span>`
      : '';

    const codeHtml = isWaiter ? `
      <div class="staff-code-row">
        <span class="staff-code-badge">${member.access_code || 'No code'}</span>
        <button class="icon-btn view-profile-btn" data-id="${member.id}" type="button">View Profile</button>
        <button class="icon-btn regen-code-btn" data-id="${member.id}" type="button">↺ New Code</button>
        <button class="icon-btn danger deactivate-btn" data-id="${member.id}" data-name="${member.name || 'this waiter'}" type="button">Remove</button>
      </div>
    ` : '';

    return `
      <div class="dash-card staff-card">
        <div class="staff-card-info">
          <span class="staff-name">${member.name || 'Unnamed'}</span>
          ${tablesHtml}
          ${codeHtml}
        </div>
        <div class="staff-card-meta">
          <span class="role-badge role-badge--${member.role}">${member.role}</span>
          ${statsHtml}
        </div>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.view-profile-btn').forEach(btn => {
    const member = staffList.find(m => m.id === btn.dataset.id);
    btn.addEventListener('click', () => openWaiterProfile(member));
  });
  list.querySelectorAll('.regen-code-btn').forEach(btn => {
    btn.addEventListener('click', () => regenerateCode(btn.dataset.id));
  });
  list.querySelectorAll('.deactivate-btn').forEach(btn => {
    btn.addEventListener('click', () => deactivateWaiter(btn.dataset.id, btn.dataset.name));
  });
}

async function regenerateCode(staffId) {
  let newCode = '';
  for (let i = 0; i < 5; i++) {
    const candidate = generateWaiterCode();
    const { data } = await db.from('staff').select('id').eq('access_code', candidate).maybeSingle();
    if (!data) { newCode = candidate; break; }
  }
  if (!newCode) { alert('Could not generate a unique code — try again.'); return; }

  const { error } = await db.from('staff').update({ access_code: newCode }).eq('id', staffId);
  if (error) { console.error('Regen code failed', error); alert('Failed to update code.'); return; }
  await loadStaff();
}

async function deactivateWaiter(staffId, name) {
  if (!confirm(`Remove ${name}? Their code will stop working and they won't be able to log in. Their order history is kept.`)) return;
  const { error } = await db.from('staff').update({ access_code: null }).eq('id', staffId);
  if (error) { console.error('Deactivate failed', error); alert('Failed to deactivate waiter.'); return; }
  await loadStaff();
}

// ── Tables ────────────────────────────────────────────────────────────────────

async function loadTablesSection() {
  const today = todayDate();
  const [
    { data: tables, error: tErr },
    { data: assignments },
    { data: waiters }
  ] = await Promise.all([
    db.from('tables').select('*').eq('restaurant_id', RESTAURANT_ID).order('table_number'),
    db.from('shift_assignments')
      .select('table_id, waiter_id, staff(name)')
      .eq('restaurant_id', RESTAURANT_ID)
      .eq('assigned_date', today),
    db.from('staff').select('id, name').eq('restaurant_id', RESTAURANT_ID).eq('role', 'waiter').order('name')
  ]);

  if (tErr) { console.error('Failed to load tables', tErr); return; }
  renderTableGrid(tables || [], assignments || [], waiters || []);
}

function renderTableGrid(tables, assignments, waiters) {
  const assignmentMap = {};
  const waiterTableCount = {};

  assignments.forEach(a => {
    assignmentMap[a.table_id] = { waiter_id: a.waiter_id, name: a.staff?.name || 'Unknown' };
    waiterTableCount[a.waiter_id] = (waiterTableCount[a.waiter_id] || 0) + 1;
  });

  const container = document.getElementById('tableGrid');
  if (!tables.length) {
    container.innerHTML = '<p class="empty-state">No tables yet. Add one above.</p>';
    return;
  }

  const waiterOptions = waiters.map(w => `<option value="${w.id}">${w.name}</option>`).join('');

  container.innerHTML = tables.map(table => {
    const assignment = assignmentMap[table.id];
    const isAssigned = !!assignment;
    return `
      <div class="table-card ${isAssigned ? 'table-card--assigned' : ''}" data-table-id="${table.id}">
        <div class="table-card-header">
          <span class="table-card-number">${table.table_number}</span>
          ${isAssigned ? `<span class="role-badge role-badge--waiter">${assignment.name.split(' ')[0]}</span>` : ''}
        </div>
        <span class="table-card-label">${table.label || 'Table ' + table.table_number}</span>
        <select class="table-assign-select" data-table-id="${table.id}">
          <option value="">Unassigned</option>
          ${waiterOptions}
        </select>
        <button class="icon-btn danger table-delete-btn" data-table-id="${table.id}" data-table-number="${table.table_number}">Delete</button>
      </div>
    `;
  }).join('');

  // Set current selections
  container.querySelectorAll('.table-assign-select').forEach(select => {
    const tableId = select.dataset.tableId;
    if (assignmentMap[tableId]) select.value = assignmentMap[tableId].waiter_id;

    select.addEventListener('change', async (e) => {
      const ok = await assignTable(tableId, e.target.value, waiterTableCount);
      if (!ok) {
        // Revert to previous value
        select.value = assignmentMap[tableId]?.waiter_id || '';
        return;
      }
      await loadTablesSection();
    });
  });

  container.querySelectorAll('.table-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(`Delete Table ${btn.dataset.tableNumber}? Assignments for this table will also be removed.`)) return;
      const { error } = await db.from('tables').delete().eq('id', btn.dataset.tableId);
      if (error) { alert('Could not delete table.'); return; }
      await loadTablesSection();
    });
  });
}

async function assignTable(tableId, waiterId, currentCounts) {
  const today = todayDate();

  if (!waiterId) {
    await db.from('shift_assignments')
      .delete()
      .eq('table_id', tableId)
      .eq('assigned_date', today)
      .eq('restaurant_id', RESTAURANT_ID);
    return true;
  }

  // Soft cap check
  const count = currentCounts[waiterId] || 0;
  if (count >= maxTablesPerWaiter) {
    const proceed = confirm(`This waiter already has ${count} table${count !== 1 ? 's' : ''} (cap is ${maxTablesPerWaiter}). Assign anyway?`);
    if (!proceed) return false;
  }

  const { error } = await db.from('shift_assignments').upsert({
    restaurant_id: RESTAURANT_ID,
    waiter_id: waiterId,
    table_id: tableId,
    assigned_date: today
  }, { onConflict: 'restaurant_id,table_id,assigned_date' });

  if (error) { console.error('Failed to assign table', error); alert('Could not save assignment.'); return false; }
  return true;
}

function initTableModal() {
  document.getElementById('addTableBtn').addEventListener('click', () => {
    document.getElementById('tableNumber').value = '';
    document.getElementById('tableLabel').value = '';
    document.getElementById('tableModal').classList.remove('admin-hidden');
  });

  document.getElementById('tableCancelBtn').addEventListener('click', () => {
    document.getElementById('tableModal').classList.add('admin-hidden');
  });

  document.getElementById('tableForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const tableNumber = parseInt(document.getElementById('tableNumber').value);
    const label = document.getElementById('tableLabel').value.trim();

    const { error } = await db.from('tables').insert({
      restaurant_id: RESTAURANT_ID,
      table_number: tableNumber,
      label: label || `Table ${tableNumber}`
    });

    if (error) { console.error('Failed to add table', error); alert('Could not add table — the number may already exist.'); return; }
    document.getElementById('tableModal').classList.add('admin-hidden');
    await loadTablesSection();
  });
}

// ── Settings ──────────────────────────────────────────────────────────────────

async function loadSettings() {
  const { data, error } = await db.from('restaurants')
    .select('name, tagline, max_tables_per_waiter')
    .eq('id', RESTAURANT_ID)
    .single();

  if (error || !data) return;

  maxTablesPerWaiter = data.max_tables_per_waiter || 3;

  const nameEl = document.getElementById('sidebarRestaurantName');
  if (nameEl) nameEl.textContent = data.name || 'Restaurant';

  document.getElementById('settingName').value = data.name || '';
  document.getElementById('settingTagline').value = data.tagline || '';
  document.getElementById('settingMaxTables').value = data.max_tables_per_waiter || 3;
}

function initSettingsForm() {
  document.getElementById('settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('settingName').value.trim();
    const tagline = document.getElementById('settingTagline').value.trim();
    const maxTables = parseInt(document.getElementById('settingMaxTables').value);
    const msg = document.getElementById('settingsSavedMsg');

    const { error } = await db.from('restaurants').update({ name, tagline, max_tables_per_waiter: maxTables }).eq('id', RESTAURANT_ID);

    if (error) {
      msg.textContent = 'Failed to save.';
      msg.style.color = '#E85A5A';
    } else {
      maxTablesPerWaiter = maxTables;
      const nameEl = document.getElementById('sidebarRestaurantName');
      if (nameEl) nameEl.textContent = name;
      msg.textContent = 'Saved!';
      msg.style.color = 'var(--accent)';
      setTimeout(() => { msg.textContent = ''; }, 3000);
    }
  });
}

// ── Waiter profile (full-screen sub-view) ────────────────────────────────────

let profilePreviousSection = 'staff';

function openWaiterProfile(member) {
  profilePreviousSection = currentSection;
  document.getElementById(currentSection + 'Section').classList.add('admin-hidden');
  document.getElementById('waiterProfileSection').classList.remove('admin-hidden');

  const titleEl = document.getElementById('topbarTitle');
  if (titleEl) titleEl.textContent = member.name || 'Waiter Profile';
  document.getElementById('profileSectionTitle').textContent = member.name || 'Waiter Profile';
  document.getElementById('profileName').textContent = member.name || 'Unnamed';
  document.getElementById('profileCode').textContent = member.access_code || 'No code';
  document.getElementById('profileAvatar').textContent = (member.name || '?')[0].toUpperCase();

  document.getElementById('profileTodayStats').innerHTML = '<p class="empty-state">Loading…</p>';
  document.getElementById('profileShiftHistory').innerHTML = '<p class="empty-state">Loading…</p>';
  document.getElementById('profileAllTimeStats').innerHTML = '<p class="empty-state">Loading…</p>';

  loadWaiterProfileData(member.id);
}

function closeWaiterProfile() {
  document.getElementById('waiterProfileSection').classList.add('admin-hidden');
  document.getElementById(profilePreviousSection + 'Section').classList.remove('admin-hidden');
  const titleEl = document.getElementById('topbarTitle');
  if (titleEl) titleEl.textContent = 'Staff';
  currentSection = profilePreviousSection;
}

async function loadWaiterProfileData(waiterId) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    { data: assignments },
    { data: todayOrders },
    { data: weekOrders },
    { data: allOrders }
  ] = await Promise.all([
    db.from('shift_assignments')
      .select('tables(table_number)')
      .eq('waiter_id', waiterId)
      .eq('restaurant_id', RESTAURANT_ID)
      .eq('assigned_date', todayDate()),
    db.from('orders')
      .select('total, order_items(item_name, quantity)')
      .eq('handled_by', waiterId)
      .eq('restaurant_id', RESTAURANT_ID)
      .gte('created_at', startOfToday()),
    db.from('orders')
      .select('total, created_at, table_number, order_items(item_name, quantity)')
      .eq('handled_by', waiterId)
      .eq('restaurant_id', RESTAURANT_ID)
      .gte('created_at', sevenDaysAgo)
      .order('created_at', { ascending: false }),
    db.from('orders')
      .select('total')
      .eq('handled_by', waiterId)
      .eq('restaurant_id', RESTAURANT_ID)
  ]);

  const tables = (assignments || []).map(a => a.tables?.table_number).filter(Boolean).sort((a, b) => a - b);
  const todayCount = (todayOrders || []).length;
  const todayRevenue = (todayOrders || []).reduce((s, o) => s + o.total, 0);
  const allCount = (allOrders || []).length;
  const allRevenue = (allOrders || []).reduce((s, o) => s + o.total, 0);

  document.getElementById('profileTodayStats').innerHTML = `
    <div class="stat-card">
      <span class="stat-label">Tables Assigned</span>
      <span class="stat-value profile-tables-value">${tables.length ? tables.join(', ') : '—'}</span>
    </div>
    <div class="stat-card">
      <span class="stat-label">Orders Today</span>
      <span class="stat-value">${todayCount}</span>
    </div>
    <div class="stat-card">
      <span class="stat-label">Revenue Today</span>
      <span class="stat-value">${formatPrice(todayRevenue)}</span>
    </div>
  `;

  document.getElementById('profileAllTimeStats').innerHTML = `
    <div class="stat-card">
      <span class="stat-label">Total Orders</span>
      <span class="stat-value">${allCount}</span>
    </div>
    <div class="stat-card">
      <span class="stat-label">Total Revenue</span>
      <span class="stat-value">${formatPrice(allRevenue)}</span>
    </div>
  `;

  renderProfileShiftHistory(weekOrders || []);
}

function renderProfileShiftHistory(orders) {
  const container = document.getElementById('profileShiftHistory');
  if (!orders.length) {
    container.innerHTML = '<p class="empty-state">No orders handled in the last 7 days.</p>';
    return;
  }

  const groups = {};
  orders.forEach(order => {
    const d = new Date(order.created_at);
    const key = d.toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short' });
    if (!groups[key]) groups[key] = [];
    groups[key].push(order);
  });

  container.innerHTML = Object.entries(groups).map(([date, dayOrders]) => {
    const dayRevenue = dayOrders.reduce((s, o) => s + o.total, 0);
    const rows = dayOrders.map(o => {
      const items = (o.order_items || []).map(i => `${i.quantity}× ${i.item_name}`).join(', ');
      return `<div class="profile-order-row">
        <span class="profile-order-table">Table ${o.table_number}</span>
        <span class="profile-order-items">${items || '—'}</span>
        <span class="profile-order-total">${formatPrice(o.total)}</span>
      </div>`;
    }).join('');

    return `
      <div class="shift-day-group">
        <div class="shift-day-header">
          <span class="shift-day-date">${date}</span>
          <span class="shift-day-summary">${dayOrders.length} order${dayOrders.length !== 1 ? 's' : ''} · ${formatPrice(dayRevenue)}</span>
        </div>
        ${rows}
      </div>
    `;
  }).join('');
}

function initWaiterProfile() {
  document.getElementById('backToStaffBtn').addEventListener('click', closeWaiterProfile);
}

// ── Create Waiter modal ────────────────────────────────────────────────────────

function openWaiterModal() {
  document.getElementById('waiterName').value = '';
  document.getElementById('waiterFormError').textContent = '';
  document.getElementById('waiterSubmitBtn').disabled = false;
  document.getElementById('waiterSubmitBtn').textContent = 'Create Waiter';
  document.getElementById('waiterModal').classList.remove('admin-hidden');
}

function closeWaiterModal() {
  document.getElementById('waiterModal').classList.add('admin-hidden');
}

function initWaiterModal() {
  document.getElementById('newWaiterBtn').addEventListener('click', openWaiterModal);
  document.getElementById('waiterCancelBtn').addEventListener('click', closeWaiterModal);

  document.getElementById('waiterForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('waiterName').value.trim();
    const errorEl = document.getElementById('waiterFormError');
    const btn = document.getElementById('waiterSubmitBtn');
    if (!name) { errorEl.textContent = 'Enter the waiter\'s name.'; return; }

    btn.disabled = true;
    btn.textContent = 'Creating…';
    errorEl.textContent = '';

    try {
      const { data: { session } } = await db.auth.getSession();
      if (!session) {
        errorEl.textContent = 'Session expired — refresh the page and try again.';
        btn.disabled = false;
        btn.textContent = 'Create Waiter';
        return;
      }
      const res = await fetch(`${SUPABASE_URL}/functions/v1/create-waiter`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ name, restaurant_id: RESTAURANT_ID })
      });

      const result = await res.json();
      if (!res.ok || result.error) throw new Error(result.error || 'Failed to create waiter');

      closeWaiterModal();
      await loadStaff();
      alert(`Waiter created!\n\nName: ${result.staff.name}\nCode: ${result.staff.access_code}\n\nShare this code with the waiter — they'll use it to log in.`);
    } catch (err) {
      console.error('Create waiter error', err);
      errorEl.textContent = err.message || 'Something went wrong. Try again.';
      btn.disabled = false;
      btn.textContent = 'Create Waiter';
    }
  });
}

// ── Forgot password ────────────────────────────────────────────────────────────

function initForgotPassword() {
  document.getElementById('forgotPasswordLink').addEventListener('click', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const msgEl = document.getElementById('forgotPasswordMsg');
    msgEl.classList.remove('admin-hidden');

    if (!email) {
      msgEl.textContent = 'Enter your email above first, then click Forgot password.';
      return;
    }

    msgEl.textContent = 'Sending reset email…';
    const { error } = await db.auth.resetPasswordForEmail(email, {
      redirectTo: 'https://virtual-waitress.vercel.app/reset-password'
    });

    if (error) {
      msgEl.textContent = 'Failed to send reset email. Check the address and try again.';
    } else {
      msgEl.textContent = 'Reset email sent — check your inbox.';
    }
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initAuth();
  initNav();
  initItemModal();
  initCategoryModal();
  initTableModal();
  initSettingsForm();
  initWaiterModal();
  initForgotPassword();
  initWaiterProfile();
});

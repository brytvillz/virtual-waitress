// Virtual Waitress — Admin Dashboard
// Manager-only: analytics, menu editing, staff overview, table assignments, settings.

let categoriesCache = [];
let itemsCache = [];
let editingItemId = null;
let editingCategoryId = null;
let currentSection = 'analytics';
let maxTablesPerWaiter = 3;
let currentPlan = 'free';
let currentPlanExpiresAt = null;
let currentWaiterCount = 0;
let currentTableCount = 0;
let ownedLocations = [];

const PLAN_LIMITS = {
  free:   { staff: 1,        tables: 5,        items: 20,       locations: 1 },
  growth: { staff: 5,        tables: Infinity,  items: Infinity, locations: 1 },
  pro:    { staff: Infinity, tables: Infinity,  items: Infinity, locations: 3 },
};

function planLimit(resource) {
  return (PLAN_LIMITS[currentPlan] || PLAN_LIMITS.free)[resource];
}

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

// ── Plan nudge (soft toast for limit hits) ─────────────────────────────────────

function showPlanNudge(title, message) {
  const existing = document.getElementById('planNudge');
  if (existing) existing.remove();

  const nudge = document.createElement('div');
  nudge.id = 'planNudge';
  nudge.className = 'plan-nudge';
  nudge.innerHTML =
    '<div class="plan-nudge-icon">&#128274;</div>' +
    '<div class="plan-nudge-body">' +
      '<p class="plan-nudge-title">' + title + '</p>' +
      '<p class="plan-nudge-msg">' + message + '</p>' +
    '</div>' +
    '<button class="plan-nudge-upgrade" id="planNudgeUpgradeBtn">Upgrade &#8594;</button>' +
    '<button class="plan-nudge-close" id="planNudgeClose" aria-label="Dismiss">&#x2715;</button>';
  document.body.appendChild(nudge);

  requestAnimationFrame(() => nudge.classList.add('plan-nudge-visible'));

  let timer;
  function dismiss() {
    clearTimeout(timer);
    nudge.classList.remove('plan-nudge-visible');
    setTimeout(() => nudge.remove(), 320);
  }

  nudge.querySelector('#planNudgeClose').addEventListener('click', dismiss);
  nudge.querySelector('#planNudgeUpgradeBtn').addEventListener('click', () => {
    dismiss();
    showUpgradeModal();
  });
  timer = setTimeout(dismiss, 6000);
}

// ── Upgrade modal ─────────────────────────────────────────────────────────────

function showUpgradeModal() {
  let overlay = document.getElementById('upgradeModalOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'upgradeModalOverlay';
    overlay.className = 'upgrade-modal-overlay';
    document.body.appendChild(overlay);
  }

  const isGrowth = currentPlan === 'growth';

  // Proration for Growth → Pro
  let prorationHtml = '';
  let proAmount = 15000;
  if (isGrowth && currentPlanExpiresAt) {
    const daysLeft = Math.max(0, Math.ceil((new Date(currentPlanExpiresAt) - new Date()) / 86400000));
    const credit   = Math.round((daysLeft / 30) * 4900);
    proAmount      = Math.max(0, 15000 - credit);
    if (credit > 0) {
      prorationHtml =
        '<div class="upgrade-proration">' +
          '<span class="upgrade-proration-label">Growth credit (' + daysLeft + ' days left)</span>' +
          '<span class="upgrade-proration-credit">−₦' + credit.toLocaleString() + '</span>' +
        '</div>' +
        '<div class="upgrade-proration upgrade-proration-total">' +
          '<span class="upgrade-proration-label">You pay today</span>' +
          '<span class="upgrade-proration-amount">₦' + proAmount.toLocaleString() + '</span>' +
        '</div>';
    }
  }

  // WhatsApp upgrade message
  const restaurantName = document.getElementById('sidebarRestaurantName')?.textContent || 'my restaurant';
  const targetPlan     = isGrowth ? 'Pro' : 'Growth';
  const waMsg = encodeURIComponent(
    'Hi, I\'d like to upgrade ' + restaurantName + ' to the ' + targetPlan + ' plan on Virtual Waitress.' +
    (isGrowth && prorationHtml ? ' I have ' + Math.ceil((new Date(currentPlanExpiresAt) - new Date()) / 86400000) + ' days left on Growth.' : '')
  );
  const waLink = 'https://wa.me/2347076077265?text=' + waMsg;

  overlay.innerHTML =
    '<div class="upgrade-modal">' +
      '<button class="upgrade-modal-close" id="upgradeModalClose" aria-label="Close">&#x2715;</button>' +
      '<div class="upgrade-modal-header">' +
        '<p class="upgrade-modal-eyebrow">You are on the <strong>' + (isGrowth ? 'Growth' : 'Free') + '</strong> plan</p>' +
        '<h2 class="upgrade-modal-title">Unlock more for your restaurant</h2>' +
      '</div>' +
      '<div class="upgrade-modal-plans">' +
        (!isGrowth
          ? '<div class="upgrade-plan-card upgrade-plan-featured">' +
              '<div class="upgrade-plan-badge">Most Popular</div>' +
              '<div class="upgrade-plan-name">Growth</div>' +
              '<div class="upgrade-plan-price">₦4,900<span>/mo</span></div>' +
              '<ul class="upgrade-plan-features">' +
                '<li>Up to 5 waiters</li>' +
                '<li>Unlimited tables &amp; menu items</li>' +
                '<li>Full analytics &amp; revenue</li>' +
                '<li>Remove VW branding</li>' +
                '<li>Push notifications</li>' +
              '</ul>' +
            '</div>'
          : '') +
        '<div class="upgrade-plan-card' + (!isGrowth ? '' : ' upgrade-plan-featured') + '">' +
          (isGrowth ? '<div class="upgrade-plan-badge">Best Value</div>' : '') +
          '<div class="upgrade-plan-name">Pro</div>' +
          '<div class="upgrade-plan-price">₦15,000<span>/mo</span></div>' +
          '<ul class="upgrade-plan-features">' +
            '<li>Everything in Growth</li>' +
            '<li>Up to 3 locations</li>' +
            '<li>Unlimited waiters</li>' +
            '<li>Priority support</li>' +
          '</ul>' +
          prorationHtml +
        '</div>' +
      '</div>' +
      '<a href="' + waLink + '" target="_blank" rel="noopener" class="upgrade-modal-cta">Upgrade Plan &#8594;</a>' +
      '<p class="upgrade-modal-note">You\'ll be connected with us on WhatsApp to complete your upgrade.</p>' +
    '</div>';

  overlay.classList.add('upgrade-modal-visible');

  overlay.querySelector('#upgradeModalClose').addEventListener('click', () => {
    overlay.classList.remove('upgrade-modal-visible');
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.remove('upgrade-modal-visible');
  });
}

// ── Auth ──────────────────────────────────────────────────────────────────────

function showDashboard() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('deniedScreen').style.display = 'none';
  document.getElementById('dashboard').classList.add('visible');
  document.getElementById('dashboard').removeAttribute('aria-hidden');
  loadSettings();
  loadAnalytics();
  maybeShowWizard();
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

function setActiveRestaurant(restaurant) {
  RESTAURANT_ID = restaurant.id;
  currentPlanExpiresAt = restaurant.plan_expires_at || null;

  let plan = 'free';
  if (restaurant.plan_status === 'active') {
    const expired = currentPlanExpiresAt && new Date(currentPlanExpiresAt) < new Date();
    plan = expired ? 'free' : (restaurant.plan || 'free');
  }
  currentPlan = plan;

  applyPlanGating();
  showDashboard();
}

async function checkAccessAndEnter() {
  const { data: { user } } = await db.auth.getUser();
  if (!user) { showLogin(); return; }

  // Owner path: user owns restaurants directly (post-migration)
  const { data: owned } = await db
    .from('restaurants')
    .select('id, name, slug, plan, plan_status, plan_expires_at')
    .eq('owner_id', user.id);

  if (owned && owned.length > 0) {
    ownedLocations = owned;
    if (owned.length === 1) {
      setActiveRestaurant(owned[0]);
    } else {
      showLocationPicker(owned);
    }
    return;
  }

  // Fallback: legacy manager staff record (single-location, pre-migration)
  const { data, error } = await db.from('staff').select('role, restaurant_id').eq('id', user.id).single();
  if (error || !data || data.role !== 'manager') { showDenied(); return; }
  const { data: rest } = await db.from('restaurants').select('id, name, slug, plan, plan_status, plan_expires_at').eq('id', data.restaurant_id).single();
  ownedLocations = rest ? [rest] : [];
  setActiveRestaurant(rest || { id: data.restaurant_id, plan: 'free', plan_status: 'inactive' });
}

function applyPlanGating() {
  const badge = document.getElementById('sidebarPlanBadge');
  if (badge) {
    const labels = { free: 'Free', growth: 'Growth', pro: 'Pro' };
    badge.textContent = labels[currentPlan] || 'Free';
    badge.className = 'sidebar-plan-badge plan-' + currentPlan;
  }

  // Analytics nav — always unlocked; content is limited for free
  const analyticsBtn = document.querySelector('[data-section="analytics"]');
  if (analyticsBtn) {
    analyticsBtn.classList.remove('nav-locked');
    analyticsBtn.title = '';
  }

  // Upgrade button — hidden for Pro, visible for free/growth
  const upgradeBtn = document.getElementById('upgradePlanBtn');
  if (upgradeBtn) {
    if (currentPlan === 'pro') {
      upgradeBtn.classList.add('admin-hidden');
    } else {
      upgradeBtn.classList.remove('admin-hidden');
      upgradeBtn.textContent = currentPlan === 'growth' ? 'Upgrade to Pro' : 'Upgrade Plan';
    }
  }

  // Plan expiry warning — show when < 7 days remain on a paid plan
  const banner = document.getElementById('planExpiryBanner');
  const bannerMsg = document.getElementById('planExpiryMsg');
  if (banner && bannerMsg) {
    if (currentPlanExpiresAt && currentPlan !== 'free') {
      const daysLeft = Math.ceil((new Date(currentPlanExpiresAt) - new Date()) / 86400000);
      if (daysLeft > 0 && daysLeft <= 7) {
        bannerMsg.textContent =
          `Your ${currentPlan === 'growth' ? 'Growth' : 'Pro'} plan expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}. Renew to keep your features.`;
        banner.classList.remove('admin-hidden');
      } else {
        banner.classList.add('admin-hidden');
      }
    } else {
      banner.classList.add('admin-hidden');
    }
  }

  // Locations switcher — show in sidebar for multi-location owners
  updateLocationSwitcher();
}

function updateLocationSwitcher() {
  const existing = document.getElementById('locationSwitcherBtn');
  if (existing) existing.remove();

  const showSwitcher = ownedLocations.length > 1 || currentPlan === 'pro' || currentPlan === 'growth';
  if (showSwitcher) {
    const sidebar = document.querySelector('.sidebar-nav') || document.querySelector('.sidebar');
    if (!sidebar) return;
    const btn = document.createElement('button');
    btn.id = 'locationSwitcherBtn';
    const isGrowthLocked = currentPlan === 'growth' && ownedLocations.length <= 1;
    btn.className = 'location-switcher-btn' + (isGrowthLocked ? ' location-switcher-locked' : '');
    const label = ownedLocations.length > 1 ? 'Switch Location' : 'Add Location';
    btn.innerHTML = '<span class="ls-icon">&#127968;</span>' +
      '<span class="ls-text">' + label + '</span>' +
      (isGrowthLocked ? '<span class="ls-pro-badge">Pro</span>' : '');
    btn.addEventListener('click', () => {
      if (isGrowthLocked) { showPlanNudge('Multiple locations is a Pro feature', 'Your Growth plan supports 1 location. Upgrade to Pro to manage up to 3 locations.'); return; }
      if (ownedLocations.length > 1) {
        showLocationPicker(ownedLocations);
      } else {
        showAddLocationModal();
      }
    });
    sidebar.appendChild(btn);
  }
}

// ── Location picker & add-location ───────────────────────────────────────────

function showLocationPicker(restaurants) {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('dashboard').classList.remove('visible');

  let overlay = document.getElementById('locationPickerOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'locationPickerOverlay';
    overlay.className = 'lp-overlay';
    document.body.appendChild(overlay);
  }

  const canAdd = currentPlan === 'pro' && restaurants.length < PLAN_LIMITS.pro.locations;
  const showLockedAdd = currentPlan === 'growth';

  overlay.innerHTML =
    '<div class="lp-card">' +
      '<div class="lp-header">' +
        '<div class="lp-logo">VW</div>' +
        '<h2 class="lp-title">Select Location</h2>' +
        '<p class="lp-sub">Choose which restaurant to manage</p>' +
      '</div>' +
      '<div class="lp-list">' +
        restaurants.map(r =>
          '<button class="lp-loc-btn" data-id="' + r.id + '" data-plan="' + (r.plan || 'free') + '" data-status="' + (r.plan_status || 'inactive') + '">' +
            '<span class="lp-loc-icon">&#127968;</span>' +
            '<span class="lp-loc-name">' + (r.name || 'Restaurant') + '</span>' +
            '<span class="lp-loc-arrow">&#8250;</span>' +
          '</button>'
        ).join('') +
      '</div>' +
      (canAdd
        ? '<button class="lp-add-btn" id="lpAddLocationBtn">+ Add New Location</button>'
        : showLockedAdd
          ? '<button class="lp-add-btn lp-add-btn-locked" id="lpAddLocationBtn"><span class="lp-pro-lock-badge">Pro</span> Add New Location</button>'
          : '') +
    '</div>';

  overlay.classList.add('lp-visible');

  overlay.querySelectorAll('.lp-loc-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const picked = restaurants.find(r => r.id === btn.dataset.id);
      if (picked) {
        overlay.classList.remove('lp-visible');
        setTimeout(() => overlay.remove(), 300);
        setActiveRestaurant(picked);
      }
    });
  });

  const addBtn = overlay.querySelector('#lpAddLocationBtn');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      if (addBtn.classList.contains('lp-add-btn-locked')) {
        showPlanNudge('Multiple locations is a Pro feature', 'Your Growth plan supports 1 location. Upgrade to Pro to manage up to 3 locations.');
      } else {
        showAddLocationModal();
      }
    });
  }
}

function showAddLocationModal() {
  let modal = document.getElementById('addLocationModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'addLocationModal';
    modal.className = 'al-modal-overlay';
    modal.innerHTML =
      '<div class="al-modal">' +
        '<h3>Add New Location</h3>' +
        '<p class="al-sub">Enter the name of the new restaurant location</p>' +
        '<input type="text" id="newLocationName" class="al-input" placeholder="e.g. Nnewi Buka — Victoria Island" maxlength="80" />' +
        '<p class="al-error" id="addLocationError"></p>' +
        '<div class="al-actions">' +
          '<button class="al-cancel" id="alCancelBtn">Cancel</button>' +
          '<button class="al-submit" id="alSubmitBtn">Create Location</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
  }

  document.getElementById('newLocationName').value = '';
  document.getElementById('addLocationError').textContent = '';
  modal.classList.add('al-visible');

  document.getElementById('alCancelBtn').onclick = () => modal.classList.remove('al-visible');

  document.getElementById('alSubmitBtn').onclick = async () => {
    const name = document.getElementById('newLocationName').value.trim();
    const errorEl = document.getElementById('addLocationError');
    const btn = document.getElementById('alSubmitBtn');
    if (!name) { errorEl.textContent = 'Please enter a restaurant name.'; return; }

    btn.disabled = true;
    btn.textContent = 'Creating…';
    errorEl.textContent = '';

    try {
      const { data: { session } } = await db.auth.getSession();
      const res = await fetch(SUPABASE_URL + '/functions/v1/add-location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.access_token },
        body: JSON.stringify({ restaurant_name: name })
      });
      const result = await res.json();
      if (!res.ok || result.error) throw new Error(result.error || 'Failed to create location');

      modal.classList.remove('al-visible');
      // Refresh owned locations list and show picker
      ownedLocations.push(result.restaurant);
      showLocationPicker(ownedLocations);
    } catch (err) {
      errorEl.textContent = err.message || 'Something went wrong. Try again.';
      btn.disabled = false;
      btn.textContent = 'Create Location';
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────

async function initAuth() {
  const { data: { session } } = await db.auth.getSession();
  if (session) await checkAccessAndEnter();

  const loginPwToggle = document.getElementById('loginPwToggle');
  const loginPwInput  = document.getElementById('loginPassword');
  if (loginPwToggle) {
    loginPwToggle.addEventListener('click', () => {
      const showing = loginPwInput.type === 'text';
      loginPwInput.type = showing ? 'password' : 'text';
      loginPwToggle.querySelector('.eye-icon').classList.toggle('eye-hidden', !showing);
      loginPwToggle.querySelector('.eye-off-icon').classList.toggle('eye-hidden', showing);
      loginPwToggle.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    });
  }

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

  document.getElementById('upgradePlanBtn')?.addEventListener('click', showUpgradeModal);

  document.getElementById('planExpiryDismissBtn')?.addEventListener('click', () => {
    document.getElementById('planExpiryBanner')?.classList.add('admin-hidden');
  });

  document.getElementById('planExpiryUpgradeBtn')?.addEventListener('click', showUpgradeModal);

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
  qr: 'QR Codes',
  settings: 'Settings'
};

const SECTION_LOADERS = {
  analytics: () => loadAnalytics(),
  menu: () => loadMenuEditor(),
  staff: () => loadStaff(),
  tables: () => loadTablesSection(),
  qr: () => loadQrSection(),
  settings: () => loadSettings()
};

function navigateTo(section) {
  if (section === currentSection) { closeSidebar(); return; }

  document.getElementById(currentSection + 'Section').classList.add('admin-hidden');
  document.getElementById(section + 'Section').classList.remove('admin-hidden');

  document.querySelectorAll('.sidebar-nav-item, .bottom-nav-item').forEach(btn => {
    const isActive = btn.dataset.section === section;
    btn.classList.toggle('active', isActive);
    if (isActive) btn.classList.remove('nav-pulse');
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

// ── Onboarding checklist ──────────────────────────────────────────────────────

async function loadOnboardingChecklist() {
  const dismissKey = `vw_setup_dismissed_${RESTAURANT_ID}`;
  if (localStorage.getItem(dismissKey)) return;

  const [
    { count: catCount },
    { count: itemCount },
    { count: tableCount },
    { count: waiterCount }
  ] = await Promise.all([
    db.from('menu_categories').select('*', { count: 'exact', head: true }).eq('restaurant_id', RESTAURANT_ID),
    db.from('menu_items').select('*', { count: 'exact', head: true }).eq('restaurant_id', RESTAURANT_ID),
    db.from('tables').select('*', { count: 'exact', head: true }).eq('restaurant_id', RESTAURANT_ID),
    db.from('staff').select('*', { count: 'exact', head: true }).eq('restaurant_id', RESTAURANT_ID).eq('role', 'waiter')
  ]);

  const steps = [
    { label: 'Add your first menu category', done: catCount > 0, section: 'menu' },
    { label: 'Add at least one menu item',   done: itemCount > 0, section: 'menu' },
    { label: 'Add at least one table',       done: tableCount > 0, section: 'tables' },
    { label: 'Add at least one waiter',      done: waiterCount > 0, section: 'staff' }
  ];

  const doneCount = steps.filter(s => s.done).length;
  if (doneCount === steps.length) return; // all done, stay hidden

  const el = document.getElementById('onboardingChecklist');
  if (!el) return;

  el.classList.remove('admin-hidden');

  document.getElementById('checklistProgressText').textContent = `${doneCount} of ${steps.length} steps complete`;
  document.getElementById('checklistProgressBar').style.width  = `${(doneCount / steps.length) * 100}%`;

  document.getElementById('checklistSteps').innerHTML = steps.map(step => `
    <div class="checklist-step ${step.done ? 'step-done' : ''}">
      <span class="step-check">${step.done ? '✅' : '⬜'}</span>
      <span class="step-label">${step.label}</span>
      ${!step.done ? `<button class="step-go-btn" data-section="${step.section}" type="button">Go →</button>` : ''}
    </div>
  `).join('');

  el.querySelectorAll('.step-go-btn').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.section));
  });

  // Pulse sidebar items for incomplete steps after wizard is dismissed
  if (localStorage.getItem('vw_wizard_done_' + RESTAURANT_ID)) {
    startPulseGuide([...new Set(steps.filter(s => !s.done).map(s => s.section))]);
  }

  document.getElementById('checklistDismissBtn').addEventListener('click', () => {
    localStorage.setItem(dismissKey, '1');
    el.classList.add('admin-hidden');
  });
}

// ── Analytics ─────────────────────────────────────────────────────────────────

async function loadAnalytics() {
  const isFree = currentPlan === 'free';

  // Section title reflects what's available
  const titleEl = document.querySelector('#analyticsSection .section-title');
  if (titleEl) titleEl.textContent = isFree ? 'Waiter Activity' : 'Analytics';

  // Show/hide full-analytics elements based on plan
  const statGrid = document.querySelector('.stat-grid');
  if (statGrid) statGrid.classList.toggle('admin-hidden', isFree);
  ['bestSellersHeading', 'bestSellersList', 'recentOrdersHeading', 'recentOrdersList'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('admin-hidden', isFree);
  });

  if (isFree) {
    // Free plan: fetch only what's needed for waiter activity
    const [{ data: todayOrders }, { data: staffList }] = await Promise.all([
      db.from('orders').select('handled_by').eq('restaurant_id', RESTAURANT_ID).gte('created_at', startOfToday()),
      db.from('staff').select('id, name, role').eq('restaurant_id', RESTAURANT_ID).order('name')
    ]);
    renderWaiterPerformance(staffList || [], todayOrders || [], true);
    loadOnboardingChecklist();
    renderAnalyticsTeaser();
    return;
  }

  // Growth+ — full analytics
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

  renderWaiterPerformance(staffList || [], todayOrders || [], false);
  renderBestSellers(orderItems || []);
  renderRecentOrders(recentOrders || []);
  loadOnboardingChecklist();
}

function renderWaiterPerformance(staffList, todayOrders, hideRevenue = false) {
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
          ${hideRevenue ? '' : `<span class="waiter-perf-revenue">${formatPrice(s.revenue)}</span>`}
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

function renderAnalyticsTeaser() {
  const existing = document.getElementById('analyticsTeaser');
  if (existing) existing.remove();

  const teaser = document.createElement('div');
  teaser.id = 'analyticsTeaser';
  teaser.className = 'analytics-teaser';
  teaser.innerHTML =
    '<div class="analytics-teaser-inner">' +
      '<div class="analytics-teaser-blur" aria-hidden="true">' +
        '<div class="stat-grid">' +
          '<div class="stat-card"><span class="stat-label">Today\'s Orders</span><span class="stat-value">18</span></div>' +
          '<div class="stat-card"><span class="stat-label">Today\'s Revenue</span><span class="stat-value">₦42,500</span></div>' +
          '<div class="stat-card"><span class="stat-label">All-Time Orders</span><span class="stat-value">234</span></div>' +
          '<div class="stat-card"><span class="stat-label">All-Time Revenue</span><span class="stat-value">₦587,200</span></div>' +
        '</div>' +
        '<h3 class="subsection-title">🔥 Best Sellers</h3>' +
        '<div class="card-list">' +
          '<div class="dash-card best-seller-card"><span><span class="best-seller-rank">#1</span>Egusi Soup — 48 sold</span><span>₦72,000</span></div>' +
          '<div class="dash-card best-seller-card"><span><span class="best-seller-rank">#2</span>Jollof Rice — 36 sold</span><span>₦54,000</span></div>' +
          '<div class="dash-card best-seller-card"><span><span class="best-seller-rank">#3</span>Pepper Soup — 24 sold</span><span>₦36,000</span></div>' +
        '</div>' +
        '<h3 class="subsection-title">🧾 Recent Orders</h3>' +
        '<div class="card-list">' +
          '<div class="dash-card"><div class="dash-card-top"><span class="dash-card-table">Table 4 · delivered</span></div><div class="dash-card-items"><div>2× Egusi Soup, 1× Pounded Yam</div></div><div class="dash-card-total">Total: ₦4,500</div></div>' +
          '<div class="dash-card"><div class="dash-card-top"><span class="dash-card-table">Table 7 · delivered</span></div><div class="dash-card-items"><div>3× Jollof Rice, 2× Malt</div></div><div class="dash-card-total">Total: ₦7,200</div></div>' +
        '</div>' +
      '</div>' +
      '<div class="analytics-teaser-overlay">' +
        '<div class="analytics-lock-icon">🔒</div>' +
        '<p class="analytics-lock-title">Revenue & Full Analytics</p>' +
        '<p class="analytics-lock-sub">Track revenue, best sellers, and full order history with Growth plan</p>' +
        '<button class="analytics-lock-btn" id="analyticsUpgradeBtn">Unlock with Growth →</button>' +
      '</div>' +
    '</div>';

  document.getElementById('analyticsSection').appendChild(teaser);
  document.getElementById('analyticsUpgradeBtn').addEventListener('click', showUpgradeModal);
}

// ── Menu editor ───────────────────────────────────────────────────────────────

async function applyMenuTemplate(templateId) {
  const btn = document.getElementById('useTemplateBtnEmpty');
  if (btn) { btn.disabled = true; btn.textContent = 'Applying template…'; }

  try {
    const res = await fetch('/data/menu-templates.json');
    const templates = await res.json();
    const template = templates.find(t => t.id === templateId);
    if (!template) throw new Error('Template not found');

    for (let ci = 0; ci < template.categories.length; ci++) {
      const cat = template.categories[ci];

      const slug = cat.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const { data: catRow, error: catErr } = await db
        .from('menu_categories')
        .insert({
          restaurant_id: RESTAURANT_ID,
          name: cat.name,
          slug,
          emoji: cat.emoji,
          ada_message: cat.ada_message,
          sort_order: ci + 1,
        })
        .select('id')
        .single();

      if (catErr || !catRow) { console.error('Failed to insert category', cat.name, catErr); continue; }

      const itemRows = cat.items.map((item, ii) => ({
        restaurant_id: RESTAURANT_ID,
        category_id: catRow.id,
        name: item.name,
        price: item.price,
        description: item.description,
        ada_message: item.ada_message,
        available: true,
        sort_order: ii + 1,
      }));

      await db.from('menu_items').insert(itemRows);
    }

    await loadMenuEditor();
  } catch (err) {
    console.error('Template apply failed', err);
    if (btn) { btn.disabled = false; btn.textContent = 'Use Nigerian Restaurant Template'; }
    alert('Could not apply template. Please try again.');
  }
}

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

  if (!categoriesCache.length) {
    container.innerHTML = `
      <div class="menu-empty-state">
        <div class="menu-empty-icon">🍽️</div>
        <h3 class="menu-empty-title">Your menu is empty</h3>
        <p class="menu-empty-desc">Start from scratch or use our ready-made Nigerian restaurant template — 6 categories and 34 items, ready to customise.</p>
        <div class="menu-empty-actions">
          <button class="btn-primary" id="useTemplateBtnEmpty">Use Nigerian Restaurant Template</button>
          <button class="btn-secondary" id="addCategoryBtnEmpty">+ Build from Scratch</button>
        </div>
      </div>
    `;
    document.getElementById('addCategoryBtnEmpty').addEventListener('click', () => openCategoryModal(null));
    document.getElementById('useTemplateBtnEmpty').addEventListener('click', () => applyMenuTemplate('nigerian-restaurant'));
    return;
  }

  container.innerHTML = categoriesCache.map(cat => {
    const items = itemsCache.filter(i => i.category_id === cat.id);
    const itemsHtml = items.map(item => `
      <div class="item-edit-row" data-item-id="${item.id}">
        ${item.image_url
          ? `<img class="item-edit-thumb" src="${item.image_url}" alt="${item.name}" loading="lazy" />`
          : '<div class="item-edit-thumb-placeholder">🍽️</div>'}
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
  document.getElementById('itemImageFile').value = '';
  document.getElementById('itemForm').dataset.removeImg = '';

  const preview   = document.getElementById('itemImgPreview');
  const btnLabel  = document.getElementById('itemImgBtnLabel');
  const removeBtn = document.getElementById('itemRemoveImgBtn');
  if (item && item.image_url) {
    preview.src = item.image_url;
    preview.classList.remove('admin-hidden');
    btnLabel.textContent = 'Change photo';
    removeBtn.classList.remove('admin-hidden');
  } else {
    preview.src = '';
    preview.classList.add('admin-hidden');
    btnLabel.textContent = 'Add photo';
    removeBtn.classList.add('admin-hidden');
  }

  document.getElementById('itemForm').dataset.categoryId = categoryId;
  document.getElementById('itemModal').classList.remove('admin-hidden');
}

function closeItemModal() {
  document.getElementById('itemModal').classList.add('admin-hidden');
  editingItemId = null;
}

function initItemModal() {
  document.getElementById('itemCancelBtn').addEventListener('click', closeItemModal);

  document.getElementById('itemImageFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const preview = document.getElementById('itemImgPreview');
    const reader = new FileReader();
    reader.onload = (ev) => {
      preview.src = ev.target.result;
      preview.classList.remove('admin-hidden');
      document.getElementById('itemImgBtnLabel').textContent = 'Change photo';
      document.getElementById('itemRemoveImgBtn').classList.remove('admin-hidden');
    };
    reader.readAsDataURL(file);
  });

  document.getElementById('itemRemoveImgBtn').addEventListener('click', () => {
    document.getElementById('itemImageFile').value = '';
    const preview = document.getElementById('itemImgPreview');
    preview.src = '';
    preview.classList.add('admin-hidden');
    document.getElementById('itemImgBtnLabel').textContent = 'Add photo';
    document.getElementById('itemRemoveImgBtn').classList.add('admin-hidden');
    document.getElementById('itemForm').dataset.removeImg = 'true';
  });

  document.getElementById('itemForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const categoryId  = e.target.dataset.categoryId;
    const file        = document.getElementById('itemImageFile').files[0];
    const removeImg   = e.target.dataset.removeImg === 'true';

    const payload = {
      name: document.getElementById('itemName').value.trim(),
      price: Number(document.getElementById('itemPrice').value),
      description: document.getElementById('itemDescription').value.trim(),
      ada_message: document.getElementById('itemAdaMessage').value.trim()
    };

    if (file) {
      const ext  = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${RESTAURANT_ID}/${editingItemId || Date.now()}.${ext}`;
      const { error: uploadError } = await db.storage
        .from('menu-images')
        .upload(path, file, { upsert: true });
      if (uploadError) {
        console.error('Image upload failed', uploadError);
      } else {
        payload.image_url = db.storage.from('menu-images').getPublicUrl(path).data.publicUrl;
      }
    } else if (removeImg) {
      payload.image_url = null;
    }

    let error;
    if (editingItemId) {
      ({ error } = await db.from('menu_items').update(payload).eq('id', editingItemId));
    } else {
      const itemLimit = planLimit('items');
      if (itemLimit !== Infinity && itemsCache.length >= itemLimit) {
        showPlanNudge('Menu item limit reached', 'Free plan allows up to 20 menu items. Upgrade to Growth for unlimited items.');
        return;
      }
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

  // Track waiter count and update the Add Waiter button state
  const waiters = (staffList || []).filter(s => s.role === 'waiter');
  currentWaiterCount = waiters.length;
  const addWaiterBtn = document.getElementById('newWaiterBtn');
  if (addWaiterBtn) {
    const limit = planLimit('staff');
    const atLimit = limit !== Infinity && currentWaiterCount >= limit;
    addWaiterBtn.disabled = atLimit;
    addWaiterBtn.title = atLimit
      ? 'Staff limit reached for your ' + currentPlan + ' plan. Upgrade to add more.'
      : '';
  }

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
  currentTableCount = (tables || []).length;
  const addTableBtn = document.getElementById('addTableBtn');
  if (addTableBtn) {
    const limit = planLimit('tables');
    const atLimit = limit !== Infinity && currentTableCount >= limit;
    addTableBtn.disabled = atLimit;
    addTableBtn.title = atLimit
      ? 'Table limit reached for Free plan (max 5). Upgrade to Growth for unlimited tables.'
      : '';
  }
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

// ── QR Codes ──────────────────────────────────────────────────────────────────

let restaurantSlug = '';
let restaurantName = '';
let restaurantTagline = '';

async function loadQrSection() {
  const [{ data: restaurant }, { data: tables }] = await Promise.all([
    db.from('restaurants').select('slug, name, tagline').eq('id', RESTAURANT_ID).single(),
    db.from('tables').select('table_number').eq('restaurant_id', RESTAURANT_ID).order('table_number')
  ]);

  if (restaurant) {
    restaurantSlug    = restaurant.slug    || '';
    restaurantName    = restaurant.name    || 'Restaurant';
    restaurantTagline = restaurant.tagline || '';
  }

  const menuUrl = `${window.location.origin}/${restaurantSlug}/1`;
  document.getElementById('qrMenuUrl').innerHTML =
    `<span class="qr-url-label">Your menu link:</span>
     <a class="qr-url-value" href="${menuUrl}" target="_blank" rel="noopener">${menuUrl}</a>`;

  const grid = document.getElementById('qrGrid');
  if (!tables || !tables.length) {
    grid.innerHTML = '<p class="empty-state">No tables yet — add them in the Tables section first.</p>';
    return;
  }

  grid.innerHTML = tables.map(t => {
    const url = `${window.location.origin}/${restaurantSlug}/${t.table_number}`;
    const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=6&color=1A1A1A&bgcolor=FFF8F0&data=${encodeURIComponent(url)}`;
    return `
      <div class="qr-admin-card">
        <img class="qr-admin-img" src="${qrSrc}" alt="QR code for Table ${t.table_number}" loading="lazy" />
        <p class="qr-admin-label">Table ${t.table_number}</p>
      </div>
    `;
  }).join('');

  document.getElementById('printQrBtn').onclick = () => {
    const tableNums = tables.map(t => t.table_number).join(',');
    const params = new URLSearchParams({
      r: restaurantSlug,
      name: restaurantName,
      tagline: restaurantTagline,
      tables: tableNums
    });
    window.open(`/qr-cards?${params.toString()}`, '_blank');
  };

  document.getElementById('qrGoToTablesBtn').onclick = () => navigateTo('tables');
}

// ── Settings ──────────────────────────────────────────────────────────────────

async function loadSettings() {
  const { data, error } = await db.from('restaurants')
    .select('name, tagline, whatsapp, accent_color, max_tables_per_waiter, menu_layout')
    .eq('id', RESTAURANT_ID)
    .single();

  if (error || !data) return;

  maxTablesPerWaiter = data.max_tables_per_waiter || 3;

  const nameEl = document.getElementById('sidebarRestaurantName');
  if (nameEl) nameEl.textContent = data.name || 'Restaurant';

  document.getElementById('settingName').value       = data.name    || '';
  document.getElementById('settingTagline').value    = data.tagline || '';
  document.getElementById('settingWhatsapp').value   = data.whatsapp || '';
  document.getElementById('settingMaxTables').value  = data.max_tables_per_waiter || 3;

  const color = data.accent_color || '#C41E3A';
  document.getElementById('settingAccentColor').value = color;
  document.getElementById('colorHint').textContent     = color;
  document.documentElement.style.setProperty('--accent', color);

  const layout = data.menu_layout || 'magazine';
  document.querySelectorAll('.layout-option').forEach(btn => {
    btn.classList.toggle('layout-option--active', btn.dataset.layout === layout);
  });
}

function initSettingsForm() {
  const colorInput = document.getElementById('settingAccentColor');
  colorInput.addEventListener('input', () => {
    document.getElementById('colorHint').textContent = colorInput.value;
    document.documentElement.style.setProperty('--accent', colorInput.value);
  });

  // Layout picker
  let selectedLayout = 'magazine';
  document.querySelectorAll('.layout-option').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.layout-option').forEach(b => b.classList.remove('layout-option--active'));
      btn.classList.add('layout-option--active');
      selectedLayout = btn.dataset.layout;
    });
  });

  document.getElementById('settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name      = document.getElementById('settingName').value.trim();
    const tagline   = document.getElementById('settingTagline').value.trim();
    const whatsapp  = document.getElementById('settingWhatsapp').value.trim();
    const color     = document.getElementById('settingAccentColor').value;
    const maxTables = parseInt(document.getElementById('settingMaxTables').value);
    const msg       = document.getElementById('settingsSavedMsg');

    // Read active layout from DOM in case loadSettings ran after initSettingsForm
    const activeBtn = document.querySelector('.layout-option--active');
    if (activeBtn) selectedLayout = activeBtn.dataset.layout;

    const { data: updated, error } = await db.from('restaurants').update({
      name,
      tagline,
      whatsapp,
      accent_color: color,
      max_tables_per_waiter: maxTables,
      menu_layout: selectedLayout,
    }).eq('id', RESTAURANT_ID).select('id');

    if (error || !updated || updated.length === 0) {
      console.error('Settings save failed', error, 'RESTAURANT_ID:', RESTAURANT_ID);
      msg.textContent = 'Failed to save — please reload and try again.';
      msg.style.color = '#E85A5A';
    } else {
      maxTablesPerWaiter = maxTables;
      document.getElementById('sidebarRestaurantName').textContent = name;
      document.documentElement.style.setProperty('--accent', color);
      msg.textContent = 'Saved!';
      msg.style.color = 'var(--accent)';
      setTimeout(() => { msg.textContent = ''; }, 3000);
    }
  });
}

// ── Waiter profile (full-screen sub-view) ────────────────────────────────────

let profilePreviousSection = 'staff';
let profileMemberId = null;

function openWaiterProfile(member) {
  profileMemberId = member.id;
  profilePreviousSection = currentSection;
  document.getElementById(currentSection + 'Section').classList.add('admin-hidden');
  document.getElementById('waiterProfileSection').classList.remove('admin-hidden');

  const titleEl = document.getElementById('topbarTitle');
  if (titleEl) titleEl.textContent = member.name || 'Waiter Profile';
  document.getElementById('profileSectionTitle').textContent = member.name || 'Waiter Profile';
  document.getElementById('profileName').textContent = member.name || 'Unnamed';
  document.getElementById('profileCode').textContent = member.access_code || 'No code';
  document.getElementById('profileAvatar').textContent = (member.name || '?')[0].toUpperCase();
  document.getElementById('profileCodeMsg').textContent = '';

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

  document.getElementById('profileResetCodeBtn').addEventListener('click', async () => {
    const btn = document.getElementById('profileResetCodeBtn');
    const msg = document.getElementById('profileCodeMsg');
    btn.disabled = true;
    btn.textContent = 'Resetting…';
    msg.textContent = '';

    let newCode = '';
    for (let i = 0; i < 5; i++) {
      const candidate = generateWaiterCode();
      const { data } = await db.from('staff').select('id').eq('access_code', candidate).maybeSingle();
      if (!data) { newCode = candidate; break; }
    }

    if (!newCode) {
      msg.textContent = 'Could not generate a unique code — try again.';
      msg.style.color = '#E85A5A';
      btn.disabled = false;
      btn.textContent = 'Reset Login Code';
      return;
    }

    const { error } = await db.from('staff').update({ access_code: newCode }).eq('id', profileMemberId);
    btn.disabled = false;
    btn.textContent = 'Reset Login Code';

    if (error) {
      msg.textContent = 'Failed to reset — try again.';
      msg.style.color = '#E85A5A';
    } else {
      document.getElementById('profileCode').textContent = newCode;
      msg.textContent = `New code: ${newCode} — share this with the waiter.`;
      msg.style.color = 'var(--accent)';
    }
  });
}

// ── Create Waiter modal ────────────────────────────────────────────────────────

function openWaiterModal() {
  const limit = planLimit('staff');
  if (limit !== Infinity && currentWaiterCount >= limit) {
    const isFree = currentPlan === 'free' || !currentPlan;
    showPlanNudge(
      'Waiter limit reached',
      isFree
        ? 'Free plan includes 1 waiter. Upgrade to Growth to add up to 5.'
        : 'Growth plan includes up to 5 waiters. Upgrade to Pro for unlimited staff.'
    );
    return;
  }
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
      redirectTo: 'https://app.virtualwaitress.com/reset-password'
    });

    if (error) {
      msgEl.textContent = 'Failed to send reset email. Check the address and try again.';
    } else {
      msgEl.textContent = 'Reset email sent — check your inbox.';
    }
  });
}

// ── Onboarding Wizard ─────────────────────────────────────────────────────────

async function maybeShowWizard() {
  const key = 'vw_wizard_done_' + RESTAURANT_ID;
  if (localStorage.getItem(key)) return;

  const { count } = await db
    .from('menu_categories')
    .select('*', { count: 'exact', head: true })
    .eq('restaurant_id', RESTAURANT_ID);

  if (count > 0) {
    localStorage.setItem(key, '1');
    return;
  }

  showAdaWelcomeBanner();
}

function showAdaWelcomeBanner() {
  if (document.getElementById('adaWelcomeBanner')) return;
  const section = document.getElementById('analyticsSection');
  if (!section) return;

  const banner = document.createElement('div');
  banner.id = 'adaWelcomeBanner';
  banner.className = 'ada-welcome-banner';
  banner.innerHTML =
    '<img class="ada-welcome-img" src="images/ada.png" alt="Ada" />' +
    '<div class="ada-welcome-body">' +
      '<p class="ada-welcome-greeting">Hi! I\'m Ada 👋</p>' +
      '<p class="ada-welcome-msg">I\'ll walk you through setting up your restaurant so you can start taking orders in minutes.</p>' +
      '<div class="ada-welcome-actions">' +
        '<button class="ada-welcome-start" id="adaWelcomeStart">Get Started →</button>' +
        '<button class="ada-welcome-skip" id="adaWelcomeSkip">I\'ll explore on my own</button>' +
      '</div>' +
    '</div>';

  const header = section.querySelector('.section-header');
  if (header) header.after(banner);
  else section.prepend(banner);

  requestAnimationFrame(() => banner.classList.add('ada-welcome-visible'));

  document.getElementById('adaWelcomeStart').addEventListener('click', () => {
    banner.classList.remove('ada-welcome-visible');
    setTimeout(() => { if (banner.parentNode) banner.remove(); showWizard(); }, 280);
  });

  document.getElementById('adaWelcomeSkip').addEventListener('click', () => {
    banner.classList.remove('ada-welcome-visible');
    setTimeout(() => { if (banner.parentNode) banner.remove(); }, 280);
    localStorage.setItem('vw_wizard_done_' + RESTAURANT_ID, '1');
    startPulseGuide(['menu', 'tables', 'staff']);
  });
}

function startPulseGuide(sections) {
  sections.forEach(sec => {
    document.querySelectorAll('[data-section="' + sec + '"]').forEach(btn => {
      btn.classList.add('nav-pulse');
    });
  });
}

function showWizard() {
  let overlay = document.getElementById('wizardOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'wizardOverlay';
    overlay.className = 'wz-overlay';
    document.body.appendChild(overlay);
  }
  renderWizardStep(overlay, 1);
  overlay.classList.add('wz-visible');
}

function closeWizard() {
  const overlay = document.getElementById('wizardOverlay');
  if (overlay) overlay.classList.remove('wz-visible');
  localStorage.setItem('vw_wizard_done_' + RESTAURANT_ID, '1');
}

function renderWizardStep(overlay, step) {
  const steps = ['Menu', 'Tables', 'Waiter', 'Done'];
  const progressHtml = steps.map((s, i) =>
    `<div class="wz-step-dot ${i + 1 === step ? 'wz-dot-active' : i + 1 < step ? 'wz-dot-done' : ''}">${i + 1 < step ? '✓' : i + 1}</div>`
  ).join('');

  let bodyHtml = '';

  if (step === 1) {
    bodyHtml = `
      <div class="wz-icon">🍽️</div>
      <h2 class="wz-title">Let's build your menu</h2>
      <p class="wz-sub">Start with our ready-made Nigerian restaurant template and customise it, or build from scratch.</p>
      <button class="wz-btn-primary" id="wzUseTemplate">Use Nigerian Restaurant Template</button>
      <button class="wz-btn-ghost" id="wzScratch">I'll build my own menu</button>
    `;
  } else if (step === 2) {
    bodyHtml = `
      <div class="wz-icon">🪑</div>
      <h2 class="wz-title">How many tables do you have?</h2>
      <p class="wz-sub">We'll create them all at once. You can rename or delete any of them later.</p>
      <input type="number" id="wzTableCount" class="wz-input" placeholder="e.g. 10" min="1" max="100" value="10" />
      <button class="wz-btn-primary" id="wzAddTables">Add Tables</button>
      <button class="wz-btn-ghost" id="wzSkipTables">Skip for now</button>
    `;
  } else if (step === 3) {
    bodyHtml = `
      <div class="wz-icon">👤</div>
      <h2 class="wz-title">Add your first waiter</h2>
      <p class="wz-sub">They'll get a login code to use on the waiter dashboard when orders come in.</p>
      <input type="text" id="wzWaiterName" class="wz-input" placeholder="Waiter's name" maxlength="60" />
      <p class="wz-error" id="wzWaiterError"></p>
      <button class="wz-btn-primary" id="wzAddWaiter">Add Waiter</button>
      <button class="wz-btn-ghost" id="wzSkipWaiter">Skip for now</button>
    `;
  } else if (step === 4) {
    const slug = ownedLocations.find(r => r.id === RESTAURANT_ID)?.slug || '';
    const menuUrl = slug ? (window.location.origin + '/' + slug + '/1') : window.location.origin;
    bodyHtml = `
      <div class="wz-icon">🎉</div>
      <h2 class="wz-title">You're live!</h2>
      <p class="wz-sub">Your restaurant is ready to take orders. Share this link or print your QR cards.</p>
      <div class="wz-url">${menuUrl}</div>
      <a href="${menuUrl}" target="_blank" rel="noopener" class="wz-btn-primary wz-btn-link">Preview My Menu →</a>
      <button class="wz-btn-ghost" id="wzDone">Go to Dashboard</button>
    `;
  }

  overlay.innerHTML = `
    <div class="wz-card">
      <div class="wz-ada-header">
        <img class="wz-ada-img" src="images/ada.png" alt="Ada" />
        <span class="wz-ada-label">Ada · Setup Guide</span>
      </div>
      <div class="wz-progress">${progressHtml}</div>
      <div class="wz-body">${bodyHtml}</div>
    </div>
  `;

  // Wire step buttons
  if (step === 1) {
    document.getElementById('wzUseTemplate').addEventListener('click', async () => {
      const btn = document.getElementById('wzUseTemplate');
      btn.disabled = true;
      btn.textContent = 'Applying template…';
      await applyMenuTemplate('nigerian-restaurant');
      renderWizardStep(overlay, 2);
    });
    document.getElementById('wzScratch').addEventListener('click', () => {
      closeWizard();
      navigateTo('menu');
    });
  }

  if (step === 2) {
    document.getElementById('wzAddTables').addEventListener('click', async () => {
      const count = Math.min(100, Math.max(1, parseInt(document.getElementById('wzTableCount').value) || 1));
      const btn = document.getElementById('wzAddTables');
      btn.disabled = true;
      btn.textContent = 'Adding tables…';

      const rows = Array.from({ length: count }, (_, i) => ({
        restaurant_id: RESTAURANT_ID,
        table_number: i + 1,
        label: 'Table ' + (i + 1),
      }));
      await db.from('tables').insert(rows);
      renderWizardStep(overlay, 3);
    });
    document.getElementById('wzSkipTables').addEventListener('click', () => renderWizardStep(overlay, 3));
  }

  if (step === 3) {
    document.getElementById('wzAddWaiter').addEventListener('click', async () => {
      const name = document.getElementById('wzWaiterName').value.trim();
      const errorEl = document.getElementById('wzWaiterError');
      const btn = document.getElementById('wzAddWaiter');
      if (!name) { errorEl.textContent = 'Enter the waiter\'s name.'; return; }

      btn.disabled = true;
      btn.textContent = 'Adding…';
      errorEl.textContent = '';

      try {
        const { data: { session } } = await db.auth.getSession();
        const res = await fetch(SUPABASE_URL + '/functions/v1/create-waiter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.access_token },
          body: JSON.stringify({ name, restaurant_id: RESTAURANT_ID })
        });
        const result = await res.json();
        if (!res.ok || result.error) throw new Error(result.error || 'Failed');
        renderWizardStep(overlay, 4);
      } catch (err) {
        errorEl.textContent = err.message || 'Something went wrong. Try again.';
        btn.disabled = false;
        btn.textContent = 'Add Waiter';
      }
    });
    document.getElementById('wzSkipWaiter').addEventListener('click', () => renderWizardStep(overlay, 4));
  }

  if (step === 4) {
    document.getElementById('wzDone').addEventListener('click', closeWizard);
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

// ── Claude AI helpers ──────────────────────────────────────────────────────────

async function claudeAI(payload) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/claude-ai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY },
    body: JSON.stringify(payload),
  });
  return res.json();
}

function initAdaGenerators() {
  // Category modal — generate Ada message from category name + its items
  document.getElementById('genCategoryAda').addEventListener('click', async function () {
    const name = document.getElementById('categoryName').value.trim();
    if (!name) { showPlanNudge('Enter a category name first', 'Ada needs the category name to write a message.'); return; }
    this.textContent = '⏳ Generating…';
    this.disabled = true;
    const catItems = editingCategoryId ? itemsCache.filter(i => i.category_id === editingCategoryId) : [];
    const { message, error } = await claudeAI({ action: 'ada-message', category_name: name, items: catItems, restaurant_name: restaurantName || 'our restaurant' });
    this.textContent = '✨ Generate';
    this.disabled = false;
    if (error || !message) { showPlanNudge('Generation failed', 'Could not reach Ada. Check your API key.'); return; }
    document.getElementById('categoryAdaMessage').value = message;
  });

  // Item modal — generate Ada message from item name
  document.getElementById('genItemAda').addEventListener('click', async function () {
    const name = document.getElementById('itemName').value.trim();
    if (!name) { showPlanNudge('Enter an item name first', 'Ada needs the item name to write a message.'); return; }
    this.textContent = '⏳ Generating…';
    this.disabled = true;
    const { message, error } = await claudeAI({ action: 'ada-message', category_name: name, items: [], restaurant_name: restaurantName || 'our restaurant' });
    this.textContent = '✨ Generate';
    this.disabled = false;
    if (error || !message) { showPlanNudge('Generation failed', 'Could not reach Ada. Check your API key.'); return; }
    document.getElementById('itemAdaMessage').value = message;
  });
}

function initMenuScanner() {
  const scanMenuBtn    = document.getElementById('scanMenuBtn');
  const scanModal      = document.getElementById('scanMenuModal');
  const scanCancelBtn  = document.getElementById('scanCancelBtn');
  const scanFileInput  = document.getElementById('scanFileInput');
  const scanDropZone   = document.getElementById('scanDropZone');
  const scanPreview    = document.getElementById('scanPreviewImg');
  const scanSubmitBtn  = document.getElementById('scanSubmitBtn');
  const scanError      = document.getElementById('scanError');
  const scanResultsWrap = document.getElementById('scanResultsWrap');
  const scanResultsList = document.getElementById('scanResultsList');
  const scanItemCount  = document.getElementById('scanItemCount');
  const scanImportBtn  = document.getElementById('scanImportBtn');

  let scannedItems = [];

  function openScanModal() {
    scanModal.classList.remove('admin-hidden');
    scanFileInput.value = '';
    scanPreview.classList.add('admin-hidden');
    scanPreview.src = '';
    scanSubmitBtn.disabled = true;
    scanError.textContent = '';
    scanResultsWrap.classList.add('admin-hidden');
    scanResultsList.innerHTML = '';
    scannedItems = [];
  }

  function closeScanModal() { scanModal.classList.add('admin-hidden'); }

  scanMenuBtn.addEventListener('click', openScanModal);
  scanCancelBtn.addEventListener('click', closeScanModal);
  scanModal.addEventListener('click', e => { if (e.target === scanModal) closeScanModal(); });

  scanDropZone.addEventListener('click', () => scanFileInput.click());

  scanFileInput.addEventListener('change', () => {
    const file = scanFileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      scanPreview.src = e.target.result;
      scanPreview.classList.remove('admin-hidden');
      scanSubmitBtn.disabled = false;
      scanResultsWrap.classList.add('admin-hidden');
      scanError.textContent = '';
    };
    reader.readAsDataURL(file);
  });

  scanSubmitBtn.addEventListener('click', async () => {
    const file = scanFileInput.files[0];
    if (!file) return;
    scanSubmitBtn.textContent = '⏳ Scanning…';
    scanSubmitBtn.disabled = true;
    scanError.textContent = '';

    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target.result;
      const base64 = dataUrl.split(',')[1];
      const media_type = file.type || 'image/jpeg';

      const { items, error } = await claudeAI({ action: 'scan-menu', image_base64: base64, media_type });

      scanSubmitBtn.textContent = '✨ Scan with Ada';
      scanSubmitBtn.disabled = false;

      if (error || !items) {
        scanError.textContent = 'Could not read the menu. Try a clearer photo.';
        return;
      }

      scannedItems = items;
      scanItemCount.textContent = items.length;
      scanResultsList.innerHTML = items.map((item, i) =>
        '<label class="scan-item-row">' +
          '<input type="checkbox" class="scan-item-check" data-index="' + i + '" checked />' +
          '<span class="scan-item-name">' + (item.name || 'Unknown') + '</span>' +
          '<span class="scan-item-price">₦' + (item.price || 0).toLocaleString('en-NG') + '</span>' +
          '<span class="scan-item-cat">' + (item.category || '') + '</span>' +
        '</label>'
      ).join('');
      scanResultsWrap.classList.remove('admin-hidden');
    };
    reader.readAsDataURL(file);
  });

  scanImportBtn.addEventListener('click', async () => {
    const checked = Array.from(scanResultsList.querySelectorAll('.scan-item-check:checked'));
    const toImport = checked.map(cb => scannedItems[parseInt(cb.dataset.index)]);
    if (!toImport.length) return;

    scanImportBtn.textContent = 'Importing…';
    scanImportBtn.disabled = true;

    // Group by category — find or create category, then insert items
    const categoryMap = {};
    for (const item of toImport) {
      const catName = (item.category || 'Imported').trim();
      if (!categoryMap[catName]) {
        // Check if category already exists
        const existing = categoriesCache.find(c => c.name.toLowerCase() === catName.toLowerCase());
        if (existing) {
          categoryMap[catName] = existing.id;
        } else {
          const slug = catName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
          const { data: newCat, error } = await db.from('menu_categories').insert({ name: catName, slug, restaurant_id: RESTAURANT_ID }).select().single();
          if (error) { console.error('Category insert failed', error); continue; }
          categoryMap[catName] = newCat.id;
        }
      }
      const catId = categoryMap[catName];
      if (!catId) continue;
      await db.from('menu_items').insert({
        name: item.name,
        price: item.price || 0,
        description: item.description || '',
        category_id: catId,
        restaurant_id: RESTAURANT_ID,
        available: true,
      });
    }

    closeScanModal();
    await loadMenu();
    showPlanNudge('Import complete', toImport.length + ' items imported from your paper menu.');
  });
}

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
  initAdaGenerators();
  initMenuScanner();
});

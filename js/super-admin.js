// Super Admin — platform-wide stats dashboard
// Access restricted to super admin email via the platform-stats Edge Function

function formatPrice(n) {
  return '₦' + (n || 0).toLocaleString();
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

function showDashError(msg) {
  const el = document.getElementById('dashError');
  if (el) { el.textContent = msg; el.classList.remove('admin-hidden'); }
}

async function loadStats() {
  const { data: { session } } = await db.auth.getSession();
  if (!session?.access_token) {
    showDashError('Not authenticated — please log in.');
    return;
  }

  const res = await fetch(`${SUPABASE_URL}/functions/v1/platform-stats`, {
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json'
    }
  });

  if (res.status === 403) {
    showDashError('Access denied — this account is not a platform administrator.');
    return;
  }

  if (!res.ok) {
    showDashError('Failed to load stats — please try again.');
    return;
  }

  const data = await res.json();

  document.getElementById('statRestaurants').textContent = data.restaurants.total;
  document.getElementById('statNewWeek').textContent     = data.restaurants.newThisWeek;
  document.getElementById('statNewMonth').textContent    = data.restaurants.newThisMonth;
  document.getElementById('statOrders').textContent      = data.orders.total;
  document.getElementById('statRevenue').textContent     = formatPrice(data.orders.revenue);

  const tbody = document.getElementById('restaurantTableBody');
  if (!data.breakdown || !data.breakdown.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No restaurants yet</td></tr>';
    return;
  }

  tbody.innerHTML = data.breakdown.map(r => `
    <tr>
      <td class="sa-name">${r.name}</td>
      <td class="sa-slug">${r.slug}</td>
      <td>${formatDate(r.created_at)}</td>
      <td>${r.orders}</td>
      <td>${formatPrice(r.revenue)}</td>
      <td>${formatDate(r.lastOrder)}</td>
    </tr>
  `).join('');
}

function showDashboard() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('dashboard').classList.remove('admin-hidden');
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await db.auth.signOut();
    window.location.reload();
  });
}

async function initAuth() {
  const { data: { session } } = await db.auth.getSession();
  if (session) {
    showDashboard();
    await loadStats();
  }

  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email    = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errorEl  = document.getElementById('loginError');
    const btn      = e.target.querySelector('button[type="submit"]');
    errorEl.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Logging in…';

    const { error } = await db.auth.signInWithPassword({ email, password });
    btn.disabled = false;
    btn.textContent = 'Log In';

    if (error) { errorEl.textContent = 'Login failed — check your credentials.'; return; }

    showDashboard();
    await loadStats();
  });
}

document.addEventListener('DOMContentLoaded', initAuth);

// Super Admin — platform-wide stats dashboard
// Access restricted to super admin email via the platform-stats Edge Function

function formatPrice(n) {
  return '₦' + (n || 0).toLocaleString();
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

async function loadStats() {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/platform-stats`, {
    headers: {
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json'
    }
  });

  if (res.status === 403) {
    document.getElementById('dashboard').innerHTML =
      '<p style="padding:60px 24px;color:#E85A5A;text-align:center">Access denied — this dashboard is restricted to platform administrators.</p>';
    return;
  }

  if (!res.ok) {
    document.getElementById('dashboard').innerHTML =
      '<p style="padding:60px 24px;color:#E85A5A;text-align:center">Failed to load stats — please try again.</p>';
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

async function initAuth() {
  const { data: { session } } = await db.auth.getSession();
  if (session) {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('dashboard').classList.remove('admin-hidden');
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

    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('dashboard').classList.remove('admin-hidden');
    await loadStats();
  });

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await db.auth.signOut();
    window.location.reload();
  });
}

document.addEventListener('DOMContentLoaded', initAuth);

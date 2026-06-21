// Super Admin — platform-wide stats with SVG charts

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

// ── SVG chart helpers ────────────────────────────────────────────────────────

function makeSvg(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function svgText(attrs, content) {
  const el = makeSvg('text', attrs);
  el.textContent = content;
  return el;
}

// Column bar chart — monthly signups
function renderColumnChart(containerId, labels, values) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';

  const W  = container.clientWidth || 340;
  const H  = 180;
  const PT = 28, PR = 12, PB = 36, PL = 28;
  const cW = W - PL - PR;
  const cH = H - PT - PB;
  const max = Math.max(...values, 1);
  const n   = labels.length;
  const step = cW / n;
  const barW = Math.min(step * 0.55, 44);

  const svg = makeSvg('svg', { width: '100%', height: H, viewBox: `0 0 ${W} ${H}` });

  // Grid lines
  [0.25, 0.5, 0.75, 1].forEach(f => {
    const y = PT + cH * (1 - f);
    svg.appendChild(makeSvg('line', { x1: PL, y1: y, x2: W - PR, y2: y, stroke: '#ffffff08', 'stroke-width': 1 }));
    svg.appendChild(svgText({ x: PL - 5, y: y + 4, 'text-anchor': 'end', 'font-size': 9, fill: '#444' }, Math.round(max * f)));
  });

  // Baseline
  svg.appendChild(makeSvg('line', { x1: PL, y1: PT + cH, x2: W - PR, y2: PT + cH, stroke: '#222', 'stroke-width': 1 }));

  // Bars
  labels.forEach((label, i) => {
    const x    = PL + step * i + (step - barW) / 2;
    const barH = values[i] > 0 ? Math.max((values[i] / max) * cH, 3) : 0;
    const y    = PT + cH - barH;

    if (barH > 0) {
      svg.appendChild(makeSvg('rect', { x, y, width: barW, height: barH, fill: '#E8893A', rx: 3 }));
      svg.appendChild(svgText({ x: x + barW / 2, y: y - 6, 'text-anchor': 'middle', 'font-size': 11, fill: '#E8893A', 'font-weight': 700 }, values[i]));
    }

    svg.appendChild(svgText({ x: x + barW / 2, y: PT + cH + 16, 'text-anchor': 'middle', 'font-size': 10, fill: '#555' }, label));
  });

  container.appendChild(svg);
}

// Horizontal bar chart — top restaurants by revenue
function renderHBarChart(containerId, labels, values, formatFn) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';

  if (!labels.length) {
    const p = document.createElement('p');
    p.className = 'sa-chart-empty';
    p.textContent = 'No orders yet';
    container.appendChild(p);
    return;
  }

  const W      = container.clientWidth || 340;
  const BAR_H  = 28;
  const BAR_G  = 10;
  const PL = 114, PR = 86, PT = 4, PB = 4;
  const H  = PT + labels.length * (BAR_H + BAR_G) - BAR_G + PB;
  const cW = W - PL - PR;
  const max = Math.max(...values, 1);

  const svg = makeSvg('svg', { width: '100%', height: H, viewBox: `0 0 ${W} ${H}` });

  labels.forEach((label, i) => {
    const y      = PT + i * (BAR_H + BAR_G);
    const barLen = values[i] > 0 ? Math.max((values[i] / max) * cW, 4) : 0;
    const name   = label.length > 13 ? label.slice(0, 12) + '…' : label;

    // track
    svg.appendChild(makeSvg('rect', { x: PL, y, width: cW, height: BAR_H, fill: '#18181b', rx: 4 }));
    // bar
    if (barLen > 0) {
      svg.appendChild(makeSvg('rect', { x: PL, y, width: barLen, height: BAR_H, fill: '#E8893A', rx: 4, opacity: 0.88 }));
    }
    // name
    svg.appendChild(svgText({ x: PL - 8, y: y + BAR_H / 2 + 4, 'text-anchor': 'end', 'font-size': 12, fill: '#ccc' }, name));
    // value
    svg.appendChild(svgText({ x: PL + cW + 10, y: y + BAR_H / 2 + 4, 'font-size': 11, fill: '#E8893A', 'font-weight': 700 }, formatFn(values[i])));
  });

  container.appendChild(svg);
}

// ── Data ─────────────────────────────────────────────────────────────────────

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

  // Stat cards
  document.getElementById('statRestaurants').textContent = data.restaurants.total;
  document.getElementById('statNewWeek').textContent     = data.restaurants.newThisWeek;
  document.getElementById('statNewMonth').textContent    = data.restaurants.newThisMonth;
  document.getElementById('statOrders').textContent      = data.orders.total;
  document.getElementById('statRevenue').textContent     = formatPrice(data.orders.revenue);

  const now = new Date().toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });
  const meta = document.getElementById('saLastUpdated');
  if (meta) meta.textContent = `Updated at ${now}`;

  // Column chart — monthly signups
  if (data.monthlySignups?.length) {
    const labels = data.monthlySignups.map(m => {
      const [y, mo] = m.month.split('-');
      return new Date(Number(y), Number(mo) - 1).toLocaleDateString('en', { month: 'short' });
    });
    renderColumnChart('chartSignups', labels, data.monthlySignups.map(m => m.count));
  } else {
    renderColumnChart('chartSignups', ['Jan','Feb','Mar','Apr','May','Jun'], [0,0,0,0,0,0]);
  }

  // Horizontal bar chart — top by revenue
  const top = (data.breakdown || [])
    .filter(r => r.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 6);
  renderHBarChart('chartRevenue', top.map(r => r.name), top.map(r => r.revenue), formatPrice);

  // Table
  const tbody = document.getElementById('restaurantTableBody');
  if (!data.breakdown?.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="sa-empty">No restaurants yet</td></tr>';
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

// ── Auth ──────────────────────────────────────────────────────────────────────

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

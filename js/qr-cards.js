// QR Cards generator — reads URL params from admin dashboard
// Falls back to Nnewi Buka demo values when opened directly

const params     = new URLSearchParams(window.location.search);
const SLUG       = params.get('r')       || 'nnewi-buka';
const RESTAURANT = params.get('name')    || 'Nnewi Buka';
const TAGLINE    = params.get('tagline') || 'Authentic Igbo Home Cooking';
const MENU_BASE  = window.location.origin;

// If tables= param is provided, use those numbers; otherwise default to 8
const tableList  = params.get('tables')
  ? params.get('tables').split(',').map(n => parseInt(n, 10)).filter(n => !isNaN(n))
  : Array.from({ length: 8 }, (_, i) => i + 1);

function buildCard(tableNumber) {
  const url = `${MENU_BASE}/?r=${SLUG}&table=${tableNumber}`;
  const qr  = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=6&color=1A1A1A&bgcolor=FFF8F0&data=${encodeURIComponent(url)}`;

  const card = document.createElement('div');
  card.className = 'card';

  const header = document.createElement('div');
  header.className = 'card-header';

  const name = document.createElement('div');
  name.className = 'card-restaurant-name';
  name.textContent = RESTAURANT;

  const tagline = document.createElement('div');
  tagline.className = 'card-tagline';
  tagline.textContent = TAGLINE;

  header.appendChild(name);
  header.appendChild(tagline);

  const body = document.createElement('div');
  body.className = 'card-body';

  const ada = document.createElement('div');
  ada.className = 'card-ada';
  ada.textContent = '👩🏾‍🍳';

  const ctaTop = document.createElement('div');
  ctaTop.className = 'card-cta-top';
  ctaTop.textContent = 'Scan to view our menu';

  const img = document.createElement('img');
  img.className = 'card-qr';
  img.src = qr;
  img.alt = `QR code for Table ${tableNumber}`;
  img.loading = 'lazy';

  const ctaBottom = document.createElement('div');
  ctaBottom.className = 'card-cta-bottom';
  ctaBottom.textContent = 'Point your camera at the code — no app needed';

  const noApp = document.createElement('div');
  noApp.className = 'card-no-app';
  noApp.textContent = '✓ Works on any phone';

  body.appendChild(ada);
  body.appendChild(ctaTop);
  body.appendChild(img);
  body.appendChild(ctaBottom);
  body.appendChild(noApp);

  const footer = document.createElement('div');
  footer.className = 'card-footer';

  const tableLabel = document.createElement('span');
  tableLabel.className = 'card-table-number';
  tableLabel.textContent = `Table ${tableNumber}`;

  const brand = document.createElement('span');
  brand.className = 'card-brand';
  brand.textContent = 'Virtual Waitress';

  footer.appendChild(tableLabel);
  footer.appendChild(brand);

  card.appendChild(header);
  card.appendChild(body);
  card.appendChild(footer);

  return card;
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('printBtn').addEventListener('click', () => window.print());

  const grid = document.getElementById('cardsGrid');
  for (const t of tableList) {
    grid.appendChild(buildCard(t));
  }
});

// Virtual Waitress MVP — NgwaNgwa Digital
// Demo restaurant: Nnewi Buka

const MENU_DATA = {
  restaurant: {
    name: "Nnewi Buka",
    tagline: "Authentic Igbo Home Cooking",
    whatsapp: "2347076077265",
    accentColor: "#E8612C"
  },
  ada: {
    name: "Ada",
    emoji: "👩🏾‍🍳",
    welcome: "Welcome to Nnewi Buka! 👋🏾 I'm Ada, your virtual waitress. Browse the menu and tap any dish to learn more!",
    idle: "Take your time! When you're ready, tap 'Call Waiter' and I'll send someone to your table right away 😊",
    categoryMessages: {
      soups: "Our soups are made fresh every morning! 🥣 Tap any soup to learn more about it.",
      swallows: "Pounded yam is our most popular swallow! 😋 It pairs perfectly with any soup on our menu.",
      rice: "Our Jollof Rice is smoky and cooked the party way 🍚 — the real deal, I promise!",
      grills: "Everything here is grilled fresh to order 🔥 The suya is an absolute must-try!",
      "small-chops": "Perfect for sharing or a light snack! Our puff puff is made fresh every morning 🤤",
      drinks: "⭐ Special today: Buy 1 Guinness Stout, get 1 absolutely FREE! Don't miss it 🍺"
    }
  },
  categories: [
    {
      id: "soups",
      name: "Soups",
      emoji: "🥣",
      items: [
        { name: "Egusi Soup",    price: 1500, description: "Rich in protein and healthy fats, cooked with assorted meat",                   ada: "Egusi is loaded with protein and healthy fats — gives you real energy! Great with pounded yam 💪" },
        { name: "Ofe Onugbu",    price: 1500, description: "Bitterleaf soup with assorted meat and stockfish — a true Igbo classic",         ada: "A true Igbo classic! The slight bitterness is what makes it special. Cooked just like mama would 😋" },
        { name: "Oha Soup",      price: 1800, description: "Seasonal delicacy with cocoyam thickener and oha leaves",                       ada: "Oha leaves are packed with vitamins A and C — very nutritious and only available seasonally! 🌿" },
        { name: "Ogbono Soup",   price: 1500, description: "Draw soup with assorted meat — smooth and filling",                              ada: "Ogbono is great for digestion and keeps you full for hours. A real comfort soup 👌" },
        { name: "Nsala Soup",    price: 2000, description: "White soup with fresh catfish — light and fragrant",                             ada: "Light and fresh! The catfish in this soup is delivered same morning. Very popular with our guests 🐟" },
        { name: "Ofe Akwu",      price: 1500, description: "Palm fruit soup — a true Eastern Nigerian classic",                              ada: "Rich in vitamin E and antioxidants — good for your skin and heart too! A real Eastern classic ✨" }
      ]
    },
    {
      id: "swallows",
      name: "Swallows",
      emoji: "🫓",
      items: [
        { name: "Pounded Yam",   price: 800,  description: "Smooth and satisfying — our most popular swallow",                              ada: "Our number one! Freshly pounded, smooth and stretchy — pairs with literally any soup on this menu 🤩" },
        { name: "Eba (Garri)",   price: 400,  description: "Light and quick — perfect everyday meal",                                       ada: "Eba is light on the stomach, very filling, and quick to prepare. A Nigerian staple for a reason!" },
        { name: "Fufu",          price: 500,  description: "Traditional and filling — the original swallow",                                ada: "High in resistant starch which feeds the good bacteria in your gut — keeps you healthy inside out! 💚" },
        { name: "Semolina",      price: 600,  description: "Smooth texture, easy on the stomach",                                           ada: "Super smooth and easy to swallow — popular with our older guests and those with sensitive stomachs 😊" },
        { name: "Wheat",         price: 600,  description: "High in fibre — the healthy swallow choice",                                    ada: "The healthiest swallow we offer! High in fibre and nutrients — great for managing weight too 🌾" }
      ]
    },
    {
      id: "rice",
      name: "Rice Dishes",
      emoji: "🍚",
      items: [
        { name: "Jollof Rice",          price: 1500, description: "Smoky party-style jollof — cooked over firewood",                        ada: "This is the real deal! Smoky bottom-pot jollof cooked over firewood 🍚🔥 You will not regret it!" },
        { name: "Fried Rice",           price: 1500, description: "Colourful and flavourful with mixed vegetables and proteins",            ada: "Colourful, flavourful, and loaded with vegetables — great for kids and adults alike! 🥕" },
        { name: "White Rice & Stew",    price: 1200, description: "Classic comfort food with rich tomato stew",                             ada: "Classic Nigerian comfort food — rich tomato stew, perfectly seasoned. Sometimes simple is best 🍅" },
        { name: "Coconut Rice",         price: 1800, description: "Fragrant and creamy — our weekend special",                              ada: "Our weekend special! Fragrant coconut rice that sells out fast — if you see it, grab it! 🥥" }
      ]
    },
    {
      id: "grills",
      name: "Grills & Peppered",
      emoji: "🍗",
      items: [
        { name: "Peppered Chicken",  price: 2500, description: "Spicy and tender — marinated and grilled to perfection",                   ada: "Marinated for hours before hitting the grill — the flavour goes all the way in! Seriously good 🔥" },
        { name: "Suya",              price: 1500, description: "Skewered beef with our secret spice blend",                                 ada: "Our suya spice blend is a family secret — you will not find this flavour anywhere else in Nnewi! 🥩" },
        { name: "Peppered Gizzard",  price: 1200, description: "Crunchy, spicy, and completely addictive",                                  ada: "High in protein, low in fat — and absolutely addictive! Most people order a second plate 😄" },
        { name: "Peppered Fish",     price: 2000, description: "Fresh catfish, heavily peppered and grilled",                               ada: "Fresh catfish delivered every morning, heavily peppered the Anambra way 🐟🔥 A real crowd favourite!" },
        { name: "Peppered Ponmo",    price: 1000, description: "Soft cow skin, peppered and stewed",                                        ada: "A Nigerian favourite! Soft, chewy ponmo in our peppered sauce — great as a side or on its own 😋" }
      ]
    },
    {
      id: "small-chops",
      name: "Small Chops",
      emoji: "🫔",
      items: [
        { name: "Puff Puff",       price: 500, description: "6 pieces — soft, sweet, freshly fried every morning",                         ada: "Made fresh every single morning — soft, golden, and slightly sweet. The smell alone will get you! 🤤" },
        { name: "Meat Pie",        price: 400, description: "Flaky pastry filled with spiced minced meat",                                  ada: "Baked fresh, never reheated! Flaky golden crust with perfectly spiced filling inside 🥧" },
        { name: "Moi Moi",         price: 500, description: "Steamed bean pudding — high in plant protein",                                 ada: "Moi moi is loaded with plant protein — great for energy, muscle, and keeping you full 💪" },
        { name: "Spring Roll",     price: 600, description: "4 pieces — crispy fried rolls with vegetable filling",                        ada: "Crispy on the outside, loaded with veggies inside — perfect for sharing with the table! 🥬" },
        { name: "Buns",            price: 300, description: "Sweet fried dough balls — a Nigerian childhood classic",                      ada: "A Nigerian childhood classic! Sweet, soft, and dangerously addictive. You have been warned 😄" }
      ]
    },
    {
      id: "drinks",
      name: "Drinks",
      emoji: "🥤",
      items: [
        { name: "Coca-Cola",      price: 300, description: "Ice cold",                                          ada: "Nothing beats an ice cold Coke with your meal — especially with the spicy dishes! 🥤" },
        { name: "Fanta Orange",   price: 300, description: "Ice cold",                                          ada: "Sweet and fizzy — great for cooling down after our peppered dishes! 🍊" },
        { name: "Sprite",         price: 300, description: "Ice cold",                                          ada: "Light and refreshing — perfect to cleanse the palate between dishes 💚" },
        { name: "Maltina",        price: 400, description: "Rich in B vitamins — great energy boost",           ada: "Maltina is loaded with B vitamins — gives you a natural energy boost without the alcohol! 🌟" },
        { name: "Water (50cl)",   price: 200, description: "Ice cold",                                          ada: "Stay hydrated! Especially important if you are having the peppered or spicy dishes 💧" },
        { name: "Trophy Lager",   price: 600, description: "Ice cold",                                          ada: "Ice cold Trophy — smooth, crisp, and refreshing. The Anambra man's drink of choice! 🍺" },
        { name: "Star Lager",     price: 600, description: "Ice cold",                                          ada: "Star Lager — Nigeria's favourite! Smooth and refreshing. Best enjoyed ice cold 🌟🍺" },
        { name: "Guinness Stout", price: 700, description: "⭐ Special offer today: Buy 1 get 1 FREE!",         ada: "⭐ TODAY ONLY: Buy 1 Guinness Stout, get 1 completely FREE! Call your waiter now to grab this deal 🍺🎉" },
        { name: "Chivita Juice",  price: 500, description: "Assorted flavours — apple, orange, mango",         ada: "100% fruit juice — great for kids, non-drinkers, or anyone who wants something sweet and healthy 🧃" }
      ]
    }
  ]
};

// ─────────────────────────────────────────────────────────────────────────────

let menuData       = null;
let activeCategory = null;
let idleTimer      = null;

function getTableNumber() {
  return new URLSearchParams(window.location.search).get('table') || '1';
}

function formatPrice(amount) {
  return '₦' + amount.toLocaleString();
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
    return `
      <div class="menu-item ${isSpecial ? 'has-special' : ''}" data-item="${item.name}">
        <div class="item-info">
          <div class="item-name">${item.name}</div>
          <div class="item-description">${item.description}</div>
          ${isSpecial ? '<span class="item-special-tag">⭐ Special Offer</span>' : ''}
        </div>
        <div class="item-price">${formatPrice(item.price)}</div>
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
}

// ── Switch category ───────────────────────────────────────────────────────────

function switchCategory(categoryId) {
  activeCategory = categoryId;
  const category = menuData.categories.find(c => c.id === categoryId);
  if (!category) return;

  renderTabs(menuData.categories, categoryId);
  renderItems(category);
  window.scrollTo({ top: 0, behavior: 'smooth' });

  const message = menuData.ada.categoryMessages[categoryId];
  if (message) setTimeout(() => Ada.speak(message, 5500), 350);
}

// ── Call waiter ───────────────────────────────────────────────────────────────

function initCallWaiter() {
  const table = getTableNumber();
  document.getElementById('callWaiterBtn').addEventListener('click', () => {
    const number  = menuData.restaurant.whatsapp;
    const message = encodeURIComponent(`Hello, Table ${table} is calling for assistance 🙋`);
    window.open(`https://wa.me/${number}?text=${message}`, '_blank');
    Ada.speak(`I've called your waiter! 😊 Someone will be at Table ${table} very shortly.`, 6000);
    Ada.resetIdleTimer();
  });
}

// ── Ada tap ───────────────────────────────────────────────────────────────────

function initAdaClick() {
  document.getElementById('adaCharacter').addEventListener('click', () => {
    const msg = menuData.ada.categoryMessages[activeCategory] || menuData.ada.welcome;
    Ada.speak(msg, 5500);
    Ada.resetIdleTimer();
  });
}

// ── Boot ──────────────────────────────────────────────────────────────────────

function init() {
  menuData = MENU_DATA;

  document.getElementById('restaurantName').textContent    = menuData.restaurant.name;
  document.getElementById('restaurantTagline').textContent = menuData.restaurant.tagline;
  document.getElementById('tableBadge').textContent        = 'Table ' + getTableNumber();
  document.documentElement.style.setProperty('--accent', menuData.restaurant.accentColor);

  const first = menuData.categories[0];
  activeCategory = first.id;
  renderTabs(menuData.categories, activeCategory);
  renderItems(first);

  initCallWaiter();
  initAdaClick();

  setTimeout(() => Ada.speak(menuData.ada.welcome, 7000), 900);
  Ada.resetIdleTimer();
}

document.addEventListener('DOMContentLoaded', init);

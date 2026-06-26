// db and SUPABASE_* constants come from supabase-config.js (loaded before this file)

const nameInput     = document.getElementById('suRestaurantName');
const emailInput    = document.getElementById('suEmail');
const passInput     = document.getElementById('suPassword');
const confirmInput  = document.getElementById('suPasswordConfirm');
const urlPreview    = document.getElementById('suUrlPreview');
const errorEl       = document.getElementById('suError');
const submitBtn     = document.getElementById('suSubmit');
const submitLabel   = document.getElementById('suSubmitLabel');
const submitSpinner = document.getElementById('suSubmitSpinner');
const step1         = document.getElementById('suStep1');
const step2         = document.getElementById('suStep2');

function toSlug(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

nameInput.addEventListener('input', () => {
  const slug = toSlug(nameInput.value);
  if (slug) {
    urlPreview.textContent = 'app.virtualwaitress.com/' + slug + '/1';
    urlPreview.classList.add('su-url-ready');
  } else {
    urlPreview.textContent = 'Your menu URL will appear here';
    urlPreview.classList.remove('su-url-ready');
  }
});

// ── Password strength ─────────────────────────────────────────────────────────

const rules = {
  len:   { el: document.getElementById('sr-len'),   test: p => p.length >= 8 },
  upper: { el: document.getElementById('sr-upper'), test: p => /[A-Z]/.test(p) },
  lower: { el: document.getElementById('sr-lower'), test: p => /[a-z]/.test(p) },
  num:   { el: document.getElementById('sr-num'),   test: p => /[0-9]/.test(p) },
};

function checkStrength(password) {
  let allPass = true;
  for (const key in rules) {
    const pass = rules[key].test(password);
    rules[key].el.classList.toggle('sr-pass', pass);
    rules[key].el.classList.toggle('sr-fail', password.length > 0 && !pass);
    if (!pass) allPass = false;
  }
  return allPass;
}

passInput.addEventListener('input', () => checkStrength(passInput.value));

// ── Password visibility toggles ───────────────────────────────────────────────

function setupToggle(toggleId, inputEl) {
  const btn = document.getElementById(toggleId);
  if (!btn) return;
  btn.addEventListener('click', () => {
    const showing = inputEl.type === 'text';
    inputEl.type = showing ? 'password' : 'text';
    btn.querySelector('.eye-icon').classList.toggle('eye-hidden', !showing);
    btn.querySelector('.eye-off-icon').classList.toggle('eye-hidden', showing);
    btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
  });
}

setupToggle('suPwToggle',  passInput);
setupToggle('suPwToggle2', confirmInput);

// ── Helpers ───────────────────────────────────────────────────────────────────

function setLoading(on) {
  submitBtn.disabled = on;
  submitLabel.classList.toggle('su-hidden', on);
  submitSpinner.classList.toggle('su-hidden', !on);
}

function showError(msg) {
  errorEl.textContent = msg;
}

// ── Submit ────────────────────────────────────────────────────────────────────

document.getElementById('suForm').addEventListener('submit', async e => {
  e.preventDefault();
  showError('');

  const restaurantName = nameInput.value.trim();
  const email          = emailInput.value.trim();
  const password       = passInput.value;
  const confirm        = confirmInput.value;

  if (!restaurantName) { showError('Please enter your restaurant name.'); nameInput.focus(); return; }
  if (!email)          { showError('Please enter your email address.'); emailInput.focus(); return; }
  if (!checkStrength(password)) {
    showError('Password must be 8+ characters with an uppercase letter and a number.');
    passInput.focus();
    return;
  }
  if (password !== confirm) { showError('Passwords do not match.'); confirmInput.focus(); return; }

  setLoading(true);

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/create-restaurant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY },
      body: JSON.stringify({ restaurant_name: restaurantName, email, password }),
    });

    const result = await res.json();

    if (!res.ok || result.error) {
      showError(result.error || 'Something went wrong. Please try again.');
      setLoading(false);
      return;
    }

    const slug = result.slug || toSlug(restaurantName);

    step1.classList.add('su-hidden');
    document.getElementById('suSuccessMsg').textContent =
      'We sent a confirmation link to ' + email + '. Click it to activate your account.';
    document.getElementById('suSuccessUrl').textContent =
      'app.virtualwaitress.com/' + slug + '/1';
    step2.classList.remove('su-hidden');

  } catch (err) {
    showError('Network error — please check your connection and try again.');
    setLoading(false);
  }
});

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
    urlPreview.textContent = window.location.origin + '/?r=' + slug + '&table=1';
    urlPreview.classList.add('su-url-ready');
  } else {
    urlPreview.textContent = 'Your menu URL will appear here';
    urlPreview.classList.remove('su-url-ready');
  }
});

function setLoading(on) {
  submitBtn.disabled = on;
  submitLabel.classList.toggle('su-hidden', on);
  submitSpinner.classList.toggle('su-hidden', !on);
}

function showError(msg) {
  errorEl.textContent = msg;
}

document.getElementById('suForm').addEventListener('submit', async e => {
  e.preventDefault();
  showError('');

  const restaurantName = nameInput.value.trim();
  const email          = emailInput.value.trim();
  const password       = passInput.value;
  const confirm        = confirmInput.value;

  if (!restaurantName) { showError('Please enter your restaurant name.'); nameInput.focus(); return; }
  if (!email)          { showError('Please enter your email address.'); emailInput.focus(); return; }
  if (password.length < 8) { showError('Password must be at least 8 characters.'); passInput.focus(); return; }
  if (password !== confirm) { showError('Passwords do not match.'); confirmInput.focus(); return; }

  setLoading(true);

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/create-restaurant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
      body: JSON.stringify({ restaurant_name: restaurantName, email, password }),
    });

    const result = await res.json();

    if (!res.ok || result.error) {
      showError(result.error || 'Something went wrong. Please try again.');
      setLoading(false);
      return;
    }

    // Sign into the admin session (storage key is vw_admin_auth — matches admin.html)
    const { error: signInError } = await db.auth.signInWithPassword({ email, password });

    step1.classList.add('su-hidden');
    document.getElementById('suSuccessMsg').textContent =
      restaurantName + ' is live! Taking you to your dashboard…';
    document.getElementById('suSuccessUrl').textContent =
      window.location.origin + '/?r=' + result.slug + '&table=1';
    step2.classList.remove('su-hidden');

    if (!signInError) {
      // Session stored — redirect to admin after a moment
      setTimeout(() => { window.location.href = 'admin.html'; }, 2000);
    }

  } catch (err) {
    showError('Network error — please check your connection and try again.');
    setLoading(false);
  }
});

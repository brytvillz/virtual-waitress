const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const nameInput    = document.getElementById('suRestaurantName');
const emailInput   = document.getElementById('suEmail');
const passInput    = document.getElementById('suPassword');
const confirmInput = document.getElementById('suPasswordConfirm');
const urlPreview   = document.getElementById('suUrlPreview');
const errorEl      = document.getElementById('suError');
const submitBtn    = document.getElementById('suSubmit');
const submitLabel  = document.getElementById('suSubmitLabel');
const submitSpinner= document.getElementById('suSubmitSpinner');
const step1        = document.getElementById('suStep1');
const step2        = document.getElementById('suStep2');

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
    urlPreview.textContent = 'app.virtualwaitress.com/?r=' + slug + '&table=1';
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

    // Sign the user in immediately so they land on admin already authenticated
    const { error: signInError } = await db.auth.signInWithPassword({ email, password });
    if (signInError) {
      // Account created but sign-in failed — send them to login
      step1.classList.add('su-hidden');
      document.getElementById('suSuccessMsg').textContent =
        'Account created for ' + restaurantName + '. Please log in.';
      document.getElementById('suSuccessUrl').textContent =
        'app.virtualwaitress.com/?r=' + result.slug + '&table=1';
      step2.classList.remove('su-hidden');
      return;
    }

    // Success — show confirmation then redirect
    step1.classList.add('su-hidden');
    document.getElementById('suSuccessMsg').textContent =
      restaurantName + ' is live! Here is your demo menu link:';
    document.getElementById('suSuccessUrl').textContent =
      window.location.origin + '/?r=' + result.slug + '&table=1';
    step2.classList.remove('su-hidden');

  } catch (err) {
    showError('Network error — please check your connection and try again.');
    setLoading(false);
  }
});

// Virtual Waitress — Password Reset
// Handles the recovery link redirect from Supabase auth emails.

async function init() {
  // Check immediately if Supabase returned an error in the URL hash (e.g. otp_expired)
  const hash = new URLSearchParams(window.location.hash.slice(1));
  if (hash.get('error')) {
    showLinkError();
    return;
  }

  let recoveryReady = false;

  // Supabase fires PASSWORD_RECOVERY when the page loads with a valid recovery hash.
  db.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY" && !recoveryReady) {
      recoveryReady = true;
      clearTimeout(timeout);
      showResetForm();
    }
  });

  // Fallback: if no event fires within 5 seconds, the link is expired or invalid.
  const timeout = setTimeout(() => {
    if (!recoveryReady) showLinkError();
  }, 5000);

  // ── Password strength indicator ───────────────────────────────────────────
  const pwInput = document.getElementById("newPassword");
  const rules = {
    "rp-len":   v => v.length >= 8,
    "rp-upper": v => /[A-Z]/.test(v),
    "rp-lower": v => /[a-z]/.test(v),
    "rp-num":   v => /[0-9]/.test(v),
  };
  pwInput.addEventListener("input", () => {
    const v = pwInput.value;
    Object.entries(rules).forEach(([id, fn]) => {
      document.getElementById(id).classList.toggle("rp-rule-ok", fn(v));
    });
  });

  // ── Password visibility toggles ───────────────────────────────────────────
  function wireToggle(btnId, inputId) {
    const btn = document.getElementById(btnId);
    const inp = document.getElementById(inputId);
    btn.addEventListener("click", () => {
      const show = inp.type === "password";
      inp.type = show ? "text" : "password";
      btn.querySelector(".rp-eye").classList.toggle("rp-eye-hidden", show);
      btn.querySelector(".rp-eye-off").classList.toggle("rp-eye-hidden", !show);
    });
  }
  wireToggle("rpPwToggle", "newPassword");
  wireToggle("rpPwToggle2", "confirmPassword");

  // ── Form submit ────────────────────────────────────────────────────────────
  document.getElementById("resetForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const password = document.getElementById("newPassword").value;
    const confirm = document.getElementById("confirmPassword").value;
    const errorEl = document.getElementById("resetError");
    const btn = document.getElementById("resetSubmitBtn");

    errorEl.textContent = "";

    if (password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
      errorEl.textContent = "Password must be 8+ characters with an uppercase letter, lowercase letter, and number.";
      return;
    }
    if (password !== confirm) {
      errorEl.textContent = "Passwords do not match.";
      return;
    }

    btn.textContent = "Updating…";
    btn.disabled = true;

    const { error } = await db.auth.updateUser({ password });
    if (error) {
      errorEl.textContent = "Failed to update password. Try requesting a new reset link.";
      btn.textContent = "Update Password";
      btn.disabled = false;
      return;
    }

    clearTimeout(timeout);
    window.location.href = "/admin";
  });
}

function showResetForm() {
  document.getElementById("loadingScreen").classList.add("admin-hidden");
  document.getElementById("resetFormScreen").classList.remove("admin-hidden");
}

function showLinkError() {
  document.getElementById("linkErrorMsg").classList.remove("admin-hidden");
  document.getElementById("backToLoginLink").classList.remove("admin-hidden");
}

document.addEventListener("DOMContentLoaded", init);

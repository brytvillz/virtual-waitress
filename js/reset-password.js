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

  document.getElementById("resetForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const password = document.getElementById("newPassword").value;
    const confirm = document.getElementById("confirmPassword").value;
    const errorEl = document.getElementById("resetError");
    const btn = document.getElementById("resetSubmitBtn");

    errorEl.textContent = "";

    if (password.length < 8) {
      errorEl.textContent = "Password must be at least 8 characters.";
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
      errorEl.textContent =
        "Failed to update password. Try requesting a new reset link.";
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

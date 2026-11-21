import { AccountService } from "../services/AccountService.js";
import { escapeHtml } from "../utils/escapeHtml.js";
import { showToast } from "../utils/feedback.js";

const ROLE_LABELS = { admin: "Administrator", user: "User" };

// Same limits as POST /api/auth/password. Returns an error message, or null when the
// new password can be sent to the server (which also checks the current password).
export function checkNewPassword(currentPassword, newPassword, confirmPassword) {
  if (!currentPassword) return "Enter your current password.";
  if (newPassword.length < 10 || newPassword.length > 128) return "The new password must be 10 to 128 characters.";
  if (newPassword !== confirmPassword) return "The new passwords don't match.";
  if (newPassword === currentPassword) return "The new password must be different from the current one.";
  return null;
}

// The System Settings screen: the signed-in account, a change-password form (not for
// demo accounts), and what works without a connection. Renders into a container element.
export class SettingsView {
  constructor(accountService = new AccountService()) {
    this.accountService = accountService;
    this.saving = false;
  }

  // `user` is the signed-in user from /api/auth/status: { email, role, isDemo }.
  render(container, user) {
    if (!container) return;
    const email = user?.email || "Unknown";
    const role = ROLE_LABELS[user?.role] || user?.role || "Unknown";
    const isDemo = Boolean(user?.isDemo);

    container.innerHTML = `
      <div class="row g-4">
        <div class="col-lg-6">
          <div class="card h-100">
            <div class="card-body">
              <h5 class="card-title">Account</h5>
              <dl class="row mb-0" id="settings-account">
                <dt class="col-sm-4">Email</dt>
                <dd class="col-sm-8 text-break" id="settings-email">${escapeHtml(email)}</dd>
                <dt class="col-sm-4">Role</dt>
                <dd class="col-sm-8" id="settings-role">${escapeHtml(role)}</dd>
                <dt class="col-sm-4">Account type</dt>
                <dd class="col-sm-8 mb-0" id="settings-account-type">${
                  isDemo
                    ? `<span class="badge text-bg-warning">Demo</span>
                       <div class="small text-muted mt-1">A temporary account with sample cattle. It and its records are deleted about 4 hours after it was created.</div>`
                    : "Standard account"
                }</dd>
              </dl>
            </div>
          </div>
        </div>

        <div class="col-lg-6">
          <div class="card h-100">
            <div class="card-body">
              <h5 class="card-title">Change password</h5>
              ${isDemo ? this.demoPasswordNote() : this.passwordForm(email)}
            </div>
          </div>
        </div>

        <div class="col-12">
          <div class="card">
            <div class="card-body">
              <h5 class="card-title">Working offline</h5>
              <p class="mb-2">After a visit, this browser keeps a copy of the app's own pages and scripts, and of your herd, so the Dashboard and Cattle Records open without a connection.</p>
              <p class="mb-2">While offline you can view, add, edit and delete cattle. Those changes are saved on this device and sent to the server when the connection returns; the bar under the top of the page shows how many are waiting. If the server can't accept one (for example, the animal was changed somewhere else in the meantime), the server's version is kept and your change is listed under <strong>Review</strong>, where you can apply it again or discard it.</p>
              <p class="mb-0">Calving, weight, medical, breeding and financial records, reports, user management, signing in and changing your password need a connection. Signing out removes the copy of your herd from this device.</p>
            </div>
          </div>
        </div>
      </div>
    `;

    container.querySelector("#settings-password-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      this.handlePasswordSubmit(e.currentTarget);
    });
  }

  demoPasswordNote() {
    return `<p class="text-muted mb-0" id="settings-password-demo">Demo accounts can't change their password. Sign in with your own account to manage a password.</p>`;
  }

  passwordForm(email) {
    // The hidden username field lets password managers update the right saved login.
    return `
      <form id="settings-password-form" novalidate>
        <input type="email" name="username" autocomplete="username" value="${escapeHtml(email)}" hidden readonly>
        <div class="mb-3">
          <label class="form-label" for="settings-current-password">Current password</label>
          <input id="settings-current-password" type="password" class="form-control" autocomplete="current-password" required maxlength="128">
        </div>
        <div class="mb-3">
          <label class="form-label" for="settings-new-password">New password</label>
          <input id="settings-new-password" type="password" class="form-control" autocomplete="new-password" required minlength="10" maxlength="128" aria-describedby="settings-new-password-help">
          <div id="settings-new-password-help" class="form-text">10 to 128 characters. Changing it signs you out on your other devices.</div>
        </div>
        <div class="mb-3">
          <label class="form-label" for="settings-confirm-password">Confirm new password</label>
          <input id="settings-confirm-password" type="password" class="form-control" autocomplete="new-password" required minlength="10" maxlength="128">
        </div>
        <div id="settings-password-message" class="alert py-2" role="alert" hidden></div>
        <button id="settings-password-submit" type="submit" class="btn btn-success">Change password</button>
      </form>
    `;
  }

  showMessage(form, text, type) {
    const el = form.querySelector("#settings-password-message");
    if (!el) return;
    el.textContent = text;
    el.className = `alert py-2 alert-${type === "error" ? "danger" : "success"}`;
    el.hidden = false;
  }

  async handlePasswordSubmit(form) {
    if (this.saving) return;
    const currentEl = form.querySelector("#settings-current-password");
    const newEl = form.querySelector("#settings-new-password");
    const confirmEl = form.querySelector("#settings-confirm-password");
    const submitBtn = form.querySelector("#settings-password-submit");

    const problem = checkNewPassword(currentEl.value, newEl.value, confirmEl.value);
    if (problem) {
      this.showMessage(form, problem, "error");
      return;
    }

    this.saving = true;
    submitBtn.disabled = true;
    try {
      await this.accountService.changePassword(currentEl.value, newEl.value);
    } catch (err) {
      if (err.sessionExpired) return;
      this.showMessage(form, err.message || "Couldn't change the password.", "error");
      if (err.status === 400 && /current password/i.test(err.message)) {
        currentEl.value = "";
        currentEl.focus();
      }
      return;
    } finally {
      this.saving = false;
      submitBtn.disabled = false;
    }
    form.reset();
    this.showMessage(form, "Password changed. Your other devices have been signed out.", "success");
    showToast("Password changed", "success");
  }
}

import { UsersView, plural } from "../views/UsersView.js";
import { showToast } from "../utils/feedback.js";
import { noteApiResult } from "../utils/connectivity.js";

// The User Management screen (admins only): list users, add one, change a role,
// delete one. CattleController.renderSecondaryView delegates the "users" view here.
// The server enforces every rule (admin only, never remove the last admin, no
// self-delete); this screen only mirrors them.

// Same error shape as CattleService: `status` (0 when the server could not be
// reached) and `sessionExpired` (after the redirect to sign in has started).
async function request(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    noteApiResult(false);
    throw Object.assign(new Error("Can't reach the server. Check your connection and try again."), { status: 0 });
  }
  if (res.status === 401) {
    location.replace("/login.html");
    throw Object.assign(new Error("Your session has expired. Please sign in again."), { status: 401, sessionExpired: true });
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error((data && data.error) || `Request failed (${res.status})`), { status: res.status });
  return data;
}

const isAdmin = () => window.currentUser?.role === "admin";

// Shows the User Management nav item to admins only. Call once the signed-in user is known.
export function applyUserManagementAccess() {
  const link = document.querySelector('[data-view="users"]');
  const item = link?.closest("li") || link;
  if (item) item.hidden = !isAdmin();
}

export class UsersController {
  // onAccessLost runs when the signed-in user turns out not to be an admin
  // (they demoted themselves, or another admin did), to leave the screen.
  constructor({ onAccessLost } = {}) {
    this.view = new UsersView();
    this.onAccessLost = onAccessLost || (() => {});
    this.users = [];
    this.root = null;
  }

  // Draws the screen into `container` (the secondary view body) and loads the list.
  async show(container) {
    if (!isAdmin()) {
      this.root = this.view.renderMessage(container, "Only admins can manage users.");
      return;
    }
    this.container = container;
    this.root = this.view.renderShell(container);
    this.bind(this.root);
    await this.load();
  }

  // The screen is still on the page (the user may have switched views while a request was in flight).
  isShowing(root) {
    return root && root.isConnected && root === this.root;
  }

  async load() {
    const root = this.root;
    let users;
    try {
      users = await request("/api/users");
    } catch (err) {
      if (err.sessionExpired || !this.isShowing(root)) return;
      if (err.status === 403) return this.lostAccess();
      this.root = this.view.renderMessage(this.container, `Couldn't load users. ${err.message}`, { retry: true });
      this.bind(this.root);
      return;
    }
    if (!this.isShowing(root)) return;
    this.users = users;
    this.view.renderUsers(root, users, window.currentUser?.id);
  }

  bind(root) {
    root.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-user-action]");
      if (!btn || btn.tagName === "SELECT") return;
      if (btn.dataset.userAction === "delete") this.handleDelete(Number(btn.dataset.id), btn);
      else if (btn.dataset.userAction === "retry") this.show(this.container);
    });
    root.addEventListener("change", (e) => {
      const select = e.target.closest('select[data-user-action="role"]');
      if (select) this.handleRoleChange(Number(select.dataset.id), select);
    });
    root.querySelector("#add-user-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      this.handleAdd(e.currentTarget);
    });
    const toggle = root.querySelector("#new-user-password-toggle");
    toggle?.addEventListener("click", () => {
      const input = root.querySelector("#new-user-password");
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      toggle.textContent = show ? "Hide" : "Show";
      toggle.setAttribute("aria-pressed", String(show));
    });
  }

  async handleAdd(form) {
    if (this.adding) return;
    const root = this.root;
    const email = form.elements.email.value.trim();
    const password = form.elements.password.value;
    const role = form.elements.role.value;

    if (!form.elements.email.checkValidity() || !email) return this.formError(form.elements.email, "Enter a valid email.");
    if (password.length < 10 || password.length > 128) {
      return this.formError(form.elements.password, "The password must be 10 to 128 characters.");
    }
    this.view.showFormError(root, "");

    const button = form.querySelector('button[type="submit"]');
    this.adding = true;
    button.disabled = true;
    try {
      const created = await request("/api/users", { method: "POST", body: { email, password, role } });
      if (!this.isShowing(root)) return;
      form.reset();
      const input = form.elements.password;
      if (input.type !== "password") root.querySelector("#new-user-password-toggle")?.click();
      showToast(`Added ${created.email}. They can sign in now.`, "success");
      await this.load();
    } catch (err) {
      if (err.sessionExpired) return;
      if (err.status === 403) return this.lostAccess();
      if (this.isShowing(root)) this.view.showFormError(root, `Couldn't add the user. ${err.message}`);
    } finally {
      this.adding = false;
      button.disabled = false;
    }
  }

  formError(input, message) {
    this.view.showFormError(this.root, message);
    input.focus();
  }

  async handleRoleChange(id, select) {
    const user = this.users.find((u) => u.id === id);
    const previous = select.dataset.role;
    const role = select.value;
    if (!user || role === previous) return;
    const isSelf = id === window.currentUser?.id;

    if (isSelf && role !== "admin" &&
        !confirm("Remove your own admin access?\n\nYou will no longer be able to manage users. Another admin can give it back.")) {
      select.value = previous;
      return;
    }

    select.disabled = true;
    let updated;
    try {
      updated = await request(`/api/users/${encodeURIComponent(id)}`, { method: "PATCH", body: { role } });
    } catch (err) {
      select.value = previous;
      select.disabled = false;
      if (err.sessionExpired) return;
      if (err.status === 403) return this.lostAccess();
      if (err.status === 404) {
        showToast("That user no longer exists. The list has been refreshed.", "error");
        return this.load();
      }
      showToast(`Couldn't change the role. ${err.message}`, "error");
      return;
    }
    select.disabled = false;
    select.dataset.role = updated.role;
    user.role = updated.role;
    showToast(`${updated.email} is now ${updated.role === "admin" ? "an admin" : "a regular user"}.`, "success");
    if (isSelf && updated.role !== "admin") {
      window.currentUser.role = updated.role;
      this.lostAccess({ quiet: true });
    }
  }

  async handleDelete(id, button) {
    const user = this.users.find((u) => u.id === id);
    if (!user) return;
    const count = Number(user.cattle_count) || 0;
    const herd = count
      ? `This also permanently deletes their ${plural(count, "cattle record")}.`
      : "They have no cattle records.";
    if (!confirm(`Delete the user ${user.email}?\n\n${herd} They are signed out everywhere. This can't be undone.`)) return;

    button.disabled = true;
    try {
      await request(`/api/users/${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch (err) {
      button.disabled = false;
      if (err.sessionExpired) return;
      if (err.status === 403) return this.lostAccess();
      if (err.status === 404) {
        showToast("That user was already deleted. The list has been refreshed.", "error");
        return this.load();
      }
      showToast(`Couldn't delete the user. ${err.message}`, "error");
      return;
    }
    showToast(`Deleted ${user.email}${count ? ` and ${plural(count, "cattle record")}` : ""}.`, "success");
    await this.load();
  }

  // The signed-in user is no longer an admin: hide the nav item and leave the screen.
  lostAccess({ quiet = false } = {}) {
    if (window.currentUser) window.currentUser.role = "user";
    applyUserManagementAccess();
    if (!quiet) showToast("You no longer have admin access.", "error");
    this.onAccessLost();
  }
}

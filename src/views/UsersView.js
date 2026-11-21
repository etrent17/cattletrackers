import { escapeHtml } from "../utils/escapeHtml.js";

// Markup for the User Management screen. Every value from the API (emails,
// dates, ids, counts) goes through escapeHtml(); see docs/architecture-and-data.md.
// Buttons use data-user-action rather than the .btn-delete/.btn-edit classes,
// which CattleController handles for cattle rows.

const ROLE_LABELS = { admin: "Admin", user: "User" };

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export class UsersView {
  // The screen's frame: the add-user form and an empty table. Returns the root element.
  renderShell(container) {
    container.innerHTML = `
      <div id="users-screen">
        <p class="text-muted">Each user has their own herd. Admins can also manage users here.</p>
        <div class="card mb-4">
          <div class="card-body">
            <h5 class="card-title">Add a user</h5>
            <form id="add-user-form" class="row g-3 align-items-end" novalidate>
              <div class="col-md-4">
                <label class="form-label" for="new-user-email">Email</label>
                <input id="new-user-email" name="email" type="email" class="form-control" required autocomplete="off" spellcheck="false">
              </div>
              <div class="col-md-4">
                <label class="form-label" for="new-user-password">Temporary password</label>
                <div class="input-group">
                  <input id="new-user-password" name="password" type="password" class="form-control" required minlength="10" maxlength="128" autocomplete="new-password" aria-describedby="new-user-password-help">
                  <button id="new-user-password-toggle" type="button" class="btn btn-outline-secondary" aria-pressed="false">Show</button>
                </div>
              </div>
              <div class="col-md-2">
                <label class="form-label" for="new-user-role">Role</label>
                <select id="new-user-role" name="role" class="form-select">
                  <option value="user" selected>User</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div class="col-md-2 d-grid">
                <button id="add-user-btn" type="submit" class="btn btn-success">Add user</button>
              </div>
              <div class="col-12">
                <div id="new-user-password-help" class="form-text mt-0">At least 10 characters. Give it to the new user privately; they sign in with it.</div>
                <div id="add-user-error" class="alert alert-danger py-2 mt-2 mb-0" role="alert" hidden></div>
              </div>
            </form>
          </div>
        </div>
        <h4>Users</h4>
        <div class="table-responsive">
          <table class="table table-hover align-middle">
            <thead><tr><th>Email</th><th>Role</th><th>Cattle</th><th>Added</th><th>Actions</th></tr></thead>
            <tbody id="users-body"><tr><td colspan="5" class="text-muted">Loading users…</td></tr></tbody>
          </table>
        </div>
      </div>
    `;
    return container.querySelector("#users-screen");
  }

  // Replaces the screen with a message (no access, failed load). `retry` adds a Try again button.
  renderMessage(container, message, { retry = false } = {}) {
    container.innerHTML = `
      <div id="users-screen">
        <div class="alert alert-warning d-flex flex-wrap align-items-center justify-content-between gap-2" role="alert">
          <span>${escapeHtml(message)}</span>
          ${retry ? '<button type="button" class="btn btn-sm btn-outline-dark" data-user-action="retry">Try again</button>' : ""}
        </div>
      </div>
    `;
    return container.querySelector("#users-screen");
  }

  renderUsers(root, users, currentUserId) {
    const body = root.querySelector("#users-body");
    if (!body) return;
    if (!users.length) {
      body.innerHTML = '<tr><td colspan="5" class="text-muted">No users yet.</td></tr>';
      return;
    }
    body.innerHTML = users.map((u) => this.row(u, u.id === currentUserId)).join("");
  }

  row(user, isSelf) {
    const id = escapeHtml(user.id);
    const email = escapeHtml(user.email);
    const options = Object.entries(ROLE_LABELS)
      .map(([value, label]) => `<option value="${value}"${user.role === value ? " selected" : ""}>${label}</option>`)
      .join("");
    const action = isSelf
      ? '<span class="text-muted small">Signed in</span>'
      : `<button type="button" class="btn btn-sm btn-outline-danger" data-user-action="delete" data-id="${id}">Delete</button>`;
    return `
      <tr data-user-id="${id}">
        <td class="text-break" style="min-width: 14rem">${email}${isSelf ? ' <span class="badge text-bg-secondary">You</span>' : ""}</td>
        <td>
          <select class="form-select form-select-sm w-auto" data-user-action="role" data-id="${id}" data-role="${escapeHtml(user.role)}" aria-label="Role for ${email}">${options}</select>
        </td>
        <td class="text-nowrap">${escapeHtml(plural(Number(user.cattle_count) || 0, "animal"))}</td>
        <td class="text-nowrap">${escapeHtml(formatDate(user.created_at))}</td>
        <td>${action}</td>
      </tr>
    `;
  }

  showFormError(root, message) {
    const el = root.querySelector("#add-user-error");
    if (!el) return;
    el.textContent = message || "";
    el.hidden = !message;
  }
}

export { plural };

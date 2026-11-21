// What the user sees of offline editing (feature 14): the Online/Offline indicator, the banner
// under the top bar (offline notice, changes waiting to sync, changes that could not be synced)
// and the "Unsynced changes" dialog. The text helpers at the top are pure and unit-tested.
import { escapeHtml } from "../utils/escapeHtml.js";
import { formatHealthStatus } from "../utils/DateHelpers.js";

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export const pendingText = (n) => (n > 0 ? `${plural(n, "change", "changes")} waiting to sync.` : "");
export const unsyncedText = (n) => (n > 0 ? `${plural(n, "change", "changes")} could not be synced.` : "");

// "21 Nov 2026, 10:03" in the user's own time zone; "" when there is no usable date.
export function formatWhen(iso) {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// The offline notice. It only promises what this browser can do: `herdSavedAt` is null when no
// herd has been saved here yet, and `canQueue` is false when the browser cannot keep changes
// (no IndexedDB).
export function offlineText(herdSavedAt, canQueue = true) {
  if (!herdSavedAt) return "You're offline, and your herd has not been saved on this device yet. Reconnect to load it.";
  const when = formatWhen(herdSavedAt);
  const showing = `You're offline. Showing the herd saved on this device${when ? ` (last updated ${when})` : ""}. `;
  if (!canQueue) return `${showing}This browser can't keep changes while offline, so records can't be changed until the connection returns.`;
  return `${showing}You can still view, add, edit and delete cattle; changes sync when the connection returns. Other pages need a connection.`;
}

const TYPE_TITLES = { create: "New animal", edit: "Edit of", delete: "Delete of" };

// "Edit of CT-001 Daisy"
export function opTitle(op) {
  const label = op.label || "an animal";
  return op.type === "create" ? `New animal ${label}` : `${TYPE_TITLES[op.type] || "Change to"} ${label}`;
}

// Why the change was not applied, in the user's terms.
export function explainRejection(item) {
  const type = item.op?.type;
  if (item.code === "dependent") return "An earlier change to this animal could not be synced, so this one was not sent.";
  if (item.code === "stale") {
    return type === "delete"
      ? "This animal was changed somewhere else after you deleted it here, so it was not deleted. The server's version is shown in the herd."
      : "This animal was changed somewhere else after you made this change. The server's version was kept and is shown in the herd.";
  }
  if (item.status === 404 && type === "edit") return "This animal was deleted somewhere else, so your change could not be saved.";
  if (item.reason === "Duplicate cow number") return "Another animal already has this cow number.";
  return item.reason || "The server did not accept this change.";
}

const FIELDS = [
  ["tagNumber", "Cow number"],
  ["nameBreed", "Name / breed"],
  ["gender", "Gender"],
  ["birthDate", "Birth date"],
  ["weight", "Weight (lbs)"],
  ["lastCalvingDate", "Last calving"],
  ["expectedCalvingDate", "Expected calving"],
  ["medications", "Medications"],
  ["healthStatus", "Status"],
  ["notes", "Notes"],
];

const shown = (field, value) => {
  if (value === undefined || value === null || value === "") return "";
  if (field === "healthStatus") return formatHealthStatus(value).label;
  if (field === "gender") return value === "male" ? "Male" : value === "female" ? "Female" : String(value);
  return String(value);
};

// The rows of the comparison table for one unsynced change: { label, yours, server }.
// - an edit with the server's version: only the fields where the two differ (a blank weight is
//   "no change", and the last calving date is not part of an edit);
// - anything else with data: every field the user filled in.
export function changedFields(item) {
  const data = item.op?.data;
  if (!data) return [];
  const current = item.current;
  const rows = [];
  for (const [field, label] of FIELDS) {
    const yours = shown(field, data[field]);
    if (item.op.type === "edit") {
      if (field === "lastCalvingDate") continue;
      if (field === "weight" && yours === "") continue;
    }
    if (current && item.op.type === "edit") {
      const server = shown(field, current[field]);
      const same = field === "weight" ? Number(yours) === Number(server) : yours === server;
      if (!same) rows.push({ label, yours, server });
    } else if (yours !== "") {
      rows.push({ label, yours, server: null });
    }
  }
  return rows;
}

const ACTION_LABELS = { create: "Add again", edit: "Apply again", delete: "Delete anyway" };

export class SyncView {
  // The dot and word in the top bar.
  renderIndicator(online) {
    const indicator = document.getElementById("online-status");
    const text = document.getElementById("status-text");
    if (!indicator || !text) return;
    indicator.className = `status-indicator ${online ? "online" : "offline"}`;
    text.textContent = online ? "Online" : "Offline";
  }

  // `canQueue`: this browser can keep changes made offline. `syncing`: a replay is running.
  renderBanner({ online, herdSavedAt, canQueue, pending, unsynced, syncing }) {
    const banner = document.getElementById("sync-banner");
    if (!banner) return;
    const set = (id, value) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = value;
      el.hidden = !value;
    };
    set("sync-offline-text", online ? "" : offlineText(herdSavedAt, canQueue));
    set("sync-pending-text", pendingText(pending));
    set("sync-unsynced-text", unsyncedText(unsynced));

    const syncBtn = document.getElementById("sync-now-btn");
    if (syncBtn) {
      syncBtn.hidden = pending === 0;
      syncBtn.disabled = Boolean(syncing);
      syncBtn.textContent = syncing ? "Syncing…" : "Sync now";
    }
    const reviewBtn = document.getElementById("unsynced-review-btn");
    if (reviewBtn) reviewBtn.hidden = unsynced === 0;

    banner.hidden = online && pending === 0 && unsynced === 0;
    banner.classList.toggle("alert-danger", unsynced > 0);
    banner.classList.toggle("alert-warning", unsynced === 0);
  }

  // The list in the "Unsynced changes" dialog. Every value comes from the user or the server
  // and is escaped.
  renderUnsynced(items) {
    const list = document.getElementById("unsynced-list");
    if (!list) return;
    if (!items.length) {
      list.innerHTML = '<p class="text-muted mb-0" id="unsynced-empty">Nothing here. Every change has been synced or dealt with.</p>';
      return;
    }
    list.innerHTML = items
      .map((item) => {
        const rows = changedFields(item);
        const compare = rows.some((r) => r.server !== null);
        const table = rows.length
          ? `<div class="table-responsive"><table class="table table-sm mb-2">
              <thead><tr><th>Field</th><th>Your change</th>${compare ? "<th>On the server</th>" : ""}</tr></thead>
              <tbody>${rows
                .map((r) => `<tr><td>${escapeHtml(r.label)}</td><td class="unsynced-yours">${escapeHtml(r.yours || "—")}</td>${compare ? `<td class="unsynced-server">${escapeHtml(r.server || "—")}</td>` : ""}</tr>`)
                .join("")}</tbody>
            </table></div>`
          : "";
        const made = formatWhen(item.op.queuedAt);
        return `
          <div class="list-group-item unsynced-item" data-key="${escapeHtml(item.key)}">
            <div class="fw-semibold unsynced-title">${escapeHtml(opTitle(item.op))}</div>
            ${made ? `<div class="small text-muted">Made ${escapeHtml(made)}</div>` : ""}
            <div class="small text-danger my-1 unsynced-reason">${escapeHtml(explainRejection(item))}</div>
            ${table}
            <div class="d-flex flex-wrap gap-2">
              <button type="button" class="btn btn-sm btn-success btn-unsynced-apply" data-key="${escapeHtml(item.key)}">${escapeHtml(ACTION_LABELS[item.op.type] || "Apply again")}</button>
              <button type="button" class="btn btn-sm btn-outline-danger btn-unsynced-discard" data-key="${escapeHtml(item.key)}">Discard</button>
            </div>
          </div>`;
      })
      .join("");
  }
}

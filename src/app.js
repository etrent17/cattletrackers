import { CattleController } from "./controllers/CattleController.js";
import { SyncController } from "./controllers/SyncController.js";
import { applyUserManagementAccess } from "./controllers/UsersController.js";
import { api } from "./services/CattleService.js";
import { openOfflineStore } from "./services/OfflineStore.js";
import { SyncEngine } from "./services/SyncEngine.js";
import { SyncView } from "./views/SyncView.js";
import { GATEWAY_STATUSES, isOnline, noteApiResult, onConnectivityChange, watchBrowserConnectivity } from "./utils/connectivity.js";
import { hideErrorBanner, showErrorBanner, showToast } from "./utils/feedback.js";

let controller = null;
let sync = null; // the offline copy and outbox (feature 14); set once in start()

// Asks the server who is signed in. Resolves to { status } on an answer, { unreachable: true }
// when the server can't be reached, or { problem } with a message for any other failure.
async function fetchStatus() {
  try {
    const res = await fetch("/api/auth/status", { credentials: "same-origin" });
    const unreachable = GATEWAY_STATUSES.includes(res.status);
    noteApiResult(!unreachable);
    if (unreachable) return { unreachable: true };
    if (!res.ok) return { problem: `The server ran into a problem (${res.status}). Try again in a moment.` };
    return { status: await res.json() };
  } catch {
    noteApiResult(false);
    return { unreachable: true };
  }
}

// The id of the user the browser's session belongs to right now, or null (and off to the sign-in
// page) when it belongs to nobody. Asked before queued changes are sent: see SyncEngine.
async function whoAmI() {
  const status = await api("/api/auth/status");
  if (status.authenticated) return status.user.id;
  window.location.replace("/login.html");
  return null;
}

async function boot() {
  const { status, unreachable, problem } = await fetchStatus();

  if (problem) {
    showErrorBanner(problem, boot);
    return;
  }

  if (unreachable) {
    // No connection: carry on as the account whose herd is saved on this device, if there is
    // one. The server checks the session again on the first request once it is back.
    const saved = await sync.state().catch(() => null);
    if (!saved?.user || !saved.herdSavedAt) {
      showErrorBanner("Can't reach the server. Check your connection and try again.", boot);
      return;
    }
    window.currentUser = saved.user;
  } else {
    // Any authenticated session (a demo session too) may use the app before the first
    // admin exists; login.html applies the same rule, so the pages cannot loop.
    if (!status.authenticated) return window.location.replace("/login.html");
    window.currentUser = status.user;
    applyUserManagementAccess(); // admins only; before anything slower, so the item never lingers
    // A copy left on this device by a different account is removed before anything is shown.
    const dropped = await sync.setUser(status.user).catch((err) => {
      console.error("Couldn't prepare the offline copy:", err);
      return 0;
    });
    if (dropped) {
      showToast(`${dropped} unsynced ${dropped === 1 ? "change" : "changes"} left on this device by another account ${dropped === 1 ? "was" : "were"} removed.`, "error");
    }
  }

  hideErrorBanner();
  applyUserManagementAccess(); // admins only

  if (controller) return;
  try {
    controller = new CattleController({ sync });
    await controller.init();
    new SyncController({
      sync,
      cattleService: controller.cattleService,
      host: {
        reload: () => controller.loadData(),
        redraw: () => controller.refreshAllViews(),
        reapply: (item) => controller.reapplyUnsynced(item),
        connectivityChanged: (online) => controller.connectivityChanged(online),
      },
    }).init();
  } catch (err) {
    console.error("App failed to start:", err);
    showErrorBanner("Something went wrong while starting the app. Reload the page to try again.", () => window.location.reload());
  }
}

function setupSignOut() {
  const btn = document.getElementById("logout-btn");
  btn?.addEventListener("click", async () => {
    // Signing out removes the herd saved on this device, and with it any change that has not
    // reached the server. Say so before it happens.
    const state = await sync?.state().catch(() => null);
    const waiting = state ? state.outbox.length + state.unsynced.length : 0;
    if (waiting) {
      const ok = confirm(
        `${waiting} ${waiting === 1 ? "change has" : "changes have"} not been synced to the server. `
        + `Signing out deletes ${waiting === 1 ? "it" : "them"} from this device.\n\nSign out anyway?`
      );
      if (!ok) return;
    }
    btn.disabled = true;
    try {
      const res = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
      if (!res.ok) throw new Error(`Sign out failed (${res.status})`);
    } catch (err) {
      console.error(err);
      btn.disabled = false;
      showToast("Couldn't sign out. Check your connection and try again.", "error");
      return;
    }
    await sync?.clear().catch((err) => console.error("Couldn't clear the offline copy:", err));
    window.location.replace("/login.html");
  });
}

async function start() {
  // The indicator follows real reachability from the first moment, also when startup stops early.
  const indicator = new SyncView();
  watchBrowserConnectivity();
  onConnectivityChange((online) => indicator.renderIndicator(online));
  indicator.renderIndicator(isOnline());

  sync = new SyncEngine({ store: await openOfflineStore(), request: api, whoAmI, isOnline });
  setupSignOut();
  await boot();
}

document.addEventListener("DOMContentLoaded", start);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch((err) => console.log("Service Worker registration failed:", err));
  });
}

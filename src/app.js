import { CattleController } from "./controllers/CattleController.js";
import { hideErrorBanner, showErrorBanner, showToast } from "./utils/feedback.js";

let controller = null;

async function boot() {
  let status;
  try {
    const res = await fetch("/api/auth/status", { credentials: "same-origin" });
    if (!res.ok) {
      showErrorBanner(`The server ran into a problem (${res.status}). Try again in a moment.`, boot);
      return;
    }
    status = await res.json();
  } catch {
    showErrorBanner("Can't reach the server. Check your connection and try again.", boot);
    return;
  }

  // Any authenticated session (a demo session too) may use the app before the first
  // admin exists; login.html applies the same rule, so the pages cannot loop.
  if (!status.authenticated) return window.location.replace("/login.html");
  hideErrorBanner();
  window.currentUser = status.user;

  if (controller) return;
  try {
    controller = new CattleController();
    await controller.init();
  } catch (err) {
    console.error("App failed to start:", err);
    showErrorBanner("Something went wrong while starting the app. Reload the page to try again.", () => window.location.reload());
  }
}

function setupSignOut() {
  const btn = document.getElementById("logout-btn");
  btn?.addEventListener("click", async () => {
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
    window.location.replace("/login.html");
  });
}

document.addEventListener("DOMContentLoaded", () => {
  setupSignOut();
  boot();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch((err) => console.log("Service Worker registration failed:", err));
  });
}

import { CattleController } from "./controllers/CattleController.js";

async function boot() {
  try {
    const status = await fetch("/api/auth/status", { credentials: "same-origin" }).then((r) => r.json());
    if (status.setupRequired || !status.authenticated) return window.location.replace("/login.html");
    window.currentUser = status.user;
  } catch {
    document.body.insertAdjacentText("afterbegin", "Can't reach the server. Check your connection.");
    return;
  }
  new CattleController().init();

  document.getElementById("logout-btn")?.addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    window.location.replace("/login.html");
  });
}

document.addEventListener("DOMContentLoaded", boot);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch((err) => console.log("Service Worker registration failed:", err));
  });
}
// Whether the app can reach its server right now (feature 14, offline editing).
//
// "Online" needs both: the browser says it has a network (navigator.onLine), and the last
// request to the API got an answer. navigator.onLine alone is not enough: it stays true on a
// network with no route to the server, and when the server itself is down.
//
// CattleService.api() reports every request here, so the state follows real traffic. Listeners
// are told on every change, and again on the browser's own online/offline events.

// Answers from a proxy in front of an app that is not running. For the user that is the same as
// no connection: nothing was read or written.
export const GATEWAY_STATUSES = [502, 503, 504];

let apiReachable = true;
const listeners = new Set();

const browserOnline = () => typeof navigator === "undefined" || navigator.onLine !== false;

export const isOnline = () => browserOnline() && apiReachable;

const notify = () => {
  const online = isOnline();
  for (const listener of [...listeners]) {
    try {
      listener(online);
    } catch (err) {
      console.error("Connectivity listener failed:", err);
    }
  }
};

// Called after each API request: `reached` is false when the request got no answer from the app
// (a network error, or one of GATEWAY_STATUSES).
export function noteApiResult(reached) {
  const before = isOnline();
  apiReachable = Boolean(reached);
  if (isOnline() !== before) notify();
}

// `listener(online)` runs when the state changes. Returns a function that removes it.
export function onConnectivityChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Asks the server whether it is there. Resolves to the new state.
export async function probe() {
  try {
    const res = await fetch("/api/health", { cache: "no-store", credentials: "same-origin" });
    noteApiResult(!GATEWAY_STATUSES.includes(res.status));
  } catch {
    noteApiResult(false);
  }
  return isOnline();
}

// Follows the browser's online/offline events. Call once at startup.
export function watchBrowserConnectivity() {
  window.addEventListener("online", () => {
    apiReachable = true; // assume the server is back; the next request corrects this if not
    notify();
  });
  window.addEventListener("offline", notify);
}

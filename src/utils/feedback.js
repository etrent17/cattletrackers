// Page-level feedback shared by app.js and the controller:
// - a toast (#notification) for the result of an action
// - a banner (#error-banner) for failures that leave the page without data,
//   with an optional Retry button

let toastTimer = null;

export function showToast(message, type = "success") {
  const el = document.getElementById("notification");
  if (!el) return;
  el.textContent = message;
  el.className = `toast-notification ${type} show`;
  // A newer toast must not be hidden early by an older toast's timer.
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), type === "error" ? 6000 : 3000);
}

// Shows the error banner. `onRetry` (optional, may be async) runs when Retry is
// clicked; the button is disabled while it runs.
export function showErrorBanner(message, onRetry) {
  const banner = document.getElementById("error-banner");
  const text = document.getElementById("error-banner-text");
  const retry = document.getElementById("error-banner-retry");
  if (!banner || !text) {
    console.error(message);
    return;
  }
  text.textContent = message;
  if (retry) {
    retry.hidden = !onRetry;
    retry.disabled = false;
    retry.textContent = "Retry";
    retry.onclick = onRetry
      ? async () => {
          retry.disabled = true;
          retry.textContent = "Retrying…";
          try {
            await onRetry();
          } finally {
            retry.disabled = false;
            retry.textContent = "Retry";
          }
        }
      : null;
  }
  banner.hidden = false;
}

export function hideErrorBanner() {
  const banner = document.getElementById("error-banner");
  if (banner) banner.hidden = true;
}

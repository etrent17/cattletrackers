// Offline editing (feature 14): keeps the indicator and the sync banner up to date, decides when
// to replay the outbox, and runs the "Unsynced changes" dialog.
//
// Replay runs when the connection returns, when the app starts, right after a change is queued,
// when the user chooses "Sync now", and every RETRY_MS while something is waiting (for a server
// that is down while the browser still believes it has a network).
//
// host = {
//   reload(): Promise<boolean>      refetch the herd (or fall back to the saved copy) and redraw
//   redraw(): void                  redraw the herd views from memory
//   reapply(item): Promise<boolean> start doing an unsynced change again; see CattleController
//   connectivityChanged(online)     the app went online or offline
// }
import { SyncView } from "../views/SyncView.js";
import { isOnline, onConnectivityChange, probe } from "../utils/connectivity.js";
import { showToast } from "../utils/feedback.js";

const RETRY_MS = 30_000;
// After a failed attempt, sooner tries first: a connection that has just come back often needs a
// few seconds before the server answers.
const QUICK_RETRIES_MS = [3_000, 8_000, 15_000];

const count = (n) => `${n} ${n === 1 ? "change" : "changes"}`;

export class SyncController {
  constructor({ sync, cattleService, host }) {
    this.sync = sync;
    this.cattleService = cattleService;
    this.host = host;
    this.view = new SyncView();
    this.modalEl = document.getElementById("unsyncedModal");
    this.syncing = null;
    this.wasOnline = isOnline();
    this.items = [];
    this.quickRetries = 0;
    this.quickTimer = null;
  }

  init() {
    document.getElementById("sync-now-btn")?.addEventListener("click", () => this.syncNow({ manual: true }));
    document.getElementById("unsynced-review-btn")?.addEventListener("click", () => this.openUnsynced());
    this.modalEl?.addEventListener("click", (e) => {
      const apply = e.target.closest(".btn-unsynced-apply");
      const discard = e.target.closest(".btn-unsynced-discard");
      if (apply) this.handleApply(Number(apply.dataset.key));
      else if (discard) this.handleDiscard(Number(discard.dataset.key));
    });

    this.sync.onChange(() => this.render());
    this.cattleService.onQueued = () => {
      // Try at once: the server may be back before the browser notices.
      if (navigator.onLine !== false) this.syncNow();
    };

    onConnectivityChange((online) => {
      const cameBack = online && !this.wasOnline;
      this.wasOnline = online;
      if (navigator.onLine === false) this.quickRetries = 0; // a fresh set of quick tries after the next reconnect
      this.render();
      this.host.connectivityChanged(online);
      if (cameBack) this.syncNow({ reload: true });
    });

    setInterval(() => this.retry(), RETRY_MS);

    this.render();
    if (isOnline()) this.syncNow();
  }

  // Redraws the indicator, the banner and (when open) the unsynced list from the store.
  async render() {
    this.view.renderIndicator(isOnline());
    let state;
    try {
      state = await this.sync.state();
    } catch (err) {
      console.error("Couldn't read the offline copy:", err);
      return;
    }
    this.items = state.unsynced;
    this.view.renderBanner({
      online: isOnline(),
      herdSavedAt: state.herdSavedAt,
      pending: state.outbox.length,
      unsynced: state.unsynced.length,
      syncing: Boolean(this.syncing),
    });
    this.view.renderUnsynced(state.unsynced);
  }

  async retry() {
    if (document.hidden || navigator.onLine === false) return;
    if (!isOnline()) {
      // Coming back online triggers the replay (see init).
      if (!(await probe())) this.quickRetry(true);
      return;
    }
    const state = await this.sync.state().catch(() => null);
    if (state?.outbox.length) this.syncNow();
  }

  // Replays the outbox, then brings the herd on screen up to date. `manual` adds a message when
  // there was nothing to do or the server is still out of reach; `reload` refetches the herd even
  // when nothing was sent (after coming back online, the list on screen is the saved copy).
  syncNow(options = {}) {
    this.syncing ??= this.runSync(options).finally(() => {
      this.syncing = null;
      this.render();
    });
    return this.syncing;
  }

  async runSync({ manual = false, reload = false }) {
    this.render();
    if (manual && !isOnline() && navigator.onLine !== false) await probe();
    const summary = await this.sync.replay();
    if (summary.stopped === "busy" || summary.stopped === "signed-out") return;
    if (summary.stopped === "account") {
      // Another account signed in on this device since this page loaded. Start again as that
      // account; startup removes the previous account's copy and says what went with it.
      window.location.reload();
      return;
    }

    if (summary.synced || summary.rejected || reload || (this.cattleService.fromCache && summary.stopped !== "unreachable")) {
      await this.host.reload();
    } else {
      await this.cattleService.refreshFromStore().catch(() => {});
      this.host.redraw();
    }

    this.quickRetry(summary.remaining > 0 && (summary.stopped === "unreachable" || summary.stopped === "error"));

    if (summary.rejected) {
      showToast(`${count(summary.rejected)} could not be synced. Choose Review to see ${summary.rejected === 1 ? "it" : "them"}.`, "error");
    } else if (summary.synced) {
      showToast(summary.remaining ? `${count(summary.synced)} synced, ${summary.remaining} still waiting.` : `${count(summary.synced)} synced.`);
    } else if (manual) {
      if (summary.stopped === "unreachable") showToast("Still can't reach the server. Your changes are safe on this device.", "error");
      else if (summary.stopped === "error") showToast("The server ran into a problem. Your changes are safe on this device; try again in a moment.", "error");
      else showToast("Everything is up to date.");
    }
  }

  // `failed`: changes are still waiting after an attempt that got no answer. Try again shortly, a
  // few times, then leave it to the regular RETRY_MS check. Anything else resets the count.
  quickRetry(failed) {
    clearTimeout(this.quickTimer);
    if (!failed) {
      this.quickRetries = 0;
      return;
    }
    if (this.quickRetries >= QUICK_RETRIES_MS.length || navigator.onLine === false) return;
    this.quickTimer = setTimeout(() => this.retry(), QUICK_RETRIES_MS[this.quickRetries]);
    this.quickRetries += 1;
  }

  openUnsynced() {
    if (!this.modalEl) return;
    this.render();
    bootstrap.Modal.getOrCreateInstance(this.modalEl).show();
  }

  // Closes the dialog and resolves once it is gone (Bootstrap shows one modal at a time).
  closeUnsynced() {
    return new Promise((resolve) => {
      const modal = this.modalEl && bootstrap.Modal.getInstance(this.modalEl);
      if (!modal || !this.modalEl.classList.contains("show")) return resolve();
      this.modalEl.addEventListener("hidden.bs.modal", () => resolve(), { once: true });
      modal.hide();
    });
  }

  async handleApply(key) {
    const item = this.items.find((i) => i.key === key);
    if (!item) return;
    if (item.op.type !== "delete") await this.closeUnsynced();
    // The host removes the entry itself once the change has been saved again.
    await this.host.reapply(item);
  }

  async handleDiscard(key) {
    const item = this.items.find((i) => i.key === key);
    if (!item) return;
    if (!confirm("Discard this change? It will be removed from this device and cannot be recovered.")) return;
    try {
      await this.sync.discardUnsynced(key);
    } catch (err) {
      showToast(`Couldn't discard the change. ${err.message}`, "error");
      return;
    }
    showToast("Change discarded.");
    await this.render();
    if (!this.items.length) await this.closeUnsynced();
  }
}

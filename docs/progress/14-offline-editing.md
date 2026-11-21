# 14 · Offline editing

| Branch | Phase | Status | Owner | Depends on |
|---|---|---|---|---|
| `feature/offline-editing` | 4 | Not started | — | 02, 04 |

## Goal
Herd records can be viewed and edited without a connection (for example, out in a barn), and changes sync when the connection returns.

## Background
The service worker caches static files only; `/api/` requests are never cached, so the app is unusable offline. This is a large feature, so settle the scope first.

## Decisions needed before starting
- [ ] Which data must work offline: cattle only, or events too?
- [ ] Conflict rule when the same record changed online and offline (last write wins, or ask the user)

## Tasks
- [ ] Cache the herd in IndexedDB after each successful load
- [ ] Show cached data when offline, with a clear "offline" banner
- [ ] Queue creates, edits, and deletes made offline
- [ ] Replay the queue on reconnect; report failures, such as a duplicate cow number
- [ ] Client-generated IDs (UUIDs) so offline-created records keep their identity
- [ ] Conflict handling per the decision above
- [ ] Clear cached data on sign out

## Acceptance
- [ ] With the network off, the herd is visible and a new cow can be added
- [ ] Reconnecting syncs the new cow to the server
- [ ] Signing out removes the offline copy

## Progress log
| Date | Who | Note |
|---|---|---|

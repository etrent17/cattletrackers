# 02 · Error handling

| Branch | Phase | Status | Owner | Depends on |
|---|---|---|---|---|
| `feature/error-handling` | 1 | Not started | — | 01 |

## Goal
When something fails (server down, session expired, a request rejected), the user sees a clear message instead of a page with dead buttons or a silent failure.

## Background
- `CattleController.init()` attaches event listeners only after cattle load, and `app.js` does not catch a failed `init()`. A failed load leaves buttons that do nothing (known issue 8).
- `handleDelete` has no try/catch; a failed delete is an unhandled error (known issue 9).
- Sign out ignores a failed request.

## Tasks
- [ ] Attach event listeners before loading data in `init()`
- [ ] Catch a failed initial load: show an error banner with a Retry button
- [ ] Catch errors in `app.js` around `init()`
- [ ] Wrap `handleDelete` in try/catch and show an error toast
- [ ] Make `refreshAllViews` resilient so one failing view does not stop the others
- [ ] Sign out: on failure, still go to the login page, or show a toast
- [ ] Disable the Save button while a save is in flight (prevents double submits)

## Acceptance
- [ ] With the server stopped, loading the app shows an error banner; Retry works once the server is back
- [ ] Deleting a record that was already deleted (two tabs) shows an error toast
- [ ] Double-clicking Save creates one record, not two
- [ ] An expired session on any action returns to the login page
- [ ] Known issues 8 and 9 moved to Resolved

## Progress log
| Date | Who | Note |
|---|---|---|

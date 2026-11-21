# 03 · Escape user input

| Branch | Phase | Status | Owner | Depends on |
|---|---|---|---|---|
| `feature/escape-user-input` | 1 | Not started | — | 01 |

## Goal
Text a user types (name, breed, notes, medications, cow number) always displays as plain text and can never inject HTML into the page.

## Background
`DashboardView`, `ListView`, and `CattleController.handleInspect` build HTML with template strings and insert record fields unescaped through `innerHTML`. The content security policy blocks inline scripts, and users only see their own herd, so the risk today is low. But a name like `<b>Daisy</b>` renders as bold, and later features (shared herds, admin screens) would make it a real security hole.

## Tasks
- [ ] Add an `escapeHtml()` helper in `src/utils/`
- [ ] Apply it to every user-supplied field in `DashboardView`, `ListView`, and `handleInspect`
- [ ] Check the secondary views and any new templates added by 01
- [ ] Add a note to the architecture doc: "always escape record fields in templates"
- [ ] Add a unit test for `escapeHtml` (once 04 lands, or in this branch)

## Acceptance
- [ ] A cow named `<b>Daisy</b><img src=x>` displays those characters literally in every table, the events list, and the details modal
- [ ] Notes containing `&`, `<`, `>`, and quotes display correctly

## Progress log
| Date | Who | Note |
|---|---|---|

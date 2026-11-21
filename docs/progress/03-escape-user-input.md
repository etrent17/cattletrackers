# 03 · Escape user input

| Branch | Phase | Status | Owner | Depends on |
|---|---|---|---|---|
| `feature/escape-user-input` | 1 | In review | agent | 01 |

## Goal
Text a user types (name, breed, notes, medications, cow number) always displays as plain text and can never inject HTML into the page.

## Background
`DashboardView`, `ListView`, and `CattleController.handleInspect` build HTML with template strings and insert record fields unescaped through `innerHTML`. The content security policy blocks inline scripts, and users only see their own herd, so the risk today is low. But a name like `<b>Daisy</b>` renders as bold, and later features (shared herds, admin screens) would make it a real security hole.

## Tasks
- [x] Add an `escapeHtml()` helper in `src/utils/` (`src/utils/escapeHtml.js`, escapes `& < > " '`, null/undefined to empty string; added to the service worker cache, `CACHE_NAME` v9)
- [x] Apply it to every user-supplied field in `DashboardView`, `ListView`, and `handleInspect` (text and `data-id` attributes, dates, status label, list title)
- [x] Check the secondary views and any new templates added by 01 (secondary views only show computed numbers; `FormView`, the modal title, `auth.js` and `app.js` use `textContent`/`value`, no `innerHTML`)
- [x] Add a note to the architecture doc: "always escape record fields in templates"
- [x] Add a unit test for `escapeHtml` (`test/escape-html.test.mjs`, run with `node --test test/escape-html.test.mjs`; 6 tests pass. Not yet wired into `npm test`, which belongs to 04)

## Acceptance
- [x] A cow named `<b>Daisy</b><img src=x>` displays those characters literally in every table, the events list, and the details modal
- [x] Notes containing `&`, `<`, `>`, and quotes display correctly

## Progress log
| Date | Who | Note |
|---|---|---|
| 2026-11-21 | agent | Added `escapeHtml()` and applied it at every template interpolation. Verified in Chromium (Playwright) with cows whose cow number, name, medications and notes contain `<b>`, `<img onerror>`, `<script>`, `</td><td>`, `</li></ul><h1>`, quotes, apostrophes and `&amp;`, created via the API and the Add form: dashboard table, upcoming events, All/Calving/Medical/Breeding lists, details modal and edit form all show the text literally, rows keep their cell count, no `img`/`b`/`h1`/`u` elements or alerts appear, search, View, Edit (save round-trip not double-escaped) and Delete still work. Negative control with escaping disabled fails the same checks. |

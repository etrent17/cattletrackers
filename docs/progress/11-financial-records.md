# 11 · Financial records

| Branch | Phase | Status | Owner | Depends on |
|---|---|---|---|---|
| `feature/financial-records` | 2 | In review | agent | 01, 02 |

## Goal
Record income and expenses, optionally tied to an animal, and see a financial report.

## Background
No financial table, API, or form exists (known issue 5). The Financial Reports page shows herd statistics (part of known issue 4).

## Tasks
- [x] Table `transactions`: id, owner_id, date, kind (income, expense), category, amount (NUMERIC), cattle_id (optional, set null on delete), description, created_at
- [x] Default categories: feed, vet and medicine, breeding, equipment, labour, sale of animals, milk, other (editable list later)
- [x] API: list (with date range), create, update, delete; owner checks
- [x] Financial page: transactions table, add/edit form, date-range filter
- [x] Financial Reports page: totals by category, income against expenses by month, net, cost per head
- [x] Cow details modal: transactions for that animal
- [x] CSV export of transactions

## Acceptance
- [x] Totals on the report match the transactions in the selected range
- [x] Deleting an animal keeps its transactions (no longer linked to it)
- [x] Amounts are stored and summed exactly (no floating-point drift)
- [x] Known issue 5 moved to Resolved; Financial Reports part of issue 4 resolved

## Notes
- Amounts are `NUMERIC(12,2)` (always > 0, `kind` gives the sign), summed in SQL and returned by the API as decimal strings. The browser only adds amounts as integer cents (`src/utils/money.js`).
- Categories are free text (1 to 50 characters); the form suggests the default list through a datalist, so an editable list can come later without an API change.
- Cost per head = expenses in the period ÷ animals on record now (a current-herd approximation, documented on the report page and in `docs/api.md`).
- CSV export is generated in the browser (`src/utils/csv.js`): RFC 4180 quoting, and text starting with `=`, `+`, `-`, `@`, tab or carriage return gets a leading `'`.
- Demo accounts get twelve sample transactions and are limited to 200.
- Shared-file edits: `db.js` (separate `initTransactionsSchema()` block), `app.js` (one route line), `lib/demo.js` (sample transactions), `CattleController.js` (import, constructor line, one-line hook in `renderSecondaryView` and in `handleInspect`), `CattleService.js` (`api` exported), `index.html` (nav item and transaction dialog), `service-worker.js` (new files, `CACHE_NAME` unchanged), `package.json` (`test:e2e` runs files one at a time).

## Verification
- API tests: `test/api/transactions.test.js` (CRUD, validation, owner isolation including another user's animal, date range, exact sums for 0.10 + 0.20 and sums above 10 digits, animal delete keeps transactions, demo data and limit).
- Unit tests: `test/unit/csv.test.mjs` (CSV quoting and formula guard), `test/unit/finance.test.mjs` (cents arithmetic, formatting, period presets, CSV export).
- Browser test: `e2e/finance.e2e.js` (add income and expenses, check records totals, report totals and cost per head, edit, empty period, cow details section, CSV download, animal delete, transaction delete).
- Checked by hand in Chromium (Playwright) on a demo account: both pages, the dialog, an HTML/formula payload in category and description (shown as text, quoted in the CSV), invalid amount message, From after To message, a failing summary request (error with Retry, then recovery), a slow response arriving after leaving the page (ignored), and the records page at phone width (the table scrolls sideways).

## Progress log
| Date | Who | Note |
|---|---|---|
| 2026-11-21 | agent | Implemented table, API, records and report pages, cow details section, CSV export, demo data, tests and docs. `npm test` and `npm run test:e2e` pass. Ready for review. |

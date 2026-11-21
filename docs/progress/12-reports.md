# 12 · Performance and health reports

| Branch | Phase | Status | Owner | Depends on |
|---|---|---|---|---|
| `feature/reports` | 2 | In review | agent | 07, 08, 09, 10 |

## Goal
Performance Reports and Health Reports show distinct, useful information built from the records data.

## Background
Both pages show the same three herd statistics (known issue 4). They need the event data from 07 to 10.

## Tasks
- [x] Performance: herd size over time, calving rate, average calving interval, average daily gain by animal and by group, weaning or sale weights if recorded (not recorded: see Notes)
- [x] Health: treatments by type and month, animals currently under treatment or in quarantine, upcoming and overdue treatments, animals within withdrawal periods
- [x] Date-range selector on both pages
- [x] Charts (pick one small chart library allowed by the content security policy, or plain SVG)
- [x] CSV export of each report table
- [x] Print-friendly layout

## Acceptance
- [x] Each report page shows different content from the others
- [x] Figures checked by hand against a small known data set
- [ ] Export opens correctly in a spreadsheet (format checked by tests; not opened in a spreadsheet program: see Notes)
- [x] Known issue 4 moved to Resolved

## Notes
- Two endpoints, `GET /api/reports/performance` and `GET /api/reports/health` (`routes/reports.js`), take `from`, `to` and `today`. Every figure is computed in SQL inside one read-only snapshot; the browser only formats. The definitions are in `docs/api.md` ("Reports") and at the foot of each page.
- Definitions chosen here:
  - Herd size over time uses `created_at` as the joining date (as a UTC date, never later than the caller's today). Deleted animals are not tracked, and an animal entered late counts from the day it was entered.
  - Calving rate = cows that calved in the period ÷ breeding-age females (not male, and either has calved by the end of the period or is a female aged 15 months or more then; a female with no birth date counts). A cow counts once, so the rate cannot pass 100% over a long period. The denominator does not use `created_at`, because calvings are often entered after the fact.
  - Calving interval = days between a cow's consecutive calving dates, for intervals ending in the period; twins on one day are one calving.
  - Daily gain = (last − first weighing in the period) ÷ days, per animal with weighings on two different dates. Group and herd figures are the unweighted mean of the animals' figures. "Group" is the animal's sex, the only grouping the cattle record has.
  - Conception rate = breedings found pregnant ÷ breedings with a pregnant or open check; a breeding's result is the cow's newest such check dated on or after it and before her next breeding. The optional `breeding_id` link on a check is not relied on.
  - Follow-ups reuse the open rule of `GET /api/treatments/due`: `routes/treatments.js` now exports its `SUPERSEDED` SQL condition and the report uses it (a test compares the two lists). Upcoming means due within 30 days.
- Weaning and sale weights are not recorded anywhere (there is no weaning or sale event), so the report says so and shows average birth weight from the calving records instead.
- Charts are inline SVG (herd size) and HTML/CSS bars inside the tables (shares, treatments by month); no library. The four treatment-type colours were checked for colour-blind separation, and every bar sits beside its number.
- CSV: each table exports the rows it shows through `src/utils/csv.js` (`csvField`, `downloadCsv`: byte-order mark, CRLF, quoting, formula guard on text). Numbers are written unquoted so a negative gain stays a number. The browser test reads the downloaded files; nobody opened one in Excel or LibreOffice, which are not available in the build environment.
- Print: `@media print` in `public/styles.css` hides the menu, filter, buttons and dialogs for every page, widens the content, and keeps bar and badge colours. Checked with print-media emulation (browser test and screenshot), not on paper.
- Removed: the placeholder branch of `CattleController.renderSecondaryView`, and `scheduledTreatments` from `CattleService.getStatistics()` (only the placeholder read it; the dashboard figure comes from the treatment schedule).
- Shared-file edits: `app.js` (one mount line), `routes/treatments.js` (export), `CattleController.js` (import, constructor line, `renderSecondaryView`), `CattleService.js` (`getStatistics`), `public/styles.css` (appended), `public/service-worker.js` (three `urlsToCache` entries; `CACHE_NAME` unchanged, so the integrator should bump it).
- Tests: `test/api/reports.test.js` (25: every figure for a six-animal herd worked out in comments, empty herd, empty period, date validation, owner isolation), `test/unit/reports-service.test.mjs` (labels, chart geometry, CSV tables), `e2e/reports.e2e.js` (11 steps).

## Progress log
| Date | Who | Note |
|---|---|---|
| 2026-11-21 | agent | Built both report endpoints and pages with period filter, charts, CSV export and print layout; removed the placeholder; known issue 4 resolved. `npm test` and `npm run test:e2e` pass. In review. |

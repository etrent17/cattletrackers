# Roadmap

Planned from a review of `main` at commit `ac0ec1c` (2026-11-21). Each feature has its own branch and its own progress sheet in [`docs/progress/`](progress/).

Status key: **Not started** · **In progress** · **In review** (pull request open) · **Done** (merged to `main`) · **Blocked**

## Overview

| # | Feature | Branch | Depends on | Status |
|---|---|---|---|---|
| **Phase 1: Working prototype** | | | | |
| 01 | [Fix dashboard and cattle list](progress/01-fix-core-views.md) | `feature/fix-core-views` | none | Done |
| 02 | [Error handling](progress/02-error-handling.md) | `feature/error-handling` | 01 | Done |
| 03 | [Escape user input](progress/03-escape-user-input.md) | `feature/escape-user-input` | 01 | Done |
| 04 | [Automated tests and CI](progress/04-automated-tests.md) | `feature/automated-tests` | 01 | Done |
| **Phase 2: Replace placeholders** | | | | |
| 05 | [Settings and account](progress/05-settings-cleanup.md) | `feature/settings-cleanup` | 01 | Done |
| 06 | [User management screen](progress/06-user-management-ui.md) | `feature/user-management-ui` | 01 | Done |
| 07 | [Calving records](progress/07-calving-records.md) | `feature/calving-records` | 01, 02 | Done |
| 08 | [Medical records](progress/08-medical-records.md) | `feature/medical-records` | 07 (pattern) | Done |
| 09 | [Breeding records](progress/09-breeding-records.md) | `feature/breeding-records` | 07 (pattern) | Done |
| 10 | [Weight tracking](progress/10-weight-tracking.md) | `feature/weight-tracking` | 07 (pattern) | Done |
| 11 | [Financial records](progress/11-financial-records.md) | `feature/financial-records` | 01, 02 | Done |
| 12 | [Performance and health reports](progress/12-reports.md) | `feature/reports` | 07, 08, 09, 10 | Done |
| **Phase 3: Deployment** | | | | |
| 13 | [Deployment hardening](progress/13-deploy-hardening.md) | `feature/deploy-hardening` | none | Done |
| 17 | [Docker image package](progress/17-docker-package.md) | `feature/docker-package` | 13 | Done |
| **Phase 4: Later** | | | | |
| 14 | [Offline editing](progress/14-offline-editing.md) | `feature/offline-editing` | 02, 04 | Done |
| 18 | [Cow GPS map](progress/18-cow-gps-map.md): a map of the field, with an option to add a GPS tracker to each cow | `feature/cow-gps-map` | 01 | In progress |
| **Phase 5: Design (after everything is functional)** | | | | |
| 15 | [Apply Emil's design](progress/15-emil-design.md) | `feature/emil-design` | 01 to 13 | Not started |
| 16 | [Impeccable polish pass](progress/16-impeccable-polish.md) | `feature/impeccable-polish` | 15 | Not started |

"07 (pattern)" means the branch can start any time, but 07 sets the table, API, and screen pattern the others should copy, so it is easier to do 07 first.

## Order of work

1. **01 first, alone.** Almost every other branch edits `index.html` or `CattleController.js`, and the dashboard currently crashes on every refresh. Fixing it first makes everything else testable.
2. **02, 03, 04 next**, in any order. They are small. Getting 04 in early means later features ship with tests.
3. **Phase 2** in the order listed. 05, 06, 11, and 13 are independent and can run in parallel with the records work.
4. **12 last in Phase 2**, because reports read the data that 07 to 10 create.
5. **Design last.** Once 01 to 13 are merged, apply Emil's design (15), then polish with Impeccable (16). Until then, new screens use plain Bootstrap and are not styled, so nothing gets restyled twice. Offline editing (14) is not required before the design work.

## Working rules

- **Start of work:** the branches were all created up front, so bring yours up to date before you begin, and again before opening a pull request:
  ```bash
  git fetch origin && git merge origin/main
  ```
- **Progress sheets:** each branch updates **only its own** sheet in `docs/progress/`: tick tasks, set the status line, and add a progress log entry with the date.
- **This overview table:** update the Status column **on `main` only**, when a branch is merged. Editing it on several branches at once causes merge conflicts, because the rows are on neighbouring lines.
- **Known issues:** when a branch fixes an item in [known issues](known-issues.md), move it to Resolved in that same branch.
- **Done means:** every acceptance item on the sheet is checked in a browser (or by a test), and the matching items in the [testing checklist](testing-checklist.md) pass.
- **Branch names:** one feature per branch. If a feature turns out too large, split it into `feature/<name>-part-2` and add a row here.

## Not planned

The following are not on the roadmap. Add a row and a sheet if you decide to build them: CSV import of an existing herd, multi-farm accounts (several users sharing one herd), a mobile app, and email or SMS reminders.

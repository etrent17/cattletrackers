# 01 · Fix dashboard and cattle list

| Branch | Phase | Status | Owner | Depends on |
|---|---|---|---|---|
| `feature/fix-core-views` | 1 | Not started | — | none |

## Goal
The dashboard, the cattle list, and the add/edit/delete/search workflows work in a browser, with icons showing.

## Background
`DashboardView` and `ListView` look up element IDs that `index.html` does not have (`stat-total-cattle` against `stat-total`, `all-cattle-tbody` against `list-body`, and others). `renderStats` throws on the first one, so every `refreshAllViews()` call crashes. As a result:
- After a successful add or edit, the record saves, but an error toast appears and the tables don't update.
- The All Cattle table never renders, so its Delete button is unreachable.

Covers known issues 1, 2, 3, and 12.

## Tasks
- [ ] Decide which side changes: the JS IDs or the HTML IDs. Then make `DashboardView` and `ListView` match `index.html`
- [ ] Dashboard: either add an alerts list to `index.html` or remove the alerts code from `renderEventsAndAlerts`
- [ ] Upcoming events: show only future expected calvings, sorted by date (currently it takes the first three with any date)
- [ ] Show `list-empty` (or the empty-table row) consistently when there are no results
- [ ] Load Font Awesome 6 from `cdnjs.cloudflare.com` (the content security policy already allows cdnjs styles and fonts)
- [ ] Calving-this-month: parse `YYYY-MM-DD` as a local date, not UTC (`CattleService.getStatistics`)
- [ ] Remove the stale `/src/services/StorageService.js` reference, if any, from the service worker; bump `CACHE_NAME`
- [ ] Run the Cattle records and Dashboard sections of the testing checklist

## Acceptance
- [ ] Dashboard shows correct counts, the five most recent cattle, and upcoming calvings
- [ ] Adding a cow updates the dashboard and list with a success toast and no error toast
- [ ] Editing a cow updates both tables
- [ ] All Cattle table renders; Delete removes the row after confirmation
- [ ] Search and status filter narrow the table
- [ ] Calving, Medical, and Breeding views show their filtered lists with the right titles
- [ ] Icons appear on gender, action buttons, and events
- [ ] Known issues 1, 2, 3, 12 moved to Resolved

## Progress log
| Date | Who | Note |
|---|---|---|

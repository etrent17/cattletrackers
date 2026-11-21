# 12 · Performance and health reports

| Branch | Phase | Status | Owner | Depends on |
|---|---|---|---|---|
| `feature/reports` | 2 | Not started | — | 07, 08, 09, 10 |

## Goal
Performance Reports and Health Reports show distinct, useful information built from the records data.

## Background
Both pages show the same three herd statistics (known issue 4). They need the event data from 07 to 10.

## Tasks
- [ ] Performance: herd size over time, calving rate, average calving interval, average daily gain by animal and by group, weaning or sale weights if recorded
- [ ] Health: treatments by type and month, animals currently under treatment or in quarantine, upcoming and overdue treatments, animals within withdrawal periods
- [ ] Date-range selector on both pages
- [ ] Charts (pick one small chart library allowed by the content security policy, or plain SVG)
- [ ] CSV export of each report table
- [ ] Print-friendly layout

## Acceptance
- [ ] Each report page shows different content from the others
- [ ] Figures checked by hand against a small known data set
- [ ] Export opens correctly in a spreadsheet
- [ ] Known issue 4 moved to Resolved

## Progress log
| Date | Who | Note |
|---|---|---|

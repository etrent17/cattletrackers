# 11 · Financial records

| Branch | Phase | Status | Owner | Depends on |
|---|---|---|---|---|
| `feature/financial-records` | 2 | Not started | — | 01, 02 |

## Goal
Record income and expenses, optionally tied to an animal, and see a financial report.

## Background
No financial table, API, or form exists (known issue 5). The Financial Reports page shows herd statistics (part of known issue 4).

## Tasks
- [ ] Table `transactions`: id, owner_id, date, kind (income, expense), category, amount (NUMERIC), cattle_id (optional, set null on delete), description, created_at
- [ ] Default categories: feed, vet and medicine, breeding, equipment, labour, sale of animals, milk, other (editable list later)
- [ ] API: list (with date range), create, update, delete; owner checks
- [ ] Financial page: transactions table, add/edit form, date-range filter
- [ ] Financial Reports page: totals by category, income against expenses by month, net, cost per head
- [ ] Cow details modal: transactions for that animal
- [ ] CSV export of transactions

## Acceptance
- [ ] Totals on the report match the transactions in the selected range
- [ ] Deleting an animal keeps its transactions (no longer linked to it)
- [ ] Amounts are stored and summed exactly (no floating-point drift)
- [ ] Known issue 5 moved to Resolved; Financial Reports part of issue 4 resolved

## Progress log
| Date | Who | Note |
|---|---|---|

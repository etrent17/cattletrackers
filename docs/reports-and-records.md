# Reports and Records

What each number and screen actually means in the current code.

## Dashboard statistics

Computed by `CattleService.getStatistics()` in the browser from the loaded cattle list.

| Statistic | Definition |
|---|---|
| Total Cattle | Number of records |
| Healthy Animals | Records whose status is Healthy |
| Calving This Month | Records whose **expected** calving date falls in the current month. Completed births are not counted |
| Scheduled Treatments | Records whose status is Under Treatment. This is a status count, not a treatment schedule |

## Record views

**Calving Records** is a page of its own. At the top it lists upcoming expected calvings (female or unspecified animals whose expected calving date is today or later, soonest first), each with a Record calving button. Below is the herd's calving history, newest first, with a search box (cow number or name, calf number, notes) and filters for outcome and year. Each cow's own history is on the Calving history tab of her details.

**Medical Records** and **Breeding History** are pages of their own too, built the same way: a herd-wide history with search, plus a list of what needs attention (treatments due or overdue; cows bred more than 35 days ago without a pregnancy check). Each animal's own history is on a tab of its details. **Weights** has a batch-entry form and a herd-wide weighing history. See the [user guide](user-guide.md) for each page.

## Report pages

Performance Reports and Health Reports currently render the same three figures: herd size, healthy percentage, and active treatments. They are placeholders.

Financial Reports shows the figures described below.

## Financial data

Transactions (income or expense, with date, category, amount, optional animal and description) are entered on the Financial Records page and stored in the `transactions` table. Amounts are `NUMERIC(12,2)` and always positive; the type decides the sign.

The Financial Reports page uses `GET /api/transactions/summary` for the chosen period:

| Figure | Definition |
|---|---|
| Income / Expenses | Sum of income / expense amounts dated in the period |
| Net | Income minus expenses |
| Cost per head | Expenses in the period ÷ animals on record now, rounded to the cent; blank with no animals. A current-herd approximation, not an average herd size over the period |
| By month | Income, expenses and net per calendar month with transactions |
| By category | Total and count per type and category |

Sums are computed in SQL on `NUMERIC` values and sent as decimal strings; the browser adds amounts only as whole cents (the records-page cards, the cow details dialog), so no floating-point drift appears.

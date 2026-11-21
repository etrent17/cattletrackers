# Reports and Records

What each number and screen actually means in the current code.

## Dashboard statistics

Computed by `CattleService.getStatistics()` in the browser from the loaded cattle list.

| Statistic | Definition |
|---|---|
| Total Cattle | Number of records |
| Healthy Animals | Records whose status is Healthy |
| Calving This Month | Records whose **expected** calving date falls in the current month. Completed births are not counted |
| Scheduled Treatments | Open treatment follow-ups due within 7 days, including overdue ones. Drawn from `GET /api/treatments/due`, not from `getStatistics()` |

## Record views

**Calving Records** is a page of its own. At the top it lists upcoming expected calvings (female or unspecified animals whose expected calving date is today or later, soonest first), each with a Record calving button. Below is the herd's calving history, newest first, with a search box (cow number or name, calf number, notes) and filters for outcome and year. Each cow's own history is on the Calving history tab of her details.

**Medical Records** and **Breeding History** are pages of their own too, built the same way: a herd-wide history with search, plus a list of what needs attention (treatments due or overdue; cows bred more than 35 days ago without a pregnancy check). Each animal's own history is on a tab of its details. **Weights** has a batch-entry form and a herd-wide weighing history. See the [user guide](user-guide.md) for each page.

## Report pages

The three report pages show different things. Each has a period filter (the same presets as the financial pages), and its figures are computed by the server in SQL; the browser only formats them. Performance and Health share one period, and each of their tables has an Export CSV button. The Print button prints the report without the navigation, filter and buttons.

**Performance Reports** (`GET /api/reports/performance`):

| Figure | Definition |
|---|---|
| Herd size now | Animals on record today |
| Herd size over time | For each month of the period, the animals on record today whose record had been created by the month's end (the current month is counted up to today). Deleted animals are not tracked, and an animal entered late counts from the day it was entered |
| Calvings | Calving records dated in the period, split by outcome and by ease |
| Calving rate | Cows that calved in the period ÷ breeding-age females. A breeding-age female is an animal not marked male that has calved before, or a female aged 15 months or more at the end of the period (a female with no birth date counts) |
| Calving interval | Days from a cow's previous calving to her calving in the period, averaged over all such intervals. Twins born on one day are one calving |
| Daily gain | Per animal: weight change from its first to its last weighing in the period ÷ the days between them (two weighings on different days are needed). By group (females, males, sex not recorded) and for the herd: the average of the animals' daily gains |
| Conception rate | Breedings found pregnant ÷ breedings with a result. A breeding's result is the cow's newest pregnant or open check dated on or after it and before her next breeding |

Weaning and sale weights are not recorded, so the report does not show them; birth weights come from the calving records.

**Health Reports** (`GET /api/reports/health`):

| Figure | Definition |
|---|---|
| Treatments, animals treated | Medical records dated in the period, and the different animals they belong to |
| By type, by month | The same records split by type (treatment, vaccination, vet visit, other) and by calendar month |
| Under treatment, in quarantine | Animals whose status says so today, with their newest medical record |
| In a withdrawal period | Animals whose latest withdrawal date is today or later |
| Overdue and upcoming follow-ups | Open follow-ups (the Medical Records rule): every overdue one, and those due within 30 days |

The last three describe the herd today and do not change with the period. The exact rules, including rounding, are in the [API reference](api.md).

**Financial Reports** shows the figures described below.

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

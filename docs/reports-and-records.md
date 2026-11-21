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

These reuse the cattle table with a filter:

- **Calving Records**: females with a last or expected calving date
- **Medical Records**: animals with medications or a status other than Healthy
- **Breeding History**: animals that are Pregnant or have an expected calving date

They show current field values only. There is no history of past calvings, treatments, or breedings.

## Report pages

Performance Reports, Health Reports, and Financial Reports currently render the same three figures: herd size, healthy percentage, and active treatments. They are placeholders.

## Financial data

Not implemented. There is no financial table, API route, or entry form. Any finance feature would need all three.

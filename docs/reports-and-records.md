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

The other two reuse the cattle table with a filter:

- **Medical Records**: animals with medications or a status other than Healthy
- **Breeding History**: animals that are Pregnant or have an expected calving date

These two show current field values only. There is no history of past treatments or breedings yet.

## Report pages

Performance Reports, Health Reports, and Financial Reports currently render the same three figures: herd size, healthy percentage, and active treatments. They are placeholders.

## Financial data

Not implemented. There is no financial table, API route, or entry form. Any finance feature would need all three.

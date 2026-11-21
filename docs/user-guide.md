# User Guide

Describes the interface as coded at commit `7fb8152`. Several screens are affected by [known issues](known-issues.md); steps marked *untested* have not been run in a browser.

## Signing in

1. Open the app. If you are not signed in you are sent to `/login.html`.
2. On a brand-new install the page asks you to create the admin account: email, a password of at least 10 characters, and a matching confirmation.
3. Afterwards, enter your email and password and choose Sign in. Use Show/Hide to reveal the password.
4. If the server has demo mode enabled, a Try the live demo button also appears.
5. Sign out with the button in the top bar.

## Navigating

The left sidebar switches views: Dashboard, Cattle Records, Calving Records, Weights, Medical Records, Breeding History, Financial Records, three report pages (Performance, Health, Financial), System Settings, and User Management. Only the selected view is shown.

## Adding a cow (untested)

1. Choose Add New Cow on the dashboard.
2. Fill in the form and choose Save Record. Only Cow Number is required.
3. A confirmation toast appears, and the lists refresh.

## Viewing, editing, deleting (untested)

- The eye button opens a details dialog.
- The pencil button reopens the form with the record loaded; saving updates it.
- The trash button, in the All Cattle table only, asks for confirmation and then deletes the record. Deletion cannot be undone.

## Searching and filtering

On Cattle Records, type in the search box to match cow number, name/breed, medications, or notes. Use the dropdown to filter by health status.

## Cattle fields

| Field | Notes |
|---|---|
| Cow Number | Required, up to 25 characters, unique per user (not case-sensitive) |
| Name/Breed | Up to 100 characters |
| Gender | Female or Male; optional, shown as "—" when not recorded |
| Birth Date | Date; age is calculated from it |
| Weight (lbs) | Greater than 0, at most 5000; a weight of 0 is refused. Shows the most recent weighing. Typing a weight for a new animal saves it as its first weighing, dated today; typing a different weight when editing saves a new weighing dated today. Clearing the field does not delete any weighing (delete weighings from the weight history instead) |
| Last Calving Date | Date. For a new cow it is saved as her first calving record. After that it is read-only and always shows her most recent calving record |
| Expected Calving Date | Date. Filled in when a breeding is recorded (see Breeding records); you can still change it |
| Current Medications | Up to 500 characters. A short free-text note of what the animal is on now; dated treatments go in Medical Records |
| Health Status | Healthy, Under Treatment, In Quarantine, or Pregnant |
| Additional Notes | Up to 2000 characters |

## Calving records

Open **Calving Records** in the sidebar, or the **Calving history** tab in a cow's details (the eye button).

- **Record a calving**: click Record Calving (or Record calving beside a cow that is due), choose the cow, and enter the date. Calf sex, calf number, birth weight, calving ease, outcome and notes are optional. Bulls are not offered.
- **Add the calf as a new animal**: tick the box and enter a calf number. The calf joins the herd with that number, the calving date as its birth date, and the sex and birth weight you entered. If the number is already used, nothing is saved.
- **Clear her expected calving date**: offered (and ticked) when the cow has an expected calving date. It removes the date and changes a Pregnant status back to Healthy.
- **Edit or delete** a calving with the buttons on its row. Deleting a calving does not delete the calf's own record.

The cow's Last Calving Date always shows her most recent calving. Deleting a cow deletes her calving records.

## Breeding records

Open **Breeding History** in the sidebar, or the **Breeding** tab in a cow's details (the eye button). Bulls have no Breeding tab.

- **Needs Pregnancy Check** lists cows bred more than 35 days ago with no pregnancy check since that breeding, oldest first. A cow drops off the list once she is checked, rebred, or calves. Click Record check to check her; her breeding is already chosen.
- **Record a breeding**: click Record Breeding, choose the cow and the date. Method (AI or natural), sire, technician and notes are optional. For the sire, pick one of your bulls (animals recorded as male) or leave "Not a bull from the herd" and type a name or straw code, for example for an AI sire. If a bull you picked is later deleted, the breeding still names him.
- **Expected calving date**: the form shows the breeding date + 283 days (the average gestation for cattle; a fixed figure, not a setting). When the breeding is the cow's newest one since her last calving, this date is saved as her Expected Calving Date, replacing what was there. Editing or deleting that breeding moves the date with it, unless you have typed a different date on the cattle form in the meantime: a typed date is kept.
- **Record a pregnancy check**: click Record Pregnancy Check (or Record check beside a cow), choose the cow, the date and the result: Pregnant, Open (not pregnant) or Unsure. Method and notes are optional, and the check can be linked to one of her breedings (her newest breeding on or before the check date is chosen for you).
- **What a check changes**, when it is the cow's latest check since her current breeding:
  - **Pregnant** changes a Healthy status to Pregnant, and fills in the expected calving date from her breeding if it is empty. Under Treatment and In Quarantine are left as they are.
  - **Open** clears her expected calving date and changes Pregnant back to Healthy.
  - **Unsure** changes nothing.
- Deleting a check does not change her health status. If the deleted check was Open, her expected calving date comes back from her breeding.
- When you record her calving with "Clear her expected calving date" ticked, the date and Pregnant status are cleared and her older breedings no longer set the date.
- **Edit or delete** breedings and checks with the buttons on their rows. Deleting a breeding keeps its checks. The search box narrows both tables by cow, sire, technician or notes.

Deleting a cow deletes her breedings and pregnancy checks.

## Weights

Open **Weights** in the sidebar, or the **Weight history** tab in an animal's details (the eye button). Weights are in pounds (lbs).

- **Record weights for several animals at once**: in Record Weights, set the weighing date (today by default), then pick an animal and type its weight on each row. Add Row adds a row; Add All Animals adds a row for every animal not listed yet. Rows left empty are skipped. Choose Save Weights: every row that can be saved is saved, and the rows that can't (no animal, a weight of 0 or over 5000, the same animal twice) stay in the form with the reason in red, so you can fix them and save again. The line under the form says how many were saved.
- **Record one weight**: Record One Weight on the Weights page, or Record weight in the animal's Weight history tab.
- **Weight history** on the Weights page lists every weighing, newest first, with the change since that animal's previous weighing and the average daily gain over those days. Search by cow number, name or notes.
- **The Weight history tab** shows the current weight, the number of weighings, the average daily gain (ADG) from the first to the last weighing, a chart of weight over time (hover a point to see its value), and each weighing with its change since the one before.
- **Edit or delete** a weighing with the buttons on its row.

An animal's weight is always its most recent weighing (latest date; for two on the same date, the one recorded last). Recording an older weighing adds history without changing it, and deleting the latest weighing brings back the previous one. Deleting an animal deletes its weighings.

Average daily gain is the weight change divided by the number of days between two weighings, in lbs/day; a loss shows as a negative number. Two weighings on the same day have no daily rate.

## Medical records

Open **Medical Records** in the sidebar, or the **Treatments** tab in an animal's details (the eye button).

- **Record a treatment**: click Record Treatment (or Record treatment on the Treatments tab), choose the animal, the date given (today by default, not in the future) and the type: Treatment, Vaccination, Vet visit or Other. Product, dose, route, given by, next due date, withdrawal date and notes are optional. Products you used before and common routes are suggested as you type.
- **Next due date**: set it for a booster or follow-up; it must be after the date given. The treatment then appears under **Upcoming and Overdue**, soonest first, marked "3 days overdue", "Due today", "Due tomorrow" or "Due in N days".
- **Record follow-up** beside an upcoming treatment opens the form with the same animal, type, product, dose, route and person, dated today. Saving it (with its own next due date if there is another one) removes the earlier one from Upcoming; in the history that row's Next Due shows "Done". Any later treatment of the same animal with the same type and product counts as the follow-up, however it is recorded. To drop a follow-up without recording one, edit the treatment and clear its next due date.
- **Withdrawal until**: the last day the animal's meat or milk must not be used, from the product label. Until that day has passed, the animal shows a red "Withdrawal until" badge in the dashboard and cattle tables, in its details, and under **Withdrawal Periods** on the Medical Records page. With several treatments, the latest withdrawal date counts.
- **Edit or delete** a treatment with the buttons on its row. Search the history by animal, product, given by or notes, and filter it by type.

On the dashboard, **Scheduled Treatments** counts open follow-ups due within the next 7 days, overdue ones included (the line under the number says how many are overdue). Each overdue follow-up is also listed under **Alerts**; View opens the animal's Treatments tab.

Deleting an animal deletes its treatments. The animal's Current Medications field is separate free text and is not changed by treatments. Demo accounts start with sample treatments, including an overdue vaccination, follow-ups due this week, and two animals in a withdrawal period.

## Settings and password

System Settings shows the email you are signed in with, your role (Administrator or User), and whether this is a demo account.

To change your password, enter your current password, then the new password (10 to 128 characters) twice, and choose Change password. You stay signed in on this device; any other browser or device signed in to your account is signed out and needs the new password. After 10 attempts within 15 minutes the form asks you to wait. Demo accounts cannot change their password.

The app keeps its own pages and scripts in your browser after a visit, but cattle records are kept on the server. Signing in and viewing or changing records need a connection; without one the app says it can't reach the server and offers Retry.

## Financial records

Open **Financial Records** under Cattle Management.

- **Period** picks the dates shown: Last 12 months (the default: this month and the 11 before it), This month, This year, Last year, All time, or Custom range. Changing From or To switches to a custom range. The period is shared with the Financial Reports page.
- **Animal** narrows the list to one animal's transactions.
- The cards show income, expenses, net (income minus expenses) and the number of transactions in the list.
- **Add Transaction** opens a form: date (today by default), type (Expense or Income), category, amount, an optional animal, and a description. Pick a suggested category (Feed, Vet and medicine, Breeding, Equipment, Labour, Sale of animals, Milk, Other) or type your own, up to 50 characters. Amounts are in dollars, greater than 0, with at most two decimal places (for example `125.50`). Always enter a positive amount; the type decides whether it counts as money in or out.
- The pencil button edits a transaction; the trash button deletes it after confirmation.
- **Export CSV** downloads the transactions currently listed (same period and animal) as a CSV file with the columns Date, Type, Category, Amount, Animal, Description. Text that starts with `=`, `+`, `-` or `@` is written with a leading `'` so spreadsheet programs show it as text instead of running it as a formula.

Deleting an animal keeps its transactions; they simply no longer name the animal.

The cow details dialog (eye button) lists the transactions linked to that animal, with its income, expenses and net.

## Financial reports

Open **Financial Reports** under Reports and pick a period, as on the records page. The page shows:

| Figure | Meaning |
|---|---|
| Income, Expenses | Totals of the transactions dated in the period |
| Net | Income minus expenses |
| Cost per head | Expenses in the period divided by the number of animals on record today, rounded to the cent. It does not average the herd size over the period; "—" when you have no animals |
| By month | Income, expenses and net for each month that has transactions, with bars for comparison |
| By category | Totals per category for income and for expenses, with each category's share |

All amounts are added exactly, to the cent.

## Performance reports

Open **Performance Reports** under Reports. Pick a period as on the financial pages (Last 12 months to begin with); the period is shared with Health Reports. The page shows:

| Figure | Meaning |
|---|---|
| Herd size now | The animals on record today, with how many are female and male |
| Herd size over time | A chart and table of the herd at the end of each month of the period. An animal counts from the day its record was created, and animals you have deleted are not counted in any month |
| Calvings | The calvings recorded in the period, split into alive and stillborn and by calving ease |
| Calving rate | The cows that calved in the period as a share of your breeding-age females: animals not marked male that have calved before, or females aged 15 months or more (a female with no birth date counts) |
| Calving interval | The average number of days between a cow's previous calving and her calving in the period |
| Daily gain | For each animal weighed on two or more days in the period: the weight change from its first to its last weighing, divided by the days between. Also averaged for females, males and the whole herd |
| Conception rate | Of the breedings in the period that were followed by a pregnant or open check, the share found pregnant |

A figure shows "—" when there is nothing to measure it from, for example a calving interval when no cow has calved twice. The notes at the foot of the page repeat these definitions.

## Health reports

Open **Health Reports** under Reports. The cards and the first two tables cover the chosen period:

- **Treatments by type** and **by month**: how many treatments, vaccinations, vet visits and other medical records were dated in the period, and how many animals they involved.

The other three tables show the herd as it is today, whatever the period:

- **Under treatment or in quarantine**: animals with that status, their current medications and their newest medical record.
- **In a withdrawal period**: animals whose withdrawal date is today or later, the one ending first at the top.
- **Overdue and upcoming follow-ups**: treatments whose next due date has passed, or falls within 30 days, and that no later treatment has replaced.

## Exporting and printing a report

Each table on the Performance and Health pages has an **Export CSV** button; the file holds the same rows as the table and opens in a spreadsheet. **Print** prints the page without the menu, the filter and the buttons, with the period written at the top.

## Demo accounts

A demo session lasts four hours, starts with eight sample animals, their calving, breeding and pregnancy-check history, and twelve sample transactions from the past five months, and is limited to 25 animals and 200 transactions. Demo data is deleted automatically.

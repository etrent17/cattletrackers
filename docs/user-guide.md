# User Guide

Describes the interface as coded at commit `7fb8152`. Several screens are affected by [known issues](known-issues.md); steps marked *untested* have not been run in a browser.

## Signing in

1. Open the app. If you are not signed in you are sent to `/login.html`.
2. On a brand-new install the page asks you to create the admin account: email, a password of at least 10 characters, and a matching confirmation.
3. Afterwards, enter your email and password and choose Sign in. Use Show/Hide to reveal the password.
4. If the server has demo mode enabled, a Try the live demo button also appears.
5. Sign out with the button in the top bar.

## Navigating

The left sidebar switches views: Dashboard, Cattle Records, Calving Records, Medical Records, Breeding History, Financial Records, three report pages, System Settings, and User Management. Only the selected view is shown.

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
| Weight (lbs) | Greater than 0, at most 5000 |
| Last Calving Date | Date. For a new cow it is saved as her first calving record. After that it is read-only and always shows her most recent calving record |
| Expected Calving Date | Date |
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

## Demo accounts

A demo session lasts four hours, starts with eight sample animals and twelve sample transactions from the past five months, and is limited to 25 animals and 200 transactions. Demo data is deleted automatically.

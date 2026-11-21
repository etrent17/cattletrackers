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
| Expected Calving Date | Date. Filled in when a breeding is recorded (see Breeding records); you can still change it |
| Current Medications | Up to 500 characters |
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

A demo session lasts four hours, starts with eight sample animals, their calving, breeding and pregnancy-check history, and twelve sample transactions from the past five months, and is limited to 25 animals and 200 transactions. Demo data is deleted automatically.

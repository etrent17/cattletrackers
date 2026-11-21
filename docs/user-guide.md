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
| Last Calving Date | Date |
| Expected Calving Date | Date |
| Current Medications | Up to 500 characters |
| Health Status | Healthy, Under Treatment, In Quarantine, or Pregnant |
| Additional Notes | Up to 2000 characters |

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

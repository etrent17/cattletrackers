# User Guide

Describes the interface as coded at commit `7fb8152`. Several screens are affected by [known issues](known-issues.md); steps marked *untested* have not been run in a browser.

## Signing in

1. Open the app. If you are not signed in you are sent to `/login.html`.
2. On a brand-new install the page asks you to create the admin account: email, a password of at least 10 characters, and a matching confirmation.
3. Afterwards, enter your email and password and choose Sign in. Use Show/Hide to reveal the password.
4. If the server has demo mode enabled, a Try the live demo button also appears.
5. Sign out with the button in the top bar.

## Navigating

The left sidebar switches views: Dashboard, Cattle Records, Calving Records, Medical Records, Breeding History, three report pages, System Settings, and User Management. Only the selected view is shown.

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

## Demo accounts

A demo session lasts four hours, starts with eight sample animals, and is limited to 25 animals. Demo data is deleted automatically.

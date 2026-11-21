# Testing Checklist

Manual acceptance tests. Tick a box only after running the step. Record the commit and date beside any failure.

## Automated tests

Many of the checks below are also covered by automated tests; run them before working through the manual list.

- `npm test`: unit tests (validators, date helpers, statistics, search) and API tests (setup, login and logout, cattle create/read/update/delete, duplicate cow numbers, validation, owner isolation, admin-only users API, rate limit). Needs `TEST_DATABASE_URL` pointing at a database that can be wiped.
- `npm run test:e2e`: browser smoke test (set up, sign out, sign in, add a cow, see it on the dashboard and list, reload, delete it).

See "Running the tests" in the [README](../README.md). The automated tests do not cover demo-mode screens, edit and view dialogs, search and filters in the browser, the secondary views, or phone layout. Offline behaviour is covered by `e2e/offline.e2e.js`, against a local stand-in for the CDNs rather than the real ones.

## Accounts
- [ ] Fresh install shows the setup form; admin account is created
- [ ] Setup is refused once a user exists
- [ ] Login with wrong password shows an error
- [ ] Login, reload, and the session persists
- [ ] Sign out returns to the login page
- [ ] Demo button appears only when `DEMO_MODE=true`
- [ ] Demo session loads eight animals and blocks the 26th

## Cattle records
- [ ] Add Cow opens the modal
- [ ] Save with only a cow number succeeds
- [ ] Reload: the record persists
- [ ] Duplicate cow number (different case) is rejected
- [ ] Invalid weight (0, 6000) is rejected
- [ ] Edit changes a record and persists after reload
- [ ] View dialog shows all fields
- [ ] Delete removes a record after confirmation
- [ ] Search matches number, name, medications, and notes
- [ ] Status filter returns the right animals

## Navigation and display
- [ ] Only one view is visible at a time
- [ ] Dashboard cards show correct counts
- [ ] Recent table, events, and alerts render
- [ ] All Cattle table renders
- [ ] Medical and Breeding views filter correctly
- [ ] Calving Records: record a calving, see it on the page and in the cow's Calving history tab; her last calving date updates; "Add the calf as a new animal" creates the calf
- [ ] Icons display
- [ ] Layout is usable on a phone-width screen

## Reports and settings
- [ ] Performance, Health and Financial Reports each show their own figures; changing the period updates them
- [ ] Export CSV on a report table opens in a spreadsheet; Print shows the report without the menu and buttons
- [ ] Settings text matches real behavior

## Permissions
- [ ] A regular user gets 403 from `/api/users`
- [ ] User A cannot read or change user B's cattle
- [ ] Admin cannot delete themselves

## Failure handling
- [ ] Stopping the server shows a clear message
- [ ] Expired session redirects to login
- [ ] The app opens offline (HTTPS or localhost) and shows the saved herd; the top bar says Offline
- [ ] A cow added or edited offline syncs after reconnecting; a conflicting edit appears under Review with the server's version on screen
- [ ] Signing out removes the saved herd

# Testing Checklist

Manual acceptance tests. Tick a box only after running the step. Record the commit and date beside any failure.

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
- [ ] Calving, Medical, and Breeding views filter correctly
- [ ] Icons display
- [ ] Layout is usable on a phone-width screen

## Reports and settings
- [ ] Confirm each report page is still a placeholder
- [ ] Settings text matches real behavior

## Permissions
- [ ] A regular user gets 403 from `/api/users`
- [ ] User A cannot read or change user B's cattle
- [ ] Admin cannot delete themselves

## Failure handling
- [ ] Stopping the server shows a clear message
- [ ] Expired session redirects to login
- [ ] Cached pages load offline; cattle data does not

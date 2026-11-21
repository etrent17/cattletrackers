# Cattle Trackers

Cattle Trackers is a livestock management web application: an Express server, a PostgreSQL database, a REST API, and a Bootstrap-based browser interface written as ES modules.

> **Status: early prototype.** These docs describe the source at commit `7fb8152`. Nothing has been verified by browser testing yet. Read [known issues](docs/known-issues.md) before relying on any workflow.

## What exists today

- Admin account setup, login, logout, and an optional temporary demo mode
- Per-user cattle records: add, view, edit, delete, search, and filter by health status
- A dashboard, plus calving, medical, and breeding views that filter the cattle list
- An admin-only user-management API
- A Docker-based installer

## What does not exist yet

- Financial records of any kind
- Distinct performance, health, or financial reports (those screens are placeholders)
- A user-management screen
- Offline editing of cattle data
- Automated tests

## Quick start

Requires Docker with Compose v2 and openssl.

```
./install.sh
```

Open the printed URL and create the first admin account. See [deployment](docs/deployment.md) for details and manual setup.

## Documentation

- [Feature inventory](docs/feature-inventory.md)
- [User guide](docs/user-guide.md)
- [Reports and records](docs/reports-and-records.md)
- [Authentication and users](docs/authentication-and-users.md)
- [Architecture and data](docs/architecture-and-data.md)
- [API reference](docs/api.md)
- [Deployment](docs/deployment.md)
- [Known issues](docs/known-issues.md)
- [Testing checklist](docs/testing-checklist.md)

## Original roadmap

- refactor the code for ease of testing & reading
- working prototype
- function login/password handling
- consider performance with pure js over other options

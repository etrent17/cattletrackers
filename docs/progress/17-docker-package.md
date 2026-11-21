# 17 · Docker image package

| Branch | Phase | Status | Owner | Depends on |
|---|---|---|---|---|
| `feature/docker-package` | 3 | In review | Claude (lead) | 13 |

## Goal
A ready-to-run Docker image in GitHub Packages, so the app can be tested on a dev Docker host without building it from source.

## Background
Requested on 2026-11-21 to test the integrated app on a dev Docker host. The Dockerfile from feature 13 had never been built, because the development environment has no Docker daemon; building it in CI also tests it.

## Tasks
- [x] GitHub Actions workflow: build, smoke test against PostgreSQL (health, demo mode, demo herd), publish to `ghcr.io/etrent17/cattletrackers`
- [x] Tags: `dev` (integration branch), `latest` (`main`), `sha-<commit>`
- [x] Multi-architecture: `linux/amd64` and `linux/arm64` (argon2 ships musl builds for both)
- [x] Standalone compose file for a dev host: `deploy/docker-compose.dev.yml`
- [x] Document it in `docs/deployment.md`, including package access
- [x] `deploy/start.sh`: one command that creates `.env`, picks a free host port, starts the stack, waits for health and prints the address
- [x] App falls back to the next free port when `PORT` is taken; clear message when started without a database
- [x] First workflow run passes and the image is published
- [ ] Image pulled and run on the dev Docker host

## Acceptance
- [ ] `docker compose -f docker-compose.dev.yml up -d` on a dev host starts the app and the demo works
- [x] A push to the integration branch publishes a new `dev` image

## Progress log
| Date | Who | Note |
|---|---|---|
| 2026-11-21 | Claude | Workflow, dev compose file and docs added. Workflow YAML parsed and the compose file validated with `docker compose config`; no Docker daemon here, so the image build itself is checked by the first CI run. |
| 2026-11-21 | Claude | First run passed (run 44950733095): image built, smoke test passed (health, demo mode, demo herd), published `dev` and `sha-e1bb745` for amd64 and arm64. The package is public: an anonymous pull of `:dev` works. |
| 2026-11-21 | Claude | Reported: the package wouldn't start and should find an open port. Reproduced with a local Docker engine: a taken host port, a missing `.env`, and `docker run` without PostgreSQL each failed with unclear errors. Added `deploy/start.sh` (secrets, free port picked and saved, health wait, address printed), next-free-port fallback in `server.js` (`lib/listen.js`, unit-tested), and a clear message when the database settings are missing. Tested with Docker: 3036 taken gave 3037; rerun kept 3037; with 3037 taken after a stop it moved to 3038 and updated `.env`; demo login and all feature APIs answered. |

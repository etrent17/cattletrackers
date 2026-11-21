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
- [ ] First workflow run passes and the image is published
- [ ] Image pulled and run on the dev Docker host

## Acceptance
- [ ] `docker compose -f docker-compose.dev.yml up -d` on a dev host starts the app and the demo works
- [ ] A push to the integration branch publishes a new `dev` image

## Progress log
| Date | Who | Note |
|---|---|---|
| 2026-11-21 | Claude | Workflow, dev compose file and docs added. Workflow YAML parsed and the compose file validated with `docker compose config`; no Docker daemon here, so the image build itself is checked by the first CI run. |

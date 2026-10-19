# Project Overview — EverShop

- **Project:** EverShop (`evershop` v2.2.1)
- **Oriented:** 2026-10-18
- **Source revision:** `8280a9a0035aca185c9e9d50b729d5da85e9be9b` (LOCAL TEST BUILD — not clean source; rebuilt from clean commit `8280a9a` before general distribution)
- **Workspace:** `/home/peet/Projects/post-integration-delivery/`
- **Coverage:** Workspace structure, key packages (`packages/evershop/`, `packages/postgres-query-builder/`, `packages/create-evershop-app/`), build/test scripts, Docker setup
- **Exclusions (current session):** `.env` (not read), `data/` (not read), PostgreSQL database (no access), package lock modifications, EverShop app startup
- **Future needs (not yet authorized):** PostgreSQL connection, `.env` access, database inspection, application startup, package dependency installation/modification

## Stack and workspace layout

Languages/frameworks: TypeScript, Express, React, GraphQL, PostgreSQL (`packages/postgres-query-builder`). Workspace uses Yarn workspaces (`workspaces: ["packages/*", "extensions/*"]`).

Concise directory map:
- `AgenticLab/` — V5 payload (AGENTS.md, brain/, prompts/, adapters/pi/, knowledge/)
- `packages/evershop/src/` — core application source
- `packages/postgres-query-builder/src/` — PostgreSQL query builder
- `packages/create-evershop-app/` — scaffolding package
- `tests/e2e/` — Playwright E2E tests (storefront, admin, pageBuilder)
- `docker/docker-compose.yml` — Docker setup (database service on port 5432, app service on port 3000)

## Starting points and key flows

- Application entry/development: `packages/evershop/src/` (see `README.md` documentation links for full docs)
- Build/test: `package.json` scripts (`dev`, `start`, `build`, `setup`, `seed`, `user:create`)
- E2E tests: `tests/e2e/` (storefront, admin, pageBuilder)
- Database: Docker Compose (`database` service, `postgres:16` image, port 5432, volume `postgres-data`)
- Docker file: `docker/Dockerfile`

## Build and test approach

Commands/configuration found in source (inspected, not run):
- `npm run dev` / `npm run start` / `npm run build`
- `npm run setup` (`evershop install`)
- `npm run seed` (`evershop seed`)
- Playwright E2E harness in `tests/e2e/`

Safety constraints verified: clean source (`clean-evershop-dev/`) untouched; this workspace (`post-integration-delivery/`) is a separate test workspace; `.env`, database, full E2E suite not accessed in initialization scope.

## Known unknowns

- `.env` contents not inspected (will be needed for PostgreSQL connection)
- PostgreSQL database (`database` service in `docker-compose.yml`) not connected; DB_HOST=`database`, DB_PORT=`5432`, DB_USER=`postgres`, DB_PASSWORD=`postgres`, DB_NAME=`postgres`
- Full application build/test not executed
- Full dependency installation not performed (no `node_modules/` inspection or package lock changes)
- AgenticLab payload (`AgenticLab/`) installed but `.pi/` wiring and initialization not complete until user approves setup

## Sources

- `AgenticLab/README.md` (installed payload documentation, source revision `LOCAL TEST BUILD`)
- `AgenticLab/AGENTS.md` (operating contract)
- `AgenticLab/brain/operating-contract.md`, `brain/knowledge-contract.md` (V5 contracts)
- `README.md` (project introduction, documentation links)
- `package.json` (scripts, workspaces, dependencies)
- `docker-compose.yml` (service definitions, ports, volumes)
- Workspace directory listing (`find` results: `packages/`, `tests/`, `docker/`, `translations/`, etc.)

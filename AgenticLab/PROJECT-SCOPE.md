# Project Scope

- **Project:** EverShop (`evershop` v2.2.1) — Post-integration-delivery workspace
- **Type:** Disposable EverShop workspace for AgenticLab V5 payload delivery and integration testing.
- **Workspace:** `/home/peet/Projects/post-integration-delivery/`
- **Objective:** Integrate validated AgenticLab V5 knowledge-capture payload, test payload functionality, and prepare for delivery-phase testing (including database access when separately authorized).
- **Application scope:** EverShop core in this disposable workspace, for bounded, read-only orientation during initialization.

## Boundaries

- `/home/peet/Projects/clean-evershop-dev/` is the designated copy source. Do not modify, install into, rename, or delete it. An explicitly approved copy operation may access it; no copy operation is part of this initialization.
- Do not read `.env`, root `data/`, secrets, backups, production/customer data, dependencies, generated output, or databases.
- Do not run the application, tests, installs, PostgreSQL, migrations, or other application commands.
- Do not alter application source or package files. This pilot setup is not authorization for EverShop feature work; any later request to change application files requires separate explicit authorization.
- This initialization may prepare only `AgenticLab/PROJECT-SCOPE.md`, `AgenticLab/PROJECT-OVERVIEW.md`, `.pi/settings.json`, and `.pi/APPEND_SYSTEM.md`, and only after the user approves the exact preview.
- Do not create or modify a workspace-root `AGENTS.md`, global Pi configuration, V4 knowledge, or V5 knowledge records as part of initialization.

## Post-integration-delivery workspace policy

- Metrics collection (`metricsEnabled: true`) is opt-in and enabled for this workspace via `AgenticLab/knowledge-capture-policy.json`. Aggregate events (staging, promotion, retrieval, confirmation outcomes) are written to `.pi/metrics/agenticlab.jsonl`; no raw user content is recorded.
- Pending candidates are not active and are not used as approved knowledge. Promotion is permitted only as one batch explicitly approved by the user.
- Jev is advisory only and cannot authorize, activate, or delete items.
- Any access to `.env`, PostgreSQL, `data/`, or application startup requires separate explicit authorization.

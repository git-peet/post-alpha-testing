# AgenticLab V5 System Payload

This directory contains the small, distributable V5 system surface. It is separate from the development roadmap, candidate backlog, evaluation history, and `DEV-LOG.md`; those developer artifacts must not be copied into a project installation.

## Contents

- `AGENTS.md` — shared operating instructions; the host workspace's trusted `.pi/APPEND_SYSTEM.md` points here and to the project scope/profile, keeping AgenticLab integration under `.pi/` rather than adding a root instruction file.
- `brain/` — portable operating and knowledge contracts.
- `prompts/system/initialize-workspace.md` — first-use initialization/orientation prompt. It is invoked directly by the user from a fresh payload before `.pi/` wiring exists; it is never auto-run.
- `prompts/delivery/` — opt-in, user-invoked workflow prompt prototypes (`plan.md`, `implement.md`, `premortem.md`). First-use initialization registers these paths in project-local `.pi/settings.json` as `/plan`, `/implement`, and `/premortem`; registration makes them available but never runs them automatically. `pi --prompt-template AgenticLab/prompts/delivery/<name>.md` remains a one-session fallback when a prompt is not registered.
- `adapters/pi/` — the optional Pi workspace integration. `adapters/pi/tests/` contains development-only policy tests and is not copied into the host snapshot.

## Manual first installation (experimental)

This is a documented manual path for a **new delivery workspace**. It is not an installer or update procedure.

1. **Choose a source snapshot.** Use a named, clean V5 source commit and confirm that the `system/` payload files match it. Record the full commit hash. Do not package the whole `AgenticLab-v5/` development repository.
2. **Preflight the target workspace.** Confirm the intended workspace root. If `<workspace>/AgenticLab/` already exists, stop; do not overwrite or reset it. Inspect only `AgenticLab/` and the setup paths `.pi/settings.json` and `.pi/APPEND_SYSTEM.md` for collision checking. `.pi/` may be absent on first use. Preserve any existing `.pi` content and stop if a safe merge is unclear. The initialization prompt will confirm project identity/scope before reading project sources. Do not create, replace, move, or scaffold application files/directories at the workspace root (for example `src/`, `tests/`, project manifests, or root `AGENTS.md`); those belong to the host.
3. **Copy the runtime payload** from the selected `system/` snapshot into `<workspace>/AgenticLab/`:
   - `AGENTS.md`, `README.md`, and `brain/`
   - runtime files under `adapters/pi/`, excluding development-only `adapters/pi/tests/`
   - `prompts/system/initialize-workspace.md` (loaded only because the user directly asks Pi to read/follow it; it does not run automatically)
   - `prompts/delivery/` (initialization registers the available workflows as opt-in slash commands; they are never auto-run)
   - exclude the V5 backlog, development logs, and other development-only material

   Write the full source commit hash to `AgenticLab/SOURCE-REVISION.txt` only after verifying the staged payload against that source commit. Do not use a live symlink.
4. **Run first-use initialization from Pi.** Start Pi from the delivery workspace root. Directly ask it to read/follow `AgenticLab/prompts/system/initialize-workspace.md`; this first invocation does not depend on `.pi/` or a pre-registered slash command. The prompt confirms scope and safe read paths, performs a bounded read-only orientation, and previews the proposed `AgenticLab/PROJECT-SCOPE.md`, `AgenticLab/PROJECT-OVERVIEW.md`, and local `.pi/` wiring together. It writes none of these until you approve the exact preview. It does not seed V5 knowledge records or change the host application.
5. **Activate and verify Pi locally.** After approved local setup, restart Pi from the workspace root and grant project trust. Confirm that `AGENTS.md` instructions, the project-local knowledge-write extension, and `/initialize-workspace`, `/plan`, `/implement`, and `/premortem` are available. Registration does not run any prompt automatically. If trust is declined or the extension is unavailable, report the limitation and do not persist V5 knowledge by another route. This procedure does not require launching the target app or running its tests.

Pi's project `.pi/APPEND_SYSTEM.md` is trusted instruction context, not a security boundary; project resources load only when trust is granted. Pi extensions are executable code and run with the permissions of the Pi process. Do not claim a hard guarantee beyond the host adapter's verified behavior.

## Refresh boundary

This first-install procedure does not refresh an existing `AgenticLab/` copy. Before a future refresh, compare it with its recorded source commit, preview every changed path, preserve project scope/knowledge and host-owned instructions/settings, and stop on any local divergence or unclear ownership. Do not delete unknown or obsolete files automatically. Reset/deletion is a separate operation requiring its own scope and approval.

This remains an experimental V5 slice, not a complete adapter framework, installer, or security sandbox. See `brain/knowledge-contract.md` and the adapter source before making claims about memory approval or shell protection.

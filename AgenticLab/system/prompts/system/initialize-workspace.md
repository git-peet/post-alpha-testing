---
description: "Initialize AgenticLab in this workspace once: confirm scope, orient the codebase, and prepare local Pi wiring."
argument-hint: "[optional project or subproject focus]"
---

# First-use Workspace Initialization

This is a one-time, user-invoked setup and orientation flow for the current workspace. It is not a normal session-start action and must never run automatically on later Pi starts.

The user may invoke this file before project `.pi/` settings exist by asking Pi to read and follow `AgenticLab/prompts/system/initialize-workspace.md`. The initial invocation does not depend on a registered slash command. During approved setup, project-local Pi settings register this template as `/initialize-workspace` for explicit future refreshes and the payload's delivery prompts as `/plan`, `/implement`, and `/premortem`. Registration makes those workflows available; it does not run them.

## Purpose and boundaries

Prepare three distinct things:

1. **Project scope** — user-confirmed project/subproject identity and boundaries in `AgenticLab/PROJECT-SCOPE.md`.
2. **AgenticLab/Pi integration** — project-local `.pi/settings.json` and `.pi/APPEND_SYSTEM.md`; never create or edit a workspace-root `AGENTS.md` or global Pi configuration.
3. **Project orientation profile** — a concise, source-cited `AgenticLab/PROJECT-OVERVIEW.md`, separate from both scope and the V5 knowledge-record interface.

This flow does not install or refresh the AgenticLab payload, run the application/tests, seed V5 memory records, import V4 knowledge, or build Graphify, semantic maps, symbol indexes, or a DIGEST. It does not create or update files in the host application's paths. Do not access `.env`, secrets, protected `data/`, backups, production/customer data, dependencies, generated output, databases, or the network unless a separate task explicitly authorizes an exact path/action. Do not use shell for project discovery by default.

The user explicitly invoked setup, but that is **not** blanket approval for file writes. Inspect and orient only after scope is confirmed. Show all proposed persistent changes together, then wait for one explicit approval before writing any of them. If the user rejects or edits the preview, apply nothing until a revised complete preview is accepted.

## Step 0 — Load the applicable V5 contracts

Read, if present:

- `AgenticLab/AGENTS.md`
- `AgenticLab/brain/operating-contract.md`
- `AgenticLab/brain/knowledge-contract.md`
- `AgenticLab/PROJECT-SCOPE.md`

The first three files are part of the dropped V5 payload. Do not assume Pi discovered them automatically: the workspace may not have `.pi/APPEND_SYSTEM.md` yet. If a required V5 contract file is missing or appears to be a partial/unknown payload, report that and stop rather than inventing its rules.

## Step 1 — Inspect only known setup paths

Inspect only these paths to determine whether initialization is new, partial, or already complete:

- `AgenticLab/SOURCE-REVISION.txt`
- `AgenticLab/AGENTS.md`
- `AgenticLab/PROJECT-SCOPE.md`
- `AgenticLab/PROJECT-OVERVIEW.md`
- `.pi/settings.json`
- `.pi/APPEND_SYSTEM.md`

Do not list or inspect host application files during this setup preflight. Do not create, replace, move, or scaffold generic workspace-root paths such as `src/`, `tests/`, `package.json`, or a root `AGENTS.md`.

Classify the state:

- **Payload only:** AgenticLab exists but scope/profile/local Pi wiring are absent or incomplete. This is the normal first-run case.
- **Partially initialized:** one or more target-owned setup files already exist. Preserve them; identify only the missing pieces and conflicts.
- **Already initialized:** both scope and overview exist. Do not rescan or overwrite. Report that initialization appears complete; offer a separately requested, source-bounded refresh only if the user asks.

If `AgenticLab/` is absent, stop: this prompt must be explicitly read from an already-dropped payload. If `SOURCE-REVISION.txt` is absent/ambiguous, report provenance as unknown and ask whether to continue; do not invent a revision. If it explicitly identifies a local/dirty draft snapshot, state that it is not a reproducible release and ask whether the user wants to proceed with this test build.

## Step 2 — Confirm project identity and scope before source inspection

If `PROJECT-SCOPE.md` exists, read it and ask only focused questions about missing or conflicting scope. Preserve existing scope text unless the user explicitly approves a change.

If it does not exist, ask for one concise response establishing:

- project name/type or the user's preferred identity;
- which application/repository/subproject the orientation should cover;
- any paths or data that must not be read;
- whether any execution is allowed (default: **read-only inspection only; no app/tests/commands**).

A project name inferred from a folder is a suggestion, not user confirmation. Do not inspect source to infer authorization or decide which project paths are safe. If the task covers a monorepo, ask for or propose a bounded scope before scanning.

State the intended inspection boundary and exclusions back to the user. If there is unresolved ambiguity about protected data, ask before proceeding.

## Step 3 — Make a bounded read-only orientation

After scope is confirmed, inspect only sources needed to create a compact navigation profile. Prefer direct, known files and available native read-only tools. Use the confirmed scope to choose paths; do not recursively inventory the entire workspace by default.

Likely useful sources, only when within the confirmed scope:

- README/contributor/architecture documentation;
- package/workspace manifests and language/framework configuration;
- limited top-level structure for approved application paths;
- entry points named by project documentation or manifests;
- representative tests and test-runner configuration to identify layout/conventions;
- CI/build configuration only when useful to understand the project workflow.

Do not execute scripts found in manifests. Do not install dependencies, start services, run migrations, or run tests. Do not read any excluded/protected files. If you lack safe listing/search tools, ask for known paths or permission for one exact, path-limited, read-only listing command; do not substitute a broader command. If the source surface is too large for the agreed pass, stop with a partial-coverage report and offer a narrower follow-up.

For every material claim, distinguish source-verified fact from inference or unknown and retain supporting file paths. A profile is a useful map, not an exhaustive inventory or current truth for every future task.

## Step 4 — Draft the project orientation profile

Draft `AgenticLab/PROJECT-OVERVIEW.md` with only useful, verified orientation material. Suggested structure:

```markdown
# Project Overview

- **Project:** [user-confirmed identity]
- **Oriented:** [date]
- **Source revision:** [current commit if safely available; otherwise explain]
- **Coverage:** [areas inspected and important exclusions]

## Stack and workspace layout
[Languages/frameworks, packages/apps, concise directory map]

## Starting points and key flows
[Important entry points and a small number of useful source paths]

## Build and test approach
[Commands/configuration found in source; explicitly mark as inspected, not run]
[Known test-isolation or safety constraints, if verified]

## Known unknowns
[Material areas not inspected or facts needing confirmation]

## Sources
[Paths supporting the summary]
```

Do not set an arbitrary token limit; make it compact enough to be read in a fresh session. Do not copy scope rules into it as authority, duplicate decision rationale from records, or populate V4 persona memories, `SYSTEM_CORE.md`, DIGEST, Graphify, symbol/semantic indexes, or experience records. If a durable non-source-derived decision is uncovered, report it separately as a candidate for the future knowledge interface; do not save it here.

## Step 5 — Prepare local Pi wiring

Prepare `.pi/settings.json` by preserving all existing keys and adding only missing AgenticLab resources:

```json
{
  "extensions": ["../AgenticLab/adapters/pi/knowledge-write-gate.ts"],
  "prompts": [
    "../AgenticLab/prompts/system/initialize-workspace.md",
    "../AgenticLab/prompts/delivery/plan.md",
    "../AgenticLab/prompts/delivery/implement.md",
    "../AgenticLab/prompts/delivery/premortem.md"
  ]
}
```

When merging, preserve unrelated extensions/prompts/settings and do not duplicate the AgenticLab paths. If an existing value conflicts, is invalid, or cannot be safely merged, stop and show the conflict instead of replacing it.

Prepare `.pi/APPEND_SYSTEM.md` by preserving existing host content and adding a concise AgenticLab block equivalent to:

```markdown
For work in this workspace, read and follow `AgenticLab/AGENTS.md`.
Read `AgenticLab/PROJECT-SCOPE.md` before consequential work and stay within its boundaries.
If `AgenticLab/PROJECT-OVERVIEW.md` exists, read it once as fresh-session orientation; verify relevant facts against current source.
Do not create or modify a workspace-root `AGENTS.md` for AgenticLab.
```

If either `.pi` file already contains equivalent AgenticLab guidance, leave it intact. Do not write global Pi settings/trust or host-root instruction files. Project `.pi` resources require project trust; do not claim they are active in the current process before a fresh trusted Pi process loads them.

## Step 6 — Present one complete initialization preview

Before writing anything, show one combined setup preview containing:

1. exact proposed contents/diff for a new or user-approved update to `AgenticLab/PROJECT-SCOPE.md`;
2. the complete proposed `AgenticLab/PROJECT-OVERVIEW.md`, including its sources, revision, coverage, exclusions, and uncertainties;
3. exact creates/merges for `.pi/settings.json` and `.pi/APPEND_SYSTEM.md`;
4. a statement that no host application files, root `AGENTS.md`, V4 knowledge, `.env`, `data/`, app/test/DB command, or global Pi configuration will be changed/accessed.

Ask one explicit question: **"Do you approve these exact AgenticLab scope/profile and project-local `.pi` setup changes?"** Do not write any of them before approval. If the user asks for changes, update the entire preview and ask again.

**Optional — knowledge-capture metrics (privacy-minimized, opt-in):**

Before the approval question, ask whether the user wants to enable knowledge-capture metrics for this workspace. If yes, the adapter writes aggregate events (staging, promotion, retrieval, confirmation outcomes) to `.pi/metrics/agenticlab.jsonl`. No raw user content is recorded. This setting can be changed later in `AgenticLab/knowledge-capture-policy.json` (key: `metricsEnabled`).

On approval, write only the listed setup/profile files. Do not create or modify anything under `AgenticLab/knowledge/` in this workflow; durable project records/index changes belong to the separate V5 knowledge interface and its write gate. If any write fails or an unexpected file conflict appears, stop and report partial completion; do not broaden the file list.

## Step 7 — Finish and activate Pi locally

Report exactly which files were created or merged and which were preserved. Tell the user to start a fresh Pi process from the workspace root and grant project trust when prompted. This restart activates the newly written `.pi` configuration; **it is not a request to read or run the initialization prompt again.** The initialization flow is now complete.

In the fresh trusted process, the project instructions should load normally. If an explicit smoke check is wanted, read `AgenticLab/PROJECT-SCOPE.md` and `AgenticLab/PROJECT-OVERVIEW.md` and report their key points; do not rescan the codebase or rerun initialization. Verify that:

- `.pi/APPEND_SYSTEM.md` instructions are active;
- the local knowledge-write extension is listed;
- `/initialize-workspace`, `/plan`, `/implement`, and `/premortem` are registered and available for explicit invocation; none was run automatically;
- `PROJECT-SCOPE.md` and the overview are directed to be read at fresh-session start;
- no host application paths were created or changed.

If `PROJECT-OVERVIEW.md` was just created, a bounded fresh-session read check verifies availability, not general delivery benefit.

## Later use

Ordinary sessions do not rerun this prompt. They read the confirmed scope and compact overview; task-specific persistent records remain selectively retrieved through the distinct V5 knowledge interface. A later explicit `/initialize-workspace` invocation must detect the existing profile and stop unless the user specifically asks for a refresh. A refresh must show a source-bounded diff and require approval before updating setup/profile files.

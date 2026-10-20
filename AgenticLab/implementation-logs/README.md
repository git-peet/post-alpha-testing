# Implementation Logs — structure and lifecycle

Durable, human-readable records of what was actually implemented in this workspace.
This folder is **agent-owned**: it lives under `AgenticLab/`, never inside project
source. Nothing here is imported by, or required by, project code.

## Folder layout

```
AgenticLab/implementation-logs/
├── README.md                        ← this file (structure + lifecycle rules)
├── template/
│   └── implement-record.json        ← schema reference / worked example
└── <workspace-key>/
    └── <pbi-id-slug>/
        ├── implement-record.json    ← transient snapshot (written by /implement)
        └── implementation-log.md    ← durable output (written by /implementation-log)
```

- `<workspace-key>` — the target workspace this AgenticLab instance serves
  (e.g. `post-integration-delivery`). One folder per workspace.
- `<pbi-id-slug>` — lowercase, hyphenated PBI identifier
  (e.g. `pbi-1-dynamic-pricing`, `pbi-2-multi-warehouse-inventory`).
- Both folders are created on demand by the workflow that needs them. Do not
  pre-create empty directories.

## Lifecycle

| Stage | Artifact | State | Written by | Deleted by |
|-------|----------|-------|------------|------------|
| 1 | `AgenticLab/plan-checkpoint.json` | transient | `/plan` (after approval) | `/implement` (at completion) |
| 2 | `implementation-logs/<ws>/<pbi>/implement-record.json` | transient | `/implement` (at completion) | `/implementation-log` (after rendering) |
| 3 | `implementation-logs/<ws>/<pbi>/implementation-log.md` | **durable** | `/implementation-log` | never |

1. `/plan` writes the plan checkpoint: approved scope, validation, stop conditions, decisions.
2. `/implement` reads the checkpoint, does the work, and writes the **implement record**:
   a structured snapshot of what was actually changed and verified. The checkpoint's
   scope/validation/stop conditions are folded into the record before the checkpoint
   is deleted, so no context is lost in the handoff.
3. `/implementation-log` reads the implement record, renders the durable markdown log,
   and deletes the record. If no record is found, it was already consumed by a previous
   run — the workflow then reconstructs the log from the current source and the
   user's input, and records any changes made since the last consumption.

## Why the record is deleted after use

The implement record is a **context capsule**, not a second permanent log. Keeping it
would create two sources of truth that drift apart. Deleting it after consumption
makes `/implementation-log` the single owner of the durable log, and makes "the
record is missing" a meaningful signal: *the log was already generated, and anything
that changed since then needs to be re-examined.*

## Post-implementation changes

The implement record is a **snapshot at the end of `/implement`**. Changes made
afterwards (e.g. from an ad-hoc `/premortem` review) are not captured by it.

To record them: invoke `/implementation-log` again for the same PBI. With no record
present, the workflow inspects the current source, compares it against the existing
`implementation-log.md`, and appends or revises the affected entries, noting the
amendment explicitly rather than silently rewriting history.

## Content rules

- The log describes **implementation facts**: what changed, where, how it was
  validated, what remains unresolved.
- It does **not** contain business content — no rule conditions, customer data,
  cart data, or credentials.
- Knowledge candidates and learning findings live in `AgenticLab/knowledge/`,
  not here. The log may reference them.

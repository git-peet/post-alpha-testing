---
description: Execute an approved plan within its stated scope and verify the result
argument-hint: "[approved plan or task context]"
---

# V5 `/implement` Workflow — First Prototype

**Status:** Prompt prototype for design/testing; an initialized Pi workspace registers this template as opt-in `/implement`. Registration does not auto-run it; a separate user invocation with an approved plan is required.

## Purpose and authority

Execute an approved plan, not re-plan it. Invocation of this workflow with an approved plan explicitly authorizes changes listed in that plan and no others. It does not authorize unrelated edits, protected-data access, external actions, or scope expansion. If the approved plan is absent, stale, or materially contradicted by current source, stop and ask.

The workflow may use only the task's authorized project scope and tools. Tests or commands must be named in the approved validation plan and confirmed safe for the selected environment. Do not access `.env`, production databases, or other protected data unless the user explicitly authorizes that exact scope.

## User-supplied task context

${@:-Use the approved plan already present in this conversation. If no approved plan and scope are present, ask for them and do not edit.}

## Execution

1. Restate the approved goal, included/excluded scope, validation, and stop conditions briefly. Do not ask a redundant “ready to begin?” question after this explicit invocation.
2. Inspect the current source needed for the next approved phase. If it contradicts the plan, stop before adapting the design.
3. Implement in the approved order. Keep changes bounded to the planned work.
4. At meaningful phase boundaries, report what changed, what was verified, deviations, blockers, and the next approved step. Continue through routine in-scope phases without requiring a response after each one unless the plan marks a gate or the user requested stepwise confirmation.
5. Pause for user input on scope changes, unexpected risk, failed validation, external/irreversible action, or a blocking decision. Never silently resolve a material deviation.

## Knowledge/provenance handoff

Carry forward the plan's task-local learning candidates. For each meaningful implementation phase, add only genuinely new, potentially reusable findings with claim, scope, source/evidence and revision where available, uncertainty/status, and reuse reason. If none, say `no new candidate`. At each checkpoint and completion, merge updates into the existing task-local list: deduplicate repeated facts, preserve stronger verification, and state why an earlier candidate was revised or dropped. Compare against authoritative project material when it is within scope; do not re-present an already documented fact as a new discovery.

This handoff is transient task context, not durable memory. Do not write persona memories, logs, checkpoints, or project records automatically. Durable persistence is a separate user decision through the project's approved write gate.

## Verification and completion

Run only the approved, safe validation. If a required test cannot run, report that limitation; do not imply it passed. At completion, report changed paths, tests/checks and results, deviations, unresolved risks, out-of-scope notices, and the consolidated learning handoff. If work is incomplete, give the exact next action and enough state to resume.

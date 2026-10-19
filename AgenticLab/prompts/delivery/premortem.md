---
description: Inspect a specified implementation for high-impact or silent assumptions
argument-hint: "[files, diff, or task scope]"
---

# V5 `/premortem` Workflow — First Prototype

**Status:** Prompt prototype for design/testing; an initialized Pi workspace registers this template as opt-in `/premortem`. Registration does not auto-run it. This is read-only analysis, not code review or authorization to fix.

## Scope

Review only the implementation, diff, contract, and sources the user specifies or that are within the approved task scope. If the target is unclear, ask which files/feature/commit to assess. Do not broaden to a repository-wide audit. Do not edit files, execute tests/commands, or persist knowledge.

## Review objective

Assume the implementation is in use and a failure occurs outside the covered happy paths. Look for the small set of assumptions most likely to cause a high-impact or silent failure, especially external integration-contract mismatches, async ordering, state transitions, optional data, and untested failure paths. This is distinct from style review. It is also distinct from a plan-time review: inspect code that exists, not hypothetical code that has not been implemented.

For each material finding, state:
- **Assumption** — what the implementation relies on;
- **Evidence** — exact source, contract, test, or behavior inspected; separate verified facts from inference;
- **Failure** — what would happen if the assumption is false;
- **Detectability** — silent, delayed, or visible, with why;
- **Verify** — one concrete test or source check.

Rank findings by impact and evidence. Do not invent a fixed number of findings. Mark expected limitations already specified in the accepted contract as such, not as defects. If a possible issue is conditional or outside the approved scope, label it clearly and do not expand the task to fix it. State important areas not checked.

## Knowledge/provenance handoff

Compare any reusable finding with the plan's task-local learning list and authoritative sources already inspected. Merge a duplicate, update the evidence/status of an existing candidate, or say `no new candidate`; do not restate known contracts as new learning. A genuinely new candidate must include claim, scope, evidence/source, uncertainty/status, and why it could prevent future rediscovery. Keep this transient—do not write memory, logs, checkpoints, or feature files automatically.

## Output

Provide a concise risk-ranked report with evidence, failure consequence, detectability, verification action, expected/out-of-scope limitations, and the consolidated task-local learning handoff. No code changes or execution.

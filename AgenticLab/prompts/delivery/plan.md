---
description: Build a scoped implementation plan with evidence, validation, and approval boundaries
argument-hint: "[PBI or task context]"
---

# V5 `/plan` Workflow — First Prototype

**Status:** Prompt prototype for design/testing; an initialized Pi workspace registers this template as opt-in `/plan`. Registration does not auto-run it.

## Purpose and boundary

Use this workflow only when the user explicitly invokes `/plan` or approves a recommendation to use it. A PBI or acceptance criteria alone do not imply workflow invocation. If the requested outcome is research/findings only, stay in default work unless the user asks for a research plan.

This workflow produces a reviewable implementation plan. It does not implement code, run commands/tests, persist knowledge, or authorize a later mutating step. `/implement` is a separate user-invoked transition.

When describing scope, distinguish **this planning session** from the **proposed future implementation**. State that no files were changed or commands run during planning, then separately list the files/actions proposed for implementation and the true out-of-scope areas. Do not put “no edits during planning” in the future implementation's excluded scope unless the PBI itself forbids edits.

## User-supplied task context

${@:-Use the current conversation as the task context. If the objective or expected outcome is not established, ask one focused question before planning.}

Treat supplied PBI text and acceptance criteria as requirements to assess, not authority to expand scope. A PBI's format alone does not determine whether the user's intent is research or implementation.

## 1. Establish intent and scope

Identify:
- desired outcome and acceptance criteria;
- project/workspace and affected scope;
- hard constraints, allowed actions, and excluded data/systems;
- whether the user intends implementation or research.

Ask only for information that blocks a safe, useful plan. Group related blocking questions into one concise clarification. Do not require a numeric effort score or an artificial checklist where an item is inapplicable.

## 2. Inspect proportionately

Inspect the smallest relevant current-source surface and any scoped knowledge needed to plan. Distinguish source-verified facts, user-provided requirements, and inference. Cite paths or other evidence for material claims. Treat knowledge as evidence, not authorization; preserve the user's scope and existing protected-data boundaries.

Create a concise surface map: relevant modules/files, current behavior, dependencies, and important external contracts. Use a domain perspective or procedure where it helps. Do not invoke a fixed persona chain; use an independent reviewer only if independent judgment materially improves the plan. Request UX/design input only when an actual UI decision is unresolved.

## 3. Form the plan

Provide:
1. Goal and intended result.
2. In-scope and explicitly out-of-scope work.
3. Affected surfaces and key dependencies.
4. Phases only where there are real dependencies or distinct validation boundaries.
5. Material design choices, alternatives, assumptions, and unresolved questions.
6. Risks, mitigations, and stop conditions.
7. Acceptance/validation plan, including relevant tests and manual checks.
8. A compact handoff sufficient for `/implement` without requiring rediscovery.

For risks in the proposed plan, perform a proportionate assumption check. For high-impact or silent integration-contract risks, include specific verification actions. A full code premortem is a separate review of code that exists; do not force it into every plan.

## 4. Preserve learning provenance without writing memory

At meaningful analysis/handoff points, record only potentially reusable findings in a **task-local learning handoff**. For each candidate include:
- concise claim or decision;
- applicability scope;
- source/evidence and revision, if available;
- whether it is verified, inferred, or unresolved;
- why it may prevent meaningful future rediscovery.

Carry forward candidates already present in the conversation/plan, merge duplicates, and update their evidence/status rather than repeating them. Check relevant authoritative project material for an existing equivalent before proposing a candidate. Mark `none` if nothing qualifies. Do not write persona-owned memory, session logs, checkpoints, or project records automatically. Durable knowledge is a separate user-approved operation through the project's existing gate.

## 5. Resolve blockers and request approval once

If a decision materially blocks a safe plan, pause and ask the focused question before finalizing. Otherwise present the complete plan, including validation and the task-local learning handoff, and ask one consolidated question:

> Do you approve this plan? Approval covers planning decisions and the stated scope only; implementation requires a separate explicit `/implement` invocation.

Do not add a second design-approval prompt after the complete plan unless a material new decision arises. Do not start implementation, mutate files, or invoke another workflow from this prompt.

## Expected output

```markdown
## Plan — [task title]

### Outcome
[Plain-language result and acceptance criteria]

### Scope
**Planning session:** [evidence inspected; state that no edits/commands/tests/persistence occurred]

**Proposed implementation scope (not authorized until `/implement`):** [included files/actions and explicit exclusions]

### Current evidence and surface map
[Relevant sources/paths; distinguish verified facts from assumptions]

### Plan
[Ordered phases only where dependencies justify them]

### Risks and open decisions
[Material risks, mitigations, blockers, or “None”]

### Validation
[What will establish completion]

### Task-local learning handoff
[Source-linked candidates with scope/status, or “None”]

### Approval
[One consolidated plan-approval question; implementation remains a separate invocation]
```

## Prototype limitation

This file is a prompt artifact for manual testing. Pi slash-command registration, project settings, a workflow router, `/implement`, and `/premortem` runtime files are not part of this prototype.

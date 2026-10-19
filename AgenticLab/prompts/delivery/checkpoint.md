---
description: Transient phase artifact that passes the approved plan from /plan to /implement
argument-hint: "[PBI/task identifier]"
---

# Plan Checkpoint — Transient Phase Artifact

Purpose: Carry an approved plan across workflow phases (e.g., /plan → /implement) without relying solely on conversation context.

Location (transient): `AgenticLab/plan-checkpoint.json` at workspace root.

Lifecycle: Created by `/plan` only after explicit user approval. Read by `/implement` at start; deleted by `/implement` at completion. If missing, `/implement` stops and asks for the approved plan.

Schema:
```json
{
  "phase": "plan",
  "status": "approved",
  "task": "PBI-1 Dynamic Pricing Rule Builder",
  "approvedAt": "2026-10-19T11:30:00+02:00",
  "scope": "project:post-integration-delivery",
  "summary": "Add pricing rules (pending→active→archived) to EverShop DB; harness emits only candidate_staged metric.",
  "inScope": ["pricing_rules table", "rule APIs", "admin UI pages", "cart apply endpoint", "metrics adapter"],
  "outOfScope": ["pricing rules as AgenticLab durable knowledge", ".env access", "Page Builder widget as admin UI"],
  "validation": ["unit tests for schema/engine", "build passes", "metrics tests pass"],
  "stopConditions": ["plan contradicts source", "tests fail", "metrics leak rule content"],
  "decisions": ["Option A confirmed: rules stay in EverShop DB; harness tracks events only"],
  "planPath": "AgenticLab/prompts/delivery/plan.md"
}
```

Not durable knowledge. Not committed to source control (add to `.gitignore` if needed, but file is deleted on completion anyway). Not used for retrieval after the phase completes.

Usage in /plan: At approval, write this file with the fields above.
Usage in /implement: At start, read this file. If task name matches current invocation, use contents as approved plan. If missing/stale, ask user.
Usage in /premortem: Read for task scope and decisions (optional; can work without if user specifies scope directly).

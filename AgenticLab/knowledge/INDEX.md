---
id: agenticlab-knowledge-index
collection: AgenticLab/project-knowledge
scope: project:post-integration-delivery
status: active
recorded: 2026-10-20
---

# AgenticLab Project Knowledge Index

Collection: project-knowledge (`AgenticLab/knowledge/`).  
Authorization: promoted records only (`status: active`).
Retrieval: use `readKnowledgeRecords` before source inspection when prior project knowledge may apply.

This is the stable, workspace-scoped router for project knowledge. Records are the source of claims and evidence. Topic maps are curated navigation routes, not exhaustive manifests; the eligible record collection remains searchable independently of map membership.

## Topic maps

- [Concurrency control](concurrency-control/INDEX.md) — route for inventory-reservation concurrency topics.

## Retrieval trigger routes

### [Advisory lock serializes concurrent inventory reservations](pbi-2-advisory-lock-concurrency.md) — `pbi-2-advisory-lock-concurrency`

- **Category:** fact
- **Scope:** multi-warehouse-inventory
- **Status:** active
- **Recorded:** 2026-10-20
- **Trigger terms:** `advisory lock`, `concurrency`, `pg_advisory_xact_lock`, `reserve inventory`, `serialize reserve`, `concurrent reservation`, `inventory lock`, `multi-warehouse reserve`

These terms are a retrieval shortcut for the linked record, not a declaration that this index lists every eligible record.

## Retrieval and completeness

1. Compare the task with trigger terms and topic-map routes. Call `readKnowledgeRecords` with the record ID when a trigger matches, or a query otherwise; pass an explicit task scope/category filter when one is known.
2. The adapter searches the workspace record corpus, filters active eligible metadata before body search, and may return `ok`, `filtered`, `no_match`, `incomplete`, `unavailable`, or `no_knowledge_store`.
3. A map/index miss alone is not a no-match. Claim no-match only after a complete eligible-record search; incomplete/capped scans and filtered-only results are not no-match.
4. Verify mutable claims against current source. Candidate, inactive, superseded, and out-of-scope material is not active evidence. Retrieval metrics are emitted by the adapter; do not emit them separately.

## Separate operational collections

- `AgenticLab/implementation-logs/` — delivery records, not project knowledge.
- `.pi/metrics/agenticlab.jsonl` — mechanism events, not evidence for project claims.

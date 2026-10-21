---
id: agenticlab-knowledge-index
collection: AgenticLab/project-knowledge
scope: multi-warehouse-inventory
status: active
recorded: 2026-10-20
---

# AgenticLab Project Knowledge Index

Collection: project-knowledge (`AgenticLab/knowledge/`).  
Authorization: promoted only (`status: active`).  
Retrieval: read via `readKnowledgeRecords` adapter or permitted file tools.

This index is a navigation aid (not duplicate truth). Record files contain the claim, rationale, evidence, and verification steps. MOC maps are not yet required — expand only when the record count exceeds ~20 or when cross-domain navigation is needed.

## Records

### [Advisory lock serializes concurrent inventory reservations](pbi-2-advisory-lock-concurrency.md) — `pbi-2-advisory-lock-concurrency`
- **Category:** concurrency-control  
- **Scope:** multi-warehouse-inventory  
- **Status:** active  
- **Recorded:** 2026-10-20  
- **Source:** `packages/evershop/src/modules/inventory/services/inventoryService.ts`  
- **Evidence:** 2-way concurrent reserve validated; advisory lock (`pg_advisory_xact_lock`) serializes reservation via transaction-scoped lock  
- **Claim:** Serializes concurrent reservations; prevents negative stock; untested at 3-5 way concurrency  
- **Limitations:** 5-way concurrency unverified; multi-warehouse same-product serialization not measured; advisory-lock key (`product_id`) may over-serialize  
- **Trigger terms:** `advisory lock`, `concurrency`, `pg_advisory_xact_lock`, `reserve inventory`, `serialize reserve`, `concurrent reservation`, `inventory lock`, `multi-warehouse reserve`

---

## Retrieval rules (use when starting any task)

1. Extract domain/task terms from the current task description.
2. Check INDEX.md `Trigger terms:` fields above for matches.
3. If a match exists: read the linked record (metadata first, then full body if relevant).
4. Verify any mutable claims (e.g., code references, test status) against current source.
5. If no match: proceed to source inspection; emit `no_match` in metrics.

## Index completeness

- Scan scope: all `.md` files in `AgenticLab/knowledge/` with `status: active`.
- Index missing if record exists but not listed here; report `filtered`.
- Index must include at least `id`, `title`, `category`, `scope`, `status`, `recorded`, `trigger terms`; body not required for metadata filter.

---

## Related collections (separate scope)

- `AgenticLab/implementation-logs/` — durable project delivery records (not knowledge)
- `AgenticLab/knowledge-pending/` — staged candidates awaiting promotion
- `.pi/metrics/agenticlab.jsonl` — event log (not evidence)

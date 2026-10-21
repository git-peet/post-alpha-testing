# Retrieval Trigger Mechanism — Design Spec

**Status:** Proposed  
**Scope:** AgenticLab knowledge retrieval activation  
**Author:** Session context  
**Recorded:** 2026-10-20

---

## 1. Problem Statement

The knowledge-capture mechanism is complete — staging, promotion, retrieval tooling, and metrics all work. However, agents **never automatically consult** durable knowledge during free-session conversation. Instead, they read source code directly.

This occurs because there is no lightweight trigger mechanism to ask: *"Do we already have a record for this topic?"*

---

## 2. Observation

From earlier session transcript:

> Sub session read source code files (`inventoryService.ts`, test files) **instead** of consulting `AgenticLab/knowledge/pbi-2-advisory-lock-concurrency.md`.

The agent has the information to make an informed choice, but it defaults to source code. This is expected behavior — **knowledge must signal that it is worth consulting first**.

---

## 3. Proposed Solution: INDEX.md + Trigger Terms

Follow V4’s SEMANTIC_MAP pattern but use V5’s structured vocabulary.

### 3.1 File: `AgenticLab/knowledge/INDEX.md`

```markdown
# Project Knowledge Index

## Concepts

- **[conceptual-slug](records/record-id.md)** — `stable-id`
  - **Aliases:** synonym1, synonym2
  - **Trigger terms:** word1, word2, word3
  - **Scope:** project:workspace
  - **Category:** decision | fact | experience | risk | procedure
  - **Status:** active | inactive | stale | rejected

Instructions:  
When starting any task, check this index for trigger terms matching your context. If a match is found, read the linked record before inspecting source code for that topic.
```

**Metadata semantics:**

* **Slug** — URL-safe identifier for wikilink routing.  
* **Aliases** — alternate search terms; expands recall.  
* **Trigger terms** — vocabulary from task description that should surface this record.  
* **Status** — gating factor; agents should **not** use `inactive`/`stale` records without explicit user permission.  
* **Scope** — project/feature filter; enables per-workspace knowledge partitioning.  

### 3.2 Trigger Matching

**Algorithm:**  
1. Extract domain-specific words from task context (e.g., component names, feature names, technical concepts).  
2. Tokenize INDEX.md trigger terms.  
3. Compute **Jaccard similarity**: |A ∩ B| / |A ∪ B|.  
4. **Match threshold**: 1+ trigger term overlap = retrieval path chosen.

### 3.3 Integration Points

#### 3.3.1 System Prompt (v5 canonical)

Add to `/system/prompts/system/initialize-workspace.md`:

> Before any source-code inspection for design rationale or decision context, check `AgenticLab/knowledge/INDEX.md`. If one or more trigger terms from the task description match a record’s trigger list, read the linked record first—the record is the source of truth for that topic. Only after reading should you verify its claims against current source. Report any gaps or contradictions discovered.

#### 3.3.2 Delivery Prompts (v5)

Add to `prompts/delivery/{plan,implement,premortem}.md` step 0:

> 0. **Index check** — scan `AgenticLab/knowledge/INDEX.md` trigger terms against the current task. If matches exist, read the linked records and cite them. Emit `retrieval_success`; continue with evidence verification.

---

## 4. Metrics Signal

| Event | When | Value |
|-------|------|-------|
| `candidate_staged` | Agent identifies a reusable finding | `event: "candidate_staged"` |
| `retrieval_success` | Trigger matched → record read | `event: "retrieval_success"` |
| `no_match` | Trigger attempted, nothing found | `event: "retrieval_success"` with `{status: "no_match"}` via separate metric or extension |

**Calibration:**  
High `no_match` rates in a topic = **write-pending candidates** for that area.

---

## 5. Phased Rollout

### Phase 1 — Immediate

1. Create `AgenticLab/knowledge/INDEX.md` with existing records.  
2. Embed trigger matching instruction in `/initialize-workspace.md` template.  
3. Run experiment: natural task → agent → read INDEX → check trigger → retrieve record.  

### Phase 2 — Next Iteration

1. Add `no_match` event schema to metrics adapter.  
2. Instrument retrieval tools (`readKnowledgeRecords`) to emit `no_match` when index consulted but nothing found.  
3. Collect baseline metrics (signal vs noise).  

### Phase 3 — MOC Scale

When `INDEX.md` reaches ~20 records:

1. Promote to **domain MOCs**: `knowledge/{domain}/INDEX.md`.  
2. Update root INDEX to route by domain MOC.  
3. Retain atomic records unchanged.  

---

## 6. References

* **C02** — Knowledge lifecycle draft (V5 backlog)  
* **V4 memory-spec.md §200** — SEMANTIC_MAP structure & trigger terms  
* **V4 protocol.md §128** — Trigger-based memory load rules  
* **C03** — Context engineering / bounded retrieval  
* **V5 knowledge-contract.md** — Retrieval outcome vocabulary & authority  

---

## 7. Open Questions

* What similarity threshold balances precision vs recall?  
* Can `no_match` be emitted directly without a false successful read?  
* How many prior successful reads warrant auto-surfacing without trigger match?

---

## 8. Next Actions

1. Create `AgenticLab/knowledge/INDEX.md` in workspace and V5 `system/knowledge/`  
2. Add trigger matching language to system prompts  
3. Sync changes to payload workspace (`AgenticLab/`)
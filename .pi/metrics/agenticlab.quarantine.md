# Quarantined metrics lines

Removed from `agenticlab.jsonl` during Dynamic Pricing Rule Builder cleanup and re-verification.

## Line 1 (original pre-existing)

**Reason:** Malformed JSON — contained a full sample-candidate payload (`id`, `title`, `category`, `scope`, `status`, `source`, `recorded`) plus redundant `timestamp`. This line predates the implementation and made the entire file non-JSONL.

**Event written before removal:** `candidate_staged`
**Occurred:** `2026-10-18T20:22:00.000Z`

Line text removed:
```json
{"timestamp": "2026-10-18T20:22:00.000Z", "event": "candidate_staged", "data": {"id": "manual-test-...", "title": "Manual test", "category": "test", "scope": "project:post-integration-delivery", "status": "pending", "source": "test", "recorded": "2026-10-18"}}
```

## Line 2 (discovered during post-reboot smoke test)

**Reason:** Malformed JSON — two JSON objects concatenated on one line without a newline separator. Caused by a missing trailing newline after the quarantine rewrite of the file.

**Event:** `candidate_staged`
**Occurred:** `2026-10-19T20:23:10.225Z`

Line text removed:
```json
{"event":"candidate_staged","occurredAt":"2026-10-19T11:58:37.557Z"}{"event":"candidate_staged","occurredAt":"2026-10-19T20:23:10.225Z"}
```

## Line 3 (legacy entries from retired project-code mechanism)

**Reason:** Valid JSON, but retired by design. These 4 events were emitted by the
project-code import `packages/evershop/src/modules/promotion/services/pricingRules/recordCandidateStagedMetric.ts`,
which violated the operating-contract "Code and dependency boundaries" rule
(project code must not contain AgenticLab code). That import was removed on
2026-10-20; metrics are now emitted agent-side from the `/plan`, `/implement`,
and `/premortem` workflow prompts only.

These entries measured **business events** (pricing rule creation), not knowledge-capture
activity, so they were not comparable with agent-side events and are not valid measurement
data for the mechanism. Removed to avoid conflating the two designs.

**Events removed:**
```json
{"event":"candidate_staged","occurredAt":"2026-10-19T11:56:57.001Z"}
{"event":"candidate_staged","occurredAt":"2026-10-19T11:58:37.557Z"}
{"event":"candidate_staged","occurredAt":"2026-10-19T20:23:10.225Z"}
{"event":"candidate_staged","occurredAt":"2026-10-19T20:23:58.242Z"}
```

## Notes

- Never rejected, never tampered with. Isolated here for audit; no runtime event author used these.
- `agenticlab.jsonl` is now empty (0 bytes) and reserved for agent-side events only, emitted by the
  workflow prompts after a knowledge candidate is staged.
- All retained events are `candidate_staged` — no `promotion_approved`, no `retrieval_success`,
  no rule data.
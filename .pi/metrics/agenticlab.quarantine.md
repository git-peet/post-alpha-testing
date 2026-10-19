# Quarantined metrics line

Removed from `agenticlab.jsonl` during Dynamic Pricing Rule Builder cleanup.

**Reason:** Malformed JSON — contained a full sample-candidate payload (`id`, `title`, `category`, `scope`, `status`, `source`, `recorded`) plus redundant `timestamp`. This line predates the implementation and made the entire file non-JSONL.

**Event written before removal:** `candidate_staged`
**Occurred:** `2026-10-18T20:22:00.000Z`

Line text removed:
```json
{"timestamp": "2026-10-18T20:22:00.000Z", "event": "candidate_staged", "data": {"id": "manual-test-...", "title": "Manual test", "category": "test", "scope": "project:post-integration-delivery", "status": "pending", "source": "test", "recorded": "2026-10-18"}}
```

Note: never rejected, never tampered with. Isolated here for audit; no runtime event author used it.
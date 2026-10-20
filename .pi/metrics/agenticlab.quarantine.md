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

## Notes

- Never rejected, never tampered with. Isolated here for audit; no runtime event author used these.
- The remaining 4 lines in `agenticlab.jsonl` are all valid JSON with only `event` and `occurredAt` keys.
- All events are `candidate_staged` — no `promotion_approved`, no `retrieval_success`, no rule data.
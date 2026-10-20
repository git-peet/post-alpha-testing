# PBI-1 — Dynamic Pricing Rule Builder

**Status:** Completed  
**Implemented:** 2026-10-19 (pilot phase completed, hardening deferred per user direction 2026-10-20)  
**Workspace:** post-integration-delivery  
**Branch/Scope:** AgenticLab/PROJECT-SCOPE.md — disposable EverShop workspace for AgenticLab V5 delivery

---

## Outcome

Extended EverShop promotion module to add dynamic pricing rule builder with pending → active → archived lifecycle. Rules evaluate against cart subtotal, customer group, category, and UTC date windows; discounts stack by priority then apply to totals.

## Deliverables

### Database

- Migration: `packages/evershop/src/modules/promotion/migration/Version-1.2.0.ts` — `pricing_rules` table (`id`, `name`, `description`, `condition_json`, `action_json`, `priority`, `status`, `created_at`, `updated_at`) with `CHECK` constraints on status + JSONB objects and unique active `(condition, action)` index.
- TypeScript types via `packages/evershop/src/types/db/index.ts` pattern (existing convention used for promotion types).

### Services & Business Logic

- `packages/evershop/src/modules/promotion/services/pricingRules/pricingRuleService.ts` — create / list / get / update-pending / approve / archive.
- `packages/evershop/src/modules/promotion/services/pricingRules/pricingRuleEngine.ts` — `calculateRuleDiscounts`, `evaluatePricingRules`, `createRuleAdjustedCartView`.
- `packages/evershop/src/modules/promotion/services/pricingRules/pricingRuleSchema.ts` — input normalization / validation.

### APIs (private/admin + public)

- `POST /api/pricing-rules` → rule created with `status='pending'`.
- `POST /api/pricing-rules/{id}/approve` → `pending → active` (409 if duplicate active rule exists — intended).
- `POST /api/pricing-rules/{id}/archive` → `active/pending → archived`.
- `GET /api/pricing-rules?status=archived` → history.
- `POST /api/cart/apply-discount` → server-computed cart totals with applied discounts.

### Admin UI

- `pricingRuleGrid` (list), `pricingRuleNew` (create), `pricingRuleEdit` (edit pending rules).
- Navigation link added in promotion module admin pages.

### Observability

- Metrics emitted on rule creation (`candidate_staged`): 4 valid events recorded, 2 malformed lines quarantined for audit.
- All events content-free — no rule data, customer/cart/admin content.
- Quarantine audit preserved: original malformed payload (pre-existing test line) and concatenated line from missing trailing newline (post-reboot smoke test) isolated, not rejected.

## Verification

- `npm run compile` / `npm run build`: passed.
- `npm start`: localhost:3000 — HTTP 200 (homepage, 8 product cards, widget active).
- Admin pages: `/admin/pricing-rules`, `/admin/pricing-rules/new` — HTTP 200.
- `POST /api/pricing-rules` (with authorization): creates `pending` rule correctly.
- `GET /api/pricing-rules`: returns rules with correct schema.
- `POST /api/cart/apply-discount`: applies discount when rule active.
- 5 Jest suites / 23 tests passed (pricingRuleSchema, pricingRuleEngine, discountAmount, subTotalWithDiscount, lineTotalWithDiscount).
- Metrics JSONL validated: 4 valid lines, 0 malformed after fix.

## DB State (post-smoke-test / post-reboot)

- `pricing_rules` table: 4 archived rows (`Smoke test ...`, `Rule 1`, `Rule 2`, `Rule 3` — test artifacts from session, not production data). Zero pending / active.

## Premortem Findings (2 High-risk identified during /premortem; deferred per user instruction 2026-10-19)

- **Lifecycle transition robustness:** Duplicate-active rule correctly returns 409; no silent failure — expected.
- **Metrics writer robustness:** File corruption from missing newline at quarantine boundary (fixed); metric written after DB commit (not in transaction) — deferred hardening.

## Deferred / Not Implemented (Explicit)

- Metrics-writer atomicity (metric in DB transaction or retry-on-failure) — deferred per user's choice: "leave it for now."
- File-integrity guard (startup validation of JSONL) — deferred.
- `promotion_approved` / `retrieval_success` event types — not required by PBI 1 scope.
- Knowledge-capture promotion (`pendingStagingEnabled` — no candidates promoted to durable knowledge yet — metrics only).
- Notification trigger / bulk threshold update / multi-language / external alert integrations — out of scope for PBI 1.

## Changes from Original Plan (amendments documented)

- `recordCandidateStagedMetric.ts` removed from `packages/evershop/src/` (2026-10-20) per authorization/relay safeguard.
- `AgenticLab/implementation-logs/README.md` created; folder structure established; `implement-record.json` created (snapshot at `/implement` end, read/deleted by `/implementation-log`).
- Hardening (metrics-in-transaction, integrity guard) explicitly deferred, not hidden.

## Verification Command Reference (reproducible from clean workspace)

```bash
# DB health check
docker-compose ps database; pg_isready -h localhost -p 5432
# Start (if needed after reboot)
docker-compose up -d
# Compile / build / start
npm install; npm run compile; npm run build; npm start
# Admin page verification
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/admin/pricing-rules
# Metrics check
cat .pi/metrics/agenticlab.jsonl
```

## Hand-off / Next Action

- **No further `/implement` steps required for PBI 1.**
- Hardening deferred; when user approves, apply via `/implement` on future PBI or retroactively.
- `/implementation-log pbi-1-dynamic-pricing` has already rendered this log (via agent-side consumption of `implement-record.json`, which has now been deleted per lifecycle).

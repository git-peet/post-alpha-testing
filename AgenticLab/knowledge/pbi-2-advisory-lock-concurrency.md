---
id: pbi-2-advisory-lock-concurrency
title: Advisory lock serializes concurrent inventory reservations
category: concurrency-control
scope: multi-warehouse-inventory
status: active
source:
  kind: implementation
  reference: packages/evershop/src/modules/inventory/services/inventoryService.ts
  revision: pbi-2-multi-warehouse-inventory
evidence: 2-way concurrent reserve validated against running DB (reserve 5->4; concurrent reserve ends at 0 with exactly one failure)
recorded: 2026-10-20
verified: 2026-10-20
claim: Inventory reservation uses a PostgreSQL advisory lock keyed on product_id to serialize concurrent reserve calls, so a two-way concurrent reserve cannot oversell.
rationale: Chosen over row-level locking because the reserve path spans a read-then-write cycle and the advisory lock avoids holding a row lock across the transaction. Confidence is bounded to the 2-way case; 3-5 way concurrency is untested.
---

# Advisory lock serializes concurrent inventory reservations

## Claim

Inventory reservation serializes concurrent calls via a PostgreSQL advisory lock keyed on
`product_id`. Two concurrent reserve requests against the same product cannot both succeed
past the available quantity.

## Evidence

- Implementation: `packages/evershop/src/modules/inventory/services/inventoryService.ts`
- Live validation: reserve 5 -> 4 succeeded; oversized reserve returned 400 with no state
  change; concurrent reserve finished at quantity 0 with exactly one failure.
- Migration `Version-1.0.2` / `Version-1.0.3` establish the `stock_alerts` unique index on
  `(product, warehouse)`, which is a separate concern from reservation locking.

## Known limits (from /premortem)

- Advisory lock confirmed under **2-way** concurrency only. **3-5 way** concurrency is
  untested and is the highest-impact open risk in this PBI.
- The lock key is `product_id`; multi-warehouse reservation across the same product in
  different warehouses serializes unnecessarily. This is a throughput cost, not a
  correctness bug, but it is unmeasured.

## Verification to extend

Raise concurrency to 3-5 parallel reserves against a known quantity and assert that
exactly `N` succeed and the remainder fail with a 400, leaving the final quantity at
zero and no negative row.

## Scope

Applies to `reserveInventory` in the multi-warehouse inventory service. Does not apply to
`adjustInventory`, which takes a different path.

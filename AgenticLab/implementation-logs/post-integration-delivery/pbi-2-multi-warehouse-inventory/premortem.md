# PBI-2 Premortem Analysis

## Assumptions and High-Impact Risks

### 1. Assumption: `stock_alerts` single-row-per-product/warehouse state model
- **Evidence**: Migrations V1.0.2/V1.0.3 + service code store one `stock_alerts` row per (product_id, warehouse_id) with a single `min_threshold` and `alert_sent` boolean. The code changes `alert_sent` to `false` when stock crosses below threshold, and creates/repairs the row on adjust/threshold operations.
- **Failure if false**: If the intent is to record *each* threshold crossing as a separate log row (as the PBI wording "create a row when inventory crosses below threshold" suggests), the current model silently overwrites prior crossings. Loss of audit history for threshold events.
- **Detectability**: Silent — data looks correct operationally; only visible if querying historical crossing events.
- **Verify**: Check whether any integration or downstream consumer expects multiple rows per (product, warehouse). Review PBI requirements against actual DB schema.

### 2. Assumption: Advisory lock (`pg_advisory_xact_lock`) serializes concurrent inventory adjustments per (product, warehouse)
- **Evidence**: `adjustInventory`, `reserveInventory` both acquire `pg_advisory_xact_lock(product_id, warehouse_id)` within a transaction. The smoke test showed one concurrent reserve succeeded and one got 400 Insufficient stock, leaving stock at 0 — consistent with advisory lock serialization.
- **Failure if false**: Without the lock (or if lock fails), two concurrent reservations could both pass the stock check and reduce quantity below zero, or both succeed leaving negative/erroneous stock. In the tested environment the lock worked, but production deployment on a different PostgreSQL configuration or extension could behave differently.
- **Detectability**: Delayed — would manifest as corrupted stock counts only under real concurrency.
- **Verify**: Run concurrent reservation tests with varying parallelism (3-5 simultaneous requests) on a fresh DB. Confirm stock never goes negative.

### 3. Assumption: `min_threshold` is always present and valid in `stock_alerts` when `crossedBelowThreshold` runs
- **Evidence**: `crossedBelowThreshold(previousQuantity, currentQuantity, threshold)` assumes `threshold` is a number. Code paths that call it guard with `if (threshold.rows.length && ...)` checking row existence.
- **Failure if false**: If `min_threshold` is NULL (migration allows default 0, but could be unset) or non-numeric, `Number(threshold.rows[0].min_threshold)` yields 0, and `crossedBelowThreshold` could incorrectly fire or not fire. In the adjust code, the threshold query uses `FOR UPDATE` which could deadlock if another session holds a conflicting lock on the same row.
- **Detectability**: Delayed — depends on data edge cases (NULL threshold, concurrent deadlock).
- **Verify**: Insert a stock_alerts row with NULL min_threshold and test adjust/reserve paths. Confirm no crashes and correct behavior.

### 4. Assumption: Warehouse `is_active` flag correctly filters out inactive warehouses in all queries
- **Evidence**: Multiple queries in `inventoryService.ts` add `AND w.is_active = true` or `WHERE w.is_active = true`. The createWarehouse validates timezone. The getWarehouses query filters `is_active = true`.
- **Failure if false**: If a warehouse is marked inactive but still referenced in inventory rows or API calls, the foreign key constraint `ON DELETE CASCADE` on the inventory table would cascade-delete inventory rows (since inventory has `FOREIGN KEY (warehouse_id) REFERENCES warehouses (id) ON DELETE CASCADE`). This would silently lose inventory data.
- **Detectability**: Visible — inventory rows disappear after warehouse deactivation; could be caught by audit.
- **Verify**: Mark a warehouse inactive, then check inventory count before/after. Confirm no accidental deletes (the CASCADE is intentional per migration, but worth confirming).

### 5. Assumption: `positiveInteger` validator rejects floats, strings, and negative values
- **Evidence**: `positiveInteger` uses `Number(value)` and checks `Number.isSafeInteger(number) && number > 0`. The service functions all call this on product_id, warehouse_id, qty, min_threshold.
- **Failure if false**: If a caller passes `0` as qty (which the smoke test does to reduce stock to 0), it's rejected by `positiveInteger` requiring `> 0`. However, `adjustInventory` maps quantity through `normalizeInventoryAdjustments` which uses `positiveInteger` too — so qty=0 is rejected. The `reserveInventory` function uses `positiveInteger` on `qty`, meaning a reserve of 0 qty is rejected. This is arguably correct but could surprise callers expecting "reserve 0 = no-op".
- **Detectability**: Visible — API returns 400 with "quantity must be a positive integer".
- **Verify**: Test API calls with qty=0, qty=-1, qty=1.5 and confirm correct 400 responses.

### 6. Assumption: Route middleware ordering `[context]bodyParser[auth].ts` → `[finish]` → `finish[apiResponse]` is consistent across all new endpoints
- **Evidence**: New PBI-2 API routes follow the pattern: `[context]bodyParser[auth].ts` for body parsing + auth, then handler `[finish]`, then response formatter `finish[apiResponse]`. The bodyParser.json middleware was added to the reserve endpoint and new APIs.
- **Failure if false**: If a route misses the bodyParser middleware, `request.body` is undefined → crash or 500. If the `[finish]` formatter is missing, response may not serialize correctly. Inconsistent middleware ordering could leave auth gaps.
- **Detectability**: Visible — immediate 400/500 on malformed requests or missing auth.
- **Verify**: Hit each new API endpoint (reserve, adjust, threshold propose/decision, warehouse manage) with and without JSON body, with and without auth cookie, and confirm expected status codes.

### 7. Assumption: Product/warehouse foreign key references always resolve when service functions run
- **Evidence**: Service functions like `getInventoryGrid`, `proposeThresholdChanges`, `reserveInventory` all query `warehouses` joined with `product` and check `w.is_active = true`. If a product_id doesn't exist in product table, the query returns 0 rows; if warehouse_id references a non-active warehouse, it's filtered out.
- **Failure if false**: If a product is deleted but inventory rows remain (cascade ON DELETE would remove them), or if a warehouse is deleted and inventory survives, behavior depends on DB state. The service assumes the DB enforces FK constraints.
- **Detectability**: Visible — queries return empty results; no crash.
- **Verify**: Delete a product, check inventory is cascade-deleted. Insert inventory row with orphan warehouse_id and confirm FK enforcement.

---

## Summary of Risks (ranked by impact / detectability)

| Rank | Assumption | Impact if false | Detectable? |
|------|-----------|----------------|-------------|
| 1 | Advisory lock serializes concurrent adjustments | Stock corruption under concurrency | Delayed (data corruption) |
| 2 | Single `stock_alerts` row model matches PBI intent | Lost audit of threshold crossings | Silent |
| 3 | `min_threshold` always valid/non-NULL | Incorrect threshold comparison | Delayed (edge-case data) |
| 4 | `is_active` FK cascade doesn't silently lose inventory | Missing inventory rows after warehouse deactivation | Visible (audit) |
| 5 | `positiveInteger` rejects 0 and negative values | Surprise API 400 on qty=0 | Visible |
| 6 | Middleware ordering consistent across all new endpoints | Crashes/500 on missing body or auth | Visible (immediate) |
| 7 | FK references resolve in service queries | Empty query results (benign) | Visible |

---
*This premortem is read-only analysis for the `/implement` workflow. No project files were modified.*
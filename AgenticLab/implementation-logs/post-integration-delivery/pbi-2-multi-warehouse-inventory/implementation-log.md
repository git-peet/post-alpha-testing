# PBI 2 — Multi-Warehouse Inventory with Low-Stock Alerts

**Status:** implemented  
**Implemented:** 2026-10-20  
**Workspace:** post-integration-delivery  
**EverShop version:** 2.2.1  

## Files changed
Migration (4): Version-1.0.0 → 1.0.3 (warehouses, inventory, stock_alerts + unique). Service: inventoryService.ts (normalizeInventoryAdjustments, reserveInventory, adjustInventory, proposeThresholdChanges, decideThresholdChanges, getOpenStockAlerts, getInventoryGrid, getInventoryByProduct, getWarehouses, createWarehouse, crossedBelowThreshold). APIs: warehouses, inventory, productInventory, alerts, reserve, inventoryAdjustment, inventoryThresholdProposal, inventoryThresholdDecision. Bootstrap + routes + admin grid + tests updated.

## API endpoints added/changed
POST /api/warehouses | GET /api/warehouses | GET /api/inventory | GET /api/inventory/product/:id | GET /api/alerts | POST /api/inventory/reserve | POST /api/inventory/adjust | POST /api/inventory/thresholds/propose | POST /api/inventory/thresholds/decision

## Migrations
V1.0.0 warehouses + index; V1.0.1 inventory + FKs + unique (product,warehouse); V1.0.2 stock_alerts + indexes; V1.0.3 unique index stock_alerts(product,warehouse).

## Test results
6 test suites / 27 tests pass (inventory, pricing, checkout). 4 metric writer tests pass. Build passes. Live: reserve 5→4, oversized reserve 400 (no change), concurrent reserve finishes at 0 with one failure.

## Premortem notes (from /premortem review)
Assumption: advisory lock serializes concurrent adjustments — confirmed under 2-way concurrency, untested at 5-way (high risk). Assumption: single stock_alerts row = config not event log — deferred model decision. Assumption: min_threshold always non-NULL — verified by row-length guard but not by NULL insertion test.

## Risks / unresolved
1. Stock-alert row model ambiguity (config vs event log) — deferred.
2. Extended concurrency (3-5 parallel reserves) not yet tested.
3. All operations validated against running DB; synthetic test warehouse (id=4) cleaned post-test.
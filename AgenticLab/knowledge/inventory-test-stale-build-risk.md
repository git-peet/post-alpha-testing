---
id: "inventory-test-stale-build-risk"
title: "Inventory concurrency runner may test stale compiled service"
category: "risk"
scope: "project:post-integration-delivery"
status: "active"
source: "file: scripts/run-inventory-concurrency-integration.mjs; packages/evershop/src/modules/inventory/services/inventoryService.ts; packages/evershop/src/modules/inventory/tests/unit/inventoryReservationConcurrency.test.ts (revision workspace working tree; uncommitted PBI-4 implementation)"
evidence: "The runner compiles only inventoryReservationConcurrency.test.ts and checks that packages/evershop/dist/modules/inventory/services/inventoryService.js exists. The test imports that compiled service. It does not compile inventoryService.ts or verify the compiled file matches current source. A later source change without recompilation could therefore leave the integration test validating stale service behavior. No actual stale artifact was observed in this session."
recorded: "2026-10-23"
verified: "2026-10-23"
---

# Inventory concurrency runner may test stale compiled service

## Claim or decision

> The inventory concurrency integration runner can silently validate a stale compiled inventoryService.js: it compiles the test but only checks that the service's dist file exists, then the test imports that dist file. If inventoryService.ts changes after the last compile, a passing test may not cover the current source. The runner should compile or verify the service source/build relationship before interpreting DB-test results as current-source evidence.

## Rationale / consequence

> This is a reusable validation-safety risk for EverShop's src-to-dist test workflow and could prevent false confidence in a concurrency regression test.

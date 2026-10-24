# Concurrency control

- **Map ID:** `map-concurrency-control`
- **Collection:** `AgenticLab/project-knowledge` (`AgenticLab/knowledge/`)
- **Scope:** `multi-warehouse-inventory`
- **Purpose:** Route tasks about concurrency behavior in inventory operations to relevant project records.
- **Aliases / trigger terms:** `advisory lock`, `concurrency`, `pg_advisory_xact_lock`, `reserve inventory`, `serialize reserve`, `concurrent reservation`, `inventory lock`, `multi-warehouse reserve`

## Concepts and routes

### Inventory reservation serialization

Use this route for questions about concurrent inventory reservations and their serialization behavior.

- **Records:** [Advisory lock serializes concurrent inventory reservations](../pbi-2-advisory-lock-concurrency.md) — `pbi-2-advisory-lock-concurrency`

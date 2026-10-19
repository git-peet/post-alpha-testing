# Full-Scope AgenticLab V5 PBIs

PBIs designed for the post-integration-delivery workspace (EverShop v2.2.1 + PostgreSQL). These are scoped to fully test the integrated knowledge-capture harness, metrics pipeline, and workspace adapter suite. Scope, test setup, and evaluation are agreed separately before work begins.

---

## PBI 1 — Dynamic Pricing Rule Builder

### User story

As an admin, I want to define and manage pricing rules (e.g., percentage discounts, minimum/maximum prices, customer-segment targeting) through a UI, so that rules are persisted in the database and evaluated at checkout.

### Acceptance criteria

- New `pricing_rules` table in PostgreSQL with columns: `id`, `name`, `description`, `condition_json`, `action_json`, `priority`, `status`, `created_at`, `updated_at`
- Admin UI form to create rules with:
  - Condition: discount percentage, minimum cart amount, customer-segment filter
  - Action: fixed discount, percentage discount, free-shipping flag
  - Scope: product-category, customer-group, date-range
- Rules have `status: pending | active | archived`
- API endpoint `GET /api/pricing-rules` returns all active rules
- API endpoint `POST /api/cart/apply-discount` applies all matching rules to a cart and returns the updated total
- Checkout reflects discounted line totals
- Duplicate rule prevention (same condition + action cannot both be active)
- **Knowledge-capture integration:**
  - Each rule creation triggers a `candidate_staged` metric event (JSONL logged to `.pi/metrics/agenticlab.jsonl`)
  - Admin must review & approve each staged rule before it becomes `active`
  - Archived rule history is retrievable via `/knowledge-opt-in` query

### Metrics test target

High frequency of `candidate_staged` events during rule design; `promotion_approved` events when rules go live; `retrieval_success` when debugging active/inactive rule states.

---

## PBI 2 — Multi-Warehouse Inventory with Low-Stock Alerts

### User story

As a store operator, I want to track product stock across multiple warehouse locations and receive low-stock alerts, so I can fulfill orders from the best-supplied location.

### Acceptance criteria

- New database tables:
  - `warehouses`: id, name, location, timezone, is_active
  - `inventory`: id, product_id, warehouse_id, quantity, last_checked_at
  - `stock_alerts`: id, product_id, warehouse_id, min_threshold, alert_sent, created_at, updated_at
- API endpoints:
  - `GET /api/inventory?product_id=X` returns per-warehouse quantities
  - `POST /api/inventory/reserve` reserves stock for an order (optimistic lock or advisory lock)
  - `GET /api/alerts` returns unprocessed low-stock alerts
- Admin UI dashboard showing:
  - Table of products + per-warehouse stock levels
  - Color-coded low-stock indicators
  - Bulk update min-threshold per product
- Notification trigger: when inventory crosses below min_threshold, create `stock_alert` row
- **Knowledge-capture integration:**
  - `candidate_staged` for each alert-threshold configuration proposed
  - `decision_knowledge` events when operator approves/rejects threshold changes
  - `retrieval_success` when auditing alert history for a product

### Metrics test target

Medium frequency of staging events for threshold proposals; retrieval events when auditing alert history across time.

---

## PBI 3 — Persistent Customer Wishlist (original PBI 3)

### User story

As a signed-in customer, I want to save products to a wishlist and revisit them later, so I can keep track of products I may want to buy.

### Acceptance criteria

- A signed-in customer can add and remove products from a wishlist that persists across sessions
- Wishlist reads and writes are scoped to the authenticated customer; one customer cannot read or modify another customer's wishlist
- Duplicate saves are handled consistently
- Missing, deleted, or unavailable products are handled safely when displaying saved items
- The storefront provides understandable loading, empty, populated, and error states, with a way to return to a saved product
- Service/API tests verify persistence and customer isolation against an isolated disposable PostgreSQL database; they do not use a shared development or production database
- User-facing tests cover the main wishlist flow
- **Knowledge-capture integration:**
  - Each `add_to_wishlist` event triggers `candidate_staged` with scope `project:post-integration-delivery`
  - Wishlist migration from session to persistent customer record triggers `promotion_approved`
  - Metrics events logged to `.pi/metrics/agenticlab.jsonl`

---

## PBI 4 — Faceted Product Search Configuration

### User story

As an admin, I want to configure faceted search (price ranges, category filters, relevance weights) without code changes, so shoppers can find products more effectively.

### Acceptance criteria

- New database table `search_config` with columns: id, facet_name, facet_type (price|category|attribute), config_json, is_active
- Admin UI to add/edit facets:
  - Define price ranges (e.g., "Under $25", "$25-$50", "$50+")
  - Define category checkboxes from the product catalog
  - Set relevance weight for each facet (slider 1-10)
- API endpoint `GET /api/search-config` returns all active search configs
- API endpoint `POST /api/search` accepts query params and returns products with facet counts
- Search results page renders facets and applied filters
- Persisted config survives app restarts
- **Knowledge-capture integration:**
  - `candidate_staged` for each new facet proposal
  - `decision_knowledge` when admin confirms or revises facet weights
  - `retrieval_success` when searching previous configs for A/B testing

### Metrics test target

Medium frequency of staging events for facet proposals; retrieval events when reviewing search config history.

---

## PBI 5 — Order Approval Workflow with Role-Based Permissions

### User story

As a team, we want orders above a monetary threshold to require manager approval before fulfillment, with a complete audit trail.

### Acceptance criteria

- New database table `order_approvals`: id, order_id, manager_id, status (pending | approved | rejected), reviewed_at, reason_json
- API endpoint `POST /api/orders/:id/submit-for-approval` creates pending approval record
- API endpoint `POST /api/approvals/:id/approve` approves (changes status to approved, triggers fulfillment)
- API endpoint `POST /api/approvals/:id/reject` rejects (changes status to rejected, notifies customer)
- Role-based access: only users with `can_approve_orders` permission can approve
- Admin UI shows pending approvals queue with order details and approve/reject buttons
- Email notification sent to customer when order is approved or rejected
- Audit trail: every status change logged with who, when, and why
- **Knowledge-capture integration:**
  - `candidate_staged` for each new approval-threshold proposal
  - `decision_knowledge` when manager approves or rejects
  - `promotion_approved` when workflow goes from "prototype" to "production"
  - Full audit trail stored as knowledge candidates retrievable via `/knowledge-opt-in`

### Metrics test target

Decision-dense PBI: many `candidate_staging` events for threshold proposals; many `decision_knowledge` events for approve/reject; `promotion_approved` when workflow is finalized.

---

## How to Use This Document

1. **Stage** a PBI as a knowledge candidate using the harness (`/knowledge-opt-in`)
2. **Review** the staged candidate; the metrics JSONL will record `candidate_staged` events
3. **Promote** approved PBIs through the pending queue (`promotion_approved` metric)
4. **Retrieve** lessons learned via `.pi/metrics/agenticlab.jsonl` after completion

---

*These PBIs are designed to exercise the full harness stack: knowledge-write-gate, pending isolation, metrics JSONL collection, and the 20/20 adapter test suite. Each PBI includes explicit knowledge-capture integration points so the metrics pipeline can measure where and how reasoning is triggered during implementation.*
import { CONSTANTS } from '../../../lib/helpers.js';
import { getConnection, pool } from '../../../lib/postgres/connection.js';
import { commit, rollback, startTransaction } from '../../../lib/postgres/query.js';

export interface ThresholdChange {
  product_id: number;
  warehouse_id: number;
  min_threshold: number;
}

export class InventoryServiceError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = 'InventoryServiceError';
  }
}

function positiveInteger(value: unknown, field: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new InventoryServiceError(`${field} must be a positive integer`, 400);
  }
  return number;
}

export async function getInventoryGrid(options: { productId?: unknown; page?: unknown; pageSize?: unknown } = {}) {
  const productId = options.productId === undefined || options.productId === null || options.productId === ''
    ? undefined
    : positiveInteger(options.productId, 'product_id');
  const page = options.page === undefined ? 1 : positiveInteger(options.page, 'page');
  const pageSize = options.pageSize === undefined ? 50 : Math.min(100, positiveInteger(options.pageSize, 'page_size'));
  const offset = (page - 1) * pageSize;
  const filter = productId === undefined ? '' : ' AND p.product_id = $1';
  const countParams = productId === undefined ? [] : [productId];
  const count = await pool.query(
    `SELECT COUNT(*)::int AS total FROM product p CROSS JOIN warehouses w WHERE w.is_active = true${filter}`,
    countParams
  );
  const params: Array<number> = productId === undefined
    ? [pageSize, offset]
    : [productId, pageSize, offset];
  const limitIndex = productId === undefined ? '$1' : '$2';
  const offsetIndex = productId === undefined ? '$2' : '$3';
  const result = await pool.query(
    `SELECT p.product_id, p.sku, w.id AS warehouse_id, w.name AS warehouse_name,
            w.location, COALESCE(i.quantity, 0)::int AS quantity, i.last_checked_at,
            sa.min_threshold,
            (sa.id IS NOT NULL AND COALESCE(i.quantity, 0) < sa.min_threshold) AS is_low_stock
       FROM product p
       CROSS JOIN warehouses w
       LEFT JOIN inventory i ON i.product_id = p.product_id AND i.warehouse_id = w.id
       LEFT JOIN stock_alerts sa ON sa.product_id = p.product_id AND sa.warehouse_id = w.id
      WHERE w.is_active = true${filter}
      ORDER BY p.product_id, w.name
      LIMIT ${limitIndex} OFFSET ${offsetIndex}`,
    [...countParams, ...params.slice(countParams.length)]
  );
  return { rows: result.rows, total: count.rows[0].total, page, pageSize };
}

export async function getInventoryByProduct(productIdInput: unknown) {
  const result = await getInventoryGrid({ productId: productIdInput, pageSize: 100 });
  return result.rows;
}

export async function getWarehouses() {
  const result = await pool.query(
    'SELECT id, name, location, timezone, is_active FROM warehouses WHERE is_active = true ORDER BY name ASC'
  );
  return result.rows;
}

export async function createWarehouse(input: { name?: unknown; location?: unknown; timezone?: unknown }) {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const location = typeof input.location === 'string' ? input.location.trim() : '';
  const timezone = typeof input.timezone === 'string' && input.timezone.trim() ? input.timezone.trim() : 'UTC';
  if (!name || name.length > 255) throw new InventoryServiceError('Warehouse name is required and must be at most 255 characters', 400);
  try {
    Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    throw new InventoryServiceError('Invalid IANA timezone', 400);
  }
  const result = await pool.query(
    'INSERT INTO warehouses (name, location, timezone) VALUES ($1, $2, $3) RETURNING id, name, location, timezone, is_active',
    [name, location, timezone]
  );
  return result.rows[0];
}

export function normalizeThresholdChanges(inputs: unknown): ThresholdChange[] {
  if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > 500) {
    throw new InventoryServiceError('thresholds must contain 1 to 500 entries', 400);
  }
  const seen = new Set<string>();
  return inputs.map((input: any) => {
    const product_id = positiveInteger(input?.product_id, 'product_id');
    const warehouse_id = positiveInteger(input?.warehouse_id, 'warehouse_id');
    const min_threshold = Number(input?.min_threshold);
    if (!Number.isSafeInteger(min_threshold) || min_threshold < 0) {
      throw new InventoryServiceError('min_threshold must be a nonnegative integer', 400);
    }
    const key = `${product_id}:${warehouse_id}`;
    if (seen.has(key)) throw new InventoryServiceError('Duplicate product/warehouse threshold entry', 400);
    seen.add(key);
    return { product_id, warehouse_id, min_threshold };
  });
}

export function crossedBelowThreshold(previousQuantity: number, currentQuantity: number, threshold: number): boolean {
  return previousQuantity >= threshold && currentQuantity < threshold;
}

export function normalizeInventoryAdjustments(inputs: unknown) {
  if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > 500) {
    throw new InventoryServiceError('adjustments must contain 1 to 500 entries', 400);
  }
  const seen = new Set<string>();
  return inputs.map((input: any) => {
    const product_id = positiveInteger(input?.product_id, 'product_id');
    const warehouse_id = positiveInteger(input?.warehouse_id, 'warehouse_id');
    const quantity = Number(input?.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 0) {
      throw new InventoryServiceError('quantity must be a nonnegative integer', 400);
    }
    const key = `${product_id}:${warehouse_id}`;
    if (seen.has(key)) throw new InventoryServiceError('Duplicate product/warehouse adjustment', 400);
    seen.add(key);
    return { product_id, warehouse_id, quantity };
  });
}

export async function adjustInventory(inputs: unknown) {
  const adjustments = normalizeInventoryAdjustments(inputs);
  const connection = await getConnection();
  await startTransaction(connection);
  try {
    for (const adjustment of adjustments) {
      await connection.query('SELECT pg_advisory_xact_lock($1::integer, $2::integer)', [adjustment.product_id, adjustment.warehouse_id]);
      const pairExists = await connection.query(
        `SELECT p.product_id FROM product p JOIN warehouses w ON w.id = $2 AND w.is_active = true WHERE p.product_id = $1 FOR UPDATE OF w`,
        [adjustment.product_id, adjustment.warehouse_id]
      );
      if (!pairExists.rowCount) throw new InventoryServiceError('Product or active warehouse not found', 404);
      const previous = await connection.query(
        'SELECT quantity FROM inventory WHERE product_id = $1 AND warehouse_id = $2 FOR UPDATE',
        [adjustment.product_id, adjustment.warehouse_id]
      );
      const previousQuantity = Number(previous.rows[0]?.quantity ?? 0);
      await connection.query(
        `INSERT INTO inventory (product_id, warehouse_id, quantity, last_checked_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
         ON CONFLICT (product_id, warehouse_id)
         DO UPDATE SET quantity = EXCLUDED.quantity, last_checked_at = CURRENT_TIMESTAMP`,
        [adjustment.product_id, adjustment.warehouse_id, adjustment.quantity]
      );
      const threshold = await connection.query(
        'SELECT min_threshold FROM stock_alerts WHERE product_id = $1 AND warehouse_id = $2 FOR UPDATE',
        [adjustment.product_id, adjustment.warehouse_id]
      );
      if (threshold.rows.length && crossedBelowThreshold(previousQuantity, adjustment.quantity, Number(threshold.rows[0].min_threshold))) {
        await connection.query(
          'UPDATE stock_alerts SET alert_sent = false, updated_at = CURRENT_TIMESTAMP WHERE product_id = $1 AND warehouse_id = $2',
          [adjustment.product_id, adjustment.warehouse_id]
        );
      }
    }
    await commit(connection);
    return { updated: adjustments.length };
  } catch (error) {
    await rollback(connection);
    throw error;
  }
}

export async function proposeThresholdChanges(inputs: unknown) {
  const changes = normalizeThresholdChanges(inputs);
  for (const change of changes) {
    const exists = await pool.query(
      `SELECT 1 FROM product p JOIN warehouses w ON w.id = $2 AND w.is_active = true WHERE p.product_id = $1`,
      [change.product_id, change.warehouse_id]
    );
    if (!exists.rowCount) throw new InventoryServiceError('Product or active warehouse not found', 404);
  }
  return changes;
}

export async function decideThresholdChanges(inputs: unknown, decision: unknown) {
  if (decision !== 'approve' && decision !== 'reject') {
    throw new InventoryServiceError('decision must be approve or reject', 400);
  }
  const changes = normalizeThresholdChanges(inputs);

  if (decision === 'approve') {
    const connection = await getConnection();
    await startTransaction(connection);
    try {
      for (const change of changes) {
        const pairExists = await connection.query(
          `SELECT p.product_id FROM product p JOIN warehouses w ON w.id = $2 AND w.is_active = true WHERE p.product_id = $1 FOR UPDATE OF w`,
          [change.product_id, change.warehouse_id]
        );
        if (!pairExists.rowCount) throw new InventoryServiceError('Product or active warehouse not found', 404);
        const inventory = await connection.query(
          'SELECT quantity FROM inventory WHERE product_id = $1 AND warehouse_id = $2 FOR UPDATE',
          [change.product_id, change.warehouse_id]
        );
        const currentQuantity = Number(inventory.rows[0]?.quantity ?? 0);
        if (!inventory.rows.length) {
          await connection.query(
            'INSERT INTO inventory (product_id, warehouse_id, quantity) VALUES ($1, $2, 0) ON CONFLICT (product_id, warehouse_id) DO NOTHING',
            [change.product_id, change.warehouse_id]
          );
        }
        const belowThreshold = currentQuantity < change.min_threshold;
        await connection.query(
          `INSERT INTO stock_alerts (product_id, warehouse_id, min_threshold, alert_sent)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (product_id, warehouse_id)
           DO UPDATE SET min_threshold = EXCLUDED.min_threshold,
                         alert_sent = EXCLUDED.alert_sent,
                         updated_at = CURRENT_TIMESTAMP`,
          [change.product_id, change.warehouse_id, change.min_threshold, !belowThreshold]
        );
      }
      await commit(connection);
    } catch (error) {
      await rollback(connection);
      throw error;
    }
  }
  return { decision, count: changes.length };
}

export async function reserveInventory(productInput: unknown, warehouseInput: unknown, quantityInput: unknown) {
  const productId = positiveInteger(productInput, 'product_id');
  const warehouseId = positiveInteger(warehouseInput, 'warehouse_id');
  const quantity = positiveInteger(quantityInput, 'qty');
  const connection = await getConnection();
  await startTransaction(connection);
  try {
    await connection.query('SELECT pg_advisory_xact_lock($1::integer, $2::integer)', [productId, warehouseId]);
    const selected = await connection.query(
      `SELECT i.quantity FROM inventory i JOIN warehouses w ON w.id = i.warehouse_id AND w.is_active = true
        WHERE i.product_id = $1 AND i.warehouse_id = $2 FOR UPDATE OF i`,
      [productId, warehouseId]
    );
    if (!selected.rows.length) throw new InventoryServiceError('Inventory not found for warehouse', 404);
    const available = Number(selected.rows[0].quantity);
    if (available < quantity) throw new InventoryServiceError('Insufficient stock', 400);
    const remaining = available - quantity;
    await connection.query(
      'UPDATE inventory SET quantity = $1, last_checked_at = CURRENT_TIMESTAMP WHERE product_id = $2 AND warehouse_id = $3',
      [remaining, productId, warehouseId]
    );
    const threshold = await connection.query(
      'SELECT min_threshold, alert_sent FROM stock_alerts WHERE product_id = $1 AND warehouse_id = $2 FOR UPDATE',
      [productId, warehouseId]
    );
    if (threshold.rows.length && crossedBelowThreshold(
      available,
      remaining,
      Number(threshold.rows[0].min_threshold)
    )) {
      await connection.query(
        'UPDATE stock_alerts SET alert_sent = false, updated_at = CURRENT_TIMESTAMP WHERE product_id = $1 AND warehouse_id = $2',
        [productId, warehouseId]
      );
    }
    await commit(connection);
    return { product_id: productId, warehouse_id: warehouseId, reserved_qty: quantity, remaining_qty: remaining };
  } catch (error) {
    await rollback(connection);
    throw error;
  }
}

export async function getOpenStockAlerts(productIdInput?: unknown) {
  let productId: number | undefined;
  if (productIdInput !== undefined && productIdInput !== null && productIdInput !== '') {
    productId = positiveInteger(productIdInput, 'product_id');
  }
  const params: number[] = [];
  let productFilter = '';
  if (productId !== undefined) {
    params.push(productId);
    productFilter = ' AND sa.product_id = $1';
  }
  const result = await pool.query(
    `SELECT sa.id, sa.product_id, sa.warehouse_id, w.name AS warehouse_name,
            sa.min_threshold, i.quantity, sa.alert_sent, sa.created_at, sa.updated_at
       FROM stock_alerts sa
       JOIN inventory i ON i.product_id = sa.product_id AND i.warehouse_id = sa.warehouse_id
       JOIN warehouses w ON w.id = sa.warehouse_id
      WHERE sa.alert_sent = false AND i.quantity < sa.min_threshold${productFilter}
      ORDER BY sa.created_at DESC`,
    params
  );
  return result.rows;
}
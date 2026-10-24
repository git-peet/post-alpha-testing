import { pool } from '../../../lib/postgres/connection.js';

export interface WishlistItem {
  productUuid: string;
  name: string | null;
  unavailable: boolean;
  outOfStock: boolean;
  createdAt: Date;
}

/**
 * Read only the authenticated customer's saved products. Product UUIDs are
 * intentionally not foreign-keyed across modules; a deleted product remains
 * representable as an unavailable, removable wishlist entry.
 */
export async function getWishlistItems(customerId: number, db = pool) {
  const result = await db.query(
    `SELECT
       item.product_uuid::text AS product_uuid,
       item.created_at,
       product.status AS product_status,
       product.uuid AS existing_product_uuid,
       description.name AS product_name,
       inventory.product_inventory_product_id AS inventory_product_id,
       inventory.manage_stock,
       inventory.qty,
       inventory.stock_availability
     FROM customer_wishlist_item AS item
     LEFT JOIN product ON product.uuid = item.product_uuid
     LEFT JOIN product_description AS description
       ON description.product_description_product_id = product.product_id
     LEFT JOIN product_inventory AS inventory
       ON inventory.product_inventory_product_id = product.product_id
     WHERE item.customer_id = $1
     ORDER BY item.created_at DESC, item.customer_wishlist_item_id DESC`,
    [customerId]
  );

  return result.rows.map((row): WishlistItem => {
    const canVisitProduct =
      row.product_status === true && row.inventory_product_id !== null;
    const isInStock =
      (Number(row.qty) > 0 && row.stock_availability === true) ||
      row.manage_stock === false;
    const productUuid = row.product_uuid as string;

    return {
      productUuid,
      name: row.product_name ?? null,
      unavailable: !canVisitProduct,
      outOfStock: canVisitProduct && !isInStock,
      createdAt: row.created_at
    };
  });
}

/** Add is safe to retry; the unique constraint also resolves concurrent saves. */
export async function addWishlistItem(
  customerId: number,
  productUuid: string,
  db = pool
): Promise<boolean> {
  const product = await db.query(
    `SELECT product.uuid
       FROM product
       INNER JOIN product_inventory
         ON product_inventory.product_inventory_product_id = product.product_id
      WHERE product.uuid = $1 AND product.status = TRUE`,
    [productUuid]
  );
  if (product.rowCount === 0) {
    return false;
  }

  await db.query(
    `INSERT INTO customer_wishlist_item (customer_id, product_uuid)
     VALUES ($1, $2)
     ON CONFLICT (customer_id, product_uuid) DO NOTHING`,
    [customerId, productUuid]
  );
  return true;
}

/** Removal is scoped by customer and idempotent for missing entries. */
export async function removeWishlistItem(
  customerId: number,
  productUuid: string,
  db = pool
): Promise<void> {
  await db.query(
    `DELETE FROM customer_wishlist_item
      WHERE customer_id = $1 AND product_uuid = $2`,
    [customerId, productUuid]
  );
}

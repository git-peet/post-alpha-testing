import { pool, startTransaction } from '../../../lib/postgres/connection';

export default async (request, response) => {
  const { product_id, warehouse_id, qty } = request.body || {};
  try {
    const connection = await pool.connect();
    await startTransaction(connection);
    try {
      const result = await connection.query(
        `SELECT quantity FROM inventory WHERE product_id = $1 AND warehouse_id = $2 FOR UPDATE`,
        [Number(product_id), Number(warehouse_id)]
      );
      if (result.rows.length === 0) {
        await connection.query('ROLLBACK');
        return response.status(400).json({ error: { message: 'Inventory not found for warehouse' } });
      }
      const available = result.rows[0].quantity;
      const reserveQty = Number(qty) || 0;
      if (available < reserveQty) {
        await connection.query('ROLLBACK');
        return response.status(400).json({ error: { message: 'Insufficient stock' } });
      }
      await connection.query(
        `UPDATE inventory SET quantity = quantity - $1, last_checked_at = CURRENT_TIMESTAMP WHERE product_id = $2 AND warehouse_id = $3`,
        [reserveQty, Number(product_id), Number(warehouse_id)]
      );
      await connection.query('COMMIT');
      return response.status(200).json({ data: { reserved_qty: reserveQty, remaining_qty: available - reserveQty } });
    } catch (e) {
      await connection.query('ROLLBACK');
      throw e;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Reserve error:', error);
    return response.status(500).json({ error: { message: 'Reserve failed' } });
  }
};
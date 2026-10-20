import { pool } from '../../../lib/postgres/connection';

export default async (request, response) => {
  try {
    const productId = request.query.product_id ? Number(request.query.product_id) : null;
    let sql = `SELECT i.*, w.name as warehouse_name, w.location, w.timezone FROM inventory i JOIN warehouses w ON i.warehouse_id = w.id WHERE w.is_active = true`;
    const params: any[] = [];
    if (productId) {
      sql += ' AND i.product_id = $1';
      params.push(productId);
    }
    sql += ' ORDER BY w.name ASC';
    const result = await pool.query(sql, params);
    return response.status(200).json({
      data: result.rows.map((row) => ({
        id: row.id,
        product_id: row.product_id,
        warehouse_id: row.warehouse_id,
        warehouse_name: row.warehouse_name,
        quantity: row.quantity,
        last_checked_at: row.last_checked_at
      }))
    });
  } catch (error) {
    console.error('Inventory query error:', error);
    return response.status(500).json({ error: { message: 'Server error' } });
  }
};
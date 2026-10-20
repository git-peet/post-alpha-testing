import { pool } from '../../../lib/postgres/connection';

export default async (request, response) => {
  try {
    const result = await pool.query(
      `SELECT sa.*, w.name as warehouse_name FROM stock_alerts sa JOIN warehouses w ON sa.warehouse_id = w.id WHERE sa.alert_sent = false ORDER BY sa.created_at DESC`
    );
    return response.status(200).json({ data: result.rows });
  } catch (error) {
    console.error('Alerts query error:', error);
    return response.status(500).json({ error: { message: 'Server error' } });
  }
};
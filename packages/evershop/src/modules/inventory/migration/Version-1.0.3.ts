import { execute } from '@evershop/postgres-query-builder';

export default async (connection: any): Promise<void> => {
  await execute(
    connection,
    `CREATE UNIQUE INDEX stock_alerts_product_warehouse_unique
       ON stock_alerts(product_id, warehouse_id)`
  );
};
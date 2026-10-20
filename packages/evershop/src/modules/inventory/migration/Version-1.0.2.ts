import { execute } from '@evershop/postgres-query-builder';

export default async (connection: any): Promise<void> => {
  await execute(
    connection,
    `CREATE TABLE stock_alerts (
      id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      product_id INT NOT NULL,
      warehouse_id INT NOT NULL,
      min_threshold INT NOT NULL DEFAULT 0,
      alert_sent BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT stock_alerts_product_fk FOREIGN KEY (product_id) REFERENCES product (product_id) ON DELETE CASCADE,
      CONSTRAINT stock_alerts_warehouse_fk FOREIGN KEY (warehouse_id) REFERENCES warehouses (id) ON DELETE CASCADE,
      CONSTRAINT stock_alerts_threshold_nonnegative CHECK (min_threshold >= 0)
    )`
  );
  await execute(
    connection,
    `CREATE INDEX stock_alerts_product_warehouse_idx ON stock_alerts(product_id, warehouse_id)`
  );
  await execute(
    connection,
    `CREATE INDEX stock_alerts_sent_idx ON stock_alerts(alert_sent)`
  );
};
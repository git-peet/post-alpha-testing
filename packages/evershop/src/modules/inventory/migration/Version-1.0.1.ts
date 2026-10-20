import { execute } from '@evershop/postgres-query-builder';

export default async (connection: any): Promise<void> => {
  await execute(
    connection,
    `CREATE TABLE inventory (
      id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      product_id INT NOT NULL,
      warehouse_id INT NOT NULL,
      quantity INT NOT NULL DEFAULT 0,
      last_checked_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT inventory_product_fk FOREIGN KEY (product_id) REFERENCES product (product_id) ON DELETE CASCADE,
      CONSTRAINT inventory_warehouse_fk FOREIGN KEY (warehouse_id) REFERENCES warehouses (id) ON DELETE CASCADE,
      CONSTRAINT inventory_quantity_nonnegative CHECK (quantity >= 0)
    )`
  );
  await execute(
    connection,
    `CREATE INDEX inventory_warehouse_idx ON inventory(warehouse_id)`
  );
  await execute(
    connection,
    `CREATE UNIQUE INDEX inventory_product_warehouse_unique ON inventory(product_id, warehouse_id)`
  );
};
import { execute, type PoolClient } from '@evershop/postgres-query-builder';

export default async (connection: PoolClient): Promise<void> => {
  await execute(
    connection,
    `CREATE TABLE "customer_wishlist_item" (
      "customer_wishlist_item_id" INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      "customer_id" INT NOT NULL,
      "product_uuid" UUID NOT NULL,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "FK_CUSTOMER_WISHLIST_CUSTOMER"
        FOREIGN KEY ("customer_id") REFERENCES "customer" ("customer_id") ON DELETE CASCADE,
      CONSTRAINT "CUSTOMER_WISHLIST_PRODUCT_UNIQUE"
        UNIQUE ("customer_id", "product_uuid")
    )`
  );
};

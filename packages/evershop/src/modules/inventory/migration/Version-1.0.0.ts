import { execute } from '@evershop/postgres-query-builder';

export default async (connection: any): Promise<void> => {
  await execute(
    connection,
    `CREATE TABLE warehouses (
      id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      location VARCHAR(255) NOT NULL DEFAULT '',
      timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  );
  await execute(
    connection,
    `CREATE INDEX warehouses_active_idx ON warehouses(is_active)`
  );
};
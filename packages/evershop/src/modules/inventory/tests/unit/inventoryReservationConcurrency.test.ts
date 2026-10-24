import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

type ReservationInput = {
  productId: number;
  warehouseId: number;
  quantity: number;
};

type ReservationResult = {
  product_id: number;
  warehouse_id: number;
  reserved_qty: number;
  remaining_qty: number;
};

const enabled = process.env.INVENTORY_TEST_DATABASE === '1';
const host = process.env.INVENTORY_TEST_DB_HOST;
const port = Number.parseInt(process.env.INVENTORY_TEST_DB_PORT || '', 10);
const user = process.env.INVENTORY_TEST_DB_USER;
const password = process.env.INVENTORY_TEST_DB_PASSWORD;
const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1']);

if (!enabled && process.env.INVENTORY_REQUIRE_POSTGRES === '1') {
  throw new Error(
    'Inventory concurrency integration tests require INVENTORY_TEST_DATABASE=1 and a dedicated disposable PostgreSQL target.'
  );
}

if (enabled) {
  if (!host || !loopbackHosts.has(host)) {
    throw new Error(
      'Inventory concurrency tests refuse non-loopback PostgreSQL hosts.'
    );
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 5432) {
    throw new Error(
      'Set INVENTORY_TEST_DB_PORT to a dedicated test port (not the shared development port 5432).'
    );
  }
  if (!user || !password) {
    throw new Error(
      'INVENTORY_TEST_DB_USER and INVENTORY_TEST_DB_PASSWORD are required.'
    );
  }
  if (process.env.INVENTORY_TEST_DB_DISPOSABLE !== '1') {
    throw new Error(
      'Set INVENTORY_TEST_DB_DISPOSABLE=1 only after verifying this is a dedicated disposable test PostgreSQL instance.'
    );
  }
  if (
    process.env.DB_HOST === host &&
    Number.parseInt(process.env.DB_PORT || '', 10) === port
  ) {
    throw new Error(
      'The inventory test target matches the application DB endpoint; refusing to run.'
    );
  }
}

const describeDatabase = enabled ? describe : describe.skip;
const databaseNamePrefix = 'evershop_inventory_concurrency';
const originalDbEnvironment = new Map<string, string | undefined>();
const dbEnvironmentKeys = [
  'DB_HOST',
  'DB_PORT',
  'DB_USER',
  'DB_PASSWORD',
  'DB_NAME',
  'DB_SSLMODE'
];

let adminPool: Pool | undefined;
let fixturePool: Pool | undefined;
let observerPool: Pool | undefined;
let appPool: Pool | undefined;
let testDatabaseName: string | undefined;
let testDatabaseCreated = false;
let reserveInventory!: (
  productId: unknown,
  warehouseId: unknown,
  quantity: unknown
) => Promise<ReservationResult>;

jest.setTimeout(120000);

async function closePool(pool: Pool | undefined): Promise<void> {
  if (pool) {
    await pool.end();
  }
}

async function cleanup(): Promise<void> {
  await Promise.all([
    closePool(appPool),
    closePool(observerPool),
    closePool(fixturePool)
  ]);
  appPool = undefined;
  observerPool = undefined;
  fixturePool = undefined;

  if (adminPool && testDatabaseName && testDatabaseCreated) {
    await adminPool.query(`DROP DATABASE "${testDatabaseName}" WITH (FORCE)`);
    testDatabaseCreated = false;
  }
  await closePool(adminPool);
  adminPool = undefined;

  originalDbEnvironment.forEach((value, key) => {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  });
}

async function createProduct() {
  const result = await fixturePool!.query(
    'INSERT INTO product DEFAULT VALUES RETURNING product_id'
  );
  return Number(result.rows[0].product_id);
}

async function createWarehouse(productId: number, quantity: number) {
  const warehouse = await fixturePool!.query(
    'INSERT INTO warehouses (name) VALUES ($1) RETURNING id',
    [`test-warehouse-${randomUUID()}`]
  );
  const warehouseId = Number(warehouse.rows[0].id);
  await fixturePool!.query(
    `INSERT INTO inventory (product_id, warehouse_id, quantity)
     VALUES ($1, $2, $3)`,
    [productId, warehouseId, quantity]
  );
  return warehouseId;
}

async function createFixture(quantity: number) {
  const productId = await createProduct();
  const warehouseId = await createWarehouse(productId, quantity);
  return { productId, warehouseId };
}

async function quantityAt(productId: number, warehouseId: number) {
  const result = await fixturePool!.query(
    'SELECT quantity FROM inventory WHERE product_id = $1 AND warehouse_id = $2',
    [productId, warehouseId]
  );
  return Number(result.rows[0]?.quantity);
}

function launchTogether(inputs: ReservationInput[]): Promise<ReservationResult>[] {
  let ready = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  return inputs.map(async ({ productId, warehouseId, quantity }) => {
    ready += 1;
    if (ready === inputs.length) {
      release();
    }
    await gate;
    return reserveInventory(productId, warehouseId, quantity);
  });
}

async function waitForCount(
  query: string,
  expected: number,
  label: string,
  timeoutMs = 10000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await observerPool!.query(query);
    if (Number(result.rows[0]?.count ?? 0) >= expected) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${label} (expected at least ${expected})`);
}

const ADVISORY_WAITER_COUNT = `SELECT COUNT(*)::int AS count
   FROM pg_locks AS lock
   JOIN pg_stat_activity AS activity ON activity.pid = lock.pid
  WHERE activity.datname = current_database()
    AND activity.pid <> pg_backend_pid()
    AND lock.locktype = 'advisory'
    AND lock.granted = false`;

async function waitForAdvisoryWaiters(expected: number): Promise<void> {
  await waitForCount(
    ADVISORY_WAITER_COUNT,
    expected,
    'advisory-lock waiters'
  );
}

async function waitForNoAdvisoryWaiters(): Promise<boolean> {
  const result = await observerPool!.query(ADVISORY_WAITER_COUNT);
  return Number(result.rows[0]?.count ?? 0) === 0;
}

async function waitForSleepingUpdates(expected: number): Promise<void> {
  await waitForCount(
    `SELECT COUNT(*)::int AS count
       FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND wait_event = 'PgSleep'
        AND query ILIKE 'UPDATE inventory SET quantity%'`,
    expected,
    'overlapping inventory updates'
  );
}

function expectInsufficientStockRejections(
  results: PromiseSettledResult<ReservationResult>[]
): number {
  const rejected = results.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected'
  );
  rejected.forEach((result) => {
    expect(result.reason).toMatchObject({ statusCode: 400, message: 'Insufficient stock' });
  });
  return rejected.length;
}

describeDatabase('inventory reservation concurrency (isolated disposable PostgreSQL)', () => {
  beforeAll(async () => {
    dbEnvironmentKeys.forEach((key) => originalDbEnvironment.set(key, process.env[key]));

    adminPool = new Pool({
      host,
      port,
      user,
      password,
      database: 'template1',
      ssl: false,
      max: 1,
      connectionTimeoutMillis: 5000
    });

    try {
      const serverVersion = await adminPool.query(
        `SELECT current_setting('server_version_num')::int AS version`
      );
      if (serverVersion.rows[0].version < 130000) {
        throw new Error('Inventory concurrency tests require PostgreSQL 13 or later.');
      }

      testDatabaseName = `${databaseNamePrefix}_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
      await adminPool.query(`CREATE DATABASE "${testDatabaseName}"`);
      testDatabaseCreated = true;

      process.env.DB_HOST = host;
      process.env.DB_PORT = String(port);
      process.env.DB_USER = user;
      process.env.DB_PASSWORD = password;
      process.env.DB_NAME = testDatabaseName;
      process.env.DB_SSLMODE = 'disable';

      const testPoolConfig = {
        host,
        port,
        user,
        password,
        database: testDatabaseName,
        ssl: false,
        max: 10,
        connectionTimeoutMillis: 5000
      };
      fixturePool = new Pool(testPoolConfig);
      observerPool = new Pool({ ...testPoolConfig, max: 2 });

      await fixturePool.query(`
        CREATE TABLE product (
          product_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY
        );
        CREATE TABLE warehouses (
          id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          is_active BOOLEAN NOT NULL DEFAULT TRUE
        );
        CREATE TABLE inventory (
          inventory_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          product_id INTEGER NOT NULL REFERENCES product(product_id),
          warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
          quantity INTEGER NOT NULL,
          last_checked_at TIMESTAMP WITH TIME ZONE,
          CONSTRAINT inventory_product_warehouse_unique UNIQUE (product_id, warehouse_id)
        );
        CREATE TABLE stock_alerts (
          id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          product_id INTEGER NOT NULL REFERENCES product(product_id),
          warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
          min_threshold INTEGER,
          alert_sent BOOLEAN,
          updated_at TIMESTAMP WITH TIME ZONE,
          CONSTRAINT stock_alerts_product_warehouse_unique UNIQUE (product_id, warehouse_id)
        );
        CREATE FUNCTION pbi4_delay_inventory_update()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          PERFORM pg_sleep(1.0);
          RETURN NEW;
        END;
        $$;
        CREATE TRIGGER pbi4_delay_inventory_update
        BEFORE UPDATE ON inventory
        FOR EACH ROW EXECUTE FUNCTION pbi4_delay_inventory_update();
      `);

      const connection = await import('../../../../lib/postgres/connection.js');
      appPool = connection.pool;
      ({ reserveInventory } = await import('../../services/inventoryService.js'));
    } catch (error) {
      await cleanup();
      throw error;
    }
  });

  afterAll(async () => cleanup());

  it.each([
    {
      label: 'two-way regression',
      parallelism: 2,
      initialStock: 5,
      quantity: 5,
      expectedSuccesses: 1,
      expectedFinal: 0
    },
    {
      label: 'three-way contention',
      parallelism: 3,
      initialStock: 7,
      quantity: 3,
      expectedSuccesses: 2,
      expectedFinal: 1
    },
    {
      label: 'five-way contention',
      parallelism: 5,
      initialStock: 10,
      quantity: 3,
      expectedSuccesses: 3,
      expectedFinal: 1
    }
  ])(
    '$label on one product/warehouse pair',
    async ({ parallelism, initialStock, quantity, expectedSuccesses, expectedFinal }) => {
      const { productId, warehouseId } = await createFixture(initialStock);
      const requests = Array.from({ length: parallelism }, () => ({
        productId,
        warehouseId,
        quantity
      }));
      const pending = launchTogether(requests);
      await waitForAdvisoryWaiters(parallelism - 1);
      const outcomes = await Promise.allSettled(pending);
      const successful = outcomes.filter(
        (outcome): outcome is PromiseFulfilledResult<ReservationResult> =>
          outcome.status === 'fulfilled'
      );
      const rejections = expectInsufficientStockRejections(outcomes);
      const finalQuantity = await quantityAt(productId, warehouseId);
      const reservedTotal = successful.reduce(
        (sum, outcome) => sum + outcome.value.reserved_qty,
        0
      );

      expect(successful).toHaveLength(expectedSuccesses);
      expect(rejections).toBe(parallelism - expectedSuccesses);
      expect(reservedTotal).toBeLessThanOrEqual(initialStock);
      expect(reservedTotal).toBe(initialStock - finalQuantity);
      expect(finalQuantity).toBe(expectedFinal);
      expect(finalQuantity).toBeGreaterThanOrEqual(0);
    }
  );

  it('allows same-product reservations in different warehouses to overlap independently', async () => {
    const first = await createFixture(4);
    const secondWarehouseId = await createWarehouse(first.productId, 4);
    const pending = launchTogether([
      { ...first, quantity: 2 },
      { productId: first.productId, warehouseId: secondWarehouseId, quantity: 2 }
    ]);

    await waitForSleepingUpdates(2);
    const outcomes = await Promise.allSettled(pending);
    expect(outcomes.every((outcome) => outcome.status === 'fulfilled')).toBe(true);
    expect(await quantityAt(first.productId, first.warehouseId)).toBe(2);
    expect(await quantityAt(first.productId, secondWarehouseId)).toBe(2);
    expect(await waitForNoAdvisoryWaiters()).toBe(true);
  });

  it('allows different-product reservations in one warehouse to overlap independently', async () => {
    const first = await createFixture(4);
    const secondProductId = await createProduct();
    await fixturePool!.query(
      `INSERT INTO inventory (product_id, warehouse_id, quantity)
       VALUES ($1, $2, $3)`,
      [secondProductId, first.warehouseId, 4]
    );
    const pending = launchTogether([
      { ...first, quantity: 2 },
      { productId: secondProductId, warehouseId: first.warehouseId, quantity: 2 }
    ]);

    await waitForSleepingUpdates(2);
    const outcomes = await Promise.allSettled(pending);
    expect(outcomes.every((outcome) => outcome.status === 'fulfilled')).toBe(true);
    expect(await quantityAt(first.productId, first.warehouseId)).toBe(2);
    expect(await quantityAt(secondProductId, first.warehouseId)).toBe(2);
    expect(await waitForNoAdvisoryWaiters()).toBe(true);
  });
});

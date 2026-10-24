import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { addRoute } from '../../../../lib/router/Router.js';
import type { EvershopRequest } from '../../../../types/request.js';
import type { EvershopResponse } from '../../../../types/response.js';

jest.setTimeout(60000);

const enabled = process.env.WISHLIST_TEST_DATABASE === '1';
const host = process.env.WISHLIST_TEST_DB_HOST || '127.0.0.1';
const port = Number.parseInt(process.env.WISHLIST_TEST_DB_PORT || '5433', 10);
const user = process.env.WISHLIST_TEST_DB_USER;
const password = process.env.WISHLIST_TEST_DB_PASSWORD;

const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1']);
let admin: Pool | undefined;
let testDbName: string | undefined;
let databasePool: Pool | undefined;
let appPool: Pool | undefined;
let customerA: number;
let customerB: number;
let activeProductUuid: string;
let inactiveProductUuid: string;
let outOfStockProductUuid: string;
let addApi: (request: EvershopRequest, response: EvershopResponse, next: () => void) => Promise<unknown>;
let getApi: (request: EvershopRequest, response: EvershopResponse, next: () => void) => Promise<unknown>;
let removeApi: (request: EvershopRequest, response: EvershopResponse, next: () => void) => Promise<unknown>;
let getWishlistItems: typeof import('../../services/wishlist.js').getWishlistItems;
let addWishlistItem: typeof import('../../services/wishlist.js').addWishlistItem;
let removeWishlistItem: typeof import('../../services/wishlist.js').removeWishlistItem;

if (!enabled && process.env.WISHLIST_REQUIRE_POSTGRES === '1') {
  throw new Error(
    'Run wishlist DB tests with WISHLIST_TEST_DATABASE=1 and WISHLIST_TEST_DB_* credentials only.'
  );
}

if (enabled) {
  if (!loopbackHosts.has(host)) {
    throw new Error(
      'Wishlist integration tests only connect to a loopback PostgreSQL host.'
    );
  }
  if (!user || !password) {
    throw new Error(
      'WISHLIST_TEST_DB_USER and WISHLIST_TEST_DB_PASSWORD must be set.'
    );
  }

  admin = new Pool({
    host,
    port,
    user,
    password,
    database: 'template1',
    ssl: false,
    max: 1
  });

  const serverVersion = await admin.query(
    `SELECT current_setting('server_version_num')::int AS version`
  );
  if (serverVersion.rows[0].version < 130000) {
    await admin.end();
    throw new Error('Wishlist tests require PostgreSQL 13 or later.');
  }

  testDbName = `evershop_wishlist_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  await admin.query(`CREATE DATABASE "${testDbName}"`);
  process.env.DB_NAME = testDbName;
  process.env.DB_SSLMODE = 'disable';
  process.env.DB_HOST = host;
  process.env.DB_PORT = String(port);
  process.env.DB_USER = user;
  process.env.DB_PASSWORD = password;

  addRoute({
    id: 'productView',
    method: ['GET'],
    path: '/product/:uuid',
    isAdmin: false
  });

  const connection = await import('../../../../lib/postgres/connection.js');
  appPool = connection.pool;
  const migration = (await import('../../migration/Version-1.0.5.js')).default;
  ({ getWishlistItems, addWishlistItem, removeWishlistItem } = await import('../../services/wishlist.js'));
  addApi = (await import('../../api/addToMyWishlist/addToMyWishlist.js')).default;
  getApi = (await import('../../api/getMyWishlist/getMyWishlist.js')).default;
  removeApi = (await import('../../api/removeFromMyWishlist/removeFromMyWishlist.js')).default;

  databasePool = new Pool({
    host,
    port,
    user,
    password,
    database: testDbName,
    ssl: false,
    max: 4
  });

  const migrationClient = await databasePool.connect();
  try {
    await databasePool.query(`
      CREATE TABLE customer (
        customer_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY
      );
      CREATE TABLE product (
        product_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
        status BOOLEAN NOT NULL DEFAULT TRUE
      );
      CREATE TABLE product_description (
        product_description_product_id INT PRIMARY KEY,
        name VARCHAR NOT NULL
      );
      CREATE TABLE product_inventory (
        product_inventory_product_id INT PRIMARY KEY,
        manage_stock BOOLEAN NOT NULL,
        qty INT NOT NULL,
        stock_availability BOOLEAN NOT NULL
      );
    `);
    await migration(migrationClient);
  } finally {
    migrationClient.release();
  }
}

const describeDatabase = enabled ? describe : describe.skip;

describeDatabase('customer wishlist service and API (dedicated isolated PostgreSQL)', () => {
  const createProduct = async (
    name: string,
    options: { status?: boolean; manageStock?: boolean; qty?: number; inStock?: boolean } = {}
  ) => {
    const productUuid = randomUUID();
    const product = await databasePool!.query(
      `INSERT INTO product (uuid, status) VALUES ($1, $2) RETURNING product_id`,
      [productUuid, options.status ?? true]
    );
    const productId = product.rows[0].product_id as number;
    await databasePool!.query(
      `INSERT INTO product_description (product_description_product_id, name) VALUES ($1, $2)`,
      [productId, name]
    );
    await databasePool!.query(
      `INSERT INTO product_inventory (product_inventory_product_id, manage_stock, qty, stock_availability)
       VALUES ($1, $2, $3, $4)`,
      [productId, options.manageStock ?? true, options.qty ?? 5, options.inStock ?? true]
    );
    return productUuid;
  };

  const callApi = async (
    handler: (request: EvershopRequest, response: EvershopResponse, next: () => void) => Promise<unknown>,
    customerId: number | undefined,
    body: Record<string, unknown> = {},
    params: Record<string, string> = {}
  ) => {
    const response: {
      statusCode: number;
      $body?: unknown;
      body?: unknown;
      status: (code: number) => typeof response;
      json: (value: unknown) => unknown;
    } = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(value) {
        this.body = value;
        return value;
      }
    };
    const request = {
      body,
      params,
      getCurrentCustomer: () =>
        customerId === undefined ? undefined : { customer_id: customerId }
    };
    await handler(
      request as unknown as EvershopRequest,
      response as unknown as EvershopResponse,
      () => undefined
    );
    return {
      status: response.statusCode,
      body: response.$body ?? response.body
    };
  };

  beforeAll(async () => {
    const customers = await databasePool!.query(
      `INSERT INTO customer VALUES (DEFAULT), (DEFAULT) RETURNING customer_id`
    );
    customerA = customers.rows[0].customer_id;
    customerB = customers.rows[1].customer_id;
    activeProductUuid = await createProduct('Available product');
    inactiveProductUuid = await createProduct('Now inactive product');
    outOfStockProductUuid = await createProduct('Out of stock product', {
      qty: 0,
      inStock: false
    });
  });

  afterAll(async () => {
    await appPool?.end();
    await databasePool?.end();
    if (admin && testDbName) {
      await admin.query(`DROP DATABASE "${testDbName}" WITH (FORCE)`);
    }
    await admin?.end();
  });

  it('persists one item per product and scopes every API operation to the authenticated customer', async () => {
    const firstAdd = await callApi(addApi, customerA, {
      product_uuid: activeProductUuid,
      customer_id: customerB
    });
    const duplicateAdd = await callApi(addApi, customerA, {
      product_uuid: activeProductUuid
    });
    expect(firstAdd.status).toBe(200);
    expect(duplicateAdd.status).toBe(200);

    const customerAItems = await callApi(getApi, customerA);
    const customerBItems = await callApi(getApi, customerB);
    expect(customerAItems.status).toBe(200);
    const customerAData = (
      customerAItems.body as { data: Array<{ productUrl: string | null }> }
    ).data;
    expect(customerAData).toHaveLength(1);
    expect(customerAData[0]?.productUrl).toMatch(
      new RegExp(`/product/${activeProductUuid}$`)
    );
    expect(customerBItems.status).toBe(200);
    expect((customerBItems.body as { data: unknown[] }).data).toHaveLength(0);

    await callApi(removeApi, customerB, {}, { product_uuid: activeProductUuid });
    const afterOtherCustomerRemoval = await callApi(getApi, customerA);
    expect((afterOtherCustomerRemoval.body as { data: unknown[] }).data).toHaveLength(1);

    await callApi(removeApi, customerA, {}, { product_uuid: activeProductUuid });
    await callApi(removeApi, customerA, {}, { product_uuid: activeProductUuid });
    const afterRemoval = await callApi(getApi, customerA);
    expect((afterRemoval.body as { data: unknown[] }).data).toHaveLength(0);
  });

  it('rejects anonymous API access and invalid product UUIDs', async () => {
    expect((await callApi(getApi, undefined)).status).toBe(401);
    expect(
      (await callApi(addApi, customerA, { product_uuid: 'not-a-uuid' })).status
    ).toBe(400);
  });

  it('represents inactive, out-of-stock, and deleted products safely', async () => {
    await addWishlistItem(customerA, inactiveProductUuid, databasePool!);
    await addWishlistItem(customerA, outOfStockProductUuid, databasePool!);
    const inactive = await databasePool!.query(
      `UPDATE product SET status = FALSE WHERE uuid = $1`,
      [inactiveProductUuid]
    );
    expect(inactive.rowCount).toBe(1);

    const items = await getWishlistItems(customerA, databasePool!);
    const inactiveItem = items.find((item) => item.productUuid === inactiveProductUuid);
    const outOfStockItem = items.find((item) => item.productUuid === outOfStockProductUuid);
    expect(inactiveItem?.unavailable).toBe(true);
    expect(outOfStockItem?.unavailable).toBe(false);
    expect(outOfStockItem?.outOfStock).toBe(true);

    await addWishlistItem(customerA, activeProductUuid, databasePool!);
    await databasePool!.query(`DELETE FROM product WHERE uuid = $1`, [activeProductUuid]);
    const deletedItem = (await getWishlistItems(customerA, databasePool!)).find(
      (item) => item.productUuid === activeProductUuid
    );
    expect(deletedItem?.name).toBeNull();
    expect(deletedItem?.unavailable).toBe(true);

    await removeWishlistItem(customerA, activeProductUuid, databasePool!);
  });
});
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1']);
const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = process.env.INVENTORY_TEST_DB_HOST;
const port = Number.parseInt(process.env.INVENTORY_TEST_DB_PORT || '', 10);
const user = process.env.INVENTORY_TEST_DB_USER;
const password = process.env.INVENTORY_TEST_DB_PASSWORD;

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
    'Set INVENTORY_TEST_DB_DISPOSABLE=1 only after verifying the target is a dedicated disposable PostgreSQL instance.'
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

const env = { ...process.env };
env.DB_HOST = host;
env.DB_PORT = String(port);
env.DB_USER = user;
env.DB_PASSWORD = password;
env.DB_SSLMODE = 'disable';
delete env.DB_NAME;
env.INVENTORY_TEST_DATABASE = '1';
env.INVENTORY_REQUIRE_POSTGRES = '1';

function run(command, args, commandEnv = env) {
  const result = spawnSync(command, args, {
    cwd: workspaceRoot,
    env: commandEnv,
    stdio: 'inherit'
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    return false;
  }
  return true;
}

// Check the dedicated target before producing a test build or creating a database.
if (
  !run('pg_isready', [
    '-h',
    host,
    '-p',
    String(port),
    '-U',
    user,
    '-d',
    'template1',
    '-t',
    '3'
  ])
) {
  process.exit(process.exitCode ?? 1);
}

const relativeTestPath =
  'packages/evershop/dist/modules/inventory/tests/unit/inventoryReservationConcurrency.test.js';
const sourcePath = path.join(
  workspaceRoot,
  'packages/evershop/src/modules/inventory/tests/unit/inventoryReservationConcurrency.test.ts'
);
const distPath = path.join(workspaceRoot, relativeTestPath);
const serviceDistPath = path.join(
  workspaceRoot,
  'packages/evershop/dist/modules/inventory/services/inventoryService.js'
);
const swcPath = path.join(workspaceRoot, 'node_modules/.bin/swc');
const swcrcPath = path.join(workspaceRoot, 'packages/evershop/.swcrc');

if (!existsSync(serviceDistPath)) {
  throw new Error(
    'Compiled inventoryService.js is missing; compile the workspace source before running this integration suite.'
  );
}
mkdirSync(path.dirname(distPath), { recursive: true });
if (
  !run(swcPath, [
    sourcePath,
    '-o',
    distPath,
    '--config-file',
    swcrcPath,
    '--strip-leading-paths'
  ])
) {
  process.exit(process.exitCode ?? 1);
}

run('npm', [
  'test',
  '--',
  '--runTestsByPath',
  relativeTestPath,
  '--runInBand'
]);

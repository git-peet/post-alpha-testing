import { spawnSync } from 'node:child_process';

const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1']);

const host = process.env.WISHLIST_TEST_DB_HOST || '127.0.0.1';
const port = process.env.WISHLIST_TEST_DB_PORT || '5433';
const user = process.env.WISHLIST_TEST_DB_USER;
const password = process.env.WISHLIST_TEST_DB_PASSWORD;

if (!loopbackHosts.has(host)) {
  throw new Error(
    'Wishlist integration tests refuse non-loopback PostgreSQL hosts; no existing development or production database may be used.'
  );
}

if (!user || !password) {
  throw new Error(
    'WISHLIST_TEST_DB_USER and WISHLIST_TEST_DB_PASSWORD must be set. The wishlist tests only run against a dedicated, disposable test instance.'
  );
}

const env = { ...process.env };
// Point the application pool at the dedicated test server. The test itself
// creates and drops its own scratch database; DB_NAME is set by the test.
env.DB_HOST = host;
env.DB_PORT = port;
env.DB_USER = user;
env.DB_PASSWORD = password;
env.DB_SSLMODE = 'disable';
delete env.DB_NAME;
env.WISHLIST_TEST_DATABASE = '1';
env.WISHLIST_REQUIRE_POSTGRES = '1';

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env,
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

if (!run('npm', ['run', 'compile'])) {
  process.exit(process.exitCode);
}

run('npm', [
  'test',
  '--',
  '--runTestsByPath',
  'packages/evershop/dist/modules/customer/tests/unit/wishlist.test.js',
  '--runInBand'
]);

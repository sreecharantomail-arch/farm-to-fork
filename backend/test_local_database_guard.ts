import assert from 'node:assert';
import {
  assertLocalSupabaseUrl,
  assertLocalPostgresUrl,
  assertApprovedLocalEnvironment,
  LocalDatabaseGuardError,
  maskUrlCredentials,
} from './src/utils/localDatabaseGuard';

async function runGuardTests() {
  console.log('===================================================================');
  console.log('   FarmChainAI — Local Database Access Guard Verification Suite    ');
  console.log('===================================================================\n');

  let passed = 0;
  let total = 0;

  const test = (name: string, fn: () => void) => {
    total++;
    try {
      fn();
      passed++;
      console.log(`✅ [PASS] Test ${total}: ${name}`);
    } catch (err: any) {
      console.error(`❌ [FAIL] Test ${total}: ${name}`);
      console.error('       Error:', err.message);
      throw err;
    }
  };

  // 1. Hosted Supabase URL Rejection
  test('Hosted Supabase URL (https://*.supabase.co) is rejected fail-closed', () => {
    const hostedUrls = [
      'https://nadnjpqusxweictjdydw.supabase.co',
      'https://xyzproject.supabase.co',
      'https://remote-farmchain-db.supabase.co/rest/v1',
    ];

    for (const url of hostedUrls) {
      assert.throws(
        () => assertLocalSupabaseUrl(url, 'HostedRejectionTest'),
        (err: any) => {
          assert(err instanceof LocalDatabaseGuardError);
          assert(err.message.includes('FAIL-CLOSED'));
          assert(err.message.includes('not the approved local development database'));
          return true;
        }
      );
    }
  });

  // 2. Remote Host / Port Rejection
  test('Remote hostnames and incorrect ports are rejected for Supabase', () => {
    const invalidUrls = [
      'http://192.168.1.100:54321',
      'http://api.production.farmchain.com:54321',
      'http://127.0.0.1:8000',
      'http://127.0.0.1:54322', // PostgreSQL port, not Kong
      'http://localhost:3000',
      '',
      '   ',
    ];

    for (const url of invalidUrls) {
      assert.throws(
        () => assertLocalSupabaseUrl(url, 'InvalidHostPortTest'),
        (err: any) => err instanceof LocalDatabaseGuardError
      );
    }
  });

  // 3. Approved Local Supabase URLs Pass
  test('Approved local Supabase URLs (127.0.0.1:54321 / localhost:54321) pass validation', () => {
    assert.doesNotThrow(() => assertLocalSupabaseUrl('http://127.0.0.1:54321', 'LocalSupabaseTest'));
    assert.doesNotThrow(() => assertLocalSupabaseUrl('http://localhost:54321', 'LocalSupabaseTest'));
    assert.doesNotThrow(() => assertLocalSupabaseUrl('http://127.0.0.1:54321/rest/v1', 'LocalSupabaseTest'));
  });

  // 4. Remote PostgreSQL Connection Rejection
  test('Remote and cloud PostgreSQL connection strings are rejected fail-closed', () => {
    const remoteConnections = [
      'postgresql://postgres:secret123@aws-0-us-west-1.pooler.supabase.com:6543/postgres',
      'postgres://admin:pass456@db.production.farmchain.io:5432/farmchain',
      'postgresql://user:pass@192.168.1.50:54322/postgres',
      'postgresql://postgres:postgres@127.0.0.1:54321/postgres', // Port 54321 is Kong, not PG
      'postgresql://postgres:postgres@127.0.0.1:54322/production_db', // Wrong database name
    ];

    for (const conn of remoteConnections) {
      assert.throws(
        () => assertLocalPostgresUrl(conn, 'RemotePostgresTest'),
        (err: any) => {
          assert(err instanceof LocalDatabaseGuardError);
          assert(err.message.includes('FAIL-CLOSED'));
          return true;
        }
      );
    }
  });

  // 5. Approved Local PostgreSQL Connections Pass
  test('Approved local PostgreSQL connection (127.0.0.1:54322/postgres) passes validation', () => {
    assert.doesNotThrow(() =>
      assertLocalPostgresUrl('postgresql://postgres:postgres@127.0.0.1:54322/postgres', 'LocalPgTest')
    );
    assert.doesNotThrow(() =>
      assertLocalPostgresUrl('postgresql://postgres:postgres@localhost:54322/postgres', 'LocalPgTest')
    );
  });

  // 6. Credential Masking in Error Messages
  test('Passwords and credentials are masked and never exposed in error messages', () => {
    const rawUrl = 'postgresql://postgres:SUPER_SECRET_PASSWORD_12345@cloud-db.supabase.co:5432/postgres';
    const masked = maskUrlCredentials(rawUrl);

    assert(!masked.includes('SUPER_SECRET_PASSWORD_12345'), 'Password must NOT be present in masked output');
    assert(masked.includes('***'), 'Password must be replaced by ***');

    try {
      assertLocalPostgresUrl(rawUrl, 'CredentialMaskingTest');
      assert.fail('Should have thrown LocalDatabaseGuardError');
    } catch (err: any) {
      assert(err instanceof LocalDatabaseGuardError);
      assert(!err.message.includes('SUPER_SECRET_PASSWORD_12345'), 'Error message must not disclose password');
      assert(err.message.includes('***'), 'Error message must contain masked password');
    }
  });

  // 7. Pre-Write Interception Proof: Hosted DB Configuration Aborts BEFORE Writes
  test('Simulated hosted database configuration aborts BEFORE any fixture insertion or cleanup', () => {
    const originalSupabaseUrl = process.env.SUPABASE_URL;
    const originalLocalDbUrl = process.env.LOCAL_DB_URL;

    let fixturesInserted = false;
    let businessTestsRan = false;
    let cleanupExecuted = false;

    // Mock test suite lifecycle functions
    const insertCanaryFixtures = () => {
      fixturesInserted = true;
    };
    const executeBusinessTest = () => {
      businessTestsRan = true;
    };
    const executeCleanup = () => {
      cleanupExecuted = true;
    };

    try {
      // Simulate environment mistakenly set to hosted Supabase
      process.env.SUPABASE_URL = 'https://nadnjpqusxweictjdydw.supabase.co';

      let guardCaught = false;

      // Simulated test suite entry point:
      try {
        // Guard check runs BEFORE any DB call
        assertApprovedLocalEnvironment('SimulatedConsumerSuite');

        // These should NEVER be reached:
        insertCanaryFixtures();
        executeBusinessTest();
        executeCleanup();
      } catch (err: any) {
        if (err instanceof LocalDatabaseGuardError) {
          guardCaught = true;
        } else {
          throw err;
        }
      }

      // Assert fail-closed guarantees:
      assert.strictEqual(guardCaught, true, 'Guard must catch the unapproved hosted Supabase URL');
      assert.strictEqual(fixturesInserted, false, 'ZERO fixtures must be inserted on hosted database');
      assert.strictEqual(businessTestsRan, false, 'ZERO test operations must execute on hosted database');
      assert.strictEqual(cleanupExecuted, false, 'ZERO cleanup queries must execute on hosted database');
    } finally {
      // Restore valid local test environment
      process.env.SUPABASE_URL = originalSupabaseUrl || 'http://127.0.0.1:54321';
      if (originalLocalDbUrl) {
        process.env.LOCAL_DB_URL = originalLocalDbUrl;
      }
    }
  });

  // 8. Pre-Write Interception Proof: Local Environment Allows Safe Execution
  test('Approved local environment allows test execution and fixture lifecycle', () => {
    process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
    process.env.LOCAL_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

    let fixturesInserted = false;
    let businessTestsRan = false;
    let cleanupExecuted = false;

    assert.doesNotThrow(() => {
      assertApprovedLocalEnvironment('ValidLocalSuite');
      fixturesInserted = true;
      businessTestsRan = true;
      cleanupExecuted = true;
    });

    assert.strictEqual(fixturesInserted, true);
    assert.strictEqual(businessTestsRan, true);
    assert.strictEqual(cleanupExecuted, true);
  });

  console.log('\n===================================================================');
  console.log(`   ALL ${passed}/${total} GUARD CHECKS PASSED SUCCESSFULLY!                 `);
  console.log('===================================================================\n');
}

runGuardTests();

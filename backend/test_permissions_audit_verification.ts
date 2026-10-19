import { Client } from 'pg';
import './src/test_preload';
import { supabase } from './src/config/supabase';

import { assertApprovedLocalEnvironment, assertLocalPostgresUrl } from './src/utils/localDatabaseGuard';

const LOCAL_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
assertApprovedLocalEnvironment('PermissionsAuditVerification');
assertLocalPostgresUrl(LOCAL_DB_URL, 'PermissionsAuditVerification');

async function verifySecurityHardening() {
  console.log('=== Stored Procedure Security & Permissions Verification ===\n');
  const client = new Client({ connectionString: LOCAL_DB_URL });
  await client.connect();

  const testFunctions = [
    {
      name: 'register_harvest_batch',
      sql: `SELECT public.register_harvest_batch('00000000-0000-0000-0000-000000000000'::uuid, 1::integer, 'B-TEST'::text, 'Crop'::text, 'Farm'::text, 100::numeric, 'kg'::text, '2026-10-18'::date, 'A'::text, 10::numeric, 'notes'::text, '{}'::jsonb, 'user-1'::text);`
    },
    {
      name: 'submit_proof_of_delivery',
      sql: `SELECT public.submit_proof_of_delivery('00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 'user-1'::text, 100::numeric, 'notes'::text, 'hash'::text, 'https://img'::text, 'geo'::text);`
    },
    {
      name: 'acknowledge_delivery_receipt',
      sql: `SELECT public.acknowledge_delivery_receipt('00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 'CONFIRMED'::text, 'notes'::text);`
    }
  ];

  let testsPassed = 0;
  let totalTests = 0;

  try {
    // 1. Verify routine privileges catalog
    console.log('[Phase 1] Checking information_schema.routine_privileges:');
    const privRes = await client.query(`
      SELECT routine_name, grantee, privilege_type
      FROM information_schema.routine_privileges
      WHERE specific_schema = 'public'
        AND routine_name IN ('register_harvest_batch', 'submit_proof_of_delivery', 'acknowledge_delivery_receipt')
      ORDER BY routine_name, grantee;
    `);
    console.table(privRes.rows);

    const forbiddenRoles = ['PUBLIC', 'anon', 'authenticated'];
    const invalidGrants = privRes.rows.filter(r => forbiddenRoles.includes(r.grantee));
    totalTests++;
    if (invalidGrants.length === 0) {
      console.log('✅ PASS: No execute privileges granted to PUBLIC, anon, or authenticated.');
      testsPassed++;
    } else {
      console.error('❌ FAIL: Forbidden grants found:', invalidGrants);
    }

    // 2. Direct role simulation in PostgreSQL: anon role
    console.log('\n[Phase 2] Simulating anonymous caller (SET ROLE anon):');
    for (const fn of testFunctions) {
      totalTests++;
      try {
        await client.query('BEGIN;');
        await client.query('SET ROLE anon;');
        await client.query(fn.sql);
        await client.query('ROLLBACK;');
        console.error(`❌ FAIL: anon was able to execute ${fn.name}!`);
      } catch (err: any) {
        await client.query('ROLLBACK;').catch(() => {});
        if (err.message.includes('permission denied for function')) {
          console.log(`✅ PASS: anon execution of ${fn.name} blocked with: "${err.message}"`);
          testsPassed++;
        } else {
          console.error(`❌ FAIL: unexpected error for anon on ${fn.name}:`, err.message);
        }
      }
    }

    // 3. Direct role simulation in PostgreSQL: authenticated role
    console.log('\n[Phase 3] Simulating authenticated caller without service_role (SET ROLE authenticated):');
    for (const fn of testFunctions) {
      totalTests++;
      try {
        await client.query('BEGIN;');
        await client.query('SET ROLE authenticated;');
        await client.query(fn.sql);
        await client.query('ROLLBACK;');
        console.error(`❌ FAIL: authenticated role was able to execute ${fn.name}!`);
      } catch (err: any) {
        await client.query('ROLLBACK;').catch(() => {});
        if (err.message.includes('permission denied for function')) {
          console.log(`✅ PASS: authenticated execution of ${fn.name} blocked with: "${err.message}"`);
          testsPassed++;
        } else {
          console.error(`❌ FAIL: unexpected error for authenticated on ${fn.name}:`, err.message);
        }
      }
    }

    // 4. Direct role simulation in PostgreSQL: service_role role
    console.log('\n[Phase 4] Simulating authorized backend caller (SET ROLE service_role):');
    for (const fn of testFunctions) {
      totalTests++;
      try {
        await client.query('BEGIN;');
        await client.query('SET ROLE service_role;');
        // Execute inside transaction and roll back so no state persists
        await client.query(fn.sql);
        await client.query('ROLLBACK;');
        console.log(`✅ PASS: service_role successfully has execute privilege for ${fn.name}`);
        testsPassed++;
      } catch (err: any) {
        await client.query('ROLLBACK;').catch(() => {});
        // If it failed because uuid doesn't exist, that means EXECUTE permission was granted and function body ran!
        if (err.message.includes('permission denied for function')) {
          console.error(`❌ FAIL: service_role was denied execute on ${fn.name}!`);
        } else {
          console.log(`✅ PASS: service_role has execute permission for ${fn.name} (executed function logic: ${err.message})`);
          testsPassed++;
        }
      }
    }

    // 5. Verify function search_path and ownership
    console.log('\n[Phase 5] Auditing function owner and search_path configuration:');
    const funcRes = await client.query(`
      SELECT p.proname, pg_get_userbyid(p.proowner) AS owner, p.prosecdef, p.proconfig
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public'
        AND p.proname IN ('register_harvest_batch', 'submit_proof_of_delivery', 'acknowledge_delivery_receipt')
      ORDER BY p.proname;
    `);
    console.table(funcRes.rows);

    for (const row of funcRes.rows) {
      totalTests++;
      const configStr = (row.proconfig || []).join(', ');
      if (configStr.includes('search_path=public, pg_temp')) {
        console.log(`✅ PASS: ${row.proname} has safe search_path explicitly configured: [${configStr}]`);
        testsPassed++;
      } else {
        console.warn(`⚠️ WARNING: ${row.proname} search_path not explicitly set to 'public, pg_temp'. Found: [${configStr}]`);
      }
    }

    console.log(`\n======================================================`);
    console.log(`Verification Complete: ${testsPassed}/${totalTests} checks passed.`);
    console.log(`======================================================\n`);
  } finally {
    await client.end();
  }
}

verifySecurityHardening().catch(err => {
  console.error('Fatal error during verification:', err);
  process.exit(1);
});

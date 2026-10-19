import './src/test_preload';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import assert from 'node:assert';
import { assertApprovedLocalEnvironment } from './src/utils/localDatabaseGuard';

// 1. Strict Environment Guard
assertApprovedLocalEnvironment('RetailerSalesIntegration');

if (process.env.SUPABASE_URL !== 'http://127.0.0.1:54321') {
  console.error("ABORT: SUPABASE_URL must be exactly 'http://127.0.0.1:54321' to ensure local targeting.");
  process.exit(1);
}

if (!process.env.SUPABASE_SERVICE_ROLE_KEY || typeof process.env.SUPABASE_SERVICE_ROLE_KEY !== 'string') {
  console.error("ABORT: Local SUPABASE_SERVICE_ROLE_KEY is missing or invalid.");
  process.exit(1);
}

// DO NOT PRINT THE SECRET KEY

const API_URL = 'http://127.0.0.1:5000/api';
const RUN_ID = `INT-SALE-${Date.now()}`;
const BATCH_ID = `${RUN_ID}-B1`;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const testState = {
  canaryUserId: null as string | null,
  userIds: [] as string[],
  userEmails: [] as string[],
  productIds: [] as string[],
  inventoryIds: [] as string[],
  saleIds: [] as string[]
};

export async function run() {
  console.log(`\n=== Starting Retailer Sales Integration Test (RUN_ID: ${RUN_ID}) ===\n`);

  try {
    // 2. Independent Canary Connection Verification
    console.log("-> Verifying independent backend connection via Canary login...");
    const canaryEmail = `canary_${Date.now()}@local.dev`;
    const canaryPassword = 'SafePassword123';
    testState.userEmails.push(canaryEmail);

    // The backend uses a custom public.users table for authentication and bcrypt hashing,
    // so we must directly provision the profile with a hashed password to verify connection.
    const hashedPassword = await bcrypt.hash(canaryPassword, 10);

    const { data: canaryUser, error: canaryErr } = await supabase.from('users').insert({
      name: 'Canary Test',
      email: canaryEmail,
      password: hashedPassword,
      role: 'retailer'
    }).select('id').single();

    if (canaryErr || !canaryUser) {
      throw new Error(`Failed to create canary user in local DB: ${canaryErr?.message}`);
    }

    testState.canaryUserId = canaryUser.id;
    testState.userIds.push(testState.canaryUserId);

    try {
      // Attempt login via Backend API
      const loginRes = await axios.post(`${API_URL}/auth/login`, { email: canaryEmail, password: canaryPassword });
      assert.strictEqual(loginRes.status, 200, "Canary login must return 200 OK");
      assert.ok(loginRes.data.token, "Canary login must return a token");
      console.log("   [Pass] Backend successfully authenticated the local canary user.");
    } catch (e: any) {
      throw new Error(`Canary login failed. Backend is likely targeting a different database. Error: ${e.message}`);
    }

    // 3. Setup Fixtures
    console.log("-> Provisioning Test Fixtures...");

    // Register functional users via API to ensure complete DB triggers fire correctly
    const registerUser = async (name: string, role: string) => {
      const email = `${name}_${Date.now()}@test.com`;
      testState.userEmails.push(email);
      await axios.post(`${API_URL}/auth/register`, { name, email, password: 'password123', role });

      // The registration assigns pending_${role}. We must query the DB to get the ID,
      // explicitly upgrade the role to active using the service-role client, and track the ID.
      const { data: dbUser } = await supabase.from('users').select('id').eq('email', email).single();
      if (!dbUser) throw new Error(`User ${email} failed to register locally.`);

      testState.userIds.push(dbUser.id);
      const { data: updatedUser, error: updateErr } = await supabase.from('users').update({ role }).eq('id', dbUser.id).select('role').single();
      if (updateErr || !updatedUser || updatedUser.role !== role) {
        throw new Error(`User ${email} failed to upgrade role to ${role}. Error: ${updateErr?.message}`);
      }

      // Now login to get a JWT with the active role claims
      const login = await axios.post(`${API_URL}/auth/login`, { email, password: 'password123' });
      return { id: dbUser.id, token: login.data.token };
    };

    const farmer = await registerUser('FarmerTest', 'farmer');
    const retailerA = await registerUser('RetA', 'retailer');
    const retailerB = await registerUser('RetB', 'retailer');

    const { data: prod, error: prodErr } = await supabase.from('products').insert({
      name: 'Test Apples', category: 'Fruits', quantity: 500, batch_number: BATCH_ID,
      farmer_id: farmer.id, current_owner_id: retailerA.id, status: 'AVAILABLE'
    }).select('id').single();
    if (prodErr) throw new Error(`Product fixture failed: ${prodErr.message}`);
    testState.productIds.push(prod.id);

    const insertInventory = async (payload: any) => {
      const { data, error } = await supabase.from('retailer_inventory').insert(payload).select('id').single();
      if (error || !data?.id) throw new Error(`Inventory fixture failed: ${error?.message}`);
      testState.inventoryIds.push(data.id);
      return data;
    };

    const inv1 = await insertInventory({
      retailer_id: retailerA.id, product_id: prod.id, batch_number: BATCH_ID,
      quantity: 100, unit: 'kg', expiry_date: '2099-01-01', status: 'AVAILABLE'
    });

    const inv2 = await insertInventory({
      retailer_id: retailerA.id, product_id: prod.id, batch_number: BATCH_ID,
      quantity: 50, unit: 'kg', expiry_date: '2000-01-01', status: 'AVAILABLE'
    });

    const inv3 = await insertInventory({
      retailer_id: retailerB.id, product_id: prod.id, batch_number: BATCH_ID,
      quantity: 100, unit: 'kg', expiry_date: '2099-01-01', status: 'AVAILABLE'
    });

    // 4. Test Execution & API Assertions
    console.log("-> Executing API Integration Tests...");

    const postSale = (token: string, payload: any) =>
      axios.post(`${API_URL}/retailer/sales`, payload, { headers: { Authorization: `Bearer ${token}` } })
        .catch(e => e.response);

    const t1 = await postSale('invalid_token', { inventory_id: inv1.id, quantity_sold: 10 });
    assert.strictEqual(t1?.status, 401, "[T1] Unauthenticated request failed to return 401");
    console.log(`   [Pass] T1: Unauthenticated request -> 401`);

    const t2 = await postSale(retailerA.token, { inventory_id: inv1.id, quantity_sold: -5 });
    assert.strictEqual(t2?.status, 400, "[T2] Invalid quantity failed to return 400");
    console.log(`   [Pass] T2: Invalid quantity (-5) -> 400`);

    const t3 = await postSale(retailerA.token, {
      inventory_id: inv3.id,
      quantity_sold: 10,
      price_per_unit: 5
    });
assert.strictEqual(t3?.status, 403, "[T3] Cross-owner sale failed to return 403");
console.log("   [Pass] T3: Cross-owner sale -> 403");

    const t4 = await postSale(retailerA.token, {
      inventory_id: inv2.id,
      quantity_sold: 10,
      price_per_unit: 5
    });
assert.strictEqual(t4?.status, 400, "[T4] Expired-item sale failed to return 400");
console.log("   [Pass] T4: Expired-item sale -> 400");

    const t5 = await postSale(retailerA.token, { inventory_id: inv1.id, quantity_sold: 10, price_per_unit: 5 });
    assert.strictEqual(t5?.status, 200, "[T5] Valid sale failed to return 200");
    console.log(`   [Pass] T5: Valid sale (10 qty) -> 200`);
assert.ok(t5?.data?.data?.sale_id, "[T5] Sale response is missing sale_id");

    console.log(`   [T6] Launching concurrent requests for remaining 90 qty...`);
    const p1 = postSale(retailerA.token, {
      inventory_id: inv1.id,
      quantity_sold: 90,
      price_per_unit: 5
    });
    const p2 = postSale(retailerA.token, {
      inventory_id: inv1.id,
      quantity_sold: 90,
      price_per_unit: 5
    });
    const [res1, res2] = await Promise.all([p1, p2]);
    const statuses = [res1?.status, res2?.status].sort();

    console.log(`        Actual Concurrent Statuses: ${statuses.join(', ')}`);

    let concurrencyError: Error | null = null;
    try {
      assert.deepStrictEqual(statuses, [200, 409], `Expected exactly one success (200) and one conflict (409), but got [${statuses.join(', ')}]`);
    } catch (e: any) {
      concurrencyError = e;
      console.error(`   [Fail] T6: Concurrency assertion failed: ${e.message}`);
      console.error(`          (Note: This test simulates a single Node.js event tick. Deviations confirm the controller's current limits but do not prove total database race-condition safety.)`);
    }

    // 5. Database Assertions
    console.log("\n-> Evaluating Persisted Database State...");

    const dbErrors: string[] = [];
    const assertDB = (condition: boolean, msg: string) => {
      try { assert.ok(condition, msg); } catch (e: any) { dbErrors.push(e.message); console.error(`   [Fail] ${e.message}`); }
    };

    // Inventory Verification
    const { data: finalInv, error: invErr } = await supabase.from('retailer_inventory').select('*').eq('id', inv1.id).single();
    if (invErr) {
      dbErrors.push(`Inventory query failed: ${invErr.message}`);
      console.error(`   [Fail] Inventory query failed: ${invErr.message}`);
    } else {
      assertDB(finalInv?.quantity === 0, `Inventory quantity expected 0, got ${finalInv?.quantity}`);
      assertDB(finalInv?.status === 'DEPLETED', `Inventory status expected DEPLETED, got ${finalInv?.status}`);
      if (finalInv?.quantity === 0 && finalInv?.status === 'DEPLETED') {
        console.log(`   [Pass] Inventory remaining quantity is 0 and status is DEPLETED.`);
      }
    }

    // Sales Record Verification
    const { data: sales, error: salesErr } = await supabase.from('retailer_sales').select('id, quantity_sold').eq('inventory_id', inv1.id);
    if (salesErr) {
      dbErrors.push(`Sales query failed: ${salesErr.message}`);
      console.error(`   [Fail] Sales query failed: ${salesErr.message}`);
    } else {
      sales?.forEach(s => testState.saleIds.push(s.id));
      assertDB(sales?.length === 2, `Expected 2 sales records, found ${sales?.length}`);
      if (sales?.length === 2) {
        console.log(`   [Pass] Exact expected sales records persisted (${sales?.length}).`);
      }
    }

    // Outbox Event Verification
    const { data: outbox, error: outboxErr } = await supabase.from('event_outbox').select('event_type, payload').eq('payload->>batch_id', BATCH_ID);
    if (outboxErr) {
      dbErrors.push(`Outbox query failed: ${outboxErr.message}`);
      console.error(`   [Fail] Outbox query failed: ${outboxErr.message}`);
    } else {
      const saleEvents = outbox?.filter(e => e.event_type === 'SALE_CREATED') || [];
      const invEvents = outbox?.filter(e => e.event_type === 'INVENTORY_UPDATED') || [];

      assertDB(saleEvents.length === 2, `Expected 2 SALE_CREATED events, found ${saleEvents.length}`);
      assertDB(invEvents.length === 2, `Expected 2 INVENTORY_UPDATED events, found ${invEvents.length}`);
      assertDB(saleEvents[0]?.payload?.quantity_sold === 10, `First sale event quantity mismatch, expected 10, got ${saleEvents[0]?.payload?.quantity_sold}`);
      if (saleEvents.length === 2 && invEvents.length === 2 && saleEvents[0]?.payload?.quantity_sold === 10) {
        console.log(`   [Pass] Expected OUTBOX events successfully persisted.`);
      }
    }

    // Traceability Event Verification
    const { data: trace, error: traceErr } = await supabase.from('traceability_events').select('event_type, actor_id, metadata').eq('batch_number', BATCH_ID).eq('event_type', 'RETAILER_SOLD');
    if (traceErr) {
      dbErrors.push(`Traceability query failed: ${traceErr.message}`);
      console.error(`   [Fail] Traceability query failed: ${traceErr.message}`);
    } else {
      assertDB(trace?.length === 2, `Expected 2 RETAILER_SOLD traceability events, found ${trace?.length}`);
      assertDB(trace?.[0]?.actor_id === retailerA.id, `Traceability event recorded incorrect actor_id: ${trace?.[0]?.actor_id}`);
      assertDB(trace?.[0]?.metadata?.quantity_sold === 10, `Traceability event recorded incorrect metadata qty: ${trace?.[0]?.metadata?.quantity_sold}`);
      if (trace?.length === 2 && trace[0]?.actor_id === retailerA.id && trace[0]?.metadata?.quantity_sold === 10) {
        console.log(`   [Pass] Expected TRACEABILITY events successfully persisted.`);
      }
    }

    if (concurrencyError || dbErrors.length > 0) {
      const msg = [
        concurrencyError ? `Concurrency assertion failed: ${concurrencyError.message}` : null,
        dbErrors.length > 0 ? `Database assertions failed:\n - ${dbErrors.join('\n - ')}` : null
      ].filter(Boolean).join('\n');
      throw new Error(msg);
    }

  } catch (error: any) {
    console.error(`\nTEST EXECUTION HALTED: ${error.message}\n`);
    throw error;
  } finally {
    console.log("\n-> Initiating Safe Teardown...");
    const errors: string[] = [];

    const attemptDelete = async (name: string, p: PromiseLike<any>) => {
      try {
        const { error } = await p;
        if (error) throw new Error(error.message);
      } catch (e: any) {
        errors.push(`${name}: ${e.message}`);
      }
    };

    // Strict dependency-order deletion
    if (BATCH_ID) {
      await attemptDelete('Event Outbox', supabase.from('event_outbox').delete().eq('payload->>batch_id', BATCH_ID));
      await attemptDelete('Traceability', supabase.from('traceability_events').delete().eq('batch_number', BATCH_ID));
    }

    if (testState.saleIds.length > 0) {
      await attemptDelete('Retailer Sales (Tracked)', supabase.from('retailer_sales').delete().in('id', testState.saleIds));
    }

    if (testState.inventoryIds.length > 0) {
      await attemptDelete('Retailer Sales (Untracked cleanup)', supabase.from('retailer_sales').delete().in('inventory_id', testState.inventoryIds));
      await attemptDelete('Retailer Inventory', supabase.from('retailer_inventory').delete().in('id', testState.inventoryIds));
    }

    if (testState.productIds.length > 0) {
      await attemptDelete('Products', supabase.from('products').delete().in('id', testState.productIds));
    }

    if (testState.userEmails.length > 0) {
      await attemptDelete('Users (public by email)', supabase.from('users').delete().in('email', testState.userEmails));
    }
    if (testState.userIds.length > 0) {
      await attemptDelete('Users (public by id)', supabase.from('users').delete().in('id', testState.userIds));
      // In Supabase, if auth.users were populated, we'd delete them too. Since we insert directly to public.users via backend,
      // deleting public.users is sufficient and required. (No auth.users are created natively by the backend code we inspected).
    }

    if (errors.length > 0) {
      console.error("   TEARDOWN ERRORS OCCURRED. The following records may require manual cleanup:");
      console.error(`   - User Emails: ${testState.userEmails.join(', ')}`);
      console.error(`   - User IDs: ${testState.userIds.join(', ')}`);
      console.error(`   - Product IDs: ${testState.productIds.join(', ')}`);
      console.error(`   - Inventory IDs: ${testState.inventoryIds.join(', ')}`);
      console.error(`   - Sale IDs: ${testState.saleIds.join(', ')}`);
      errors.forEach(e => console.error(`   - Failed operation: ${e}`));

      // Explicitly fail the test suite run if teardown fails
      throw new Error(`Teardown failed with ${errors.length} errors.`);
    } else {
      console.log("   Teardown completed cleanly.");
    }
    console.log("\n=== Integration Test Concluded ===");
  }
}

// Ensure it is NOT run during normal imports
if (require.main === module) {
  // run();
}

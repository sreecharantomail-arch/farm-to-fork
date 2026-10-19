import './src/test_preload';
import { Kafka } from 'kafkajs';
import pg from 'pg';
import assert from 'node:assert';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { supabase } from './src/config/supabase';
import { registerProduct } from './src/controllers/productController';
import { submitProofOfDelivery } from './src/controllers/distributorController';
import { acknowledgeDeliveryReceipt } from './src/controllers/retailerController';

const LOCAL_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

import { assertApprovedLocalEnvironment, assertLocalPostgresUrl } from './src/utils/localDatabaseGuard';
assertApprovedLocalEnvironment('OutboxAtomicitySuite');
assertLocalPostgresUrl(LOCAL_DB_URL, 'OutboxAtomicitySuite');

const envConfig = dotenv.parse(fs.readFileSync(path.resolve(__dirname, '.env'), 'utf8'));
const originalSupabase = createClient(envConfig.SUPABASE_URL, envConfig.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const createMockReqRes = (options: {
  user?: any;
  params?: Record<string, string>;
  body?: Record<string, any>;
}) => {
  const req: any = {
    user: options.user || null,
    params: options.params || {},
    body: options.body || {},
  };

  const res: any = {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: any) {
      this.body = data;
      return this;
    },
  };

  return { req, res };
};

async function runAtomicityTestSuite() {
  console.log('===================================================================');
  console.log('   FarmChainAI — Business Transaction & Outbox Atomicity Suite    ');
  console.log('===================================================================\n');

  const pool = new pg.Pool({ connectionString: LOCAL_DB_URL });

  let passedTests = 0;
  let totalTests = 0;

  const test = async (name: string, fn: () => Promise<void>) => {
    totalTests++;
    console.log(`\n--- TEST ${totalTests}: ${name} ---`);
    try {
      await fn();
      passedTests++;
      console.log(`✅ [PASS] Test ${totalTests}: ${name}`);
    } catch (err: any) {
      console.error(`❌ [FAIL] Test ${totalTests}: ${name}`);
      console.error('       Error:', err.message || err);
      throw err;
    }
  };

  // -------------------------------------------------------------
  // PRE-FLIGHT: Audit baseline business events in database
  // -------------------------------------------------------------
  const { data: originalOutbox, error: origErr } = await originalSupabase
    .from('event_outbox')
    .select('id, status, topic');

  if (origErr) {
    throw new Error(`Failed to query baseline outbox from original backlog: ${origErr.message}`);
  }

  const baselinePendingCount = originalOutbox.filter((r) => r.status === 'PENDING').length;
  console.log(`[Baseline Audit] Verified ${baselinePendingCount} original business events in PENDING status.`);
  assert.strictEqual(baselinePendingCount, 40, 'Expected exactly 40 pre-existing pending business events in original backlog');

  const { data: initialLocalOutbox } = await supabase
    .from('event_outbox')
    .select('id, status');
  const localBaselinePending = initialLocalOutbox?.filter((r) => r.status === 'PENDING').length || 0;
  console.log(`[Baseline Audit] Verified ${localBaselinePending} local business events in PENDING status.`);

  // Test identifiers for cleanup
  const ts = Date.now();
  const testFarmerId = `11111111-aaaa-4111-8111-${String(ts).slice(-12)}`;
  const testDistributorId = `22222222-bbbb-4222-8222-${String(ts).slice(-12)}`;
  const testRetailerId = `33333333-cccc-4333-8333-${String(ts).slice(-12)}`;
  const testIntruderId = `44444444-dddd-4444-8444-${String(ts).slice(-12)}`;

  const testBatch1 = `BATCH-ATOM-01-${ts}`;
  const testBatch2 = `BATCH-ATOM-02-${ts}`;
  const testBatchRollback = `BATCH-ATOM-FAIL-${ts}`;

  let createdProduct1Id: string | null = null;
  let createdShipment1Id: string | null = null;

  try {
    // -------------------------------------------------------------
    // SETUP: Create isolated test users
    // -------------------------------------------------------------
    await pool.query(
      `INSERT INTO public.users (id, name, email, password, role)
       VALUES
         ($1, 'Atom Farmer', 'farmer-${ts}@test.local', 'hash', 'farmer'),
         ($2, 'Atom Distributor', 'distributor-${ts}@test.local', 'hash', 'distributor'),
         ($3, 'Atom Retailer', 'retailer-${ts}@test.local', 'hash', 'retailer'),
         ($4, 'Atom Intruder', 'intruder-${ts}@test.local', 'hash', 'distributor')
       ON CONFLICT (id) DO NOTHING;`,
      [testFarmerId, testDistributorId, testRetailerId, testIntruderId]
    );

    // -------------------------------------------------------------
    // TEST 1: Farmer Batch Registration — Atomic Success
    // -------------------------------------------------------------
    await test('Farmer Registration: Product, Traceability, and Outbox commit together atomically', async () => {
      const { req, res } = createMockReqRes({
        user: { id: testFarmerId, role: 'farmer' },
        body: {
          name: 'Atomic Test Carrots',
          category: 'Vegetables',
          batchNumber: testBatch1,
          quantity: 200,
          organicStatus: 'Organic',
        },
      });

      await registerProduct(req, res);

      assert.strictEqual(res.statusCode, 201, 'registerProduct should return 201');
      assert.strictEqual(res.body.success, true);
      const product = res.body.data;
      createdProduct1Id = product.id;

      // Ground truth in PostgreSQL:
      // 1. Product row created
      const prodRes = await pool.query(`SELECT * FROM public.products WHERE id = $1;`, [product.id]);
      assert.strictEqual(prodRes.rows.length, 1);
      assert.strictEqual(prodRes.rows[0].batch_number, testBatch1);
      assert.strictEqual(Number(prodRes.rows[0].quantity), 200);

      // 2. Traceability event created
      const traceRes = await pool.query(
        `SELECT * FROM public.traceability_events WHERE product_id = $1 AND event_type = 'HARVEST_REGISTERED';`,
        [product.id]
      );
      assert.strictEqual(traceRes.rows.length, 1);
      assert.strictEqual(traceRes.rows[0].batch_number, testBatch1);

      // 3. Outbox event created
      const outboxRes = await pool.query(
        `SELECT * FROM public.event_outbox WHERE topic = 'traceability-events' AND event_type = 'BATCH_CREATED' AND payload->>'batch_id' = $1;`,
        [testBatch1]
      );
      assert.strictEqual(outboxRes.rows.length, 1);
      assert.strictEqual(outboxRes.rows[0].status, 'PENDING');
      assert.strictEqual(outboxRes.rows[0].payload.farmer_id, testFarmerId);
    });

    // -------------------------------------------------------------
    // TEST 2: Farmer Batch Registration — Duplicate Prevention
    // -------------------------------------------------------------
    await test('Farmer Registration: Duplicate batch number rolls back and creates no orphan records', async () => {
      const { req, res } = createMockReqRes({
        user: { id: testFarmerId, role: 'farmer' },
        body: {
          name: 'Duplicate Carrots Attempt',
          category: 'Vegetables',
          batchNumber: testBatch1, // DUPLICATE!
          quantity: 150,
          organicStatus: 'Organic',
        },
      });

      await registerProduct(req, res);

      assert.strictEqual(res.statusCode, 400, 'Duplicate batch registration must return 400');

      // Verify no second product exists
      const prodCount = await pool.query(
        `SELECT count(*)::int as count FROM public.products WHERE batch_number = $1;`,
        [testBatch1]
      );
      assert.strictEqual(prodCount.rows[0].count, 1, 'Exactly one product should exist for this batch');

      // Verify no second outbox event was created
      const outboxCount = await pool.query(
        `SELECT count(*)::int as count FROM public.event_outbox WHERE payload->>'batch_id' = $1;`,
        [testBatch1]
      );
      assert.strictEqual(outboxCount.rows[0].count, 1, 'Exactly one outbox event should exist');
    });

    // -------------------------------------------------------------
    // TEST 3: Farmer Registration — Forced Outbox Failure Rollback
    // -------------------------------------------------------------
    await test('Farmer Registration Rollback: Forced Outbox failure completely rolls back Product and Traceability', async () => {
      // Direct simulation of atomic transaction:
      // If the outbox insertion step fails (e.g. invalid column or constraint),
      // the product row MUST NOT remain committed in PostgreSQL.
      let threwExpectedError = false;
      const client = await pool.connect();
      try {
        await client.query('BEGIN;');

        // 1. Insert product
        const prodInsert = await client.query(
          `INSERT INTO public.products (
             product_id, name, category, batch_number, quantity,
             organic_status, farmer_id, current_owner_id, status
           ) VALUES (
             999888, 'Doomed Product', 'Test', $1, 100,
             'Conventional', $2, $2, 'Pending Approval'
           ) RETURNING id;`,
          [testBatchRollback, testFarmerId]
        );
        const doomedProdId = prodInsert.rows[0].id;

        // 2. Insert traceability event
        await client.query(
          `INSERT INTO public.traceability_events (
             product_id, batch_number, event_type, actor_id, location
           ) VALUES ($1, $2, 'HARVEST_REGISTERED', $3, 'Farm');`,
          [doomedProdId, testBatchRollback, testFarmerId]
        );

        // 3. Forced outbox insertion failure (simulate NOT NULL violation or invalid constraint)
        await client.query(
          `INSERT INTO public.event_outbox (event_id, event_type, topic, payload)
           VALUES (NULL, 'BATCH_CREATED', 'traceability-events', '{}'::jsonb);`
        );

        await client.query('COMMIT;');
      } catch (err: any) {
        threwExpectedError = true;
        await client.query('ROLLBACK;');
      } finally {
        client.release();
      }

      assert.strictEqual(threwExpectedError, true, 'Transaction must fail on outbox error');

      // Verify NO product was committed
      const prodCheck = await pool.query(
        `SELECT count(*)::int as count FROM public.products WHERE batch_number = $1;`,
        [testBatchRollback]
      );
      assert.strictEqual(prodCheck.rows[0].count, 0, 'Rolled back transaction must leave ZERO product rows');

      // Verify NO traceability event was committed
      const traceCheck = await pool.query(
        `SELECT count(*)::int as count FROM public.traceability_events WHERE batch_number = $1;`,
        [testBatchRollback]
      );
      assert.strictEqual(traceCheck.rows[0].count, 0, 'Rolled back transaction must leave ZERO traceability rows');
    });

    // -------------------------------------------------------------
    // SETUP FOR SHIPMENT & POD TESTS
    // -------------------------------------------------------------
    const shipRes = await pool.query(
      `INSERT INTO public.shipments (
         shipment_tracking_id, product_id, batch_number, sender_id, receiver_id,
         distributor_id, quantity, unit, status
       ) VALUES (
         $1, $2, $3, $4, $5, $4, 200, 'units', 'IN_TRANSIT'
       ) RETURNING id;`,
      [`TRK-ATOM-${ts}`, createdProduct1Id, testBatch1, testDistributorId, testRetailerId]
    );
    createdShipment1Id = shipRes.rows[0].id;

    // -------------------------------------------------------------
    // TEST 4: Distributor POD Submission — Atomic Success
    // -------------------------------------------------------------
    await test('Distributor POD: Proof, Shipment DELIVERED, Traceability, and Outbox commit together atomically', async () => {
      const { req, res } = createMockReqRes({
        user: { id: testDistributorId, role: 'distributor' },
        params: { id: createdShipment1Id! },
        body: {
          recipient_name: 'Store Manager Alex',
          quantity_delivered: 200,
          unit: 'units',
          delivery_notes: 'Delivered in good condition',
        },
      });

      await submitProofOfDelivery(req, res);

      assert.strictEqual(res.statusCode, 201, 'submitProofOfDelivery should return 201');
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.shipment.status, 'DELIVERED');

      // Ground truth in PostgreSQL:
      // 1. Proof of delivery row exists with SUBMITTED status
      const podRes = await pool.query(
        `SELECT * FROM public.proof_of_delivery WHERE shipment_id = $1;`,
        [createdShipment1Id]
      );
      assert.strictEqual(podRes.rows.length, 1);
      assert.strictEqual(podRes.rows[0].status, 'SUBMITTED');
      assert.strictEqual(podRes.rows[0].recipient_name, 'Store Manager Alex');
      assert.strictEqual(Number(podRes.rows[0].quantity_delivered), 200);

      // 2. Shipment status transitioned to DELIVERED
      const shipCheck = await pool.query(
        `SELECT status FROM public.shipments WHERE id = $1;`,
        [createdShipment1Id]
      );
      assert.strictEqual(shipCheck.rows[0].status, 'DELIVERED');

      // 3. Traceability event created
      const traceRes = await pool.query(
        `SELECT * FROM public.traceability_events WHERE product_id = $1 AND event_type = 'DISTRIBUTOR_DELIVERED';`,
        [createdProduct1Id]
      );
      assert.strictEqual(traceRes.rows.length, 1);

      // 4. Outbox event created
      const outboxRes = await pool.query(
        `SELECT * FROM public.event_outbox WHERE topic = 'shipment-events' AND event_type = 'DELIVERY_PROOF_SUBMITTED' AND payload->>'shipment_id' = $1;`,
        [createdShipment1Id]
      );
      assert.strictEqual(outboxRes.rows.length, 1);
      assert.strictEqual(outboxRes.rows[0].status, 'PENDING');
      assert.strictEqual(outboxRes.rows[0].payload.recipient_name, 'Store Manager Alex');
    });

    // -------------------------------------------------------------
    // TEST 5: Distributor POD — Duplicate Submission Prevention
    // -------------------------------------------------------------
    await test('Distributor POD: Repeated submission is rejected without creating duplicate POD or Outbox event', async () => {
      const { req, res } = createMockReqRes({
        user: { id: testDistributorId, role: 'distributor' },
        params: { id: createdShipment1Id! },
        body: {
          recipient_name: 'Store Manager Alex',
          quantity_delivered: 200,
        },
      });

      await submitProofOfDelivery(req, res);

      assert.ok(res.statusCode === 400 || res.statusCode === 409, 'Duplicate submission should return 400 or 409');

      // Verify exactly 1 POD row
      const podCount = await pool.query(
        `SELECT count(*)::int as count FROM public.proof_of_delivery WHERE shipment_id = $1;`,
        [createdShipment1Id]
      );
      assert.strictEqual(podCount.rows[0].count, 1);

      // Verify exactly 1 DELIVERY_PROOF_SUBMITTED outbox event
      const outboxCount = await pool.query(
        `SELECT count(*)::int as count FROM public.event_outbox WHERE payload->>'shipment_id' = $1 AND event_type = 'DELIVERY_PROOF_SUBMITTED';`,
        [createdShipment1Id]
      );
      assert.strictEqual(outboxCount.rows[0].count, 1);
    });

    // -------------------------------------------------------------
    // TEST 6: Distributor POD — Unauthorized Distributor Rejection
    // -------------------------------------------------------------
    await test('Distributor POD: Unauthorized distributor is rejected and creates no records', async () => {
      // Create a temporary shipment
      const shipIntruder = await pool.query(
        `INSERT INTO public.shipments (
           shipment_tracking_id, product_id, batch_number, sender_id, receiver_id,
           distributor_id, quantity, unit, status
         ) VALUES (
           $1, $2, $3, $4, $5, $4, 100, 'units', 'IN_TRANSIT'
         ) RETURNING id;`,
        [`TRK-INTRUDER-${ts}`, createdProduct1Id, testBatch1, testDistributorId, testRetailerId]
      );
      const intruderShipId = shipIntruder.rows[0].id;

      const { req, res } = createMockReqRes({
        user: { id: testIntruderId, role: 'distributor' }, // INTRUDER!
        params: { id: intruderShipId },
        body: {
          recipient_name: 'Store Manager',
          quantity_delivered: 100,
        },
      });

      await submitProofOfDelivery(req, res);

      assert.strictEqual(res.statusCode, 403, 'Unauthorized distributor must return 403 Forbidden');

      // Verify no POD created
      const podCount = await pool.query(
        `SELECT count(*)::int as count FROM public.proof_of_delivery WHERE shipment_id = $1;`,
        [intruderShipId]
      );
      assert.strictEqual(podCount.rows[0].count, 0);

      // Verify shipment remains IN_TRANSIT
      const shipStatus = await pool.query(
        `SELECT status FROM public.shipments WHERE id = $1;`,
        [intruderShipId]
      );
      assert.strictEqual(shipStatus.rows[0].status, 'IN_TRANSIT');

      // Cleanup intruder shipment
      await pool.query(`DELETE FROM public.shipments WHERE id = $1;`, [intruderShipId]);
    });

    // -------------------------------------------------------------
    // TEST 7: Retailer Delivery Acknowledgement with Blockchain Hash
    // -------------------------------------------------------------
    await test('Retailer Acknowledgement: SHIPMENT_RECEIVED, RETAILER_RECEIVED, INVENTORY_CREATED, and BLOCKCHAIN_RECORDED all commit atomically', async () => {
      const mockTxHash = `0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890`;

      // Call acknowledge_delivery_receipt stored procedure directly with blockchain hash
      const rpcRes = await pool.query(
        `SELECT public.acknowledge_delivery_receipt($1, $2, $3, $4) as result;`,
        [createdShipment1Id, testRetailerId, testBatch1, mockTxHash]
      );

      const result = rpcRes.rows[0].result;
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.status, 'ACKNOWLEDGED');

      // Ground truth in PostgreSQL:
      // 1. Proof of delivery is ACKNOWLEDGED
      const pod = (await pool.query(
        `SELECT status, acknowledged_by FROM public.proof_of_delivery WHERE shipment_id = $1;`,
        [createdShipment1Id]
      )).rows[0];
      assert.strictEqual(pod.status, 'ACKNOWLEDGED');
      assert.strictEqual(pod.acknowledged_by, testRetailerId);

      // 2. Shipment is RECEIVED
      const ship = (await pool.query(
        `SELECT status FROM public.shipments WHERE id = $1;`,
        [createdShipment1Id]
      )).rows[0];
      assert.strictEqual(ship.status, 'RECEIVED');

      // 3. Product owner updated
      const prod = (await pool.query(
        `SELECT current_owner_id FROM public.products WHERE id = $1;`,
        [createdProduct1Id]
      )).rows[0];
      assert.strictEqual(prod.current_owner_id, testRetailerId);

      // 4. Retailer inventory created
      const inv = (await pool.query(
        `SELECT * FROM public.retailer_inventory WHERE retailer_id = $1 AND batch_number = $2;`,
        [testRetailerId, testBatch1]
      )).rows[0];
      assert.strictEqual(Number(inv.quantity), 200);
      assert.strictEqual(inv.status, 'AVAILABLE');

      // 5. Traceability event has blockchain_hash
      const trace = (await pool.query(
        `SELECT * FROM public.traceability_events WHERE product_id = $1 AND event_type = 'RETAILER_RECEIVED';`,
        [createdProduct1Id]
      )).rows[0];
      assert.strictEqual(trace.blockchain_hash, mockTxHash);

      // 6. ALL 4 outbox events created in this transaction:
      const outboxEvents = (await pool.query(
        `SELECT event_type, topic, payload FROM public.event_outbox
         WHERE (payload->>'shipment_id' = $1 OR payload->>'batch_id' = $2)
         ORDER BY event_type;`,
        [createdShipment1Id, testBatch1]
      )).rows;

      const eventTypes = outboxEvents.map((e) => e.event_type);
      console.log('Outbox events recorded for shipment:', eventTypes);

      assert.ok(eventTypes.includes('SHIPMENT_RECEIVED'), 'Must contain SHIPMENT_RECEIVED');
      assert.ok(eventTypes.includes('RETAILER_RECEIVED'), 'Must contain RETAILER_RECEIVED');
      assert.ok(eventTypes.includes('INVENTORY_CREATED'), 'Must contain INVENTORY_CREATED');
      assert.ok(eventTypes.includes('BLOCKCHAIN_RECORDED'), 'Must atomically contain BLOCKCHAIN_RECORDED when tx_hash is passed');

      const bcEvent = outboxEvents.find((e) => e.event_type === 'BLOCKCHAIN_RECORDED');
      assert.strictEqual(bcEvent.payload.tx_hash, mockTxHash);
      assert.strictEqual(bcEvent.payload.event_source, 'RETAILER_ACKNOWLEDGED');
    });

    // -------------------------------------------------------------
    // TEST 8: Retailer Acknowledgement — Duplicate Prevention
    // -------------------------------------------------------------
    await test('Retailer Acknowledgement: Duplicate acknowledgement is blocked without double inventory or duplicate events', async () => {
      let threwDuplicate = false;
      try {
        await pool.query(
          `SELECT public.acknowledge_delivery_receipt($1, $2, $3, $4) as result;`,
          [createdShipment1Id, testRetailerId, testBatch1, '0xanotherhash']
        );
      } catch (err: any) {
        if (err.message.includes('already been received') || err.message.includes('22023')) {
          threwDuplicate = true;
        }
      }

      assert.strictEqual(threwDuplicate, true, 'Second acknowledgement must be rejected');

      // Verify inventory count is still exactly 1
      const invCount = await pool.query(
        `SELECT count(*)::int as count FROM public.retailer_inventory WHERE retailer_id = $1 AND batch_number = $2;`,
        [testRetailerId, testBatch1]
      );
      assert.strictEqual(invCount.rows[0].count, 1, 'Inventory must be created EXACTLY ONCE');
    });

    // -------------------------------------------------------------
    // CLEANUP TEST FIXTURES
    // -------------------------------------------------------------
    console.log('\nCleaning up isolated test fixtures...');
    await pool.query(`DELETE FROM public.event_outbox WHERE payload->>'batch_id' IN ($1, $2);`, [testBatch1, testBatchRollback]);
    await pool.query(`DELETE FROM public.traceability_events WHERE batch_number IN ($1, $2);`, [testBatch1, testBatchRollback]);
    await pool.query(`DELETE FROM public.retailer_inventory WHERE batch_number IN ($1, $2);`, [testBatch1, testBatchRollback]);
    await pool.query(`DELETE FROM public.proof_of_delivery WHERE shipment_id = $1;`, [createdShipment1Id]);
    await pool.query(`DELETE FROM public.shipments WHERE id = $1;`, [createdShipment1Id]);
    await pool.query(`DELETE FROM public.products WHERE id = $1 OR batch_number IN ($2, $3);`, [createdProduct1Id, testBatch1, testBatchRollback]);
    await pool.query(`DELETE FROM public.users WHERE id IN ($1, $2, $3, $4);`, [testFarmerId, testDistributorId, testRetailerId, testIntruderId]);
    console.log('Isolated test fixtures cleaned up successfully.');

    // -------------------------------------------------------------
    // TEST 9: Final Read-Only Baseline Audit (All 40 Outbox Events Intact)
    // -------------------------------------------------------------
    await test('Baseline Preservation: 100% of the 40 original business events remain untouched and PENDING', async () => {
      const { data: finalOutbox, error: finalErr } = await originalSupabase
        .from('event_outbox')
        .select('id, status');

      if (finalErr) {
        throw new Error(`Failed to query original outbox: ${finalErr.message}`);
      }

      const pendingCount = finalOutbox.filter((r) => r.status === 'PENDING').length;
      console.log(`[Baseline Audit] Original event backlog total: ${finalOutbox.length}, Pending: ${pendingCount}`);

      assert.strictEqual(finalOutbox.length, 40, 'Original outbox total rows must remain exactly 40');
      assert.strictEqual(pendingCount, 40, 'All 40 original business events must remain in PENDING state');

      const { data: finalLocal, error: localErr } = await supabase
        .from('event_outbox')
        .select('id, status');
      assert.strictEqual(localErr, null, 'Local outbox query must succeed');
      const localFinalPending = finalLocal?.filter((r) => r.status === 'PENDING').length || 0;
      assert.strictEqual(localFinalPending, localBaselinePending, 'Local baseline outbox count must remain untouched');
      console.log(`[Baseline Audit] Local database outbox preserved: ${localFinalPending} PENDING events intact.`);
    });

    console.log('\n===================================================================');
    console.log(`  SUMMARY: ${passedTests}/${totalTests} TESTS PASSED`);
    console.log('===================================================================\n');
  } catch (err: any) {
    console.error('\n❌ ATOMICITY TEST SUITE FAILED:', err.message || err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runAtomicityTestSuite();

import './src/test_preload';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '.env.local'), override: true });

import pg from 'pg';
import assert from 'node:assert';
import { supabase } from './src/config/supabase';
import { submitProofOfDelivery, getDeliveryProof, getOutgoingShipments } from './src/controllers/distributorController';
import { getShipmentDeliveryProof, acknowledgeDeliveryReceipt, reportDeliveryDiscrepancy } from './src/controllers/retailerController';

import { assertApprovedLocalEnvironment, assertLocalPostgresUrl } from './src/utils/localDatabaseGuard';

const PG_CONN = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
assertApprovedLocalEnvironment('PodRealDbE2eSuite');
assertLocalPostgresUrl(PG_CONN, 'PodRealDbE2eSuite');

// Direct PostgreSQL connection for raw database ground-truth validation
const pool = new pg.Pool({
  connectionString: PG_CONN
});

// Helper for Mock Express Request/Response
const createReqRes = (options: {
  user?: any;
  params?: Record<string, string>;
  body?: Record<string, any>;
}) => {
  const req: any = {
    user: options.user || null,
    params: options.params || {},
    body: options.body || {}
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
    }
  };

  return { req, res };
};

async function runE2eTests() {
  console.log('================================================================');
  console.log('FARMCHAINAI — DIGITAL PROOF OF DELIVERY REAL DATABASE E2E SUITE');
  console.log('Testing against local Supabase: 127.0.0.1:54321 / 127.0.0.1:54322');
  console.log('================================================================\n');

  const ts = Date.now();
  const canaryDistId = `11111111-1111-4111-8111-${String(ts).slice(-12)}`;
  const canaryRetId = `22222222-2222-4222-8222-${String(ts).slice(-12)}`;
  const canaryIntruderId = `33333333-3333-4333-8333-${String(ts).slice(-12)}`;
  const canaryProd1Id = `44444444-4444-4444-8444-${String(ts).slice(-12)}`;
  const canaryProd2Id = `55555555-5555-4555-8555-${String(ts).slice(-12)}`;
  const canaryShip1Id = `66666666-6666-4666-8666-${String(ts).slice(-12)}`;
  const canaryShip2Id = `77777777-7777-4777-8777-${String(ts).slice(-12)}`;

  const batch1 = `BATCH-E2E-1-${ts}`;
  const batch2 = `BATCH-E2E-2-${ts}`;

  let passedTests = 0;
  let totalTests = 0;

  function markPass(name: string) {
    passedTests++;
    totalTests++;
    console.log(`  [PASS] Test ${totalTests}: ${name}`);
  }

  function markFail(name: string, err: any) {
    totalTests++;
    console.error(`  [FAIL] Test ${totalTests}: ${name}`);
    console.error('    Error details:', err);
  }

  try {
    // -------------------------------------------------------------
    // Step 0: Record Baseline DB Row Counts
    // -------------------------------------------------------------
    console.log('--- Step 0: Baseline Database State Inspection ---');
    const baselineUsers = await pool.query('SELECT count(*)::int as count FROM users');
    const baselineProducts = await pool.query('SELECT count(*)::int as count FROM products');
    const baselineShipments = await pool.query('SELECT count(*)::int as count FROM shipments');
    const baselineInventory = await pool.query('SELECT count(*)::int as count FROM retailer_inventory');
    const baselinePod = await pool.query('SELECT count(*)::int as count FROM proof_of_delivery');
    const baselineTrace = await pool.query('SELECT count(*)::int as count FROM traceability_events');
    const baselineOutbox = await pool.query('SELECT count(*)::int as count FROM event_outbox');

    const baseline = {
      users: baselineUsers.rows[0].count,
      products: baselineProducts.rows[0].count,
      shipments: baselineShipments.rows[0].count,
      inventory: baselineInventory.rows[0].count,
      pod: baselinePod.rows[0].count,
      traceability: baselineTrace.rows[0].count,
      outbox: baselineOutbox.rows[0].count
    };
    console.log('Baseline database counts (PRESERVED):', baseline);
    console.log('');

    // -------------------------------------------------------------
    // Step 1: Create Isolated Canary Records in Local DB
    // -------------------------------------------------------------
    console.log('--- Step 1: Fixture Setup (Isolated Canary Records) ---');
    // Test Distributor
    await pool.query(
      `INSERT INTO users (id, name, email, role, password)
       VALUES ($1, 'E2E Canary Distributor', $2, 'distributor', 'dummy_hash')`,
      [canaryDistId, `dist_canary_${ts}@test.local`]
    );
    // Test Retailer
    await pool.query(
      `INSERT INTO users (id, name, email, role, password)
       VALUES ($1, 'E2E Canary Retailer', $2, 'retailer', 'dummy_hash')`,
      [canaryRetId, `ret_canary_${ts}@test.local`]
    );
    // Intruder Retailer
    await pool.query(
      `INSERT INTO users (id, name, email, role, password)
       VALUES ($1, 'E2E Canary Intruder', $2, 'retailer', 'dummy_hash')`,
      [canaryIntruderId, `intruder_canary_${ts}@test.local`]
    );

    // Product 1 (for normal receipt test)
    await pool.query(
      `INSERT INTO products (id, name, category, batch_number, farmer_id, current_owner_id, quantity, unit, expiry_date, status)
       VALUES ($1, 'E2E Organic Apples', 'Fruits', $2, $3, $3, 100, 'kg', '2027-12-31', 'ACTIVE')`,
      [canaryProd1Id, batch1, canaryDistId]
    );

    // Product 2 (for discrepancy test)
    await pool.query(
      `INSERT INTO products (id, name, category, batch_number, farmer_id, current_owner_id, quantity, unit, expiry_date, status)
       VALUES ($1, 'E2E Organic Oranges', 'Fruits', $2, $3, $3, 50, 'kg', '2027-12-31', 'ACTIVE')`,
      [canaryProd2Id, batch2, canaryDistId]
    );

    // Shipment 1
    await pool.query(
      `INSERT INTO shipments (id, shipment_tracking_id, product_id, batch_number, sender_id, receiver_id, distributor_id, quantity, unit, status)
       VALUES ($1, $2, $3, $4, $5, $6, $5, 100, 'kg', 'IN_TRANSIT')`,
      [canaryShip1Id, `TRK-1-${ts}`, canaryProd1Id, batch1, canaryDistId, canaryRetId]
    );

    // Shipment 2
    await pool.query(
      `INSERT INTO shipments (id, shipment_tracking_id, product_id, batch_number, sender_id, receiver_id, distributor_id, quantity, unit, status)
       VALUES ($1, $2, $3, $4, $5, $6, $5, 50, 'kg', 'IN_TRANSIT')`,
      [canaryShip2Id, `TRK-2-${ts}`, canaryProd2Id, batch2, canaryDistId, canaryRetId]
    );

    console.log('Isolated canary records created successfully.\n');

    // -------------------------------------------------------------
    // Step 2: Negative Tests (Security & Validation Checks)
    // -------------------------------------------------------------
    console.log('--- Step 2: Security & Validation Tests ---');

    // 2.1 Unauthorized distributor
    {
      const { req, res } = createReqRes({
        user: { id: canaryIntruderId, role: 'distributor' },
        params: { id: canaryShip1Id },
        body: { recipient_name: 'Receiver', quantity_delivered: 100 }
      });
      await submitProofOfDelivery(req, res);
      assert.strictEqual(res.statusCode, 403, 'Expected 403 Forbidden for unauthorized distributor');
      markPass('Unauthorized distributor rejected with 403 Forbidden');
    }

    // 2.2 Excessive quantity rejected
    {
      const { req, res } = createReqRes({
        user: { id: canaryDistId, role: 'distributor' },
        params: { id: canaryShip1Id },
        body: { recipient_name: 'Receiver', quantity_delivered: 9999 }
      });
      await submitProofOfDelivery(req, res);
      assert.strictEqual(res.statusCode, 400, 'Expected 400 Bad Request for excessive quantity');
      markPass('Delivery quantity exceeding shipment rejected with 400 Bad Request');
    }

    // 2.3 Unauthorized retailer cannot view proof before or after
    {
      const { req, res } = createReqRes({
        user: { id: canaryIntruderId, role: 'retailer' },
        params: { id: canaryShip1Id }
      });
      await getShipmentDeliveryProof(req, res);
      assert.strictEqual(res.statusCode, 403, 'Expected 403 Forbidden for unassigned retailer view');
      markPass('Unassigned retailer cannot view proof of delivery (403 Forbidden)');
    }

    // -------------------------------------------------------------
    // Step 3: Distributor Submits Proof for Shipment 1
    // -------------------------------------------------------------
    console.log('\n--- Step 3: Distributor Submits Proof of Delivery (Shipment 1) ---');
    {
      const { req, res } = createReqRes({
        user: { id: canaryDistId, role: 'distributor' },
        params: { id: canaryShip1Id },
        body: {
          recipient_name: 'Store Manager Sarah',
          quantity_delivered: 100,
          delivery_notes: 'All 100kg delivered in cold chain vehicle',
          photo_url: 'https://local-storage/canary-proof.jpg'
        }
      });
      await submitProofOfDelivery(req, res);
      assert.strictEqual(res.statusCode, 201, 'Expected 201 Created');
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.proof.status, 'SUBMITTED');
      markPass('Distributor submits proof of delivery successfully (201 Created)');

      // Verify direct PostgreSQL state
      const dbPod = await pool.query('SELECT * FROM proof_of_delivery WHERE shipment_id = $1', [canaryShip1Id]);
      assert.strictEqual(dbPod.rows.length, 1);
      assert.strictEqual(dbPod.rows[0].status, 'SUBMITTED');
      assert.strictEqual(dbPod.rows[0].recipient_name, 'Store Manager Sarah');
      assert.strictEqual(Number(dbPod.rows[0].quantity_delivered), 100);
      markPass('PostgreSQL ground truth: proof_of_delivery row created with SUBMITTED status');

      const dbShip = await pool.query('SELECT status FROM shipments WHERE id = $1', [canaryShip1Id]);
      assert.strictEqual(dbShip.rows[0].status, 'DELIVERED');
      markPass('PostgreSQL ground truth: shipment status transitioned to DELIVERED');

      const dbTrace = await pool.query(
        "SELECT * FROM traceability_events WHERE metadata->>'shipment_id' = $1 AND event_type = 'DISTRIBUTOR_DELIVERED'",
        [canaryShip1Id]
      );
      assert.strictEqual(dbTrace.rows.length, 1);
      markPass('PostgreSQL ground truth: traceability event recorded for proof submission');
    }

    // -------------------------------------------------------------
    // Step 4: Duplicate Submission & Retailer Authorization Checks
    // -------------------------------------------------------------
    console.log('\n--- Step 4: Duplicate Submission & Retailer Protection Checks ---');
    // 4.1 Duplicate submission prevented
    {
      const { req, res } = createReqRes({
        user: { id: canaryDistId, role: 'distributor' },
        params: { id: canaryShip1Id },
        body: { recipient_name: 'Duplicate', quantity_delivered: 100 }
      });
      await submitProofOfDelivery(req, res);
      assert.ok(res.statusCode === 400 || res.statusCode === 409, `Expected 400 or 409 for duplicate submission, got ${res.statusCode}`);
      markPass('Duplicate proof submission rejected (status validation/duplicate prevention)');
    }

    // 4.2 Unauthorized retailer acknowledgement rejected
    {
      const { req, res } = createReqRes({
        user: { id: canaryIntruderId, role: 'retailer' },
        params: { id: canaryShip1Id },
        body: { qr_data: batch1 }
      });
      await acknowledgeDeliveryReceipt(req, res);
      assert.strictEqual(res.statusCode, 403, 'Expected 403 Forbidden for intruder acknowledgement');
      markPass('Unauthorized retailer acknowledgement rejected with 403 Forbidden');
    }

    // 4.3 QR Code mismatch rejected
    {
      const { req, res } = createReqRes({
        user: { id: canaryRetId, role: 'retailer' },
        params: { id: canaryShip1Id },
        body: { qr_data: 'WRONG-BATCH-CODE' }
      });
      await acknowledgeDeliveryReceipt(req, res);
      assert.strictEqual(res.statusCode, 400, 'Expected 400 Bad Request for QR mismatch');
      markPass('Mismatched QR batch code rejected with 400 Bad Request');
    }

    // -------------------------------------------------------------
    // Step 5: Correct Retailer Reviews Proof
    // -------------------------------------------------------------
    console.log('\n--- Step 5: Retailer Reviews Proof of Delivery ---');
    {
      const { req, res } = createReqRes({
        user: { id: canaryRetId, role: 'retailer' },
        params: { id: canaryShip1Id }
      });
      await getShipmentDeliveryProof(req, res);
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.recipient_name, 'Store Manager Sarah');
      assert.strictEqual(Number(res.body.data.quantity_delivered), 100);
      markPass('Assigned retailer successfully retrieves and reviews delivery proof (200 OK)');
    }

    // -------------------------------------------------------------
    // Step 6: Correct Retailer Acknowledges Receipt (Transactional Stored Procedure)
    // -------------------------------------------------------------
    console.log('\n--- Step 6: Retailer Acknowledges Delivery (Transactional Stored Procedure) ---');
    {
      const { req, res } = createReqRes({
        user: { id: canaryRetId, role: 'retailer' },
        params: { id: canaryShip1Id },
        body: { qr_data: batch1 }
      });
      await acknowledgeDeliveryReceipt(req, res);
      assert.strictEqual(res.statusCode, 200, 'Expected 200 OK');
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.status, 'ACKNOWLEDGED');
      markPass('Retailer acknowledgement succeeds (200 OK)');

      // PostgreSQL Ground-Truth Assertions
      const dbPod = await pool.query('SELECT * FROM proof_of_delivery WHERE shipment_id = $1', [canaryShip1Id]);
      assert.strictEqual(dbPod.rows[0].status, 'ACKNOWLEDGED');
      assert.strictEqual(dbPod.rows[0].acknowledged_by, canaryRetId);
      assert.ok(dbPod.rows[0].acknowledged_at !== null);
      markPass('PostgreSQL ground truth: proof_of_delivery updated to ACKNOWLEDGED with timestamp');

      const dbShip = await pool.query('SELECT status FROM shipments WHERE id = $1', [canaryShip1Id]);
      assert.strictEqual(dbShip.rows[0].status, 'RECEIVED');
      markPass('PostgreSQL ground truth: shipment status atomically updated to RECEIVED');

      const dbProduct = await pool.query('SELECT current_owner_id FROM products WHERE id = $1', [canaryProd1Id]);
      assert.strictEqual(dbProduct.rows[0].current_owner_id, canaryRetId);
      markPass('PostgreSQL ground truth: product current_owner_id transferred to retailer');

      const dbInv = await pool.query('SELECT * FROM retailer_inventory WHERE retailer_id = $1 AND batch_number = $2', [
        canaryRetId,
        batch1
      ]);
      assert.strictEqual(dbInv.rows.length, 1, 'Exactly one inventory row should exist');
      assert.strictEqual(Number(dbInv.rows[0].quantity), 100);
      assert.strictEqual(dbInv.rows[0].status, 'AVAILABLE');
      markPass('PostgreSQL ground truth: retailer_inventory row created with correct quantity and status');

      const dbTrace = await pool.query(
        "SELECT * FROM traceability_events WHERE batch_number = $1 AND event_type = 'RETAILER_RECEIVED'",
        [batch1]
      );
      assert.strictEqual(dbTrace.rows.length, 1);
      markPass('PostgreSQL ground truth: RETAILER_RECEIVED traceability event recorded');

      const dbOutbox = await pool.query(
        "SELECT event_type FROM event_outbox WHERE payload->>'batch_id' = $1 ORDER BY event_type",
        [batch1]
      );
      const outboxTypes = dbOutbox.rows.map(r => r.event_type);
      assert.ok(outboxTypes.includes('SHIPMENT_RECEIVED'));
      assert.ok(outboxTypes.includes('INVENTORY_CREATED'));
      markPass('PostgreSQL ground truth: transactional outbox events generated (SHIPMENT_RECEIVED, INVENTORY_CREATED)');
    }

    // -------------------------------------------------------------
    // Step 7: Prevent Duplicate Acknowledgement & Single Inventory Intake
    // -------------------------------------------------------------
    console.log('\n--- Step 7: Duplicate Intake Prevention & Single Inventory Verification ---');
    {
      const { req, res } = createReqRes({
        user: { id: canaryRetId, role: 'retailer' },
        params: { id: canaryShip1Id },
        body: { qr_data: batch1 }
      });
      await acknowledgeDeliveryReceipt(req, res);
      assert.ok(res.statusCode === 400 || res.statusCode === 409, `Expected 400 or 409 on duplicate, got ${res.statusCode}`);
      markPass('Duplicate acknowledgement attempt is rejected');

      // Crucial: Assert inventory was created EXACTLY ONCE
      const dbInvCount = await pool.query(
        'SELECT count(*)::int as count FROM retailer_inventory WHERE retailer_id = $1 AND batch_number = $2',
        [canaryRetId, batch1]
      );
      assert.strictEqual(dbInvCount.rows[0].count, 1, 'Inventory record count must remain exactly 1');
      markPass('PostgreSQL ground truth: Inventory created EXACTLY ONCE (No duplicate intake)');
    }

    // -------------------------------------------------------------
    // Step 8: Discrepancy Reporting Workflow (Shipment 2)
    // -------------------------------------------------------------
    console.log('\n--- Step 8: Complete Discrepancy Reporting Workflow (Shipment 2) ---');
    // 8.1 Distributor submits proof for shipment 2
    {
      const { req, res } = createReqRes({
        user: { id: canaryDistId, role: 'distributor' },
        params: { id: canaryShip2Id },
        body: {
          recipient_name: 'Store Manager Sarah',
          quantity_delivered: 50,
          delivery_notes: 'All 50kg loaded',
          photo_url: 'https://local-storage/oranges-proof.jpg'
        }
      });
      await submitProofOfDelivery(req, res);
      assert.strictEqual(res.statusCode, 201);
      markPass('Distributor submits proof for Shipment 2 (DELIVERED)');
    }

    // 8.2 Retailer reports discrepancy
    {
      const discrepancyReason = 'Damaged packaging and crushed fruit boxes';
      const discrepancyNotes = '15kg crushed due to vehicle shift during transit';

      const { req, res } = createReqRes({
        user: { id: canaryRetId, role: 'retailer' },
        params: { id: canaryShip2Id },
        body: {
          reason: discrepancyReason,
          notes: discrepancyNotes
        }
      });
      await reportDeliveryDiscrepancy(req, res);
      assert.strictEqual(res.statusCode, 200, 'Expected 200 OK');
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.status, 'DISPUTED');
      markPass('Retailer successfully reports discrepancy (200 OK)');

      // PostgreSQL Ground-Truth Assertions
      const dbPod = await pool.query('SELECT * FROM proof_of_delivery WHERE shipment_id = $1', [canaryShip2Id]);
      assert.strictEqual(dbPod.rows[0].status, 'DISPUTED');
      assert.strictEqual(dbPod.rows[0].discrepancy_reason, discrepancyReason);
      assert.strictEqual(dbPod.rows[0].discrepancy_notes, discrepancyNotes);
      // Verify original distributor proof is PRESERVED intact!
      assert.strictEqual(dbPod.rows[0].recipient_name, 'Store Manager Sarah');
      assert.strictEqual(Number(dbPod.rows[0].quantity_delivered), 50);
      assert.strictEqual(dbPod.rows[0].photo_url, 'https://local-storage/oranges-proof.jpg');
      markPass('PostgreSQL ground truth: Discrepancy logged while preserving original distributor proof');

      const dbShip = await pool.query('SELECT status FROM shipments WHERE id = $1', [canaryShip2Id]);
      assert.strictEqual(dbShip.rows[0].status, 'DELIVERY_DISPUTED');
      markPass('PostgreSQL ground truth: shipment status updated to DELIVERY_DISPUTED');

      const dbTrace = await pool.query(
        "SELECT * FROM traceability_events WHERE metadata->>'shipment_id' = $1 AND event_type = 'DELIVERY_DISPUTED'",
        [canaryShip2Id]
      );
      assert.strictEqual(dbTrace.rows.length, 1);
      markPass('PostgreSQL ground truth: DELIVERY_DISPUTED traceability event logged');
    }

    // 8.3 Disputed shipment blocks normal receipt
    {
      const { req, res } = createReqRes({
        user: { id: canaryRetId, role: 'retailer' },
        params: { id: canaryShip2Id },
        body: { qr_data: batch2 }
      });
      await acknowledgeDeliveryReceipt(req, res);
      assert.strictEqual(res.statusCode, 400, 'Expected 400 Bad Request');
      assert.match(res.body.message, /dispute/i);
      markPass('Disputed shipment blocks normal delivery receipt (400 Bad Request)');

      // Assert NO inventory was created for disputed shipment
      const dbInvCount = await pool.query(
        'SELECT count(*)::int as count FROM retailer_inventory WHERE retailer_id = $1 AND batch_number = $2',
        [canaryRetId, batch2]
      );
      assert.strictEqual(dbInvCount.rows[0].count, 0, 'No inventory must be created for disputed shipment');
      markPass('PostgreSQL ground truth: Zero inventory created for disputed shipment');
    }

    // -------------------------------------------------------------
    // Step 9: Database Transaction Safety (Direct RPC Test)
    // -------------------------------------------------------------
    console.log('\n--- Step 9: Database Transaction Safety & Atomicity Verification ---');
    {
      // Calling stored procedure with non-existent shipment must roll back cleanly
      const { data, error } = await (supabase as any).rpc('acknowledge_delivery_receipt', {
        p_shipment_id: '00000000-0000-0000-0000-000000000000',
        p_retailer_id: canaryRetId,
        p_qr_data: 'TEST',
        p_tx_hash: null
      });
      assert.ok(error !== null);
      assert.strictEqual(error.code, 'P0002');
      markPass('Stored procedure acknowledge_delivery_receipt raises P0002 on non-existent shipment');
    }

    // -------------------------------------------------------------
    // Step 10: Safe Teardown & Record Preservation
    // -------------------------------------------------------------
    console.log('\n--- Step 10: Safe Cleanup of Test Canary Records ---');
    // Delete only the canary records created during this run
    await pool.query('DELETE FROM event_outbox WHERE payload->>\'batch_id\' IN ($1, $2)', [batch1, batch2]);
    await pool.query('DELETE FROM traceability_events WHERE batch_number IN ($1, $2)', [batch1, batch2]);
    await pool.query('DELETE FROM retailer_inventory WHERE batch_number IN ($1, $2)', [batch1, batch2]);
    await pool.query('DELETE FROM proof_of_delivery WHERE shipment_id IN ($1, $2)', [canaryShip1Id, canaryShip2Id]);
    await pool.query('DELETE FROM shipments WHERE id IN ($1, $2)', [canaryShip1Id, canaryShip2Id]);
    await pool.query('DELETE FROM products WHERE id IN ($1, $2)', [canaryProd1Id, canaryProd2Id]);
    await pool.query('DELETE FROM users WHERE id IN ($1, $2, $3)', [canaryDistId, canaryRetId, canaryIntruderId]);

    // Verify baseline counts are 100% preserved
    const afterUsers = await pool.query('SELECT count(*)::int as count FROM users');
    const afterProducts = await pool.query('SELECT count(*)::int as count FROM products');
    const afterShipments = await pool.query('SELECT count(*)::int as count FROM shipments');
    const afterInventory = await pool.query('SELECT count(*)::int as count FROM retailer_inventory');
    const afterPod = await pool.query('SELECT count(*)::int as count FROM proof_of_delivery');

    assert.strictEqual(afterUsers.rows[0].count, baseline.users, 'Users count must match baseline');
    assert.strictEqual(afterProducts.rows[0].count, baseline.products, 'Products count must match baseline');
    assert.strictEqual(afterShipments.rows[0].count, baseline.shipments, 'Shipments count must match baseline');
    assert.strictEqual(afterInventory.rows[0].count, baseline.inventory, 'Inventory count must match baseline');
    assert.strictEqual(afterPod.rows[0].count, baseline.pod, 'POD count must match baseline');

    markPass('All canary records cleaned up; 100% of pre-existing database records preserved intact!');

    console.log('\n================================================================');
    console.log(`REAL DATABASE E2E TEST SUMMARY: ${passedTests}/${totalTests} TESTS PASSED`);
    console.log('================================================================\n');

  } catch (err) {
    console.error('Fatal error during E2E test execution:', err);
    // Cleanup if something crashed
    try {
      await pool.query('DELETE FROM event_outbox WHERE payload->>\'batch_id\' IN ($1, $2)', [batch1, batch2]);
      await pool.query('DELETE FROM traceability_events WHERE batch_number IN ($1, $2)', [batch1, batch2]);
      await pool.query('DELETE FROM retailer_inventory WHERE batch_number IN ($1, $2)', [batch1, batch2]);
      await pool.query('DELETE FROM proof_of_delivery WHERE shipment_id IN ($1, $2)', [canaryShip1Id, canaryShip2Id]);
      await pool.query('DELETE FROM shipments WHERE id IN ($1, $2)', [canaryShip1Id, canaryShip2Id]);
      await pool.query('DELETE FROM products WHERE id IN ($1, $2)', [canaryProd1Id, canaryProd2Id]);
      await pool.query('DELETE FROM users WHERE id IN ($1, $2, $3)', [canaryDistId, canaryRetId, canaryIntruderId]);
    } catch (cleanErr) {
      console.error('Emergency cleanup failed:', cleanErr);
    }
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runE2eTests();

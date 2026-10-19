import './src/test_preload';
import { Kafka } from 'kafkajs';
import pg from 'pg';
import crypto from 'crypto';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { supabase } from './src/config/supabase';
import {
  InventoryAnalyticsConsumer,
} from './src/services/inventoryAnalyticsConsumer';
import { assertApprovedLocalEnvironment, assertLocalPostgresUrl } from './src/utils/localDatabaseGuard';

const LOCAL_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

assertApprovedLocalEnvironment('InventoryConsumerSuite');
assertLocalPostgresUrl(LOCAL_DB_URL, 'InventoryConsumerSuite');

const envConfig = dotenv.parse(fs.readFileSync(path.resolve(__dirname, '.env'), 'utf8'));
const originalSupabase = createClient(envConfig.SUPABASE_URL, envConfig.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function runTestSuite() {
  console.log('===================================================================');
  console.log('    FarmChainAI — Inventory Analytics Consumer Verification        ');
  console.log('===================================================================\n');

  const pool = new pg.Pool({ connectionString: LOCAL_DB_URL });
  const kafka = new Kafka({
    clientId: 'inventory-test-runner',
    brokers: ['localhost:9092'],
  });
  const producer = kafka.producer();
  await producer.connect();

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
  const { data: initialLocalOutbox, error: localErr } = await supabase
    .from('event_outbox')
    .select('id, status');

  if (localErr) {
    throw new Error(`Failed to query local baseline outbox: ${localErr.message}`);
  }

  const localPendingCount = initialLocalOutbox.filter((r) => r.status === 'PENDING').length;
  console.log(`[Baseline Audit] Verified ${localPendingCount} local business events in PENDING status.`);
  assert.strictEqual(initialLocalOutbox.length, 35, 'Expected exactly 35 pre-existing pending local business events');
  assert.strictEqual(localPendingCount, 35, 'All 35 local business events must remain in PENDING state');

  const { data: initialRemoteOutbox, error: remoteErr } = await originalSupabase
    .from('event_outbox')
    .select('id, status');
  if (remoteErr) {
    throw new Error(`Failed to query remote baseline outbox: ${remoteErr.message}`);
  }
  const remotePendingCount = initialRemoteOutbox.filter((r) => r.status === 'PENDING').length;
  console.log(`[Baseline Audit] Verified ${remotePendingCount} hosted backlog events in PENDING status (read-only).`);
  assert.strictEqual(initialRemoteOutbox.length, 40, 'Expected exactly 40 pre-existing hosted business events');
  assert.strictEqual(remotePendingCount, 40, 'All 40 hosted business events must remain in PENDING state');

  // Test identifiers for cleanup
  const testRetailer1 = `test-ret-inv-${Date.now()}`;
  const testBatch1 = `test-batch-inv-${Date.now()}`;
  const testEvent1 = `test-event-inv-created-${Date.now()}`;

  const testRetailerOOO = `test-ret-ooo-${Date.now()}`;
  const testBatchOOO = `test-batch-ooo-${Date.now()}`;
  const testEventSaleOOO = `test-event-sale-ooo-${Date.now()}`;
  const testEventCreatedOOO = `test-event-created-ooo-${Date.now()}`;
  const testEventWastageOOO = `test-event-wastage-ooo-${Date.now()}`;
  const testEventUpdateOOO = `test-event-update-ooo-${Date.now()}`;

  try {
    // -------------------------------------------------------------
    // TEST 1: Safety Guard — Test-only mode cannot subscribe to business topics
    // -------------------------------------------------------------
    await test('Safety Guard: Test-only consumer refuses subscription to business topics', async () => {
      let threwInventoryError = false;
      try {
        new InventoryAnalyticsConsumer({
          isTestMode: true,
          topic: 'inventory-events', // FORBIDDEN in test mode
        });
      } catch (err: any) {
        if (err.message.includes('SAFETY VIOLATION')) {
          threwInventoryError = true;
        }
      }
      assert.strictEqual(threwInventoryError, true, 'Test mode consumer must reject inventory-events topic');

      let threwShipmentError = false;
      try {
        new InventoryAnalyticsConsumer({
          isTestMode: true,
          topic: 'shipment-events', // FORBIDDEN in test mode
        });
      } catch (err: any) {
        if (err.message.includes('SAFETY VIOLATION')) {
          threwShipmentError = true;
        }
      }
      assert.strictEqual(threwShipmentError, true, 'Test mode consumer must reject shipment-events topic');

      let threwTraceError = false;
      try {
        new InventoryAnalyticsConsumer({
          isTestMode: true,
          topic: 'traceability-events', // FORBIDDEN in test mode
        });
      } catch (err: any) {
        if (err.message.includes('SAFETY VIOLATION')) {
          threwTraceError = true;
        }
      }
      assert.strictEqual(threwTraceError, true, 'Test mode consumer must reject traceability-events topic');

      const testConsumer = new InventoryAnalyticsConsumer({ isTestMode: true });
      assert.strictEqual(testConsumer.topic, 'test-diagnostic-events');
      assert.deepStrictEqual(testConsumer.getSubscribedTopics(), ['test-diagnostic-events']);
    });

    // -------------------------------------------------------------
    // TEST 2: Envelope and Payload Validation Rules
    // -------------------------------------------------------------
    await test('Validation: Envelope structure and inventory payload schema rules', async () => {
      const consumer = new InventoryAnalyticsConsumer({ isTestMode: true });

      // Envelope validation
      assert.ok(consumer.validateEnvelope({} as any)?.includes('event_id'));
      assert.ok(consumer.validateEnvelope({ event_id: 'e1' } as any)?.includes('event_type'));
      assert.ok(consumer.validateEnvelope({ event_id: 'e1', event_type: 'T' } as any)?.includes('payload'));
      assert.ok(consumer.validateEnvelope({ event_id: 'e1', event_type: 'T', payload: 'bad' } as any)?.includes('non-object payload'));

      // Root payload requirements
      assert.ok(consumer.validatePayload('INVENTORY_CREATED', { batch_id: 'b' })?.includes('retailer_id'));
      assert.ok(consumer.validatePayload('INVENTORY_CREATED', { retailer_id: 'r' })?.includes('batch_id'));

      // --- INVENTORY_CREATED ---
      const validInvCreated = consumer.validatePayload('INVENTORY_CREATED', {
        retailer_id: 'ret-01',
        batch_id: 'batch-01',
        product_id: 'prod-01',
        quantity: 50,
        unit: 'units',
        inventory_id: 'inv-uuid',
      });
      assert.strictEqual(validInvCreated, null, 'Actual producer INVENTORY_CREATED should have no error');

      assert.ok(consumer.validatePayload('INVENTORY_CREATED', { retailer_id: 'r', batch_id: 'b', quantity: -10 })?.includes('positive number'));
      assert.ok(consumer.validatePayload('INVENTORY_CREATED', { retailer_id: 'r', batch_id: 'b', quantity: 0 })?.includes('positive number'));
      assert.ok(consumer.validatePayload('INVENTORY_CREATED', { retailer_id: 'r', batch_id: 'b', quantity: 'abc' })?.includes('positive number'));

      // --- SALE_CREATED ---
      const validSale = consumer.validatePayload('SALE_CREATED', {
        retailer_id: 'ret-01',
        batch_id: 'batch-01',
        quantity_sold: 10,
      });
      assert.strictEqual(validSale, null, 'Actual producer SALE_CREATED should have no error');

      assert.ok(consumer.validatePayload('SALE_CREATED', { retailer_id: 'r', batch_id: 'b' })?.includes('quantity_sold'));
      assert.ok(consumer.validatePayload('SALE_CREATED', { retailer_id: 'r', batch_id: 'b', quantity_sold: 0 })?.includes('positive number'));
      assert.ok(consumer.validatePayload('SALE_CREATED', { retailer_id: 'r', batch_id: 'b', quantity_sold: -5 })?.includes('positive number'));

      // --- INVENTORY_UPDATED ---
      const validUpdate = consumer.validatePayload('INVENTORY_UPDATED', {
        retailer_id: 'ret-01',
        batch_id: 'batch-01',
        new_quantity: 40,
        reason: 'CUSTOMER_RETURN',
      });
      assert.strictEqual(validUpdate, null, 'Actual producer INVENTORY_UPDATED should have no error');

      // Zero is a valid inventory quantity (out of stock)
      const validZeroStock = consumer.validatePayload('INVENTORY_UPDATED', {
        retailer_id: 'ret-01',
        batch_id: 'batch-01',
        new_quantity: 0,
      });
      assert.strictEqual(validZeroStock, null, 'Zero stock is a valid non-negative new_quantity');

      assert.ok(consumer.validatePayload('INVENTORY_UPDATED', { retailer_id: 'r', batch_id: 'b', new_quantity: -1 })?.includes('non-negative number'));

      // --- WASTAGE_RECORDED ---
      const validWastage = consumer.validatePayload('WASTAGE_RECORDED', {
        retailer_id: 'ret-01',
        batch_id: 'batch-01',
        quantity_wasted: 5,
        reason: 'DAMAGED_IN_STORE',
      });
      assert.strictEqual(validWastage, null, 'Actual producer WASTAGE_RECORDED should have no error');

      assert.ok(consumer.validatePayload('WASTAGE_RECORDED', { retailer_id: 'r', batch_id: 'b' })?.includes('quantity_wasted'));
      assert.ok(consumer.validatePayload('WASTAGE_RECORDED', { retailer_id: 'r', batch_id: 'b', quantity_wasted: 0 })?.includes('positive number'));
      assert.ok(consumer.validatePayload('WASTAGE_RECORDED', { retailer_id: 'r', batch_id: 'b', quantity_wasted: -2 })?.includes('positive number'));

      // Unsupported event type
      assert.ok(consumer.validatePayload('UNKNOWN_TYPE', { retailer_id: 'r', batch_id: 'b' })?.includes('Unsupported'));
    });

    // -------------------------------------------------------------
    // TEST 3: Contract Compatibility (Historical Variations & Omissions)
    // -------------------------------------------------------------
    await test('Contract Compatibility: Process historical variations and optional omissions', async () => {
      const consumer = new InventoryAnalyticsConsumer({ isTestMode: true });

      // Variation 1: INVENTORY_CREATED with quantity_delivered instead of quantity
      const var1 = consumer.validatePayload('INVENTORY_CREATED', {
        retailer_id: 'ret-v1',
        batch_id: 'batch-v1',
        quantity_delivered: 75,
      });
      assert.strictEqual(var1, null);
      const norm1 = consumer.normalizePayload('INVENTORY_CREATED', {
        retailer_id: 'ret-v1',
        batch_id: 'batch-v1',
        quantity_delivered: 75,
      });
      assert.strictEqual(norm1.quantity, 75);
      assert.strictEqual(norm1.unit, 'units', 'Default unit should be units when omitted');

      // Variation 2: SALE_CREATED with quantity instead of quantity_sold
      const var2 = consumer.validatePayload('SALE_CREATED', {
        retailer_id: 'ret-v2',
        batch_id: 'batch-v2',
        quantity: 12,
      });
      assert.strictEqual(var2, null);
      const norm2 = consumer.normalizePayload('SALE_CREATED', {
        retailer_id: 'ret-v2',
        batch_id: 'batch-v2',
        quantity: '12',
      });
      assert.strictEqual(norm2.quantity_sold, 12);

      // Variation 3: INVENTORY_UPDATED with quantity instead of new_quantity
      const var3 = consumer.validatePayload('INVENTORY_UPDATED', {
        retailer_id: 'ret-v3',
        batch_id: 'batch-v3',
        quantity: 88,
      });
      assert.strictEqual(var3, null);
      const norm3 = consumer.normalizePayload('INVENTORY_UPDATED', {
        retailer_id: 'ret-v3',
        batch_id: 'batch-v3',
        quantity: 88,
      });
      assert.strictEqual(norm3.new_quantity, 88);

      // Variation 4: WASTAGE_RECORDED with quantity instead of quantity_wasted
      const var4 = consumer.validatePayload('WASTAGE_RECORDED', {
        retailer_id: 'ret-v4',
        batch_id: 'batch-v4',
        quantity: 4,
      });
      assert.strictEqual(var4, null);
      const norm4 = consumer.normalizePayload('WASTAGE_RECORDED', {
        retailer_id: 'ret-v4',
        batch_id: 'batch-v4',
        quantity: 4,
      });
      assert.strictEqual(norm4.quantity_wasted, 4);
    });

    // -------------------------------------------------------------
    // TEST 4: Isolated Projection: INVENTORY_CREATED
    // -------------------------------------------------------------
    const consumerForDb = new InventoryAnalyticsConsumer({
      isTestMode: true,
      dbPool: pool,
    });

    await test('Isolated Projection: Process INVENTORY_CREATED and create projection row', async () => {
      const envelope = {
        event_id: testEvent1,
        event_type: 'TEST_INVENTORY_CREATED',
        event_version: '1.0',
        event_timestamp: new Date().toISOString(),
        source: 'retailer-service',
        payload: {
          test: true,
          retailer_id: testRetailer1,
          batch_id: testBatch1,
          product_id: 'test-prod-1',
          quantity: 100,
          unit: 'kg',
          inventory_id: 'test-inv-uuid-1',
        },
      };

      const result = await consumerForDb.processMessage(envelope, {
        topic: 'test-diagnostic-events',
        partition: 0,
        message: { offset: '10' },
      } as any);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.duplicate, false);

      // Verify row in inventory_projections
      const projRes = await pool.query(
        `SELECT * FROM public.inventory_projections WHERE retailer_id = $1 AND batch_id = $2;`,
        [testRetailer1, testBatch1]
      );
      assert.strictEqual(projRes.rows.length, 1);
      const row = projRes.rows[0];
      assert.strictEqual(row.retailer_id, testRetailer1);
      assert.strictEqual(row.batch_id, testBatch1);
      assert.strictEqual(row.product_id, 'test-prod-1');
      assert.strictEqual(row.unit, 'kg');
      assert.strictEqual(Number(row.initial_quantity), 100);
      assert.strictEqual(Number(row.current_quantity), 100);
      assert.strictEqual(Number(row.total_sold_quantity), 0);
      assert.strictEqual(Number(row.total_wasted_quantity), 0);
      assert.strictEqual(row.turnover_ratio, null, 'Turnover ratio should be null before any sales occur');
      assert.strictEqual(row.events_count, 1);
      assert.strictEqual(row.last_event_id, testEvent1);
      assert.strictEqual(row.last_event_type, 'INVENTORY_CREATED');

      // Verify row in inventory_event_index
      const indexRes = await pool.query(
        `SELECT * FROM public.inventory_event_index WHERE event_id = $1;`,
        [testEvent1]
      );
      assert.strictEqual(indexRes.rows.length, 1);
      assert.strictEqual(indexRes.rows[0].event_type, 'INVENTORY_CREATED');

      // Verify row in processed_events
      const procRes = await pool.query(
        `SELECT * FROM public.processed_events WHERE event_id = $1 AND consumer_group = $2;`,
        [testEvent1, consumerForDb.groupId]
      );
      assert.strictEqual(procRes.rows.length, 1);
    });

    // -------------------------------------------------------------
    // TEST 5: Idempotency: Repeated Delivery of Identical Event
    // -------------------------------------------------------------
    await test('Idempotency: Repeated delivery of identical event ID is safely skipped', async () => {
      const envelope = {
        event_id: testEvent1,
        event_type: 'TEST_INVENTORY_CREATED',
        event_version: '1.0',
        event_timestamp: new Date().toISOString(),
        source: 'retailer-service',
        payload: {
          test: true,
          retailer_id: testRetailer1,
          batch_id: testBatch1,
          product_id: 'test-prod-1',
          quantity: 100,
          unit: 'kg',
        },
      };

      const result = await consumerForDb.processMessage(envelope, {
        topic: 'test-diagnostic-events',
        partition: 0,
        message: { offset: '11' },
      } as any);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.duplicate, true, 'Repeated message must be identified as duplicate');

      // Verify events_count and quantities have NOT doubled or changed
      const projRes = await pool.query(
        `SELECT * FROM public.inventory_projections WHERE retailer_id = $1 AND batch_id = $2;`,
        [testRetailer1, testBatch1]
      );
      assert.strictEqual(projRes.rows[0].events_count, 1, 'Events count must NOT increment on duplicate');
      assert.strictEqual(Number(projRes.rows[0].current_quantity), 100);
      assert.strictEqual(Number(projRes.rows[0].total_sold_quantity), 0);
    });

    // -------------------------------------------------------------
    // TEST 6: Out-of-Order Lifecycle: SALE_CREATED before INVENTORY_CREATED
    // -------------------------------------------------------------
    await test('Out-of-Order: SALE_CREATED before INVENTORY_CREATED reconciles metrics correctly', async () => {
      // Step A: SALE_CREATED arrives early
      const saleEnvelope = {
        event_id: testEventSaleOOO,
        event_type: 'TEST_SALE_CREATED',
        event_version: '1.0',
        event_timestamp: new Date().toISOString(),
        source: 'pos-terminal',
        payload: {
          test: true,
          retailer_id: testRetailerOOO,
          batch_id: testBatchOOO,
          quantity_sold: 25,
        },
      };

      const saleResult = await consumerForDb.processMessage(saleEnvelope, {
        topic: 'test-diagnostic-events',
        partition: 0,
        message: { offset: '20' },
      } as any);

      assert.strictEqual(saleResult.success, true);
      assert.strictEqual(saleResult.duplicate, false);

      const projEarly = (await pool.query(
        `SELECT * FROM public.inventory_projections WHERE retailer_id = $1 AND batch_id = $2;`,
        [testRetailerOOO, testBatchOOO]
      )).rows[0];

      assert.strictEqual(Number(projEarly.total_sold_quantity), 25);
      assert.strictEqual(projEarly.sales_count, 1);
      assert.strictEqual(projEarly.initial_quantity, null, 'Initial quantity unknown before receipt event');
      assert.strictEqual(projEarly.turnover_ratio, null, 'Turnover ratio cannot be computed without verified initial quantity');

      // Step B: INVENTORY_CREATED arrives later
      const createdEnvelope = {
        event_id: testEventCreatedOOO,
        event_type: 'TEST_INVENTORY_CREATED',
        event_version: '1.0',
        event_timestamp: new Date().toISOString(),
        source: 'warehouse-dock',
        payload: {
          test: true,
          retailer_id: testRetailerOOO,
          batch_id: testBatchOOO,
          product_id: 'test-prod-ooo',
          quantity: 100,
          unit: 'units',
        },
      };

      const createdResult = await consumerForDb.processMessage(createdEnvelope, {
        topic: 'test-diagnostic-events',
        partition: 0,
        message: { offset: '21' },
      } as any);

      assert.strictEqual(createdResult.success, true);
      assert.strictEqual(createdResult.duplicate, false);

      const projReconciled = (await pool.query(
        `SELECT * FROM public.inventory_projections WHERE retailer_id = $1 AND batch_id = $2;`,
        [testRetailerOOO, testBatchOOO]
      )).rows[0];

      assert.strictEqual(Number(projReconciled.initial_quantity), 100);
      assert.strictEqual(Number(projReconciled.total_sold_quantity), 25);
      assert.strictEqual(Number(projReconciled.current_quantity), 75, 'Remaining current stock should be 100 - 25 = 75');
      // Turnover ratio = 25 / 100 = 0.2500
      assert.strictEqual(Number(projReconciled.turnover_ratio), 0.25);
      assert.strictEqual(projReconciled.events_count, 2);
    });

    // -------------------------------------------------------------
    // TEST 7: Wastage and Stock Update
    // -------------------------------------------------------------
    await test('Wastage & Updates: Record wastage and direct stock updates without core table mutations', async () => {
      // 1. Record Wastage (5 units spoiled)
      const wastageEnvelope = {
        event_id: testEventWastageOOO,
        event_type: 'TEST_WASTAGE_RECORDED',
        event_version: '1.0',
        event_timestamp: new Date().toISOString(),
        source: 'inspection-team',
        payload: {
          test: true,
          retailer_id: testRetailerOOO,
          batch_id: testBatchOOO,
          quantity_wasted: 5,
          reason: 'DAMAGED_IN_STORE',
        },
      };

      const wastageResult = await consumerForDb.processMessage(wastageEnvelope, {
        topic: 'test-diagnostic-events',
        partition: 0,
        message: { offset: '22' },
      } as any);

      assert.strictEqual(wastageResult.success, true);

      let proj = (await pool.query(
        `SELECT * FROM public.inventory_projections WHERE retailer_id = $1 AND batch_id = $2;`,
        [testRetailerOOO, testBatchOOO]
      )).rows[0];

      assert.strictEqual(Number(proj.total_wasted_quantity), 5);
      assert.strictEqual(proj.wastage_count, 1);
      assert.strictEqual(Number(proj.current_quantity), 70, '75 - 5 = 70 remaining');

      // 2. Direct stock update (e.g. audit recount or return restock: 68 units)
      const updateEnvelope = {
        event_id: testEventUpdateOOO,
        event_type: 'TEST_INVENTORY_UPDATED',
        event_version: '1.0',
        event_timestamp: new Date().toISOString(),
        source: 'retailer-inventory-sync',
        payload: {
          test: true,
          retailer_id: testRetailerOOO,
          batch_id: testBatchOOO,
          new_quantity: 68,
          reason: 'CYCLE_COUNT_ADJUSTMENT',
        },
      };

      const updateResult = await consumerForDb.processMessage(updateEnvelope, {
        topic: 'test-diagnostic-events',
        partition: 0,
        message: { offset: '23' },
      } as any);

      assert.strictEqual(updateResult.success, true);

      proj = (await pool.query(
        `SELECT * FROM public.inventory_projections WHERE retailer_id = $1 AND batch_id = $2;`,
        [testRetailerOOO, testBatchOOO]
      )).rows[0];

      assert.strictEqual(Number(proj.current_quantity), 68);
      assert.strictEqual(proj.updates_count, 1);
      assert.strictEqual(proj.events_count, 4);

      // Verify that CORE operational tables are completely untouched!
      const coreInvCheck = await pool.query(
        `SELECT count(*)::int as count FROM public.retailer_inventory WHERE batch_number = $1;`,
        [testBatchOOO]
      );
      assert.strictEqual(coreInvCheck.rows[0].count, 0, 'Core retailer_inventory table must never be mutated by analytics consumer');

      const coreSalesCheck = await pool.query(
        `SELECT count(*)::int as count FROM public.retailer_sales WHERE inventory_id IN (SELECT id FROM public.retailer_inventory WHERE batch_number = $1);`,
        [testBatchOOO]
      );
      assert.strictEqual(coreSalesCheck.rows[0].count, 0, 'Core retailer_sales table must never be mutated by analytics consumer');

      const coreWastageCheck = await pool.query(
        `SELECT count(*)::int as count FROM public.retailer_wastage WHERE notes LIKE $1;`,
        [`%${testBatchOOO}%`]
      );
      assert.strictEqual(coreWastageCheck.rows[0].count, 0, 'Core retailer_wastage table must never be mutated by analytics consumer');
    });

    // -------------------------------------------------------------
    // TEST 8: Dead-Letter Queue (DLQ) for Poison Messages
    // -------------------------------------------------------------
    await test('DLQ Routing: Poison message with corrupted payload is routed to dead-letter-events', async () => {
      const consumer = new InventoryAnalyticsConsumer({
        isTestMode: true,
        groupId: `test-group-dlq-inv-${Date.now()}`,
        dbPool: pool,
      });

      let committedOffset: string | null = null;

      // Mock consumer.commitMessageOffset to observe manual commit
      (consumer as any).commitMessageOffset = async (t: string, p: number, o: string) => {
        committedOffset = o;
      };

      // Poison message: missing batch_id entirely
      const poisonEnvelope = {
        event_id: `poison-inv-${Date.now()}`,
        event_type: 'INVENTORY_CREATED',
        event_version: '1.0',
        event_timestamp: new Date().toISOString(),
        source: 'corrupted-producer',
        payload: {
          test: true,
          // MISSING batch_id!
          retailer_id: 'ret-1',
          quantity: 100,
        },
      };

      const mockPayload: any = {
        topic: 'test-diagnostic-events',
        partition: 0,
        message: {
          offset: '88',
          value: Buffer.from(JSON.stringify(poisonEnvelope)),
        },
        heartbeat: async () => {},
      };

      await consumer.handleIncomingMessage(mockPayload);

      assert.strictEqual(committedOffset, '88', 'Offset must be committed only after DLQ dispatch');
      assert.strictEqual(consumer.getHealth().dlqCount, 1, 'DLQ counter should be 1');

      // Valid Historical Message: Must NOT be routed to DLQ
      const validHistRetailerId = `test-ret-dlq-safe-${Date.now()}`;
      const validHistBatchId = `test-batch-dlq-safe-${Date.now()}`;
      const validHistEventId = `test-event-dlq-safe-${Date.now()}`;
      const validHistEnvelope = {
        event_id: validHistEventId,
        event_type: 'TEST_INVENTORY_CREATED',
        event_version: '1.0',
        event_timestamp: new Date().toISOString(),
        source: 'retailer-service',
        payload: {
          test: true,
          retailer_id: validHistRetailerId,
          batch_id: validHistBatchId,
          quantity: 250,
        },
      };

      const validHistPayload: any = {
        topic: 'test-diagnostic-events',
        partition: 0,
        message: {
          offset: '89',
          value: Buffer.from(JSON.stringify(validHistEnvelope)),
        },
        heartbeat: async () => {},
      };

      await consumer.handleIncomingMessage(validHistPayload);

      assert.strictEqual(committedOffset, '89', 'Offset must be committed for valid message');
      assert.strictEqual(consumer.getHealth().dlqCount, 1, 'DLQ counter must NOT increment for valid message');
      assert.strictEqual(consumer.getHealth().processedCount, 1, 'Processed counter should increment');

      await consumer.cleanupTestRecord(validHistRetailerId, validHistBatchId, validHistEventId);
    });

    // -------------------------------------------------------------
    // TEST 9: Transient DB Failure (No Commit, Throws For Redelivery)
    // -------------------------------------------------------------
    await test('Transient Error: Database failure throws without committing Kafka offset', async () => {
      const brokenPool: any = {
        query: async () => {
          throw new Error('Connection terminated unexpectedly (ECONNRESET)');
        },
      };

      const consumer = new InventoryAnalyticsConsumer({
        isTestMode: true,
        groupId: `test-group-transient-inv-${Date.now()}`,
        dbPool: brokenPool,
      });

      let committedOffset: string | null = null;
      (consumer as any).commitMessageOffset = async (t: string, p: number, o: string) => {
        committedOffset = o;
      };

      const envelope = {
        event_id: `transient-inv-${Date.now()}`,
        event_type: 'TEST_INVENTORY_CREATED',
        event_version: '1.0',
        event_timestamp: new Date().toISOString(),
        source: 'retailer-service',
        payload: {
          test: true,
          retailer_id: `test-ret-transient-${Date.now()}`,
          batch_id: 'batch-transient-inv',
          quantity: 100,
        },
      };

      let threwTransient = false;
      try {
        await consumer.handleIncomingMessage({
          topic: 'test-diagnostic-events',
          partition: 0,
          message: { offset: '99', value: Buffer.from(JSON.stringify(envelope)) },
          heartbeat: async () => {},
        } as any);
      } catch (err: any) {
        if (err.message.includes('ECONNRESET')) {
          threwTransient = true;
        }
      }

      assert.strictEqual(threwTransient, true, 'Consumer must rethrow transient DB error');
      assert.strictEqual(committedOffset, null, 'Must NOT commit offset on transient failure');
      assert.strictEqual(consumer.getHealth().dlqCount, 0, 'Transient errors must NOT route to DLQ');
    });

    // -------------------------------------------------------------
    // TEST 10: Live Broker Integration (Test-Only Mode on test-diagnostic-events)
    // -------------------------------------------------------------
    const liveTestRetailerId = `test-ret-live-${Date.now()}`;
    const liveTestBatchId = `test-batch-live-${Date.now()}`;
    const liveTestEventId = `test-event-live-inv-${Date.now()}`;

    await test('Live Broker: Produce test event to Kafka broker and process through consumer', async () => {
      const liveConsumer = new InventoryAnalyticsConsumer({
        isTestMode: true,
        groupId: `test-group-live-inv-${Date.now()}`,
        dbPool: pool,
        enabled: true,
      });

      await liveConsumer.start();
      // Allow consumer group assignment to stabilize
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const liveEnvelope = {
        event_id: liveTestEventId,
        event_type: 'TEST_INVENTORY_CREATED',
        event_version: '1.0',
        event_timestamp: new Date().toISOString(),
        source: 'manual-test-runner',
        payload: {
          test: true,
          retailer_id: liveTestRetailerId,
          batch_id: liveTestBatchId,
          product_id: 'prod-live-inv',
          quantity: 150,
          unit: 'boxes',
        },
      };

      // Produce directly to Kafka test-diagnostic-events topic
      await producer.send({
        topic: 'test-diagnostic-events',
        messages: [
          {
            key: liveTestBatchId,
            value: JSON.stringify(liveEnvelope),
          },
        ],
      });

      console.log(`Produced live test event ${liveTestEventId} to test-diagnostic-events. Waiting for consumer processing...`);

      // Wait up to 12 seconds for consumer to poll and process
      let foundInDb = false;
      for (let i = 0; i < 24; i++) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const check = await pool.query(
          `SELECT * FROM public.inventory_projections WHERE retailer_id = $1 AND batch_id = $2;`,
          [liveTestRetailerId, liveTestBatchId]
        );
        if (check.rows.length > 0) {
          foundInDb = true;
          break;
        }
      }

      await liveConsumer.stop();

      assert.strictEqual(foundInDb, true, 'Live consumer should poll from Kafka and write projection');
      console.log(`Verified live consumer created projection row for (${liveTestRetailerId}, ${liveTestBatchId}).`);

      // Clean up isolated test record
      await liveConsumer.cleanupTestRecord(liveTestRetailerId, liveTestBatchId, liveTestEventId);
    });

    // Cleanup other isolated test batches
    const cleanupConsumer = new InventoryAnalyticsConsumer({ isTestMode: true, dbPool: pool });
    await cleanupConsumer.cleanupTestRecord(testRetailer1, testBatch1, testEvent1);
    await cleanupConsumer.cleanupTestRecord(testRetailerOOO, testBatchOOO, testEventSaleOOO);
    await cleanupConsumer.cleanupTestRecord(testRetailerOOO, testBatchOOO, testEventCreatedOOO);
    await cleanupConsumer.cleanupTestRecord(testRetailerOOO, testBatchOOO, testEventWastageOOO);
    await cleanupConsumer.cleanupTestRecord(testRetailerOOO, testBatchOOO, testEventUpdateOOO);

    // -------------------------------------------------------------
    // TEST 11: Final Read-Only Baseline Audit (All Baseline Events Intact)
    // -------------------------------------------------------------
    await test('Baseline Preservation: 100% of business events remain untouched and PENDING', async () => {
      const { data: finalLocalOutbox, error: finalLocalErr } = await supabase
        .from('event_outbox')
        .select('id, status');

      if (finalLocalErr) {
        throw new Error(`Failed to query final local outbox: ${finalLocalErr.message}`);
      }

      const localPending = finalLocalOutbox.filter((r) => r.status === 'PENDING').length;
      console.log(`[Final Audit] Local outbox total: ${finalLocalOutbox.length}, PENDING count: ${localPending}`);

      assert.strictEqual(finalLocalOutbox.length, 35, 'Local outbox total rows must remain exactly 35');
      assert.strictEqual(localPending, 35, 'All 35 local business events must remain in PENDING state');

      const { data: finalRemoteOutbox, error: finalRemoteErr } = await originalSupabase
        .from('event_outbox')
        .select('id, status');

      if (finalRemoteErr) {
        throw new Error(`Failed to query final remote outbox: ${finalRemoteErr.message}`);
      }

      const remotePending = finalRemoteOutbox.filter((r) => r.status === 'PENDING').length;
      console.log(`[Final Audit] Hosted backlog total: ${finalRemoteOutbox.length}, PENDING count: ${remotePending}`);

      assert.strictEqual(finalRemoteOutbox.length, 40, 'Hosted backlog rows must remain exactly 40');
      assert.strictEqual(remotePending, 40, 'All 40 hosted business events must remain in PENDING state');
    });

    console.log('\n===================================================================');
    console.log(`  SUMMARY: ${passedTests}/${totalTests} TESTS PASSED`);
    console.log('===================================================================\n');
  } catch (err: any) {
    console.error('\n❌ TEST SUITE FAILED:', err.message || err);
    process.exit(1);
  } finally {
    await producer.disconnect();
    await pool.end();
  }
}

runTestSuite();

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
  TraceabilityAnalyticsConsumer,
} from './src/services/traceabilityAnalyticsConsumer';
import { assertApprovedLocalEnvironment, assertLocalPostgresUrl } from './src/utils/localDatabaseGuard';

const LOCAL_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

assertApprovedLocalEnvironment('TraceabilityConsumerSuite');
assertLocalPostgresUrl(LOCAL_DB_URL, 'TraceabilityConsumerSuite');

const envConfig = dotenv.parse(fs.readFileSync(path.resolve(__dirname, '.env'), 'utf8'));
const originalSupabase = createClient(envConfig.SUPABASE_URL, envConfig.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function runTestSuite() {
  console.log('===================================================================');
  console.log('   FarmChainAI — Traceability Analytics Consumer Verification     ');
  console.log('===================================================================\n');

  const pool = new pg.Pool({ connectionString: LOCAL_DB_URL });
  const kafka = new Kafka({
    clientId: 'traceability-test-runner',
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

  try {
    // -------------------------------------------------------------
    // TEST 1: Safety Guard — Test-only mode cannot subscribe to business topics
    // -------------------------------------------------------------
    await test('Safety Guard: Test-only consumer refuses subscription to business topics', async () => {
      let threwSafetyError = false;
      try {
        new TraceabilityAnalyticsConsumer({
          isTestMode: true,
          topic: 'traceability-events', // FORBIDDEN in test mode
        });
      } catch (err: any) {
        if (err.message.includes('SAFETY VIOLATION')) {
          threwSafetyError = true;
        }
      }
      assert.strictEqual(threwSafetyError, true, 'Test mode consumer must reject business topic subscription');
    });

    // -------------------------------------------------------------
    // TEST 2: Envelope and Payload Validation Rules
    // -------------------------------------------------------------
    // -------------------------------------------------------------
    // TEST 2: Envelope and Payload Validation Rules (Real Producers & Variations)
    // -------------------------------------------------------------
    await test('Validation: Envelope structure, producer schemas, and historical contract variations', async () => {
      const consumer = new TraceabilityAnalyticsConsumer({ isTestMode: true });

      // Envelope validations
      assert.ok(consumer.validateEnvelope({} as any)?.includes('event_id'));
      assert.ok(consumer.validateEnvelope({ event_id: 'e1' } as any)?.includes('event_type'));
      assert.ok(consumer.validateEnvelope({ event_id: 'e1', event_type: 'T' } as any)?.includes('payload'));
      assert.ok(consumer.validateEnvelope({ event_id: 'e1', event_type: 'T', payload: 'not-an-object' } as any)?.includes('non-object payload'));

      // --- BATCH_CREATED ---
      // Real producer payload from productController.ts
      const validProducerBatch = consumer.validatePayload('BATCH_CREATED', {
        batch_id: 'test-batch-01',
        product_id: 'prod-01',
        farmer_id: 'farm-01',
        quantity: 100,
        status: 'Pending Approval',
      });
      assert.strictEqual(validProducerBatch, null, 'Actual producer BATCH_CREATED should have no error');

      // Historical variation using initial_quantity and initial_status
      const validHistBatch = consumer.validatePayload('BATCH_CREATED', {
        batch_id: 'test-batch-01',
        product_id: 'prod-01',
        farmer_id: 'farm-01',
        initial_quantity: 250,
        initial_status: 'Registered',
      });
      assert.strictEqual(validHistBatch, null, 'Historical variation BATCH_CREATED should have no error');

      // Missing required fields
      assert.ok(consumer.validatePayload('BATCH_CREATED', { product_id: 'p', farmer_id: 'f', quantity: 10, status: 's' })?.includes('batch_id'));
      assert.ok(consumer.validatePayload('BATCH_CREATED', { batch_id: 'b', farmer_id: 'f', quantity: 10, status: 's' })?.includes('product_id'));
      assert.ok(consumer.validatePayload('BATCH_CREATED', { batch_id: 'b', product_id: 'p', quantity: 10, status: 's' })?.includes('farmer_id'));
      assert.ok(consumer.validatePayload('BATCH_CREATED', { batch_id: 'b', product_id: 'p', farmer_id: 'f', status: 's' })?.includes('quantity'));
      assert.ok(consumer.validatePayload('BATCH_CREATED', { batch_id: 'b', product_id: 'p', farmer_id: 'f', quantity: 'ten', status: 's' })?.includes('numeric'));
      assert.ok(consumer.validatePayload('BATCH_CREATED', { batch_id: 'b', product_id: 'p', farmer_id: 'f', quantity: -5, status: 's' })?.includes('positive'));
      assert.ok(consumer.validatePayload('BATCH_CREATED', { batch_id: 'b', product_id: 'p', farmer_id: 'f', quantity: 10 })?.includes('status'));

      // --- RETAILER_RECEIVED ---
      // Real producer payload from retailerController.ts and migration 11
      const validProducerRetail = consumer.validatePayload('RETAILER_RECEIVED', {
        batch_id: 'test-batch-01',
        shipment_id: 'ship-01',
        retailer_id: 'ret-01',
        quantity: 50,
      });
      assert.strictEqual(validProducerRetail, null, 'Actual producer RETAILER_RECEIVED should have no error');

      // Historical variation: received_quantity without optional shipment_id or condition
      const validHistRetail = consumer.validatePayload('RETAILER_RECEIVED', {
        batch_id: 'test-batch-01',
        retailer_id: 'ret-01',
        received_quantity: 50,
      });
      assert.strictEqual(validHistRetail, null, 'Historical RETAILER_RECEIVED with received_quantity and absent shipment_id should have no error');

      // Historical variation: quantity_received with condition
      const validHistRetailWithCondition = consumer.validatePayload('RETAILER_RECEIVED', {
        batch_id: 'test-batch-01',
        retailer_id: 'ret-01',
        shipment_id: 'ship-02',
        quantity_received: 75,
        condition: 'Good',
      });
      assert.strictEqual(validHistRetailWithCondition, null, 'Historical RETAILER_RECEIVED with condition should be accepted');

      // Missing required fields
      assert.ok(consumer.validatePayload('RETAILER_RECEIVED', { batch_id: 'b', quantity: 50 })?.includes('retailer_id'));
      assert.ok(consumer.validatePayload('RETAILER_RECEIVED', { batch_id: 'b', retailer_id: 'r' })?.includes('quantity'));
      assert.ok(consumer.validatePayload('RETAILER_RECEIVED', { batch_id: 'b', retailer_id: 'r', quantity: 0 })?.includes('positive'));

      // --- BLOCKCHAIN_RECORDED ---
      // Real producer payload from retailerController.ts
      const validProducerChain = consumer.validatePayload('BLOCKCHAIN_RECORDED', {
        batch_id: 'test-batch-01',
        tx_hash: '0x4a34adbb1234567890abcdef',
        event_source: 'RETAILER_RECEIVED',
      });
      assert.strictEqual(validProducerChain, null, 'Actual producer BLOCKCHAIN_RECORDED should have no error');

      // Historical variation: transaction_hash without optional event_source
      const validHistChain = consumer.validatePayload('BLOCKCHAIN_RECORDED', {
        batch_id: 'test-batch-01',
        transaction_hash: '0xabcdef1234567890abcdef',
      });
      assert.strictEqual(validHistChain, null, 'Historical BLOCKCHAIN_RECORDED with transaction_hash and absent event_source should have no error');

      // Historical variation: blockchain_hash
      const validAltChain = consumer.validatePayload('BLOCKCHAIN_RECORDED', {
        batch_id: 'test-batch-01',
        blockchain_hash: '0x9999991234567890abcdef',
      });
      assert.strictEqual(validAltChain, null, 'Historical BLOCKCHAIN_RECORDED with blockchain_hash should have no error');

      // Missing required tx_hash / transaction_hash
      assert.ok(consumer.validatePayload('BLOCKCHAIN_RECORDED', { batch_id: 'b' })?.includes('tx_hash'));
      assert.ok(consumer.validatePayload('BLOCKCHAIN_RECORDED', { batch_id: 'b', tx_hash: 'short' })?.includes('valid'));
    });

    // -------------------------------------------------------------
    // TEST 2B: Historical Contract Variations Projection End-to-End Test
    // -------------------------------------------------------------
    const testBatchHist = `test-batch-hist-${Date.now()}`;
    const testEventHistBatch = `test-event-hist-b-${Date.now()}`;
    const testEventHistRetail = `test-event-hist-r-${Date.now()}`;
    const testEventHistChain = `test-event-hist-c-${Date.now()}`;

    await test('Contract Compatibility: Process historical field variations into projection idempotently', async () => {
      const consumer = new TraceabilityAnalyticsConsumer({
        isTestMode: true,
        groupId: `test-group-hist-${Date.now()}`,
        dbPool: pool,
      });

      // 1. Process BATCH_CREATED using historical aliases: initial_quantity and initial_status
      const resB = await consumer.processMessage(
        {
          event_id: testEventHistBatch,
          event_type: 'TEST_BATCH_CREATED',
          event_version: '1.0',
          event_timestamp: new Date().toISOString(),
          source: 'legacy-system',
          payload: {
            test: true,
            batch_id: testBatchHist,
            product_id: 'prod-hist-01',
            farmer_id: 'farmer-hist-01',
            initial_quantity: 350,
            initial_status: 'Pre-Approved',
          },
        },
        { topic: 'test-diagnostic-events', partition: 0, message: { offset: '10' } } as any
      );
      assert.strictEqual(resB.success, true);
      assert.strictEqual(resB.duplicate, false);

      // Verify projection contains normalized quantity and status
      const projB = (await pool.query(`SELECT * FROM public.traceability_projections WHERE batch_id = $1;`, [testBatchHist])).rows[0];
      assert.strictEqual(Number(projB.initial_quantity), 350);
      assert.strictEqual(projB.status, 'Pre-Approved');

      // 2. Process RETAILER_RECEIVED using historical received_quantity and absent shipment_id
      const resR = await consumer.processMessage(
        {
          event_id: testEventHistRetail,
          event_type: 'TEST_RETAILER_RECEIVED',
          event_version: '1.0',
          event_timestamp: new Date().toISOString(),
          source: 'legacy-retailer',
          payload: {
            test: true,
            batch_id: testBatchHist,
            retailer_id: 'retailer-hist-99',
            received_quantity: 340,
            condition: 'Optimal',
          },
        },
        { topic: 'test-diagnostic-events', partition: 0, message: { offset: '11' } } as any
      );
      assert.strictEqual(resR.success, true);
      assert.strictEqual(resR.duplicate, false);

      const projR = (await pool.query(`SELECT * FROM public.traceability_projections WHERE batch_id = $1;`, [testBatchHist])).rows[0];
      assert.strictEqual(Number(projR.received_quantity), 340);
      assert.strictEqual(projR.retailer_id, 'retailer-hist-99');
      assert.strictEqual(projR.last_shipment_id, null, 'Optional shipment_id was omitted in legacy message');

      // 3. Process BLOCKCHAIN_RECORDED using historical transaction_hash and absent event_source
      const resC = await consumer.processMessage(
        {
          event_id: testEventHistChain,
          event_type: 'TEST_BLOCKCHAIN_RECORDED',
          event_version: '1.0',
          event_timestamp: new Date().toISOString(),
          source: 'legacy-chain-listener',
          payload: {
            test: true,
            batch_id: testBatchHist,
            transaction_hash: '0xabcdef0123456789abcdef0123456789abcdef01',
          },
        },
        { topic: 'test-diagnostic-events', partition: 0, message: { offset: '12' } } as any
      );
      assert.strictEqual(resC.success, true);
      assert.strictEqual(resC.duplicate, false);

      const projC = (await pool.query(`SELECT * FROM public.traceability_projections WHERE batch_id = $1;`, [testBatchHist])).rows[0];
      assert.strictEqual(projC.blockchain_recorded, true);
      assert.strictEqual(projC.blockchain_tx_hash, '0xabcdef0123456789abcdef0123456789abcdef01');
      assert.strictEqual(projC.events_count, 3);

      // 4. Duplicate Delivery of Event C
      const resCDup = await consumer.processMessage(
        {
          event_id: testEventHistChain,
          event_type: 'TEST_BLOCKCHAIN_RECORDED',
          event_version: '1.0',
          event_timestamp: new Date().toISOString(),
          source: 'legacy-chain-listener',
          payload: {
            test: true,
            batch_id: testBatchHist,
            transaction_hash: '0xabcdef0123456789abcdef0123456789abcdef01',
          },
        },
        { topic: 'test-diagnostic-events', partition: 0, message: { offset: '13' } } as any
      );
      assert.strictEqual(resCDup.success, true);
      assert.strictEqual(resCDup.duplicate, true, 'Duplicate delivery of historical variation must be skipped idempotently');

      // Clean up test batch records
      await consumer.cleanupTestRecord(testBatchHist, testEventHistBatch);
      await consumer.cleanupTestRecord(testBatchHist, testEventHistRetail);
      await consumer.cleanupTestRecord(testBatchHist, testEventHistChain);
    });

    // -------------------------------------------------------------
    // TEST 3: Successful Isolated Projection Processing (BATCH_CREATED)
    // -------------------------------------------------------------
    const testBatch1 = `test-batch-${Date.now()}-1`;
    const testEvent1 = `test-event-${Date.now()}-1`;

    await test('Isolated Projection: Process BATCH_CREATED and populate projection', async () => {
      const consumer = new TraceabilityAnalyticsConsumer({
        isTestMode: true,
        groupId: `test-group-${Date.now()}`,
        dbPool: pool,
      });

      const envelope = {
        event_id: testEvent1,
        event_type: 'TEST_BATCH_CREATED',
        event_version: '1.0',
        event_timestamp: new Date().toISOString(),
        source: 'test-runner',
        payload: {
          test: true,
          batch_id: testBatch1,
          product_id: 'test-prod-101',
          farmer_id: 'test-farmer-202',
          quantity: 250,
          status: 'Harvested',
        },
      };

      const mockPayload: any = {
        topic: 'test-diagnostic-events',
        partition: 0,
        message: { offset: '10' },
      };

      const result = await consumer.processMessage(envelope, mockPayload);
      assert.strictEqual(result.success, true, 'Message processing should succeed');
      assert.strictEqual(result.duplicate, false, 'First run should not be duplicate');

      // Verify projection row in database
      const projRes = await pool.query(
        `SELECT * FROM public.traceability_projections WHERE batch_id = $1;`,
        [testBatch1]
      );
      assert.strictEqual(projRes.rows.length, 1);
      const proj = projRes.rows[0];
      assert.strictEqual(proj.batch_id, testBatch1);
      assert.strictEqual(proj.product_id, 'test-prod-101');
      assert.strictEqual(proj.farmer_id, 'test-farmer-202');
      assert.strictEqual(Number(proj.initial_quantity), 250);
      assert.strictEqual(proj.lifecycle_stage, 'HARVESTED');
      assert.strictEqual(proj.events_count, 1);

      // Verify event index
      const idxRes = await pool.query(
        `SELECT * FROM public.traceability_event_index WHERE event_id = $1;`,
        [testEvent1]
      );
      assert.strictEqual(idxRes.rows.length, 1);

      // Verify processed_events
      const procRes = await pool.query(
        `SELECT * FROM public.processed_events WHERE event_id = $1 AND consumer_group = $2;`,
        [testEvent1, consumer.groupId]
      );
      assert.strictEqual(procRes.rows.length, 1);
    });

    // -------------------------------------------------------------
    // TEST 4: Idempotent Duplicate Delivery Handling
    // -------------------------------------------------------------
    await test('Idempotency: Re-delivery of the same event ID is safely skipped', async () => {
      const consumer = new TraceabilityAnalyticsConsumer({
        isTestMode: true,
        groupId: `test-group-${Date.now()}`,
        dbPool: pool,
      });

      const envelope = {
        event_id: testEvent1, // Same event ID as Test 3
        event_type: 'TEST_BATCH_CREATED',
        event_version: '1.0',
        event_timestamp: new Date().toISOString(),
        source: 'test-runner',
        payload: {
          test: true,
          batch_id: testBatch1,
          product_id: 'test-prod-101',
          farmer_id: 'test-farmer-202',
          quantity: 250,
          status: 'Harvested',
        },
      };

      // Manually record in processed_events for this consumer group first
      await pool.query(
        `INSERT INTO public.processed_events (event_id, topic, consumer_group, processed_at)
         VALUES ($1, $2, $3, now()) ON CONFLICT DO NOTHING;`,
        [testEvent1, 'test-diagnostic-events', consumer.groupId]
      );

      const mockPayload: any = {
        topic: 'test-diagnostic-events',
        partition: 0,
        message: { offset: '11' },
      };

      const result = await consumer.processMessage(envelope, mockPayload);
      assert.strictEqual(result.success, true, 'Duplicate should succeed without error');
      assert.strictEqual(result.duplicate, true, 'Must be flagged as duplicate');

      // Verify events_count was not incremented
      const projRes = await pool.query(
        `SELECT events_count FROM public.traceability_projections WHERE batch_id = $1;`,
        [testBatch1]
      );
      assert.strictEqual(projRes.rows[0].events_count, 1, 'Events count must not change on duplicate');
    });

    // -------------------------------------------------------------
    // TEST 5: Out-of-Order Lifecycle Event Reconciliation
    // -------------------------------------------------------------
    const testBatch2 = `test-batch-ooo-${Date.now()}`;
    const testEventRetail = `test-event-retail-${Date.now()}`;
    const testEventHarvest = `test-event-harvest-${Date.now()}`;
    const testEventChain = `test-event-chain-${Date.now()}`;

    await test('Out-of-Order: RETAILER_RECEIVED before BATCH_CREATED reconciles lead time', async () => {
      const consumer = new TraceabilityAnalyticsConsumer({
        isTestMode: true,
        groupId: `test-group-ooo-${Date.now()}`,
        dbPool: pool,
      });

      const tHarvest = new Date(Date.now() - 3600000); // 1 hour ago
      const tRetail = new Date(); // now

      // 1. RETAILER_RECEIVED arrives FIRST (Out-of-Order!)
      const retailEnvelope = {
        event_id: testEventRetail,
        event_type: 'TEST_RETAILER_RECEIVED',
        event_version: '1.0',
        event_timestamp: tRetail.toISOString(),
        source: 'test-runner',
        payload: {
          test: true,
          batch_id: testBatch2,
          retailer_id: 'retailer-777',
          shipment_id: 'ship-888',
          quantity: 120,
        },
      };

      await consumer.processMessage(retailEnvelope, { topic: 'test-diagnostic-events', partition: 0, message: { offset: '20' } } as any);

      const projStep1 = (await pool.query(`SELECT * FROM public.traceability_projections WHERE batch_id = $1;`, [testBatch2])).rows[0];
      assert.strictEqual(projStep1.retailer_id, 'retailer-777');
      assert.strictEqual(Number(projStep1.received_quantity), 120);
      assert.strictEqual(projStep1.lifecycle_stage, 'RETAILED');
      assert.strictEqual(projStep1.journey_lead_time_seconds, null, 'Lead time cannot be computed without creation time');

      // 2. BATCH_CREATED arrives SECOND
      const harvestEnvelope = {
        event_id: testEventHarvest,
        event_type: 'TEST_BATCH_CREATED',
        event_version: '1.0',
        event_timestamp: tHarvest.toISOString(),
        source: 'test-runner',
        payload: {
          test: true,
          batch_id: testBatch2,
          product_id: 'prod-777',
          farmer_id: 'farmer-555',
          quantity: 120,
          status: 'Harvested',
        },
      };

      await consumer.processMessage(harvestEnvelope, { topic: 'test-diagnostic-events', partition: 0, message: { offset: '21' } } as any);

      const projStep2 = (await pool.query(`SELECT * FROM public.traceability_projections WHERE batch_id = $1;`, [testBatch2])).rows[0];
      assert.strictEqual(projStep2.product_id, 'prod-777');
      assert.strictEqual(projStep2.farmer_id, 'farmer-555');
      assert.strictEqual(projStep2.events_count, 2);
      assert.ok(Number(projStep2.journey_lead_time_seconds) > 3500, 'Journey lead time should be ~3600 seconds');

      // 3. BLOCKCHAIN_RECORDED arrives THIRD
      const chainEnvelope = {
        event_id: testEventChain,
        event_type: 'TEST_BLOCKCHAIN_RECORDED',
        event_version: '1.0',
        event_timestamp: new Date().toISOString(),
        source: 'test-runner',
        payload: {
          test: true,
          batch_id: testBatch2,
          tx_hash: '0x999testchainhash',
          event_source: 'RETAILER_RECEIVED',
        },
      };

      await consumer.processMessage(chainEnvelope, { topic: 'test-diagnostic-events', partition: 0, message: { offset: '22' } } as any);

      const projStep3 = (await pool.query(`SELECT * FROM public.traceability_projections WHERE batch_id = $1;`, [testBatch2])).rows[0];
      assert.strictEqual(projStep3.blockchain_recorded, true);
      assert.strictEqual(projStep3.blockchain_tx_hash, '0x999testchainhash');
      assert.strictEqual(projStep3.events_count, 3);
    });

    // -------------------------------------------------------------
    // TEST 6: Dead-Letter Queue (DLQ) for Poison Messages
    // -------------------------------------------------------------
    await test('DLQ Routing: Poison message with corrupted payload is routed to dead-letter-events', async () => {
      const consumer = new TraceabilityAnalyticsConsumer({
        isTestMode: true,
        groupId: `test-group-dlq-${Date.now()}`,
        dbPool: pool,
      });

      let committedOffset: string | null = null;
      let mockHeartbeatCalled = false;

      // Mock consumer.commitOffsets to observe manual commit
      (consumer as any).commitMessageOffset = async (t: string, p: number, o: string) => {
        committedOffset = o;
      };

      // Poison message: missing batch_id entirely
      const poisonEnvelope = {
        event_id: `poison-${Date.now()}`,
        event_type: 'BATCH_CREATED',
        event_version: '1.0',
        event_timestamp: new Date().toISOString(),
        source: 'corrupted-producer',
        payload: {
          test: true,
          // MISSING batch_id!
          quantity: 100,
        },
      };

      const mockPayload: any = {
        topic: 'test-diagnostic-events',
        partition: 0,
        message: {
          offset: '42',
          value: Buffer.from(JSON.stringify(poisonEnvelope)),
        },
        heartbeat: async () => {
          mockHeartbeatCalled = true;
        },
      };

      await consumer.handleIncomingMessage(mockPayload);

      assert.strictEqual(committedOffset, '42', 'Offset must be committed only after DLQ dispatch');
      assert.strictEqual(consumer.getHealth().dlqCount, 1, 'DLQ counter should be 1');

      // 2. Valid Historical Message: Must NOT be routed to DLQ
      const validHistBatchId = `test-batch-dlq-safe-${Date.now()}`;
      const validHistEventId = `test-event-dlq-safe-${Date.now()}`;
      const validHistEnvelope = {
        event_id: validHistEventId,
        event_type: 'TEST_RETAILER_RECEIVED',
        event_version: '1.0',
        event_timestamp: new Date().toISOString(),
        source: 'retailer-service',
        payload: {
          test: true,
          batch_id: validHistBatchId,
          retailer_id: 'retailer-dlq-safe',
          received_quantity: 150, // Historical alias
          // shipment_id and condition absent
        },
      };

      const validHistPayload: any = {
        topic: 'test-diagnostic-events',
        partition: 0,
        message: {
          offset: '43',
          value: Buffer.from(JSON.stringify(validHistEnvelope)),
        },
        heartbeat: async () => {},
      };

      await consumer.handleIncomingMessage(validHistPayload);

      assert.strictEqual(committedOffset, '43', 'Offset must be committed for valid historical message');
      assert.strictEqual(consumer.getHealth().dlqCount, 1, 'DLQ counter must NOT increment for valid historical message');
      assert.strictEqual(consumer.getHealth().processedCount, 1, 'Processed counter should increment for valid historical message');

      await consumer.cleanupTestRecord(validHistBatchId, validHistEventId);
    });

    // -------------------------------------------------------------
    // TEST 7: Transient DB Failure (No Commit, Throws For Redelivery)
    // -------------------------------------------------------------
    await test('Transient Error: Database failure throws without committing Kafka offset', async () => {
      // Mock pool that throws connection error
      const brokenPool: any = {
        query: async () => {
          throw new Error('Connection terminated unexpectedly (ECONNRESET)');
        },
      };

      const consumer = new TraceabilityAnalyticsConsumer({
        isTestMode: true,
        groupId: `test-group-transient-${Date.now()}`,
        dbPool: brokenPool,
      });

      let committed = false;
      (consumer as any).commitMessageOffset = async () => {
        committed = true;
      };

      const validEnvelope = {
        event_id: `transient-${Date.now()}`,
        event_type: 'TEST_BATCH_CREATED',
        event_version: '1.0',
        event_timestamp: new Date().toISOString(),
        source: 'test-runner',
        payload: {
          test: true,
          batch_id: 'test-transient-batch',
          product_id: 'p-1',
          farmer_id: 'f-1',
          quantity: 10,
          status: 'Harvested',
        },
      };

      const mockPayload: any = {
        topic: 'test-diagnostic-events',
        partition: 0,
        message: {
          offset: '88',
          value: Buffer.from(JSON.stringify(validEnvelope)),
        },
        heartbeat: async () => {},
      };

      let threw = false;
      try {
        await consumer.handleIncomingMessage(mockPayload);
      } catch (err: any) {
        threw = true;
      }

      assert.strictEqual(threw, true, 'Transient error must throw to signal failure to KafkaJS');
      assert.strictEqual(committed, false, 'Offset must NOT be committed on transient failure');
    });

    // -------------------------------------------------------------
    // TEST 8: Full Live Broker Integration (Produce Test Event & Verify)
    // -------------------------------------------------------------
    const liveTestBatchId = `test-live-consumer-${Date.now()}`;
    const liveTestEventId = `test-event-live-${Date.now()}`;

    await test('Live Broker: Produce test event to Kafka broker and process through consumer', async () => {
      const liveConsumer = new TraceabilityAnalyticsConsumer({
        isTestMode: true,
        groupId: `test-group-live-${Date.now()}`,
        dbPool: pool,
        enabled: true,
      });

      await liveConsumer.start();
      // Allow consumer group assignment to stabilize
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const liveEnvelope = {
        event_id: liveTestEventId,
        event_type: 'TEST_BATCH_CREATED',
        event_version: '1.0',
        event_timestamp: new Date().toISOString(),
        source: 'manual-test-runner',
        payload: {
          test: true,
          batch_id: liveTestBatchId,
          product_id: 'prod-live-999',
          farmer_id: 'farmer-live-888',
          quantity: 500,
          status: 'Verified In Test',
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
          `SELECT * FROM public.traceability_projections WHERE batch_id = $1;`,
          [liveTestBatchId]
        );
        if (check.rows.length > 0) {
          foundInDb = true;
          break;
        }
      }

      await liveConsumer.stop();

      assert.strictEqual(foundInDb, true, 'Live consumer should poll from Kafka and write projection');
      console.log(`Verified live consumer created projection row for batch '${liveTestBatchId}'.`);

      // Clean up isolated test record
      await liveConsumer.cleanupTestRecord(liveTestBatchId, liveTestEventId);
    });

    // Cleanup other isolated test batches
    const cleanupConsumer = new TraceabilityAnalyticsConsumer({ isTestMode: true, dbPool: pool });
    await cleanupConsumer.cleanupTestRecord(testBatch1, testEvent1);
    await cleanupConsumer.cleanupTestRecord(testBatch2, testEventRetail);
    await cleanupConsumer.cleanupTestRecord(testBatch2, testEventHarvest);
    await cleanupConsumer.cleanupTestRecord(testBatch2, testEventChain);

    // -------------------------------------------------------------
    // TEST 10: Final Read-Only Baseline Audit (All Baseline Events Intact)
    // -------------------------------------------------------------
    await test('Baseline Preservation: 100% of business events remain untouched and PENDING', async () => {
      const { data: finalLocalOutbox, error: finalLocalErr } = await supabase
        .from('event_outbox')
        .select('id, status, topic');

      if (finalLocalErr) {
        throw new Error(`Failed to query final local outbox: ${finalLocalErr.message}`);
      }

      const localPending = finalLocalOutbox.filter((r) => r.status === 'PENDING').length;
      console.log(`[Final Audit] Local outbox total: ${finalLocalOutbox.length}, PENDING count: ${localPending}`);

      assert.strictEqual(finalLocalOutbox.length, 35, 'Local outbox total rows must remain exactly 35');
      assert.strictEqual(localPending, 35, 'All 35 local business events must remain in PENDING state');

      const { data: finalRemoteOutbox, error: finalRemoteErr } = await originalSupabase
        .from('event_outbox')
        .select('id, status, topic');

      if (finalRemoteErr) {
        throw new Error(`Failed to query final remote outbox: ${finalRemoteErr.message}`);
      }

      const remotePending = finalRemoteOutbox.filter((r) => r.status === 'PENDING').length;
      console.log(`[Final Audit] Hosted backlog total: ${finalRemoteOutbox.length}, PENDING count: ${remotePending}`);

      assert.strictEqual(finalRemoteOutbox.length, 40, 'Hosted backlog rows must remain exactly 40');
      assert.strictEqual(remotePending, 40, 'All 40 hosted business events must remain in PENDING state');
    });

  } finally {
    await producer.disconnect();
    await pool.end();
  }

  console.log('\n===================================================================');
  console.log(`   ALL ${passedTests}/${totalTests} TESTS PASSED SUCCESSFULLY!                    `);
  console.log('===================================================================');
}

runTestSuite()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Traceability consumer test suite failed:', err);
    process.exit(1);
  });

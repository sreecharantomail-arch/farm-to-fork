import './src/test_preload';
import { Kafka } from 'kafkajs';
import pg from 'pg';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { supabase } from './src/config/supabase';
import {
  ShipmentAnalyticsConsumer,
} from './src/services/shipmentAnalyticsConsumer';
import { assertApprovedLocalEnvironment, assertLocalPostgresUrl } from './src/utils/localDatabaseGuard';

const LOCAL_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

assertApprovedLocalEnvironment('ShipmentConsumerSuite');
assertLocalPostgresUrl(LOCAL_DB_URL, 'ShipmentConsumerSuite');

const envConfig = dotenv.parse(fs.readFileSync(path.resolve(__dirname, '.env'), 'utf8'));
const originalSupabase = createClient(envConfig.SUPABASE_URL, envConfig.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function runTestSuite() {
  console.log('===================================================================');
  console.log('      FarmChainAI — Shipment Analytics Consumer Verification       ');
  console.log('===================================================================\n');

  const pool = new pg.Pool({ connectionString: LOCAL_DB_URL });
  const kafka = new Kafka({
    clientId: 'shipment-test-runner',
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
      let threwShipmentError = false;
      try {
        new ShipmentAnalyticsConsumer({
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
        new ShipmentAnalyticsConsumer({
          isTestMode: true,
          topic: 'traceability-events', // FORBIDDEN in test mode
        });
      } catch (err: any) {
        if (err.message.includes('SAFETY VIOLATION')) {
          threwTraceError = true;
        }
      }
      assert.strictEqual(threwTraceError, true, 'Test mode consumer must reject traceability-events topic');
    });

    // -------------------------------------------------------------
    // TEST 2: Envelope and Payload Validation Rules
    // -------------------------------------------------------------
    await test('Validation: Envelope structure and shipment payload schema rules', async () => {
      const consumer = new ShipmentAnalyticsConsumer({ isTestMode: true });

      // Envelope validation
      assert.ok(consumer.validateEnvelope({} as any)?.includes('event_id'));
      assert.ok(consumer.validateEnvelope({ event_id: 'e1' } as any)?.includes('event_type'));
      assert.ok(consumer.validateEnvelope({ event_id: 'e1', event_type: 'T' } as any)?.includes('payload'));
      assert.ok(consumer.validateEnvelope({ event_id: 'e1', event_type: 'T', payload: 'bad' } as any)?.includes('non-object payload'));

      // --- DELIVERY_PROOF_SUBMITTED ---
      const validProof = consumer.validatePayload('DELIVERY_PROOF_SUBMITTED', {
        shipment_id: 'ship-01',
        batch_id: 'batch-01',
        retailer_id: 'ret-01',
        pod_id: 'pod-01',
        quantity_delivered: 100,
        unit: 'kg',
        recipient_name: 'Store Manager',
        distributor_id: 'dist-01',
      });
      assert.strictEqual(validProof, null, 'Actual producer DELIVERY_PROOF_SUBMITTED should have no error');

      // Missing required fields
      assert.ok(consumer.validatePayload('DELIVERY_PROOF_SUBMITTED', { batch_id: 'b', retailer_id: 'r', pod_id: 'p', quantity_delivered: 10 })?.includes('shipment_id'));
      assert.ok(consumer.validatePayload('DELIVERY_PROOF_SUBMITTED', { shipment_id: 's', retailer_id: 'r', pod_id: 'p', quantity_delivered: 10 })?.includes('batch_id'));
      assert.ok(consumer.validatePayload('DELIVERY_PROOF_SUBMITTED', { shipment_id: 's', batch_id: 'b', pod_id: 'p', quantity_delivered: 10 })?.includes('retailer_id'));
      assert.ok(consumer.validatePayload('DELIVERY_PROOF_SUBMITTED', { shipment_id: 's', batch_id: 'b', retailer_id: 'r', quantity_delivered: 10 })?.includes('pod_id'));
      assert.ok(consumer.validatePayload('DELIVERY_PROOF_SUBMITTED', { shipment_id: 's', batch_id: 'b', retailer_id: 'r', pod_id: 'p' })?.includes('quantity_delivered'));
      assert.ok(consumer.validatePayload('DELIVERY_PROOF_SUBMITTED', { shipment_id: 's', batch_id: 'b', retailer_id: 'r', pod_id: 'p', quantity_delivered: -5 })?.includes('positive number'));

      // --- SHIPMENT_RECEIVED ---
      const validReceived = consumer.validatePayload('SHIPMENT_RECEIVED', {
        shipment_id: 'ship-01',
        batch_id: 'batch-01',
        retailer_id: 'ret-01',
        quantity: 100,
        unit: 'kg',
        pod_id: 'pod-01',
      });
      assert.strictEqual(validReceived, null, 'Actual producer SHIPMENT_RECEIVED should have no error');

      // Missing required fields
      assert.ok(consumer.validatePayload('SHIPMENT_RECEIVED', { batch_id: 'b', retailer_id: 'r', quantity: 10 })?.includes('shipment_id'));
      assert.ok(consumer.validatePayload('SHIPMENT_RECEIVED', { shipment_id: 's', retailer_id: 'r', quantity: 10 })?.includes('batch_id'));
      assert.ok(consumer.validatePayload('SHIPMENT_RECEIVED', { shipment_id: 's', batch_id: 'b', quantity: 10 })?.includes('retailer_id'));
      assert.ok(consumer.validatePayload('SHIPMENT_RECEIVED', { shipment_id: 's', batch_id: 'b', retailer_id: 'r' })?.includes('quantity'));

      // --- DELIVERY_DISPUTED ---
      const validDisputed = consumer.validatePayload('DELIVERY_DISPUTED', {
        shipment_id: 'ship-01',
        batch_id: 'batch-01',
        retailer_id: 'ret-01',
        reason: 'Damaged packaging during transit',
        notes: '3 boxes crushed',
        distributor_id: 'dist-01',
        pod_id: 'pod-01',
      });
      assert.strictEqual(validDisputed, null, 'Actual producer DELIVERY_DISPUTED should have no error');

      assert.ok(consumer.validatePayload('DELIVERY_DISPUTED', { shipment_id: 's', batch_id: 'b', retailer_id: 'r' })?.includes('reason'));
    });

    // -------------------------------------------------------------
    // TEST 3: Contract Compatibility & Historical Variations
    // -------------------------------------------------------------
    const testShipmentHist = `test-ship-hist-${Date.now()}`;
    const testEventHistProof = `test-event-hp-${Date.now()}`;
    const testEventHistRecv = `test-event-hr-${Date.now()}`;

    await test('Contract Compatibility: Process historical variations and optional omissions', async () => {
      const consumer = new ShipmentAnalyticsConsumer({
        isTestMode: true,
        groupId: `test-group-hist-${Date.now()}`,
        dbPool: pool,
      });

      // 1. Process DELIVERY_PROOF_SUBMITTED using alias 'delivered_quantity' without optional unit/recipient_name
      const resP = await consumer.processMessage(
        {
          event_id: testEventHistProof,
          event_type: 'TEST_DELIVERY_PROOF_SUBMITTED',
          event_version: '1.0',
          event_timestamp: new Date().toISOString(),
          source: 'legacy-pod-uploader',
          payload: {
            test: true,
            shipment_id: testShipmentHist,
            batch_id: 'test-batch-hist-01',
            retailer_id: 'ret-hist-1',
            pod_id: 'pod-hist-1',
            delivered_quantity: 450, // Historical alias
          },
        },
        { topic: 'test-diagnostic-events', partition: 0, message: { offset: '10' } } as any
      );
      assert.strictEqual(resP.success, true);
      assert.strictEqual(resP.duplicate, false);

      const projP = (await pool.query(`SELECT * FROM public.shipment_projections WHERE shipment_id = $1;`, [testShipmentHist])).rows[0];
      assert.strictEqual(Number(projP.quantity_delivered), 450);
      assert.strictEqual(projP.delivery_status, 'PROOF_SUBMITTED');

      // 2. Process SHIPMENT_RECEIVED using alias 'quantity_delivered' without optional pod_id
      const resR = await consumer.processMessage(
        {
          event_id: testEventHistRecv,
          event_type: 'TEST_SHIPMENT_RECEIVED',
          event_version: '1.0',
          event_timestamp: new Date().toISOString(),
          source: 'legacy-retail-intake',
          payload: {
            test: true,
            shipment_id: testShipmentHist,
            batch_id: 'test-batch-hist-01',
            retailer_id: 'ret-hist-1',
            quantity_delivered: 450, // Alternate quantity field
          },
        },
        { topic: 'test-diagnostic-events', partition: 0, message: { offset: '11' } } as any
      );
      assert.strictEqual(resR.success, true);
      assert.strictEqual(resR.duplicate, false);

      const projR = (await pool.query(`SELECT * FROM public.shipment_projections WHERE shipment_id = $1;`, [testShipmentHist])).rows[0];
      assert.strictEqual(projR.delivery_status, 'DELIVERED');
      assert.strictEqual(projR.events_count, 2);

      // Clean up test records
      await consumer.cleanupTestRecord(testShipmentHist, testEventHistProof);
      await consumer.cleanupTestRecord(testShipmentHist, testEventHistRecv);
    });

    // -------------------------------------------------------------
    // TEST 4: Isolated Projection Processing (DELIVERY_PROOF_SUBMITTED)
    // -------------------------------------------------------------
    const testShipment1 = `test-ship-${Date.now()}-1`;
    const testEvent1 = `test-event-${Date.now()}-1`;
    const idempotencyConsumer = new ShipmentAnalyticsConsumer({
      isTestMode: true,
      groupId: `test-group-idem-${Date.now()}`,
      dbPool: pool,
    });

    await test('Isolated Projection: Process DELIVERY_PROOF_SUBMITTED and create projection row', async () => {
      const envelope = {
        event_id: testEvent1,
        event_type: 'TEST_DELIVERY_PROOF_SUBMITTED',
        event_version: '1.0',
        event_timestamp: new Date().toISOString(),
        source: 'distributor-controller',
        payload: {
          test: true,
          shipment_id: testShipment1,
          batch_id: 'test-batch-ship-01',
          distributor_id: 'dist-alpha',
          retailer_id: 'retailer-beta',
          pod_id: 'pod-alpha-99',
          quantity_delivered: 200,
          unit: 'boxes',
          recipient_name: 'Sarah Connor',
        },
      };

      const result = await idempotencyConsumer.processMessage(envelope, { topic: 'test-diagnostic-events', partition: 0, message: { offset: '10' } } as any);
      assert.strictEqual(result.success, true, 'Message processing should succeed');
      assert.strictEqual(result.duplicate, false, 'First delivery should not be a duplicate');

      const proj = (await pool.query(`SELECT * FROM public.shipment_projections WHERE shipment_id = $1;`, [testShipment1])).rows[0];
      assert.ok(proj, 'Projection row must exist in public.shipment_projections');
      assert.strictEqual(proj.shipment_id, testShipment1);
      assert.strictEqual(proj.batch_id, 'test-batch-ship-01');
      assert.strictEqual(proj.distributor_id, 'dist-alpha');
      assert.strictEqual(proj.retailer_id, 'retailer-beta');
      assert.strictEqual(proj.pod_id, 'pod-alpha-99');
      assert.strictEqual(Number(proj.quantity_delivered), 200);
      assert.strictEqual(proj.unit, 'boxes');
      assert.strictEqual(proj.recipient_name, 'Sarah Connor');
      assert.strictEqual(proj.delivery_status, 'PROOF_SUBMITTED');
      assert.strictEqual(proj.is_disputed, false);
      assert.strictEqual(proj.events_count, 1);
    });

    // -------------------------------------------------------------
    // TEST 5: Idempotency Under Repeated Delivery
    // -------------------------------------------------------------
    await test('Idempotency: Repeated delivery of identical event ID is safely skipped', async () => {
      const envelope = {
        event_id: testEvent1, // Identical event_id from Test 4
        event_type: 'TEST_DELIVERY_PROOF_SUBMITTED',
        event_version: '1.0',
        event_timestamp: new Date().toISOString(),
        source: 'distributor-controller',
        payload: {
          test: true,
          shipment_id: testShipment1,
          batch_id: 'test-batch-ship-01',
          distributor_id: 'dist-alpha',
          retailer_id: 'retailer-beta',
          pod_id: 'pod-alpha-99',
          quantity_delivered: 200,
          unit: 'boxes',
          recipient_name: 'Sarah Connor',
        },
      };

      const result = await idempotencyConsumer.processMessage(envelope, { topic: 'test-diagnostic-events', partition: 0, message: { offset: '11' } } as any);
      assert.strictEqual(result.success, true, 'Should return success on duplicate');
      assert.strictEqual(result.duplicate, true, 'Should detect duplicate processing');

      const projCount = (await pool.query(`SELECT count(*)::int as count FROM public.shipment_projections WHERE shipment_id = $1;`, [testShipment1])).rows[0].count;
      assert.strictEqual(projCount, 1, 'Exactly one projection row must remain');

      const proj = (await pool.query(`SELECT * FROM public.shipment_projections WHERE shipment_id = $1;`, [testShipment1])).rows[0];
      assert.strictEqual(proj.events_count, 1, 'Events count must not increment on duplicate');
    });

    // -------------------------------------------------------------
    // TEST 6: Out-of-Order Lifecycle Handling (SHIPMENT_RECEIVED before DELIVERY_PROOF_SUBMITTED)
    // -------------------------------------------------------------
    const testShipmentOOO = `test-ship-ooo-${Date.now()}`;
    const testEventRecvOOO = `test-event-recv-ooo-${Date.now()}`;
    const testEventProofOOO = `test-event-proof-ooo-${Date.now()}`;

    await test('Out-of-Order: SHIPMENT_RECEIVED before DELIVERY_PROOF_SUBMITTED reconciles duration', async () => {
      const consumer = new TraceabilityOrShipmentConsumer(pool);

      const tProof = new Date(Date.now() - 7200000); // 2 hours ago
      const tRecv = new Date(); // now

      // 1. SHIPMENT_RECEIVED arrives FIRST (Out-of-Order!)
      const recvEnvelope = {
        event_id: testEventRecvOOO,
        event_type: 'TEST_SHIPMENT_RECEIVED',
        event_version: '1.0',
        event_timestamp: tRecv.toISOString(),
        source: 'retailer-controller',
        payload: {
          test: true,
          shipment_id: testShipmentOOO,
          batch_id: 'test-batch-ooo-01',
          retailer_id: 'retailer-gamma',
          pod_id: 'pod-ooo-88',
          quantity: 150,
          unit: 'crates',
        },
      };

      await consumer.processMessage(recvEnvelope, { topic: 'test-diagnostic-events', partition: 0, message: { offset: '20' } } as any);

      const projStep1 = (await pool.query(`SELECT * FROM public.shipment_projections WHERE shipment_id = $1;`, [testShipmentOOO])).rows[0];
      assert.strictEqual(projStep1.retailer_id, 'retailer-gamma');
      assert.strictEqual(Number(projStep1.quantity_delivered), 150);
      assert.strictEqual(projStep1.delivery_status, 'DELIVERED');
      assert.strictEqual(projStep1.delivery_duration_seconds, null, 'Duration cannot be calculated without proof submitted timestamp');

      // 2. DELIVERY_PROOF_SUBMITTED arrives SECOND
      const proofEnvelope = {
        event_id: testEventProofOOO,
        event_type: 'TEST_DELIVERY_PROOF_SUBMITTED',
        event_version: '1.0',
        event_timestamp: tProof.toISOString(),
        source: 'distributor-controller',
        payload: {
          test: true,
          shipment_id: testShipmentOOO,
          batch_id: 'test-batch-ooo-01',
          distributor_id: 'dist-gamma',
          retailer_id: 'retailer-gamma',
          pod_id: 'pod-ooo-88',
          quantity_delivered: 150,
          unit: 'crates',
          recipient_name: 'John Connor',
        },
      };

      await consumer.processMessage(proofEnvelope, { topic: 'test-diagnostic-events', partition: 0, message: { offset: '21' } } as any);

      const projStep2 = (await pool.query(`SELECT * FROM public.shipment_projections WHERE shipment_id = $1;`, [testShipmentOOO])).rows[0];
      assert.strictEqual(projStep2.distributor_id, 'dist-gamma');
      assert.strictEqual(projStep2.recipient_name, 'John Connor');
      assert.strictEqual(projStep2.delivery_status, 'DELIVERED');
      assert.strictEqual(projStep2.events_count, 2);
      assert.ok(Number(projStep2.delivery_duration_seconds) > 7100, 'Duration should reconcile to ~7200 seconds');
    });

    // -------------------------------------------------------------
    // TEST 7: Delivery Discrepancy & Dispute Handling
    // -------------------------------------------------------------
    const testEventDispute = `test-event-dispute-${Date.now()}`;

    await test('Dispute Handling: DELIVERY_DISPUTED records discrepancy without losing delivery metadata', async () => {
      const consumer = new TraceabilityOrShipmentConsumer(pool);

      const disputeEnvelope = {
        event_id: testEventDispute,
        event_type: 'TEST_DELIVERY_DISPUTED',
        event_version: '1.0',
        event_timestamp: new Date().toISOString(),
        source: 'retailer-controller',
        payload: {
          test: true,
          shipment_id: testShipmentOOO,
          batch_id: 'test-batch-ooo-01',
          retailer_id: 'retailer-gamma',
          distributor_id: 'dist-gamma',
          reason: 'Temperature excursion detected upon intake',
          notes: 'Thermometer showed 14C instead of required 4C',
          pod_id: 'pod-ooo-88',
        },
      };

      await consumer.processMessage(disputeEnvelope, { topic: 'test-diagnostic-events', partition: 0, message: { offset: '22' } } as any);

      const projStep3 = (await pool.query(`SELECT * FROM public.shipment_projections WHERE shipment_id = $1;`, [testShipmentOOO])).rows[0];
      assert.strictEqual(projStep3.is_disputed, true);
      assert.strictEqual(projStep3.delivery_status, 'DISPUTED');
      assert.strictEqual(projStep3.dispute_reason, 'Temperature excursion detected upon intake');
      assert.strictEqual(projStep3.dispute_notes, 'Thermometer showed 14C instead of required 4C');
      assert.strictEqual(projStep3.events_count, 3);
      // Ensure previous metadata remains intact
      assert.strictEqual(projStep3.distributor_id, 'dist-gamma');
      assert.strictEqual(Number(projStep3.quantity_delivered), 150);
    });

    // -------------------------------------------------------------
    // TEST 8: Dead-Letter Queue (DLQ) for Poison Messages
    // -------------------------------------------------------------
    await test('DLQ Routing: Poison message with corrupted payload is routed to dead-letter-events', async () => {
      const consumer = new ShipmentAnalyticsConsumer({
        isTestMode: true,
        groupId: `test-group-dlq-${Date.now()}`,
        dbPool: pool,
      });

      let committedOffset: string | null = null;

      // Mock consumer.commitMessageOffset to observe manual commit
      (consumer as any).commitMessageOffset = async (t: string, p: number, o: string) => {
        committedOffset = o;
      };

      // Poison message: missing shipment_id entirely
      const poisonEnvelope = {
        event_id: `poison-ship-${Date.now()}`,
        event_type: 'DELIVERY_PROOF_SUBMITTED',
        event_version: '1.0',
        event_timestamp: new Date().toISOString(),
        source: 'corrupted-producer',
        payload: {
          test: true,
          // MISSING shipment_id!
          batch_id: 'test-batch-corrupt',
          retailer_id: 'ret-1',
          quantity_delivered: 100,
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
      const validHistShipmentId = `test-ship-dlq-safe-${Date.now()}`;
      const validHistEventId = `test-event-dlq-safe-${Date.now()}`;
      const validHistEnvelope = {
        event_id: validHistEventId,
        event_type: 'TEST_SHIPMENT_RECEIVED',
        event_version: '1.0',
        event_timestamp: new Date().toISOString(),
        source: 'retailer-service',
        payload: {
          test: true,
          shipment_id: validHistShipmentId,
          batch_id: 'test-batch-dlq-safe',
          retailer_id: 'retailer-dlq-safe',
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

      await consumer.cleanupTestRecord(validHistShipmentId, validHistEventId);
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

      const consumer = new ShipmentAnalyticsConsumer({
        isTestMode: true,
        groupId: `test-group-transient-${Date.now()}`,
        dbPool: brokenPool,
      });

      let committedOffset: string | null = null;
      (consumer as any).commitMessageOffset = async (t: string, p: number, o: string) => {
        committedOffset = o;
      };

      const envelope = {
        event_id: `transient-${Date.now()}`,
        event_type: 'TEST_SHIPMENT_RECEIVED',
        event_version: '1.0',
        event_timestamp: new Date().toISOString(),
        source: 'retailer-service',
        payload: {
          test: true,
          shipment_id: `test-ship-transient-${Date.now()}`,
          batch_id: 'batch-transient',
          retailer_id: 'retailer-transient',
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
    const liveTestShipmentId = `test-ship-live-${Date.now()}`;
    const liveTestEventId = `test-event-live-${Date.now()}`;

    await test('Live Broker: Produce test event to Kafka broker and process through consumer', async () => {
      const liveConsumer = new ShipmentAnalyticsConsumer({
        isTestMode: true,
        groupId: `test-group-live-ship-${Date.now()}`,
        dbPool: pool,
        enabled: true,
      });

      await liveConsumer.start();
      // Allow consumer group assignment to stabilize
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const liveEnvelope = {
        event_id: liveTestEventId,
        event_type: 'TEST_DELIVERY_PROOF_SUBMITTED',
        event_version: '1.0',
        event_timestamp: new Date().toISOString(),
        source: 'manual-test-runner',
        payload: {
          test: true,
          shipment_id: liveTestShipmentId,
          batch_id: 'test-batch-live-01',
          distributor_id: 'dist-live-01',
          retailer_id: 'ret-live-01',
          pod_id: 'pod-live-01',
          quantity_delivered: 300,
          unit: 'pallets',
          recipient_name: 'Live Tester',
        },
      };

      // Produce directly to Kafka test-diagnostic-events topic
      await producer.send({
        topic: 'test-diagnostic-events',
        messages: [
          {
            key: liveTestShipmentId,
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
          `SELECT * FROM public.shipment_projections WHERE shipment_id = $1;`,
          [liveTestShipmentId]
        );
        if (check.rows.length > 0) {
          foundInDb = true;
          break;
        }
      }

      await liveConsumer.stop();

      assert.strictEqual(foundInDb, true, 'Live consumer should poll from Kafka and write projection');
      console.log(`Verified live consumer created projection row for shipment '${liveTestShipmentId}'.`);

      // Clean up isolated test record
      await liveConsumer.cleanupTestRecord(liveTestShipmentId, liveTestEventId);
    });

    // Cleanup other isolated test batches
    const cleanupConsumer = new ShipmentAnalyticsConsumer({ isTestMode: true, dbPool: pool });
    await cleanupConsumer.cleanupTestRecord(testShipment1, testEvent1);
    await cleanupConsumer.cleanupTestRecord(testShipmentOOO, testEventRecvOOO);
    await cleanupConsumer.cleanupTestRecord(testShipmentOOO, testEventProofOOO);
    await cleanupConsumer.cleanupTestRecord(testShipmentOOO, testEventDispute);

    // -------------------------------------------------------------
    // TEST 11: Final Read-Only Baseline Audit (All Baseline Events Intact)
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

// Helper factory for tests
function TraceabilityOrShipmentConsumer(pool: pg.Pool) {
  return new ShipmentAnalyticsConsumer({
    isTestMode: true,
    groupId: `test-group-${Date.now()}`,
    dbPool: pool,
  });
}

runTestSuite()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Shipment consumer test suite failed:', err);
    process.exit(1);
  });

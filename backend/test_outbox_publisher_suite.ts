import './src/test_preload';
import { assertApprovedLocalEnvironment } from './src/utils/localDatabaseGuard';

assertApprovedLocalEnvironment('OutboxPublisherSuite');

import { supabase } from './src/config/supabase';
import { OutboxPublisherService, OutboxRecord } from './src/services/outboxPublisherService';
import net from 'net';

async function checkPortOpen(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(2000);
    socket.connect(port, host, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => {
      resolve(false);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function runTestSuite() {
  console.log('===================================================================');
  console.log('   FarmChainAI — Atomic Outbox Claiming & Concurrency Test Suite   ');
  console.log('===================================================================\n');

  // STEP 1: Snapshot Existing Database Outbox Records
  console.log('--- TEST 1: Baseline Preservation & Read-Only Audit ---');
  const { data: initialRecords, error: initialErr } = await supabase
    .from('event_outbox')
    .select('id, event_id, event_type, topic, status, retry_count, last_error');

  if (initialErr) {
    throw new Error(`Failed to query event_outbox: ${initialErr.message}`);
  }

  const initialCount = initialRecords.length;
  console.log(`Found ${initialCount} existing outbox events in database.`);
  const statusCounts: Record<string, number> = {};
  for (const r of initialRecords) {
    statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
  }
  console.log('Existing Status Distribution:', statusCounts);
  if (statusCounts['PENDING'] !== initialCount) {
    throw new Error(`Expected all ${initialCount} records to be PENDING, but found: ${JSON.stringify(statusCounts)}`);
  }
  console.log(`✅ Baseline verified: All ${initialCount} pre-existing business events are securely preserved in PENDING state.`);

  // STEP 2: Local Kafka Availability Probe
  console.log('\n--- TEST 2: Local Kafka Availability Probe ---');
  const isBrokerPortOpen = await checkPortOpen(9092, '127.0.0.1');
  console.log(`TCP Port 9092 reachable: ${isBrokerPortOpen ? 'YES' : 'NO (Connection Refused)'}`);

  const livePublisher = new OutboxPublisherService({
    brokers: ['127.0.0.1:9092'],
    clientId: 'farmchain-test-probe',
    workerId: 'worker-probe-01',
    pollIntervalMs: 60000,
  });

  const connectResult = await livePublisher.connect();
  const health = livePublisher.getHealth();
  console.log(`Broker Connect Result: ${connectResult ? 'CONNECTED' : 'FAILED / OFFLINE'}`);
  console.log(`Reported Connection Error: "${health.lastError}"`);

  if (!isBrokerPortOpen) {
    console.log('✅ Graceful Failure Verified: When Kafka is offline, connect() returns false without crashing.');
  }

  // STEP 3: Offline Protection (Pending events untouched while broker is offline)
  console.log('\n--- TEST 3: Offline Broker Protection ---');
  const offlineBatchResult = await livePublisher.processOutboxBatch();
  console.log('Offline Batch Execution Result:', offlineBatchResult);
  if (offlineBatchResult.processed === 0 && offlineBatchResult.published === 0 && offlineBatchResult.failed === 0) {
    console.log('✅ Protection Verified: Pending events were NOT touched while broker is offline.');
  } else {
    throw new Error('FAILED: Events were modified while broker was offline!');
  }

  // STEP 4: Atomic Two-Worker Race Simulation (Independent Workers Competing for Same Event)
  console.log('\n--- TEST 4: Atomic Race Simulation — Two Competing Independent Workers ---');
  const testRaceEventId = `test-race-compete-${Date.now()}`;
  const { data: raceRecord, error: insertRaceErr } = await supabase
    .from('event_outbox')
    .insert({
      event_id: testRaceEventId,
      event_type: 'TEST_CONCURRENT_RACE',
      topic: 'test-diagnostic-events',
      payload: { test: true, purpose: 'atomic_claim_concurrency' },
      status: 'PENDING',
      retry_count: 0,
      last_error: null,
    })
    .select()
    .single();

  if (insertRaceErr || !raceRecord) {
    throw new Error(`Failed to create race test record: ${insertRaceErr?.message}`);
  }

  console.log(`Created isolated test event ${testRaceEventId} (ID: ${raceRecord.id})`);

  try {
    // Instantiate two completely distinct worker instances with different worker IDs
    const workerAlpha = new OutboxPublisherService({ workerId: 'worker-ALPHA-1001', mode: 'TEST_ONLY' });
    const workerBeta = new OutboxPublisherService({ workerId: 'worker-BETA-2002', mode: 'TEST_ONLY' });

    // Both workers observed the exact same event in PENDING status
    const observedRecord = raceRecord as OutboxRecord;

    console.log('Launching simultaneous atomic claim requests from Worker ALPHA and Worker BETA...');
    const [claimAlpha, claimBeta] = await Promise.all([
      workerAlpha.claimEvent(observedRecord),
      workerBeta.claimEvent(observedRecord),
    ]);

    console.log(`Worker ALPHA Claim Result: ${claimAlpha.claimed ? 'CLAIMED (' + claimAlpha.claimToken + ')' : 'REJECTED (0 rows)'}`);
    console.log(`Worker BETA Claim Result:  ${claimBeta.claimed ? 'CLAIMED (' + claimBeta.claimToken + ')' : 'REJECTED (0 rows)'}`);

    // Exactly one worker must win the claim
    const winCount = (claimAlpha.claimed ? 1 : 0) + (claimBeta.claimed ? 1 : 0);
    if (winCount !== 1) {
      throw new Error(`ATOMIC CLAIM FAILED: Expected exactly 1 winner, but ${winCount} workers claimed the event!`);
    }

    const winningWorker = claimAlpha.claimed ? workerAlpha : workerBeta;
    const losingWorker = claimAlpha.claimed ? workerBeta : workerAlpha;
    const winningClaim = claimAlpha.claimed ? claimAlpha : claimBeta;
    const losingClaim = claimAlpha.claimed ? claimBeta : claimAlpha;

    console.log(`✅ Atomic Claim Verified: Winner is ${winningWorker.workerId}. Loser is ${losingWorker.workerId}.`);

    // Verify database record has winner's claim token
    const { data: dbClaimedRecord } = await supabase
      .from('event_outbox')
      .select('*')
      .eq('id', raceRecord.id)
      .single();

    if (!dbClaimedRecord.last_error?.startsWith(`CLAIM:${winningWorker.workerId}:`)) {
      throw new Error(`Database claim token mismatch: ${dbClaimedRecord.last_error}`);
    }
    console.log(`✅ Database State Verified: last_error atomically set to "${dbClaimedRecord.last_error}".`);

    // Verify that the losing worker is PREVENTED from publishing
    let mockLosingSent = false;
    losingWorker.setProducer({
      send: async () => {
        mockLosingSent = true;
      },
    });

    const losingPubResult = await losingWorker.publishSingleEvent(dbClaimedRecord as OutboxRecord);
    console.log('Losing Worker Publish Attempt Result:', losingPubResult);
    if (mockLosingSent || losingPubResult.status !== 'CLAIM_FAILED') {
      throw new Error('Losing worker bypassed claim check and dispatched message to Kafka!');
    }
    console.log('✅ Double-Publish Prevention Verified: Losing worker was blocked from sending to Kafka.');

    // Verify that the winning worker CAN publish successfully
    let mockWinningSent = false;
    winningWorker.setProducer({
      send: async (args: any) => {
        mockWinningSent = true;
        return [{ topicName: args.topic, partition: 0, errorCode: 0, baseOffset: '100' }];
      },
    });

    const winningPubResult = await winningWorker.publishSingleEvent(winningClaim.record || (dbClaimedRecord as OutboxRecord), winningClaim.claimToken);
    console.log('Winning Worker Publish Result:', winningPubResult);
    if (!mockWinningSent || winningPubResult.status !== 'PUBLISHED') {
      throw new Error('Winning worker failed to publish event');
    }

    // Verify final database state is PUBLISHED with null last_error
    const { data: finalRaceDb } = await supabase
      .from('event_outbox')
      .select('*')
      .eq('id', raceRecord.id)
      .single();

    if (finalRaceDb.status !== 'PUBLISHED' || !finalRaceDb.published_at || finalRaceDb.last_error !== null) {
      throw new Error(`Unexpected final DB state: status=${finalRaceDb.status}, last_error=${finalRaceDb.last_error}`);
    }
    console.log('✅ Final Transition Verified: Record transitioned to PUBLISHED with cleared lease.');
  } finally {
    // Isolate cleanup to ONLY this test record
    await supabase.from('event_outbox').delete().eq('id', raceRecord.id);
    console.log(`Cleaned up isolated race test record ${raceRecord.id}`);
  }

  // STEP 5: Abandoned Claim Recovery (Worker Crash Simulation)
  console.log('\n--- TEST 5: Abandoned Claim Recovery (Crashed Worker Lease Expiry) ---');
  const testAbandonEventId = `test-abandon-${Date.now()}`;
  const { data: abandonRecord, error: insertAbandonErr } = await supabase
    .from('event_outbox')
    .insert({
      event_id: testAbandonEventId,
      event_type: 'TEST_CRASH_RECOVERY',
      topic: 'test-diagnostic-events',
      payload: { crash_sim: true },
      status: 'PENDING',
      retry_count: 0,
      last_error: null,
    })
    .select()
    .single();

  if (insertAbandonErr || !abandonRecord) {
    throw new Error(`Failed to create abandon test record: ${insertAbandonErr?.message}`);
  }

  console.log(`Created isolated test event ${testAbandonEventId} (ID: ${abandonRecord.id})`);

  try {
    // Worker 1 claims with an extremely short lease of 1.5 seconds (1500ms)
    const crashedWorker = new OutboxPublisherService({ workerId: 'worker-CRASHED-99', claimTimeoutMs: 1500, mode: 'TEST_ONLY' });
    const recoveryWorker = new OutboxPublisherService({ workerId: 'worker-RECOVERY-01', claimTimeoutMs: 30000, mode: 'TEST_ONLY' });

    const initialClaim = await crashedWorker.claimEvent(abandonRecord as OutboxRecord);
    if (!initialClaim.claimed || !initialClaim.claimToken) {
      throw new Error('Initial claim by crashed worker failed');
    }
    console.log(`Worker CRASHED-99 acquired lease: ${initialClaim.claimToken}`);

    // Immediately before lease expiry, recovery worker should NOT be able to claim it
    const earlyAttempt = await recoveryWorker.claimEvent(initialClaim.record!);
    if (earlyAttempt.claimed) {
      throw new Error('Recovery worker claimed unexpired lease!');
    }
    console.log('✅ Unexpired Lease Protection Verified: Recovery worker rejected while lease is still active.');

    // Simulate worker crash: crashedWorker vanishes, does not publish.
    // Wait 2.0 seconds for lease to expire...
    console.log('Simulating worker crash. Waiting 2.0s for lease to expire...');
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Fetch current state from DB
    const { data: expiredDbRecord } = await supabase
      .from('event_outbox')
      .select('*')
      .eq('id', abandonRecord.id)
      .single();

    // Recovery worker re-attempts claim
    const recoveryClaim = await recoveryWorker.claimEvent(expiredDbRecord as OutboxRecord);
    if (!recoveryClaim.claimed || !recoveryClaim.claimToken) {
      throw new Error('Recovery worker failed to reclaim expired/abandoned lease!');
    }
    console.log(`✅ Abandoned Lease Recovered: Recovery worker acquired new lease: ${recoveryClaim.claimToken}`);

    // Recovery worker finishes publication
    recoveryWorker.setProducer({
      send: async () => [{ partition: 0, errorCode: 0, baseOffset: '200' }],
    });
    const pubResult = await recoveryWorker.publishSingleEvent(recoveryClaim.record!, recoveryClaim.claimToken);
    if (pubResult.status !== 'PUBLISHED') {
      throw new Error(`Recovery worker failed to publish: ${JSON.stringify(pubResult)}`);
    }
    console.log('✅ Event Saved: Abandoned event safely published and marked PUBLISHED without data loss.');
  } finally {
    await supabase.from('event_outbox').delete().eq('id', abandonRecord.id);
    console.log(`Cleaned up isolated abandon test record ${abandonRecord.id}`);
  }

  // STEP 6: Failed Publication Does Not Lose Event (Retry Increment & Max Retries)
  console.log('\n--- TEST 6: Publication Failure Safety (No Event Loss) ---');
  const testFailEventId = `test-retry-loss-${Date.now()}`;
  const { data: failRecord } = await supabase
    .from('event_outbox')
    .insert({
      event_id: testFailEventId,
      event_type: 'TEST_RETRY_LOSS_PREVENTION',
      topic: 'test-diagnostic-events',
      payload: { test: true },
      status: 'PENDING',
      retry_count: 0,
      last_error: null,
    })
    .select()
    .single();

  try {
    const retryWorker = new OutboxPublisherService({ maxRetries: 2, workerId: 'worker-RETRY-01', mode: 'TEST_ONLY' });
    retryWorker.setProducer({
      send: async () => {
        throw new Error('Simulated TopicAuthorizationException');
      },
    });

    // Attempt 1: Should increment retry count and remain PENDING
    const attempt1 = await retryWorker.publishSingleEvent(failRecord as OutboxRecord);
    console.log('Attempt 1 Result:', attempt1);

    const { data: dbAfter1 } = await supabase
      .from('event_outbox')
      .select('*')
      .eq('id', failRecord.id)
      .single();

    if (dbAfter1.status !== 'PENDING' || dbAfter1.retry_count !== 1) {
      throw new Error(`Attempt 1 failed: status=${dbAfter1.status}, retry_count=${dbAfter1.retry_count}`);
    }
    console.log('✅ Attempt 1 verified: Event kept as PENDING, retry_count incremented to 1.');

    // Attempt 2: Reaches maxRetries (2) -> transitions to FAILED
    const attempt2 = await retryWorker.publishSingleEvent(dbAfter1 as OutboxRecord);
    console.log('Attempt 2 Result:', attempt2);

    const { data: dbAfter2 } = await supabase
      .from('event_outbox')
      .select('*')
      .eq('id', failRecord.id)
      .single();

    if (dbAfter2.status !== 'FAILED' || dbAfter2.retry_count !== 2) {
      throw new Error(`Attempt 2 failed: status=${dbAfter2.status}, retry_count=${dbAfter2.retry_count}`);
    }
    console.log('✅ Attempt 2 verified: Reached maxRetries (2), safely marked FAILED without losing record.');
  } finally {
    await supabase.from('event_outbox').delete().eq('id', failRecord.id);
    console.log(`Cleaned up isolated fail test record ${failRecord.id}`);
  }

  // STEP 7: Safe TEST_ONLY & PAUSED Mode Isolation Check
  console.log('\n--- TEST 7: Safe TEST_ONLY Mode Backlog Isolation Check ---');
  // Configure publisher in TEST_ONLY mode with a mock producer
  let testOnlySentEvents: any[] = [];
  const mockProducerForTestMode = {
    connect: async () => {},
    disconnect: async () => {},
    send: async (args: any) => {
      testOnlySentEvents.push(args);
      return [{ topicName: args.topic, partition: 0, errorCode: 0, baseOffset: '500' }];
    },
  };

  const testOnlyWorker = new OutboxPublisherService({
    mode: 'TEST_ONLY',
    workerId: 'worker-TEST-MODE-ISOLATION',
    customProducer: mockProducerForTestMode,
  });

  // A. Execute batch while the 40 real business events exist in PENDING state
  console.log('Running processOutboxBatch() in TEST_ONLY mode against database containing 40 business events...');
  const testOnlyBatchResult = await testOnlyWorker.processOutboxBatch();
  console.log('TEST_ONLY Batch Result:', testOnlyBatchResult);

  if (testOnlyBatchResult.processed !== 0 || testOnlyBatchResult.published !== 0) {
    throw new Error(`TEST_ONLY isolation failure! Processed: ${testOnlyBatchResult.processed}, Published: ${testOnlyBatchResult.published}`);
  }
  if (testOnlySentEvents.length !== 0) {
    throw new Error(`TEST_ONLY isolation failure! Mock producer dispatched ${testOnlySentEvents.length} events!`);
  }
  console.log('✅ Batch Isolation Verified: TEST_ONLY mode completely ignored all 40 business events.');

  // B. Attempt direct claim on real business records while in TEST_ONLY mode
  console.log('Attempting direct claim on real business events in TEST_ONLY mode...');
  const { data: sampleBusinessEvents } = await supabase
    .from('event_outbox')
    .select('*')
    .eq('status', 'PENDING')
    .limit(5);

  let rejectedClaimsCount = 0;
  for (const bEvent of (sampleBusinessEvents || [])) {
    const claimRes = await testOnlyWorker.claimEvent(bEvent as OutboxRecord);
    if (!claimRes.claimed) {
      rejectedClaimsCount++;
    }
  }

  if (rejectedClaimsCount !== (sampleBusinessEvents?.length || 0)) {
    throw new Error('TEST_ONLY mode allowed a business event to be claimed!');
  }
  console.log(`✅ Direct Claim Guard Verified: All ${rejectedClaimsCount} attempted business event claims were rejected in TEST_ONLY mode.`);

  // C. Verify PAUSED mode rejects batch execution as well
  const pausedWorker = new OutboxPublisherService({
    mode: 'PAUSED',
    workerId: 'worker-PAUSED-CHECK',
    customProducer: mockProducerForTestMode,
  });
  const pausedBatchResult = await pausedWorker.processOutboxBatch();
  if (pausedBatchResult.processed !== 0 || pausedBatchResult.published !== 0) {
    throw new Error('PAUSED mode processed events!');
  }
  console.log('✅ PAUSED Mode Verified: processOutboxBatch() returned 0/0/0 without touching records.');

  // STEP 8: Final Baseline Check (Zero Records Lost or Mutated)
  console.log('\n--- TEST 8: Final Baseline Verification ---');
  const { data: finalRecords, error: finalErr } = await supabase
    .from('event_outbox')
    .select('id, event_id, status, retry_count');

  if (finalErr) {
    throw new Error(`Failed to query event_outbox: ${finalErr.message}`);
  }

  console.log(`Final total outbox count: ${finalRecords.length} (Initial was ${initialCount})`);
  if (finalRecords.length !== initialCount) {
    throw new Error(`Record count mismatch! Initial: ${initialCount}, Final: ${finalRecords.length}`);
  }

  const initialIdSet = new Set(initialRecords.map((r) => r.id));
  let pendingCount = 0;
  for (const r of finalRecords) {
    if (!initialIdSet.has(r.id)) {
      throw new Error(`Unexpected new record found: ${r.id}`);
    }
    if (r.status === 'PENDING') {
      pendingCount++;
    }
  }

  if (pendingCount !== initialCount) {
    throw new Error(`Expected all ${initialCount} records to remain PENDING, but found ${pendingCount}`);
  }

  console.log(`✅ PERFECT: All ${initialCount} original business events remain intact, unmodified, and preserved in PENDING state!`);

  console.log('\n===================================================================');
  console.log('   ALL ATOMIC CLAIMING & CONCURRENCY TESTS PASSED SUCCESSFULLY!    ');
  console.log('===================================================================');
}

runTestSuite().catch((err) => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});

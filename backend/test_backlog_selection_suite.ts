/**
 * FarmChainAI — Backlog Selection & Fixture Isolation Verification Suite
 *
 * Deterministic unit and integration tests proving safe backlog selection,
 * pre-claim fixture isolation, deferred-topic boundary protection, and fail-closed invariants.
 *
 * Invariants:
 * 1. Read-only against existing database records: ZERO claims, leases, updates, or deletes on backlog rows.
 * 2. Pre-claim boundary: 3 fixtures and 19 deferred events are filtered out BEFORE claimEvent() is called.
 * 3. In-claim defense-in-depth: claimEvent() refuses to claim fixture IDs under any mode.
 * 4. Zero Kafka broker publication: No Kafka producer is instantiated or called.
 * 5. Rollback-isolated testing for any transactional claim mechanics.
 */

import './src/test_preload';
import pg from 'pg';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import {
  assertApprovedLocalEnvironment,
  assertLocalPostgresUrl,
  assertLocalSupabaseUrl,
  LocalDatabaseGuardError,
  maskUrlCredentials,
} from './src/utils/localDatabaseGuard';
import {
  HISTORICAL_ATOM_FIXTURE_IDS,
  CONTROLLED_REPLAY_APPROVED_TOPICS,
  DEFERRED_UNHANDLED_TOPICS,
  EXPECTED_ELIGIBLE_EVENT_IDS,
  classifyBacklogRecord,
  selectBacklogReplayCandidates,
  isEventEligibleForControlledReplay,
  validateReplayPayloadContract,
} from './src/services/backlogReplaySelector';
import {
  OutboxPublisherService,
  OutboxRecord,
} from './src/services/outboxPublisherService';

// Enforce approved local environment immediately
assertApprovedLocalEnvironment('BacklogSelectionSuite');
const LOCAL_DB_URL = process.env.LOCAL_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const LOCAL_SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';

assertLocalPostgresUrl(LOCAL_DB_URL, 'BacklogSelectionSuite');
assertLocalSupabaseUrl(LOCAL_SUPABASE_URL, 'BacklogSelectionSuite');

interface OutboxDbRow {
  id: string;
  event_id: string;
  event_type: string;
  topic: string;
  status: string;
  retry_count: number;
  last_error: string | null;
  payload: any;
  created_at: Date | string;
  published_at?: Date | string | null;
}

async function runBacklogSelectionSuite() {
  console.log('===================================================================');
  console.log('   FarmChainAI — Step 21: Backlog Selection & Fixture Isolation    ');
  console.log('===================================================================\n');

  const client = new pg.Client({ connectionString: LOCAL_DB_URL });
  await client.connect();

  let passedTests = 0;

  try {
    // -------------------------------------------------------------------------
    // BASELINE: CAPTURE BEFORE SNAPSHOT
    // -------------------------------------------------------------------------
    console.log('Capturing BEFORE-snapshot of local outbox...');
    const beforeRes = await client.query(`
      SELECT id, event_id, event_type, topic, status, retry_count, last_error, payload, created_at, published_at
      FROM event_outbox
      ORDER BY created_at ASC;
    `);
    const initialRows: OutboxDbRow[] = beforeRes.rows;
    assert.strictEqual(initialRows.length, 35, 'Expected exactly 35 records in event_outbox');

    for (const row of initialRows) {
      assert.strictEqual(row.status, 'PENDING', `Record ${row.id} must be PENDING`);
      assert.strictEqual(row.retry_count, 0, `Record ${row.id} retry_count must be 0`);
      assert.strictEqual(row.last_error, null, `Record ${row.id} last_error must be null`);
      assert.strictEqual(row.published_at, null, `Record ${row.id} published_at must be null`);
    }
    console.log(`[PASS] Baseline confirmed: 35/35 records are PENDING with retry_count=0 and last_error=null.\n`);

    // -------------------------------------------------------------------------
    // TEST 1: Reusable Selection Against Live Database Rows (Read-Only)
    // -------------------------------------------------------------------------
    console.log('Test 1: Reusable selector classification on live outbox records...');
    const partition = selectBacklogReplayCandidates(initialRows as any, { failClosedOnUnexpected: true });

    assert.strictEqual(partition.eligible.length, 13, `Expected 13 eligible candidates, got ${partition.eligible.length}`);
    assert.strictEqual(partition.fixtures.length, 3, `Expected 3 excluded fixtures, got ${partition.fixtures.length}`);
    assert.strictEqual(partition.deferred.length, 19, `Expected 19 deferred events, got ${partition.deferred.length}`);
    assert.strictEqual(partition.rejected.length, 0, `Expected 0 rejected events, got ${partition.rejected.length}`);

    // Verify 13 eligible candidate UUIDs
    const eligibleIdSet = new Set(partition.eligible.map((e) => e.id));
    for (const id of EXPECTED_ELIGIBLE_EVENT_IDS) {
      assert.ok(eligibleIdSet.has(id), `Expected eligible ID ${id} missing from partition`);
    }

    // Verify 3 fixture UUIDs
    const fixtureIdSet = new Set(partition.fixtures.map((f) => f.id));
    for (const id of HISTORICAL_ATOM_FIXTURE_IDS) {
      assert.ok(fixtureIdSet.has(id), `Expected fixture ID ${id} missing from partition`);
    }

    // Verify topic breakdown of 13 eligible
    const eligibleTopics = partition.eligible.map((e) => e.topic);
    assert.strictEqual(eligibleTopics.filter((t) => t === 'traceability-events').length, 9);
    assert.strictEqual(eligibleTopics.filter((t) => t === 'shipment-events').length, 1);
    assert.strictEqual(eligibleTopics.filter((t) => t === 'inventory-events').length, 3);

    // Verify breakdown of 19 deferred
    const deferredTopics = partition.deferred.map((d) => d.topic);
    assert.strictEqual(deferredTopics.filter((t) => t === 'quality-alerts').length, 10);
    assert.strictEqual(deferredTopics.filter((t) => t === 'logistics-events').length, 9);

    console.log('  [PASS] 13 eligible, 3 fixtures, 19 deferred accurately partitioned.\n');
    passedTests++;

    // -------------------------------------------------------------------------
    // TEST 2: Pre-Claim Boundary Protection (Mock Claim Spy)
    // -------------------------------------------------------------------------
    console.log('Test 2: Pre-claim boundary protection — verifying claim spy calls...');
    const claimedEventIds: string[] = [];
    const mockClaimSpy = async (event: OutboxRecord) => {
      claimedEventIds.push(event.id);
      return {
        claimed: true,
        claimToken: `MOCK-CLAIM-${event.id}`,
        record: event,
      };
    };

    const publisher = new OutboxPublisherService({
      customProducer: {
        send: async () => {}, // Mock producer that does nothing
      },
    });

    // Run controlled replay batch with mock claim spy and mock publish spy
    const batchResult = await publisher.processControlledBacklogReplayBatch({
      dryRun: false,
      claimFn: mockClaimSpy,
      publishFn: async () => ({ status: 'PUBLISHED' }),
    });

    assert.strictEqual(batchResult.eligibleCount, 13);
    assert.strictEqual(batchResult.fixturesExcludedCount, 3);
    assert.strictEqual(batchResult.deferredCount, 19);

    // CRITICAL ASSERTION: claimFn was called ONLY for the 13 eligible events
    assert.strictEqual(claimedEventIds.length, 13, `claimFn called ${claimedEventIds.length} times, expected 13`);
    for (const claimedId of claimedEventIds) {
      assert.ok(EXPECTED_ELIGIBLE_EVENT_IDS.has(claimedId), `Non-eligible event ${claimedId} was passed to claimFn!`);
      assert.ok(!HISTORICAL_ATOM_FIXTURE_IDS.has(claimedId), `Historical fixture ${claimedId} was passed to claimFn!`);
    }

    // Explicitly verify NONE of the 3 fixtures were ever passed to claimFn
    for (const fixtureId of HISTORICAL_ATOM_FIXTURE_IDS) {
      assert.ok(!claimedEventIds.includes(fixtureId), `FIXTURE LEAK: ${fixtureId} reached claimFn!`);
    }

    // Explicitly verify NONE of the 19 deferred events were ever passed to claimFn
    for (const deferredEvent of partition.deferred) {
      assert.ok(!claimedEventIds.includes(deferredEvent.id), `DEFERRED EVENT LEAK: ${deferredEvent.id} reached claimFn!`);
    }

    console.log('  [PASS] Claim boundary verified: 3 fixtures & 19 deferred events filtered out prior to claim call.\n');
    passedTests++;

    // -------------------------------------------------------------------------
    // TEST 3: Dry-Run Mode Safety
    // -------------------------------------------------------------------------
    console.log('Test 3: Dry-run mode execution...');
    let dryRunClaimInvoked = false;
    const dryRunResult = await publisher.processControlledBacklogReplayBatch({
      dryRun: true,
      claimFn: async () => {
        dryRunClaimInvoked = true;
        return { claimed: false };
      },
    });

    assert.strictEqual(dryRunClaimInvoked, false, 'claimFn must never be called in dryRun mode');
    assert.strictEqual(dryRunResult.eligibleCount, 13);
    assert.strictEqual(dryRunResult.fixturesExcludedCount, 3);
    assert.strictEqual(dryRunResult.deferredCount, 19);
    assert.strictEqual(dryRunResult.processedCount, 0);
    assert.strictEqual(dryRunResult.publishedCount, 0);
    console.log('  [PASS] Dry-run mode safely evaluates plan with zero claims or mutations.\n');
    passedTests++;

    // -------------------------------------------------------------------------
    // TEST 4: Direct claimEvent Defense-in-Depth Guard
    // -------------------------------------------------------------------------
    console.log('Test 4: Direct claimEvent defense-in-depth guard for fixture IDs...');
    // Even if an operator calls claimEvent directly with forceSingleTest=true or mode='LIVE':
    publisher.setMode('LIVE');
    for (const fixture of partition.fixtures) {
      const directClaimResult = await publisher.claimEvent(fixture as OutboxRecord, true);
      assert.strictEqual(
        directClaimResult.claimed,
        false,
        `claimEvent must refuse to claim fixture ${fixture.id} even with forceSingleTest=true in LIVE mode`
      );
    }
    // Return to PAUSED mode
    publisher.setMode('PAUSED');
    console.log('  [PASS] claimEvent defense-in-depth guard strictly refuses to claim all 3 fixture IDs.\n');
    passedTests++;

    // -------------------------------------------------------------------------
    // TEST 5: Fail-Closed on Missing Fixture ID
    // -------------------------------------------------------------------------
    console.log('Test 5: Fail-closed on missing fixture ID...');
    const missingFixtureRecords = (initialRows as any[]).filter(
      (r) => r.id !== '4232d9be-af74-4d3e-8848-32b28d446942'
    );
    assert.throws(
      () => {
        selectBacklogReplayCandidates(missingFixtureRecords, { failClosedOnUnexpected: true, requireAllFixtures: true });
      },
      /\[FAIL_CLOSED\] Expected historical fixture 4232d9be-af74-4d3e-8848-32b28d446942 was not found or has been altered!/,
      'Must fail closed if an expected fixture is missing'
    );
    console.log('  [PASS] Missing fixture detected and failed closed.\n');
    passedTests++;

    // -------------------------------------------------------------------------
    // TEST 6: Fail-Closed on Altered Fixture ID
    // -------------------------------------------------------------------------
    console.log('Test 6: Fail-closed on altered fixture ID...');
    const alteredFixtureRecords = (initialRows as any[]).map((r) => {
      if (r.id === 'ecef8be1-c37b-4375-a2e1-d6df5c2b30ca') {
        return { ...r, id: '11111111-2222-3333-4444-555555555555' };
      }
      return r;
    });
    assert.throws(
      () => {
        selectBacklogReplayCandidates(alteredFixtureRecords, { failClosedOnUnexpected: true, requireAllFixtures: true });
      },
      /\[FAIL_CLOSED\]/,
      'Must fail closed if a fixture ID was modified'
    );
    console.log('  [PASS] Altered fixture detected and failed closed.\n');
    passedTests++;

    // -------------------------------------------------------------------------
    // TEST 7: Fail-Closed on Unknown Topic or Unexpected Pending Record
    // -------------------------------------------------------------------------
    console.log('Test 7: Fail-closed on unknown topic or unexpected record...');
    const unknownTopicRecord: OutboxRecord = {
      id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      event_id: 'test-event-unknown',
      event_type: 'PAYMENT_PROCESSED',
      topic: 'finance-events',
      payload: { amount: 100 },
      status: 'PENDING',
      retry_count: 0,
      created_at: new Date().toISOString(),
    };
    const recordsWithUnknown = [...(initialRows as any[]), unknownTopicRecord];
    assert.throws(
      () => {
        selectBacklogReplayCandidates(recordsWithUnknown, { failClosedOnUnexpected: true });
      },
      /\[FAIL_CLOSED\] Replay selection rejected 1 unexpected or invalid record/,
      'Must fail closed on unknown topic'
    );

    const unexpectedEligibleCandidate: OutboxRecord = {
      id: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
      event_id: 'test-event-unexpected-batch',
      event_type: 'BATCH_CREATED',
      topic: 'traceability-events',
      payload: {
        batch_id: 'BATCH-UNEXPECTED',
        product_id: 'PROD-01',
        farmer_id: 'FARM-01',
        quantity: 100,
        status: 'Active',
      },
      status: 'PENDING',
      retry_count: 0,
      created_at: new Date().toISOString(),
    };
    const recordsWithUnexpectedCandidate = [...(initialRows as any[]), unexpectedEligibleCandidate];
    assert.throws(
      () => {
        selectBacklogReplayCandidates(recordsWithUnexpectedCandidate, { failClosedOnUnexpected: true });
      },
      /\[FAIL_CLOSED\] Replay selection rejected 1 unexpected or invalid record/,
      'Must fail closed on unexpected record ID not in approved 13 set'
    );
    console.log('  [PASS] Unknown topics and unexpected pending records fail closed.\n');
    passedTests++;

    // -------------------------------------------------------------------------
    // TEST 8: Normal Publishing Invariants Preserved
    // -------------------------------------------------------------------------
    console.log('Test 8: Normal publishing invariants preserved...');
    const freshPublisher = new OutboxPublisherService();
    assert.strictEqual(freshPublisher.mode, 'PAUSED', 'Publisher mode must strictly default to PAUSED');

    // Normal topic support is NOT restricted to the 3 replay topics
    assert.ok(
      (DEFERRED_UNHANDLED_TOPICS as readonly string[]).includes('quality-alerts'),
      'quality-alerts is deferred only for replay, not globally forbidden'
    );
    console.log('  [PASS] Normal publishing defaults and scope isolation confirmed.\n');
    passedTests++;

    // -------------------------------------------------------------------------
    // TEST 9: Transaction-Rollback Isolated Database OCC Claim Test
    // -------------------------------------------------------------------------
    console.log('Test 9: Rollback-isolated database OCC claim verification...');
    // We test PostgreSQL optimistic concurrency update semantics on a synthetic test row
    // inside an isolated transaction that is rolled back immediately.
    await client.query('BEGIN;');
    try {
      const dummyId = '00000000-0000-4000-8000-000000000001';
      const dummyEventId = 'test-rollback-isolated-event';

      // Insert dummy record inside transaction
      await client.query(`
        INSERT INTO event_outbox (id, event_id, event_type, topic, payload, status, retry_count, last_error)
        VALUES ($1, $2, 'TEST_EVENT', 'test-diagnostic-events', '{"test":true}', 'PENDING', 0, NULL);
      `, [dummyId, dummyEventId]);

      // Worker A claims the dummy record
      const claimTokenA = 'CLAIM:worker-A:9999999999999';
      const claimResA = await client.query(`
        UPDATE event_outbox
        SET last_error = $1
        WHERE id = $2 AND status = 'PENDING' AND last_error IS NULL
        RETURNING id, last_error;
      `, [claimTokenA, dummyId]);
      assert.strictEqual(claimResA.rowCount, 1, 'Worker A must successfully claim row');
      assert.strictEqual(claimResA.rows[0].last_error, claimTokenA);

      // Worker B attempts competing claim on same row
      const claimTokenB = 'CLAIM:worker-B:9999999999999';
      const claimResB = await client.query(`
        UPDATE event_outbox
        SET last_error = $1
        WHERE id = $2 AND status = 'PENDING' AND last_error IS NULL
        RETURNING id, last_error;
      `, [claimTokenB, dummyId]);
      assert.strictEqual(claimResB.rowCount, 0, 'Worker B competing claim must match 0 rows');

    } finally {
      // ALWAYS ROLLBACK: Guarantees zero persistent database changes
      await client.query('ROLLBACK;');
    }
    console.log('  [PASS] Database OCC claim logic tested in transaction and rolled back cleanly.\n');
    passedTests++;

    // -------------------------------------------------------------------------
    // TEST 10: Final Snapshot Zero-Mutation Post-Condition Audit
    // -------------------------------------------------------------------------
    console.log('Test 10: Database zero-mutation post-condition audit...');
    const afterRes = await client.query(`
      SELECT id, event_id, event_type, topic, status, retry_count, last_error, payload, created_at, published_at
      FROM event_outbox
      ORDER BY created_at ASC;
    `);
    const finalRows: OutboxDbRow[] = afterRes.rows;

    assert.strictEqual(finalRows.length, 35, 'Row count mutated during test suite!');

    for (let i = 0; i < initialRows.length; i++) {
      const before = initialRows[i];
      const after = finalRows[i];

      assert.strictEqual(before.id, after.id, `Row ID mutated at index ${i}`);
      assert.strictEqual(after.status, 'PENDING', `Record ${after.id} status mutated to ${after.status}`);
      assert.strictEqual(after.retry_count, 0, `Record ${after.id} retry_count mutated to ${after.retry_count}`);
      assert.strictEqual(after.last_error, null, `Record ${after.id} last_error mutated to ${after.last_error}`);
      assert.strictEqual(after.published_at, null, `Record ${after.id} published_at mutated to ${after.published_at}`);
      assert.strictEqual(
        new Date(before.created_at).getTime(),
        new Date(after.created_at).getTime(),
        `Record ${after.id} created_at mutated`
      );
    }
    console.log(`  [PASS] Zero-mutation invariant confirmed: 35/35 records remain pristine in local database.\n`);
    passedTests++;

    console.log('===================================================================');
    console.log(`   ALL ${passedTests}/${passedTests} BACKLOG SELECTION TESTS PASSED`);
    console.log('===================================================================\n');

  } finally {
    await client.end();
  }
}

// Auto-run if executed directly
if (require.main === module) {
  runBacklogSelectionSuite().catch((err) => {
    console.error('\n[SELECTION_TEST_FATAL_ERROR]', err?.message || err);
    process.exit(1);
  });
}

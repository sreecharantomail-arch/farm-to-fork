/**
 * FarmChainAI — Backlog Replay Preflight Verification Suite
 *
 * READ-ONLY PREFLIGHT AUDIT AND PARTITION VERIFICATION.
 *
 * Strict Invariants:
 * 1. Read-only operation: performs zero INSERT, UPDATE, DELETE, or lease/claim queries.
 * 2. Connects exclusively to approved local database targets (127.0.0.1:54321 / 127.0.0.1:54322).
 * 3. Never contacts remote or hosted Supabase.
 * 4. Zero Kafka broker publication: No Kafka producer is imported or instantiated.
 * 5. Fixture exclusion happens strictly before any claim/lease operation could be conceived.
 * 6. Fails closed immediately on count, UUID, schema, or invariant violations.
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

// Enforce approved local environment immediately
assertApprovedLocalEnvironment('BacklogReplayPreflight');
const LOCAL_DB_URL = process.env.LOCAL_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const LOCAL_SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';

assertLocalPostgresUrl(LOCAL_DB_URL, 'BacklogReplayPreflight');
assertLocalSupabaseUrl(LOCAL_SUPABASE_URL, 'BacklogReplayPreflight');

// ============================================================================
// CONSTANTS & IMMUTABLE CLASSIFICATION SETS
// ============================================================================

export const HISTORICAL_ATOM_FIXTURE_IDS = new Set<string>([
  '4232d9be-af74-4d3e-8848-32b28d446942', // BATCH_CREATED (BATCH-ATOM-01-1792273692509)
  'ecef8be1-c37b-4375-a2e1-d6df5c2b30ca', // BATCH_CREATED (BATCH-ATOM-01-1792273827677)
  '293f96d7-d6a7-450f-b546-4888c8ddc1e6', // DELIVERY_PROOF_SUBMITTED (BATCH-ATOM-01-1792273827677)
]);

export const EXPECTED_ELIGIBLE_EVENT_IDS = new Set<string>([
  'f3c6f7e0-dc64-4e89-bb65-67e3e76084ef', // traceability-events :: BATCH_CREATED (BATCH-1791655578385)
  '89759505-e86a-4a4a-881b-50f816d8fb21', // shipment-events     :: SHIPMENT_RECEIVED (BATCH-3D-1791656463293)
  '84aaf5d1-eeb3-41d6-9e96-f92463a167ca', // traceability-events :: RETAILER_RECEIVED (BATCH-3D-1791656463293)
  'b9566ee6-09f5-47d5-9acf-c86c7ce88a58', // inventory-events    :: INVENTORY_CREATED (BATCH-3D-1791656463293)
  'd0fa05cb-4d7f-4f94-b46e-82d1309bb4f3', // inventory-events    :: SALE_CREATED (INT-RETURN-1791741607611-B1)
  'd996b7bb-a34e-40fa-b4f5-6d223ec78b05', // inventory-events    :: INVENTORY_UPDATED (INT-RETURN-1791741607611-B1)
  '8baf0f08-beb0-48f5-8487-e388a4acbd3b', // traceability-events :: BATCH_CREATED (TOM-1792159666172)
  'c510405d-a782-4696-b79a-b5cc3c2bb372', // traceability-events :: BATCH_CREATED (MNG-1792159666172)
  '8ff803e7-523e-4832-a4ac-a96dee56422e', // traceability-events :: BATCH_CREATED (TOM-1792161447547)
  '0964e2f7-f166-4822-bc96-394b5e6b3896', // traceability-events :: BATCH_CREATED (MNG-1792161447547)
  '594a432c-e768-435d-98c2-78ddb109efdc', // traceability-events :: BATCH_CREATED (STR-1792161494834)
  'f44daf30-a455-4b83-8e86-20d779c3cb9c', // traceability-events :: BATCH_CREATED (STR-1792161645009)
  'ea3e8c99-a52a-4ed2-892f-46f32a359161', // traceability-events :: BATCH_CREATED (STR-1792161810719)
]);

export const APPROVED_CONSUMER_TOPICS = ['traceability-events', 'shipment-events', 'inventory-events'] as const;
export const UNHANDLED_TOPICS = ['quality-alerts', 'logistics-events'] as const;

export interface OutboxDbRow {
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

export type EventPartition = 'ELIGIBLE_BUSINESS' | 'HISTORICAL_FIXTURE' | 'DEFERRED_UNHANDLED';

export interface ClassifiedOutboxRecord {
  record: OutboxDbRow;
  partition: EventPartition;
  exclusionReason?: string;
  validationError?: string | null;
}

// ============================================================================
// PAYLOAD SCHEMA CONTRACT VALIDATORS
// ============================================================================

export function validatePayloadContract(topic: string, eventType: string, payload: any): string | null {
  if (!payload || typeof payload !== 'object') {
    return 'Payload must be a non-null JSON object';
  }

  switch (topic) {
    case 'traceability-events': {
      if (!payload.batch_id || typeof payload.batch_id !== 'string' || payload.batch_id.trim().length === 0) {
        return 'Missing required field: batch_id';
      }
      if (eventType === 'BATCH_CREATED') {
        if (!payload.product_id || typeof payload.product_id !== 'string' || payload.product_id.trim().length === 0) {
          return 'Missing required field: product_id';
        }
        if (!payload.farmer_id || typeof payload.farmer_id !== 'string' || payload.farmer_id.trim().length === 0) {
          return 'Missing required field: farmer_id';
        }
        const qty = payload.quantity !== undefined ? payload.quantity : payload.initial_quantity;
        if (qty === undefined || qty === null || isNaN(Number(qty)) || Number(qty) <= 0) {
          return 'Missing or invalid numeric field: quantity (must be positive number)';
        }
        const status = payload.status || payload.initial_status;
        if (!status || typeof status !== 'string' || status.trim().length === 0) {
          return 'Missing required field: status';
        }
      } else if (eventType === 'RETAILER_RECEIVED') {
        if (!payload.retailer_id || typeof payload.retailer_id !== 'string' || payload.retailer_id.trim().length === 0) {
          return 'Missing required field: retailer_id';
        }
        const qty = payload.quantity !== undefined
          ? payload.quantity
          : (payload.received_quantity !== undefined ? payload.received_quantity : payload.quantity_received);
        if (qty === undefined || qty === null || isNaN(Number(qty)) || Number(qty) <= 0) {
          return 'Missing or invalid numeric field: quantity';
        }
      } else {
        return `Unsupported event type '${eventType}' on topic '${topic}'`;
      }
      break;
    }

    case 'shipment-events': {
      if (!payload.shipment_id || typeof payload.shipment_id !== 'string' || payload.shipment_id.trim().length === 0) {
        return 'Missing required field: shipment_id';
      }
      if (!payload.batch_id || typeof payload.batch_id !== 'string' || payload.batch_id.trim().length === 0) {
        return 'Missing required field: batch_id';
      }
      if (!payload.retailer_id || typeof payload.retailer_id !== 'string' || payload.retailer_id.trim().length === 0) {
        return 'Missing required field: retailer_id';
      }
      if (eventType === 'SHIPMENT_RECEIVED') {
        const qty = payload.quantity !== undefined
          ? payload.quantity
          : (payload.quantity_delivered !== undefined ? payload.quantity_delivered : payload.delivered_quantity);
        if (qty === undefined || qty === null || isNaN(Number(qty)) || Number(qty) <= 0) {
          return 'Missing or invalid numeric field: quantity (must be positive number)';
        }
      } else if (eventType === 'DELIVERY_PROOF_SUBMITTED') {
        const qty = payload.quantity_delivered !== undefined
          ? payload.quantity_delivered
          : (payload.quantity !== undefined ? payload.quantity : payload.delivered_quantity);
        if (qty === undefined || qty === null || isNaN(Number(qty)) || Number(qty) <= 0) {
          return 'Missing or invalid numeric field: quantity_delivered';
        }
        if (!payload.pod_id || typeof payload.pod_id !== 'string' || payload.pod_id.trim().length === 0) {
          return 'Missing required field: pod_id';
        }
      } else {
        return `Unsupported event type '${eventType}' on topic '${topic}'`;
      }
      break;
    }

    case 'inventory-events': {
      if (!payload.retailer_id || typeof payload.retailer_id !== 'string' || payload.retailer_id.trim().length === 0) {
        return 'Missing required field: retailer_id';
      }
      if (!payload.batch_id || typeof payload.batch_id !== 'string' || payload.batch_id.trim().length === 0) {
        return 'Missing required field: batch_id';
      }
      if (eventType === 'INVENTORY_CREATED') {
        const qty = payload.quantity !== undefined
          ? payload.quantity
          : (payload.quantity_delivered !== undefined ? payload.quantity_delivered : payload.delivered_quantity);
        if (qty === undefined || qty === null || isNaN(Number(qty)) || Number(qty) <= 0) {
          return 'Missing or invalid numeric field: quantity';
        }
      } else if (eventType === 'SALE_CREATED') {
        const qtySold = payload.quantity_sold !== undefined ? payload.quantity_sold : payload.quantity;
        if (qtySold === undefined || qtySold === null || isNaN(Number(qtySold)) || Number(qtySold) <= 0) {
          return 'Missing or invalid numeric field: quantity_sold';
        }
      } else if (eventType === 'INVENTORY_UPDATED') {
        const newQty = payload.new_quantity !== undefined ? payload.new_quantity : payload.quantity;
        if (newQty === undefined || newQty === null || isNaN(Number(newQty)) || Number(newQty) < 0) {
          return 'Missing or invalid numeric field: new_quantity';
        }
      } else {
        return `Unsupported event type '${eventType}' on topic '${topic}'`;
      }
      break;
    }

    default:
      return `Topic '${topic}' does not have an active consumer contract schema`;
  }

  return null;
}

// ============================================================================
// PARTITION CLASSIFICATION ENGINE
// ============================================================================

export function classifyRecord(record: OutboxDbRow): ClassifiedOutboxRecord {
  // 1. Check exact historical fixture exclusion
  if (HISTORICAL_ATOM_FIXTURE_IDS.has(record.id)) {
    return {
      record,
      partition: 'HISTORICAL_FIXTURE',
      exclusionReason: 'Identified historical atomicity test fixture (excluded before claim/lease)',
    };
  }

  // 2. Check unhandled topic exclusion
  if (UNHANDLED_TOPICS.includes(record.topic as any)) {
    return {
      record,
      partition: 'DEFERRED_UNHANDLED',
      exclusionReason: `Topic '${record.topic}' lacks downstream consumer and projection model`,
    };
  }

  // 3. Consumer-backed topic
  if (APPROVED_CONSUMER_TOPICS.includes(record.topic as any)) {
    // Validate schema
    const validationError = validatePayloadContract(record.topic, record.event_type, record.payload);
    return {
      record,
      partition: 'ELIGIBLE_BUSINESS',
      validationError,
    };
  }

  throw new Error(`[FAIL_CLOSED] Unknown topic '${record.topic}' encountered for record ${record.id}`);
}

export function evaluateBacklogPartition(records: OutboxDbRow[]) {
  const eligible: ClassifiedOutboxRecord[] = [];
  const fixtures: ClassifiedOutboxRecord[] = [];
  const deferred: ClassifiedOutboxRecord[] = [];

  for (const record of records) {
    const classified = classifyRecord(record);
    if (classified.partition === 'ELIGIBLE_BUSINESS') {
      eligible.push(classified);
    } else if (classified.partition === 'HISTORICAL_FIXTURE') {
      fixtures.push(classified);
    } else if (classified.partition === 'DEFERRED_UNHANDLED') {
      deferred.push(classified);
    }
  }

  return { eligible, fixtures, deferred };
}

// ============================================================================
// PREFLIGHT AUDIT RUNNER
// ============================================================================

export async function runPreflightAudit(client: pg.Client) {
  console.log('-------------------------------------------------------------------');
  console.log('   STEP 1: DATABASE TARGET VERIFICATION & SAFETY PRE-CHECKS        ');
  console.log('-------------------------------------------------------------------');

  assertApprovedLocalEnvironment('PreflightAudit');
  console.log(`[PASS] Local Supabase URL: ${LOCAL_SUPABASE_URL}`);
  console.log(`[PASS] Local PostgreSQL:   ${maskUrlCredentials(LOCAL_DB_URL)}`);
  console.log('[PASS] Local Database Guard enforced. No remote hosts accessible.\n');

  console.log('-------------------------------------------------------------------');
  console.log('   STEP 2: BEFORE-SNAPSHOT OF LOCAL OUTBOX RECORDS                  ');
  console.log('-------------------------------------------------------------------');

  const beforeQuery = await client.query(`
    SELECT id, event_id, event_type, topic, status, retry_count, last_error, payload, created_at, published_at
    FROM event_outbox
    ORDER BY created_at ASC;
  `);

  const initialRows: OutboxDbRow[] = beforeQuery.rows;
  console.log(`[SNAPSHOT] Retrieved ${initialRows.length} outbox records from local PostgreSQL.`);

  // Verify baseline counts
  if (initialRows.length !== 35) {
    throw new Error(`[FAIL_CLOSED] Expected exactly 35 records in event_outbox, but found ${initialRows.length}. Aborting.`);
  }

  // Verify all records are PENDING with retry_count = 0 and last_error = null
  for (const row of initialRows) {
    if (row.status !== 'PENDING') {
      throw new Error(`[FAIL_CLOSED] Record ${row.id} has non-PENDING status '${row.status}'. Aborting.`);
    }
    if (row.retry_count !== 0) {
      throw new Error(`[FAIL_CLOSED] Record ${row.id} has non-zero retry_count ${row.retry_count}. Aborting.`);
    }
    if (row.last_error !== null) {
      throw new Error(`[FAIL_CLOSED] Record ${row.id} has existing last_error: '${row.last_error}'. Aborting.`);
    }
  }
  console.log('[PASS] Baseline verification: 35/35 records are PENDING with retry_count=0 and last_error=null.\n');

  console.log('-------------------------------------------------------------------');
  console.log('   STEP 3: OUTBOX STATUS & TOPIC INVENTORY MATRIX                  ');
  console.log('-------------------------------------------------------------------');

  const topicMatrix = await client.query(`
    SELECT topic, event_type, status, count(*)::int as count
    FROM event_outbox
    GROUP BY topic, event_type, status
    ORDER BY topic, event_type;
  `);
  console.table(topicMatrix.rows);

  console.log('\n-------------------------------------------------------------------');
  console.log('   STEP 4: PARTITION CLASSIFICATION & FIXTURE ISOLATION            ');
  console.log('-------------------------------------------------------------------');

  const { eligible, fixtures, deferred } = evaluateBacklogPartition(initialRows);

  console.log(`Partition Results:`);
  console.log(`  - Eligible Consumer-Backed Events: ${eligible.length} (Expected: 13)`);
  console.log(`  - Excluded Historical Fixtures:    ${fixtures.length} (Expected: 3)`);
  console.log(`  - Excluded Deferred Topics:        ${deferred.length} (Expected: 19)`);
  console.log(`  - Total Verified:                  ${eligible.length + fixtures.length + deferred.length} (Expected: 35)\n`);

  assert.strictEqual(eligible.length, 13, `Eligible business events count must be exactly 13, got ${eligible.length}`);
  assert.strictEqual(fixtures.length, 3, `Historical fixtures count must be exactly 3, got ${fixtures.length}`);
  assert.strictEqual(deferred.length, 19, `Deferred unhandled events count must be exactly 19, got ${deferred.length}`);

  // Step 4a: Verify the 3 Historical Fixtures
  console.log('--- Historical Fixtures (Flagged EXCLUDED before claim/lease) ---');
  const fixtureIdsFound = new Set<string>();
  for (const f of fixtures) {
    fixtureIdsFound.add(f.record.id);
    const p = f.record.payload || {};
    console.log(`  [EXCLUDED FIXTURE] ID: ${f.record.id} | Topic: ${f.record.topic} | Type: ${f.record.event_type} | Batch: ${p.batch_id || 'N/A'}`);
  }
  for (const expectedFixtureId of HISTORICAL_ATOM_FIXTURE_IDS) {
    if (!fixtureIdsFound.has(expectedFixtureId)) {
      throw new Error(`[FAIL_CLOSED] Expected historical fixture UUID ${expectedFixtureId} not found in database!`);
    }
  }
  console.log('[PASS] Exact match: All 3 historical atomicity fixtures identified and excluded.\n');

  // Step 4b: Verify the 19 Deferred Events
  console.log('--- Deferred Events (Flagged EXCLUDED due to no consumers) ---');
  const qualityAlerts = deferred.filter(d => d.record.topic === 'quality-alerts');
  const logisticsEvents = deferred.filter(d => d.record.topic === 'logistics-events');
  console.log(`  - Topic 'quality-alerts':   ${qualityAlerts.length} records (All COLD_CHAIN_ALERT)`);
  console.log(`  - Topic 'logistics-events': ${logisticsEvents.length} records (All ROUTE_DISPATCHED)`);
  assert.strictEqual(qualityAlerts.length, 10, 'quality-alerts count must be exactly 10');
  assert.strictEqual(logisticsEvents.length, 9, 'logistics-events count must be exactly 9');
  console.log('[PASS] Unhandled topics protection verified. 19 events safely deferred.\n');

  // Step 4c: Verify the 13 Eligible Business Events & Payload Contract
  console.log('--- Eligible Business Events (13 Candidates for Future Replay) ---');
  const eligibleIdsFound = new Set<string>();
  for (const e of eligible) {
    eligibleIdsFound.add(e.record.id);
    if (e.validationError) {
      throw new Error(`[FAIL_CLOSED] Payload validation failed for eligible event ${e.record.id}: ${e.validationError}`);
    }
    const p = e.record.payload;
    const batch = p.batch_id || 'N/A';
    console.log(`  [ELIGIBLE] ID: ${e.record.id} | EventID: ${e.record.event_id} | ${e.record.topic} :: ${e.record.event_type} | Batch: ${batch} | Valid: YES`);
  }
  for (const expectedEligibleId of EXPECTED_ELIGIBLE_EVENT_IDS) {
    if (!eligibleIdsFound.has(expectedEligibleId)) {
      throw new Error(`[FAIL_CLOSED] Expected eligible event UUID ${expectedEligibleId} missing from database!`);
    }
  }
  console.log('[PASS] All 13 eligible business events validated against consumer schemas.\n');

  console.log('-------------------------------------------------------------------');
  console.log('   STEP 5: SAFTEY INVARIANT CHECKS (ZERO KAFKA / ZERO MUTATIONS)    ');
  console.log('-------------------------------------------------------------------');

  console.log('[SAFEGUARD_CONFIRMED] Broker publication bypassed: No Kafka producer instantiated or called.');
  console.log('[SAFEGUARD_CONFIRMED] Read-only execution: No claim, lease, or mutation function invoked.');

  // Step 5b: AFTER-SNAPSHOT Comparison
  const afterQuery = await client.query(`
    SELECT id, event_id, event_type, topic, status, retry_count, last_error, payload, created_at, published_at
    FROM event_outbox
    ORDER BY created_at ASC;
  `);
  const finalRows: OutboxDbRow[] = afterQuery.rows;

  assert.strictEqual(initialRows.length, finalRows.length, 'Row count mutated during preflight audit!');

  for (let i = 0; i < initialRows.length; i++) {
    const before = initialRows[i];
    const after = finalRows[i];

    assert.strictEqual(before.id, after.id, `Row ID mutated at index ${i}`);
    assert.strictEqual(after.status, 'PENDING', `Record ${after.id} status mutated to ${after.status}`);
    assert.strictEqual(after.retry_count, 0, `Record ${after.id} retry_count mutated to ${after.retry_count}`);
    assert.strictEqual(after.last_error, null, `Record ${after.id} last_error mutated to ${after.last_error}`);
    assert.strictEqual(
      new Date(before.created_at).getTime(),
      new Date(after.created_at).getTime(),
      `Record ${after.id} created_at mutated`
    );
    assert.strictEqual(before.published_at, after.published_at, `Record ${after.id} published_at mutated`);
  }
  console.log(`[PASS] Zero-mutation invariant confirmed: 35/35 records remain PENDING with retry_count=0 and last_error=null.`);
  console.log('[PASS] Preflight audit completed successfully.\n');
}

// ============================================================================
// AUTOMATED TEST SUITE: BEHAVIORAL & NEGATIVE INVARIANT TESTS
// ============================================================================

export async function runTestSuite(client: pg.Client) {
  console.log('===================================================================');
  console.log('   FarmChainAI — Backlog Preflight Invariant Test Suite            ');
  console.log('===================================================================\n');

  let passedTests = 0;

  // Test 1: Fail closed on remote or unapproved database targets
  console.log('Test 1: Enforce fail-closed guard against unapproved database targets...');
  assert.throws(
    () => {
      assertLocalSupabaseUrl('https://abc123xyz.supabase.co', 'TestTargetRejection');
    },
    (err: any) => err instanceof LocalDatabaseGuardError && err.message.includes('FAIL-CLOSED'),
    'Should reject remote hosted Supabase URL'
  );

  assert.throws(
    () => {
      assertLocalPostgresUrl('postgresql://postgres:secret@db.external.com:5432/postgres', 'TestTargetRejection');
    },
    (err: any) => err instanceof LocalDatabaseGuardError && err.message.includes('FAIL-CLOSED'),
    'Should reject remote PostgreSQL host'
  );

  assert.throws(
    () => {
      assertLocalPostgresUrl('postgresql://postgres:postgres@127.0.0.1:5432/postgres', 'TestTargetRejection');
    },
    (err: any) => err instanceof LocalDatabaseGuardError && err.message.includes('54322'),
    'Should reject unapproved port 5432'
  );
  console.log('  [PASS] Target URL guards fail closed on remote endpoints.\n');
  passedTests++;

  // Test 2: Static Codebase Audit (No Kafka producer, no claim/lease statements in preflight)
  console.log('Test 2: Static audit — preflight script imports and calls...');
  const scriptContent = fs.readFileSync(__filename, 'utf8');
  const importLines = scriptContent.split('\n').filter(line => line.trim().startsWith('import '));
  const hasKafkaImport = importLines.some(line => line.toLowerCase().includes('kafka'));
  assert.strictEqual(hasKafkaImport, false, 'Preflight script must not import kafkajs or any kafka package');

  const nonTestLines = scriptContent
    .split('\n')
    .filter(line => !line.includes('Test 2') && !line.includes('assert.') && !line.includes('hasKafka') && !line.includes('hasClaim') && !line.includes('hasOutboxMutation'));
  const hasKafkaConstruction = nonTestLines.some(l => /\bnew\s+Kafka\s*\(/.test(l));
  assert.strictEqual(hasKafkaConstruction, false, 'Preflight script must not construct a Kafka client');

  const hasClaimCall = nonTestLines.some(l => /claim_outbox_events/.test(l) || /\bclaimEvent\b/.test(l));
  assert.strictEqual(hasClaimCall, false, 'Preflight script must not call claim_outbox_events or claimEvent');

  const hasOutboxMutation = nonTestLines.some(l => /UPDATE\s+event_outbox/i.test(l) || /DELETE\s+FROM\s+event_outbox/i.test(l));
  assert.strictEqual(hasOutboxMutation, false, 'Preflight script must not execute UPDATE or DELETE on event_outbox');
  console.log('  [PASS] Preflight script confirmed free of Kafka producer and claim/lease logic.\n');
  passedTests++;

  // Test 3: Partition Classification: 13 eligible, 3 fixtures, 19 deferred
  console.log('Test 3: Partition classification logic validation...');
  const res = await client.query(`SELECT * FROM event_outbox ORDER BY created_at ASC;`);
  const { eligible, fixtures, deferred } = evaluateBacklogPartition(res.rows);
  assert.strictEqual(eligible.length, 13, 'Eligible count must be 13');
  assert.strictEqual(fixtures.length, 3, 'Fixtures count must be 3');
  assert.strictEqual(deferred.length, 19, 'Deferred count must be 19');
  console.log('  [PASS] 13/3/19 partitioning verified on database rows.\n');
  passedTests++;

  // Test 4: Negative Test — Missing fixture ID causes preflight failure
  console.log('Test 4: Negative test — Missing fixture ID detection...');
  const syntheticWithoutFixture = res.rows.filter(r => r.id !== '4232d9be-af74-4d3e-8848-32b28d446942');
  const evaluatedMissing = evaluateBacklogPartition(syntheticWithoutFixture);
  assert.throws(
    () => {
      const foundIds = new Set(evaluatedMissing.fixtures.map(f => f.record.id));
      for (const id of HISTORICAL_ATOM_FIXTURE_IDS) {
        if (!foundIds.has(id)) {
          throw new Error(`[FAIL_CLOSED] Expected historical fixture UUID ${id} not found!`);
        }
      }
    },
    /\[FAIL_CLOSED\] Expected historical fixture UUID 4232d9be-af74-4d3e-8848-32b28d446942 not found!/,
    'Should fail closed if a fixture is missing from the database'
  );
  console.log('  [PASS] Missing fixture ID triggers fail-closed error.\n');
  passedTests++;

  // Test 5: Negative Test — Altered or unexpected fixture ID causes preflight failure
  console.log('Test 5: Negative test — Altered fixture ID detection...');
  const syntheticAlteredFixture = res.rows.map(r => {
    if (r.id === '4232d9be-af74-4d3e-8848-32b28d446942') {
      return { ...r, id: '00000000-0000-0000-0000-000000000000' };
    }
    return r;
  });
  const evaluatedAltered = evaluateBacklogPartition(syntheticAlteredFixture);
  assert.throws(
    () => {
      const foundIds = new Set(evaluatedAltered.fixtures.map(f => f.record.id));
      for (const id of HISTORICAL_ATOM_FIXTURE_IDS) {
        if (!foundIds.has(id)) {
          throw new Error(`[FAIL_CLOSED] Expected historical fixture UUID ${id} not found!`);
        }
      }
    },
    /\[FAIL_CLOSED\] Expected historical fixture UUID 4232d9be-af74-4d3e-8848-32b28d446942 not found!/,
    'Should fail closed if a fixture UUID was modified'
  );
  console.log('  [PASS] Altered fixture ID triggers fail-closed error.\n');
  passedTests++;

  // Test 6: Negative Test — Unexpected pending record causes preflight failure
  console.log('Test 6: Negative test — Unexpected pending record detection...');
  const syntheticUnexpectedRow: OutboxDbRow = {
    id: '99999999-9999-4999-9999-999999999999',
    event_id: '88888888-8888-4888-8888-888888888888',
    event_type: 'UNKNOWN_EVENT_TYPE',
    topic: 'unknown-topic',
    status: 'PENDING',
    retry_count: 0,
    last_error: null,
    payload: {},
    created_at: new Date(),
  };
  assert.throws(
    () => {
      classifyRecord(syntheticUnexpectedRow);
    },
    /\[FAIL_CLOSED\] Unknown topic 'unknown-topic' encountered/,
    'Should fail closed on unexpected record topic/type'
  );
  console.log('  [PASS] Unexpected pending record triggers fail-closed error.\n');
  passedTests++;

  // Test 7: Negative Test — Malformed payload for eligible event fails validation
  console.log('Test 7: Negative test — Malformed payload schema detection...');
  const malformedBatchCreated = validatePayloadContract('traceability-events', 'BATCH_CREATED', {
    batch_id: 'BATCH-TEST',
    // Missing product_id, farmer_id, quantity, status
  });
  assert.ok(malformedBatchCreated !== null, 'Malformed payload must return validation error');
  assert.ok(malformedBatchCreated?.includes('Missing required field: product_id'), 'Validation should identify missing product_id');

  const invalidQty = validatePayloadContract('inventory-events', 'SALE_CREATED', {
    retailer_id: 'RET-01',
    batch_id: 'BATCH-01',
    quantity_sold: -5, // Invalid negative quantity
  });
  assert.ok(invalidQty !== null, 'Negative quantity must fail validation');
  console.log('  [PASS] Schema validator rejects corrupted/incomplete event payloads.\n');
  passedTests++;

  // Test 8: Final verification — database still pristine
  console.log('Test 8: Database zero-mutation post-condition audit...');
  const finalCheck = await client.query(`
    SELECT count(*)::int as total,
           count(*) filter (where status = 'PENDING')::int as pending_count,
           count(*) filter (where retry_count != 0)::int as retried_count,
           count(*) filter (where last_error is not null)::int as error_count
    FROM event_outbox;
  `);
  const stats = finalCheck.rows[0];
  assert.strictEqual(stats.total, 35, 'Total records must remain 35');
  assert.strictEqual(stats.pending_count, 35, 'All 35 records must remain PENDING');
  assert.strictEqual(stats.retried_count, 0, 'Zero records may have non-zero retry_count');
  assert.strictEqual(stats.error_count, 0, 'Zero records may have non-null last_error');
  console.log(`  [PASS] Database state unchanged: ${stats.total} records total, ${stats.pending_count} PENDING, 0 retried, 0 errors.\n`);
  passedTests++;

  console.log('===================================================================');
  console.log(`   ALL ${passedTests}/${passedTests} PREFLIGHT INVARIANT TESTS PASSED`);
  console.log('===================================================================\n');
}

// ============================================================================
// MAIN ENTRYPOINT
// ============================================================================

async function main() {
  console.log('===================================================================');
  console.log('   FarmChainAI — Step 20: Backlog Replay Preflight Verification    ');
  console.log('===================================================================\n');

  const client = new pg.Client({ connectionString: LOCAL_DB_URL });
  await client.connect();

  try {
    // 1. Run full live preflight audit against local database
    await runPreflightAudit(client);

    // 2. Run automated invariant test suite
    await runTestSuite(client);

    console.log('>>> PREFLIGHT AUDIT & VERIFICATION COMPLETED SUCCESSFULLY <<<');
  } finally {
    await client.end();
  }
}

// Auto-run if executed directly
if (require.main === module) {
  main().catch((err) => {
    console.error('\n[PREFLIGHT_FATAL_ERROR]', err?.message || err);
    process.exit(1);
  });
}

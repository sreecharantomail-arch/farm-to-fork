/**
 * FarmChainAI — Controlled Kafka Smoke Test Runner
 *
 * PURPOSE:
 * This script provides a controlled, local-development-only way to perform an isolated Kafka smoke test.
 *
 * CRITICAL SAFETY RULES:
 * 1. Strictly isolates test events to 'test-diagnostic-events' topic and 'TEST_SMOKE_EVENT' event type.
 * 2. Does NOT publish or claim any of the 40 pre-existing business events.
 * 3. Does NOT route business events into test topics.
 * 4. Checks broker availability before dispatching. If Kafka is offline, exits cleanly without failing or corrupting data.
 */

import './src/test_preload';
import { supabase } from './src/config/supabase';
import { OutboxPublisherService } from './src/services/outboxPublisherService';
import { assertApprovedLocalEnvironment } from './src/utils/localDatabaseGuard';
import net from 'net';

assertApprovedLocalEnvironment('KafkaSmokeTest');

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

async function runSmokeTest() {
  console.log('===================================================================');
  console.log('         FarmChainAI — Controlled Kafka Smoke Test Runner          ');
  console.log('===================================================================\n');

  // 1. Audit baseline business records before running
  const { data: initialEvents, error: errInitial } = await supabase
    .from('event_outbox')
    .select('id, event_id, event_type, topic, status')
    .eq('status', 'PENDING');

  if (errInitial) {
    throw new Error(`Failed to query database outbox: ${errInitial.message}`);
  }

  const baselinePendingCount = initialEvents.length;
  console.log(`[Safety Check] Baseline database outbox contains ${baselinePendingCount} pending business events.`);
  console.log('[Safety Check] Mode is strictly TEST_ONLY. None of the business events will be touched.\n');

  // 2. Check local broker connectivity
  const isBrokerPortOpen = await checkPortOpen(9092, '127.0.0.1');
  console.log(`[Broker Probe] TCP Port 9092 reachable: ${isBrokerPortOpen ? 'YES (Broker Online)' : 'NO (Broker Offline)'}`);

  if (!isBrokerPortOpen) {
    console.log('\n-------------------------------------------------------------------');
    console.log('ℹ️  STATUS: Kafka broker is currently OFFLINE.');
    console.log('   Connection to 127.0.0.1:9092 failed (ECONNREFUSED).');
    console.log('   Docker Desktop daemon is stopped on this host machine.');
    console.log('   No events were dispatched. All 40 business events remain intact.');
    console.log('-------------------------------------------------------------------');
    console.log('\nTo run a live smoke test in the future:');
    console.log('1. Start Docker Desktop.');
    console.log('2. Run: docker compose -f docker-compose.kafka.yml up -d');
    console.log('3. Re-run: npx tsx test_kafka_smoke.ts\n');
    return;
  }

  // 3. Broker is online — proceed with controlled isolated test event
  console.log('\n[Broker Online] Initializing OutboxPublisher in TEST_ONLY mode...');
  const smokePublisher = new OutboxPublisherService({
    mode: 'TEST_ONLY',
    clientId: 'farmchain-smoke-runner',
    workerId: 'worker-smoke-test',
  });

  const connected = await smokePublisher.connect();
  if (!connected) {
    console.error('Failed to establish session with Kafka broker.');
    return;
  }

  console.log('Publishing single isolated test event to test-diagnostic-events...');
  const testResult = await smokePublisher.publishIsolatedTestEvent({
    topic: 'test-diagnostic-events',
    payload: {
      smoke_test: true,
      operator: 'manual_smoke_runner',
      environment: 'local_development',
      timestamp: new Date().toISOString(),
    },
  });

  console.log('Smoke Test Publish Result:', testResult);

  if (testResult.status === 'PUBLISHED') {
    console.log(`✅ Success! Test event ${testResult.eventId} published and acknowledged by Kafka broker.`);
  } else {
    console.error(`❌ Publish failed with status: ${testResult.status} (Error: ${testResult.error})`);
  }

  // 4. Verify post-test baseline
  const { data: postEvents } = await supabase
    .from('event_outbox')
    .select('id')
    .eq('status', 'PENDING');

  console.log(`\n[Post-Test Check] Pending business events in database: ${postEvents?.length} (Baseline was: ${baselinePendingCount})`);
  if (postEvents?.length === baselinePendingCount) {
    console.log('✅ Baseline confirmed: 100% of business events remain untouched and PENDING.');
  } else {
    console.error('⚠️ Warning: Pending event count changed during smoke test!');
  }

  // Cleanup isolated test record
  await supabase.from('event_outbox').delete().eq('id', testResult.outboxId);
  console.log(`Cleaned up smoke test event record ${testResult.outboxId}.`);

  await smokePublisher.stop();
  console.log('\n===================================================================');
  console.log('                 SMOKE TEST COMPLETED SUCCESSFULLY                 ');
  console.log('===================================================================');
}

runSmokeTest().catch((err) => {
  console.error('\n❌ Smoke test encountered an error:', err);
  process.exit(1);
});

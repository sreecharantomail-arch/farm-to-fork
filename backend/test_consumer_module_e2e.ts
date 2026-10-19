import './src/test_preload';
import assert from 'node:assert';
import { blockchainService, BlockchainStatus } from './src/services/blockchainService';
import { ethers } from 'ethers';

const BASE_URL = 'http://localhost:5000/api';

async function runConsumerModuleTests() {
  console.log('====================================================');
  console.log('   FARMCHAINAI CONSUMER MODULE E2E TEST SUITE');
  console.log('====================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  const test = async (name: string, fn: () => Promise<void>) => {
    totalTests++;
    try {
      await fn();
      passedTests++;
      console.log(`[PASS] Test ${totalTests}: ${name}`);
    } catch (err: any) {
      console.error(`[FAIL] Test ${totalTests}: ${name}`);
      console.error('       Error:', err.message);
    }
  };

  // 1. Public Unauthenticated Access
  await test('Public unauthenticated access is permitted without auth tokens', async () => {
    const res = await fetch(`${BASE_URL}/products/blockchain/286958`);
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.success, true);
    assert.ok(json.data);
  });

  // 2. Search by Numeric Product ID
  await test('Search resolves numeric product_id (286958)', async () => {
    const res = await fetch(`${BASE_URL}/products/blockchain/286958`);
    const json = await res.json();
    assert.strictEqual(json.success, true);
    assert.strictEqual(json.data.name, 'Test Apples 3B');
    assert.strictEqual(json.data.product_id, 286958);
  });

  // 3. Search by FP- prefix
  await test('Search resolves formatted "FP-286958"', async () => {
    const res = await fetch(`${BASE_URL}/products/blockchain/FP-286958`);
    const json = await res.json();
    assert.strictEqual(json.success, true);
    assert.strictEqual(json.data.name, 'Test Apples 3B');
  });

  // 4. Search by Batch Number
  await test('Search resolves batch number string (BATCH-1791655578385)', async () => {
    const res = await fetch(`${BASE_URL}/products/blockchain/BATCH-1791655578385`);
    const json = await res.json();
    assert.strictEqual(json.success, true);
    assert.strictEqual(json.data.batch_number, 'BATCH-1791655578385');
  });

  // 5. Search by Processed Batch Number
  await test('Search resolves processed child batch (PB-5E53E4F3)', async () => {
    const res = await fetch(`${BASE_URL}/products/blockchain/PB-5E53E4F3`);
    const json = await res.json();
    assert.strictEqual(json.success, true);
    assert.strictEqual(json.data.name, 'Apple Juice');
    assert.strictEqual(json.data.batch_number, 'PB-5E53E4F3');
  });

  // 6. Search by UUID Primary Key
  await test('Search resolves UUID primary key (8d877bf1-f895-4280-aff0-0f5145bec8e9)', async () => {
    const res = await fetch(`${BASE_URL}/products/blockchain/8d877bf1-f895-4280-aff0-0f5145bec8e9`);
    const json = await res.json();
    assert.strictEqual(json.success, true);
    assert.strictEqual(json.data.id, '8d877bf1-f895-4280-aff0-0f5145bec8e9');
  });

  // 7. Search by Shipment Tracking ID
  await test('Search resolves shipment tracking ID (TRK-1791655578726)', async () => {
    const res = await fetch(`${BASE_URL}/products/blockchain/TRK-1791655578726`);
    const json = await res.json();
    assert.strictEqual(json.success, true);
    assert.strictEqual(json.data.name, 'Test Apples 3B');
  });

  // 8. Search by Scanned QR Tracking URL
  await test('Search parses full scanned QR URL (http://localhost:5173/track?id=PB-5E53E4F3)', async () => {
    const targetUrl = 'http://localhost:5173/track?id=PB-5E53E4F3';
    const res = await fetch(`${BASE_URL}/products/blockchain/${encodeURIComponent(targetUrl)}`);
    const json = await res.json();
    assert.strictEqual(json.success, true);
    assert.strictEqual(json.data.batch_number, 'PB-5E53E4F3');
  });

  // 9. Invalid Identifier Handling
  await test('Search returns safe 404 for non-existent identifier', async () => {
    const res = await fetch(`${BASE_URL}/products/blockchain/NON_EXISTENT_IDENTIFIER_XYZ`);
    assert.strictEqual(res.status, 404);
    const json = await res.json();
    assert.strictEqual(json.success, false);
    assert.strictEqual(json.message, 'Product not found');
  });

  // 10. Chronological Order of Traceability Events
  await test('Traceability events are returned in strict chronological order', async () => {
    const res = await fetch(`${BASE_URL}/products/blockchain/PB-5E53E4F3`);
    const json = await res.json();
    assert.ok(json.data.events && json.data.events.length > 0);
    const events = json.data.events;
    for (let i = 1; i < events.length; i++) {
      const prevTime = new Date(events[i - 1].created_at).getTime();
      const currTime = new Date(events[i].created_at).getTime();
      assert.ok(prevTime <= currTime, `Events must be chronological: ${prevTime} <= ${currTime}`);
    }
  });

  // 11. Parent-Child Lineage Resolution
  await test('Processed product resolves parent batch lineage', async () => {
    const res = await fetch(`${BASE_URL}/products/blockchain/PB-5E53E4F3`);
    const json = await res.json();
    assert.ok(json.data.lineage, 'Lineage must be present in response');
    assert.ok(json.data.lineage.length > 0, 'Lineage must have parent entries for processed product');
    const firstLineage = json.data.lineage[0];
    assert.ok(firstLineage.parent, 'Parent details must be attached');
    assert.ok(firstLineage.parent.batch_number, 'Parent batch number must be present');
    assert.ok(firstLineage.processing_action, 'Processing action must be recorded');
  });

  // 12. Public Response Data Privacy and Sanitization
  await test('Public response does not expose private passwords, emails, or credentials', async () => {
    const res = await fetch(`${BASE_URL}/products/blockchain/286958`);
    const json = await res.json();
    const dataStr = JSON.stringify(json.data);

    assert.strictEqual(dataStr.includes('password'), false, 'Must not leak passwords');
    assert.strictEqual(dataStr.includes('token'), false, 'Must not leak auth tokens');
    assert.strictEqual(dataStr.includes('service_role'), false, 'Must not leak service role key');

    // Check actor object in events
    if (json.data.events && json.data.events.length > 0) {
      for (const evt of json.data.events) {
        if (evt.actor) {
          assert.strictEqual(evt.actor.email, undefined, 'Must not leak actor email in public responses');
          assert.ok(evt.actor.name, 'Safe actor name should be present');
          assert.ok(evt.actor.role, 'Safe actor role should be present');
        }
      }
    }
  });

  // 13. Blockchain Verification Accuracy (On-Chain Confirmed)
  await test('Blockchain verification reports VERIFIED_ON_CHAIN for registered product', async () => {
    const prodId = '8d877bf1-f895-4280-aff0-0f5145bec8e9';
    const res = await fetch(`${BASE_URL}/products/blockchain/${prodId}`);
    const json = await res.json();
    assert.ok(json.data.blockchain_verification);
    assert.strictEqual(json.data.blockchain_verification.status, 'VERIFIED_ON_CHAIN');
    assert.strictEqual(json.data.blockchain_verification.isConfigured, true);
    assert.ok(json.data.blockchain_verification.chainData);
    assert.strictEqual(json.data.blockchain_verification.chainData.batchNumber, 'BATCH-1791655578385');
  });

  // 14. Blockchain Verification Accuracy (Unregistered Product)
  await test('Blockchain verification reports NOT_ON_CHAIN for unregistered product', async () => {
    const prodId = 'fe5f029d-365b-46d4-bcbe-5e9c7595424f';
    const res = await fetch(`${BASE_URL}/products/blockchain/${prodId}`);
    const json = await res.json();
    assert.ok(json.data.blockchain_verification);
    assert.strictEqual(json.data.blockchain_verification.status, 'NOT_ON_CHAIN');
  });

  // 15. Blockchain Unavailability Resilience
  await test('Blockchain service handles RPC offline gracefully without crashing', async () => {
    // Call verifyProduct with a dummy unreachable RPC
    const dummyProvider = new ethers.JsonRpcProvider('http://127.0.0.1:19999'); // offline port
    const origProvider = (blockchainService as any).provider;
    (blockchainService as any).provider = dummyProvider;

    const offlineResult = await blockchainService.verifyProduct('8d877bf1-f895-4280-aff0-0f5145bec8e9');
    assert.strictEqual(offlineResult.status, 'BLOCKCHAIN_UNAVAILABLE');
    assert.ok(offlineResult.message.includes('unavailable'));

    // Restore provider
    (blockchainService as any).provider = origProvider;
  });

  // 16. Traceability History Completeness Indicator
  await test('Traceability completeness is honestly calculated', async () => {
    const res = await fetch(`${BASE_URL}/products/blockchain/PB-5E53E4F3`);
    const json = await res.json();
    assert.ok(json.data.history_completeness);
    assert.strictEqual(typeof json.data.history_completeness.is_complete, 'boolean');
    assert.ok(json.data.history_completeness.notice);
  });

  // 17. Logistics & Cold-Chain Summary Presence
  await test('Cold-chain summary structure is present and sanitized', async () => {
    const res = await fetch(`${BASE_URL}/products/blockchain/286958`);
    const json = await res.json();
    assert.ok(json.data.cold_chain_summary);
    assert.strictEqual(typeof json.data.cold_chain_summary.monitored, 'boolean');
  });

  console.log('\n====================================================');
  console.log(`  E2E SUMMARY: ${passedTests}/${totalTests} TESTS PASSED`);
  console.log('====================================================\n');

  if (passedTests === totalTests) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runConsumerModuleTests().catch(err => {
  console.error('Fatal Test Suite Error:', err);
  process.exit(1);
});

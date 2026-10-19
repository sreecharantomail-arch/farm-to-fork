import './src/test_preload';
import { assertApprovedLocalEnvironment } from './src/utils/localDatabaseGuard';

assertApprovedLocalEnvironment('TestBlockchainSigningVerification');

import { blockchainService, BlockchainStatus } from './src/services/blockchainService';
import crypto from 'crypto';

async function runBlockchainSigningVerification() {
  console.log('===============================================================');
  console.log('   FARMCHAINAI — BLOCKCHAIN SIGNING & VERIFICATION SUITE      ');
  console.log('===============================================================\n');

  try {
    // -------------------------------------------------------------------------
    // 1. HEALTH CHECK: Verify dynamic signer resolution on local development node
    // -------------------------------------------------------------------------
    console.log('1. Checking Blockchain Health & Dynamic Signer Resolution...');
    const health = await blockchainService.getHealth();
    console.log('   Health Status:', health.status);
    console.log('   Message:', health.message);
    console.log('   Signer Address:', (health as any).walletAddress);
    console.log('   Wallet Balance:', (health as any).walletBalance, 'ETH');
    console.log('   Network:', (health as any).network);
    console.log('   Contract Address:', (health as any).contractAddress);

    if (health.status !== 'healthy') {
      throw new Error(`Expected health status 'healthy', got '${health.status}': ${health.message}`);
    }
    if (!(health as any).walletAddress || !(health as any).walletAddress.startsWith('0x')) {
      throw new Error('Signer address was not resolved from local development node');
    }
    console.log('   ✓ Local development signer successfully resolved via unlocked account!\n');

    // -------------------------------------------------------------------------
    // 2. READ-ONLY CONTRACT CALL: Safe view query on non-existent fixture
    // -------------------------------------------------------------------------
    console.log('2. Testing Safe Read-Only Contract Call (verifyProduct on non-existent product)...');
    const nonExistentId = `probe-nonexistent-${crypto.randomUUID()}`;
    const readResult = await blockchainService.verifyProduct(nonExistentId);
    console.log('   Read Status:', readResult.status);
    console.log('   Message:', readResult.message);
    console.log('   Contract Address:', readResult.contractAddress);

    if (readResult.status !== 'NOT_ON_CHAIN') {
      throw new Error(`Expected NOT_ON_CHAIN for non-existent product, got ${readResult.status}`);
    }
    console.log('   ✓ Safe read-only call successfully queried smart contract views without error.\n');

    // -------------------------------------------------------------------------
    // 3. WRITE TRANSACTION: Register isolated test product
    // -------------------------------------------------------------------------
    console.log('3. Testing Isolated Write Transaction (registerProduct)...');
    const testProductId = `isolated-test-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const testProductName = 'Autonomous Test Crop';
    const testBatchNumber = `BATCH-${Date.now()}`;
    const testQuantity = 250;

    const regResult = await blockchainService.registerProduct(
      testProductId,
      testProductName,
      'Vegetables',
      testBatchNumber,
      testQuantity,
      'Harvested'
    );
    console.log('   Register Status:', regResult.status);
    console.log('   Tx Hash:', regResult.txHash);
    console.log('   Mined in Block:', regResult.blockNumber);

    if (regResult.status !== BlockchainStatus.ON_CHAIN_CONFIRMED) {
      throw new Error(`Write transaction failed: ${regResult.error || 'Unknown error'}`);
    }
    if (!regResult.txHash || !regResult.txHash.startsWith('0x')) {
      throw new Error('Valid transaction hash was not returned');
    }
    console.log('   ✓ Write transaction successfully signed, broadcast, and mined on local chain!\n');

    // -------------------------------------------------------------------------
    // 4. READ-AFTER-WRITE INTEGRITY CHECK: Verify product on-chain state
    // -------------------------------------------------------------------------
    console.log('4. Testing Read-After-Write Verification (verifyProduct)...');
    const verifyResult = await blockchainService.verifyProduct(testProductId, {
      name: testProductName,
      batchNumber: testBatchNumber
    });
    console.log('   Verification Status:', verifyResult.status);
    console.log('   Chain Data Product:', verifyResult.chainData?.name);
    console.log('   Chain Data Current Owner:', verifyResult.chainData?.currentOwner);
    console.log('   Chain Data Quantity:', verifyResult.chainData?.quantity);

    if (verifyResult.status !== 'VERIFIED_ON_CHAIN') {
      throw new Error(`Expected VERIFIED_ON_CHAIN, got ${verifyResult.status}`);
    }
    if (verifyResult.chainData?.name !== testProductName) {
      throw new Error(`Product name mismatch: expected ${testProductName}, got ${verifyResult.chainData?.name}`);
    }
    console.log('   ✓ On-chain record matches registered fixture data with 100% fidelity!\n');

    // -------------------------------------------------------------------------
    // 5. STAGE UPDATE TRANSACTION: Mutate stage on-chain
    // -------------------------------------------------------------------------
    console.log('5. Testing Update Stage Write Transaction (updateStage)...');
    const updateResult = await blockchainService.updateStage(
      testProductId,
      'In Transit',
      'Dispatched with temperature logger'
    );
    console.log('   Update Status:', updateResult.status);
    console.log('   Tx Hash:', updateResult.txHash);

    if (updateResult.status !== BlockchainStatus.ON_CHAIN_CONFIRMED) {
      throw new Error(`updateStage failed: ${updateResult.error}`);
    }
    console.log('   ✓ Stage update transaction confirmed on-chain!\n');

    // -------------------------------------------------------------------------
    // 6. RECORD RECEIPT TRANSACTION: Record receipt event on-chain
    // -------------------------------------------------------------------------
    console.log('6. Testing Record Receipt Write Transaction (recordReceipt)...');
    const receiptResult = await blockchainService.recordReceipt(testProductId);
    console.log('   Receipt Status:', receiptResult.status);
    console.log('   Tx Hash:', receiptResult.txHash);

    if (receiptResult.status !== BlockchainStatus.ON_CHAIN_CONFIRMED) {
      throw new Error(`recordReceipt failed: ${receiptResult.error}`);
    }
    console.log('   ✓ Receipt transaction confirmed on-chain!\n');

    // -------------------------------------------------------------------------
    // 7. REJECTED TRANSACTION HANDLING: Test duplicate registration rejection
    // -------------------------------------------------------------------------
    console.log('7. Testing Rejection Handling (Duplicate Registration)...');
    const dupResult = await blockchainService.registerProduct(
      testProductId,
      testProductName,
      'Vegetables',
      testBatchNumber,
      testQuantity,
      'Harvested'
    );
    console.log('   Duplicate Register Status:', dupResult.status);
    console.log('   Rejection Error:', dupResult.error);

    if (dupResult.status === BlockchainStatus.ON_CHAIN_CONFIRMED) {
      throw new Error('Duplicate registration should have been rejected by contract!');
    }
    if (dupResult.status !== BlockchainStatus.ON_CHAIN_VERIFICATION_FAILED) {
      throw new Error(`Expected ON_CHAIN_VERIFICATION_FAILED, got ${dupResult.status}`);
    }
    console.log('   ✓ Smart contract revert caught and surfaced safely with error reason!\n');

    // -------------------------------------------------------------------------
    // 8. MISSING SIGNER / UNCONFIGURED HANDLING: Test explicit fail-safe
    // -------------------------------------------------------------------------
    console.log('8. Testing Missing Signer / Unconfigured Reporting...');
    // Temporarily point to a non-existent provider to verify fail-safe behavior
    const originalProvider = (blockchainService as any).provider;
    const originalConfigured = blockchainService.isConfigured;

    (blockchainService as any).provider = null;
    blockchainService.isConfigured = false;

    const unconfResult = await blockchainService.registerProduct(
      'unconfigured-probe',
      'Probe',
      'Test',
      'BATCH',
      10,
      'Harvested'
    );
    console.log('   Unconfigured Write Status:', unconfResult.status);
    console.log('   Unconfigured Error message:', unconfResult.error);

    if (unconfResult.status !== BlockchainStatus.NOT_CONFIGURED) {
      throw new Error(`Expected NOT_CONFIGURED, got ${unconfResult.status}`);
    }

    // Restore provider
    (blockchainService as any).provider = originalProvider;
    blockchainService.isConfigured = originalConfigured;
    console.log('   ✓ Missing signer/offline network explicitly and safely reported as NOT_CONFIGURED!\n');

    console.log('===============================================================');
    console.log('   ALL BLOCKCHAIN SIGNING & VERIFICATION TESTS PASSED (100%)  ');
    console.log('===============================================================');
  } catch (err: any) {
    console.error('\n❌ Test encountered an error:', err);
    process.exit(1);
  }
}

runBlockchainSigningVerification();

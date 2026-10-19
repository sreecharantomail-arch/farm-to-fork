import './src/test_preload';
import { assertApprovedLocalEnvironment } from './src/utils/localDatabaseGuard';

assertApprovedLocalEnvironment('TestBlockchain');

import dotenv from 'dotenv';
dotenv.config();
assertApprovedLocalEnvironment('TestBlockchain');

import { blockchainService, BlockchainStatus } from './src/services/blockchainService';
import crypto from 'crypto';

async function testBlockchainService() {
  process.env.BLOCKCHAIN_RPC_URL = 'http://127.0.0.1:8545';
  process.env.BLOCKCHAIN_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  process.env.CONTRACT_ADDRESS = '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9';
  
  // Re-initialize with new env vars
  blockchainService['initialize']();

  console.log("=== Testing Blockchain Service (Phase 8C) ===");

  // 1. Blockchain not configured
  console.log("\n1. Testing Blockchain not configured...");
  process.env.BLOCKCHAIN_RPC_URL = '';
  blockchainService['initialize']();
  const unconfResult = await blockchainService.registerProduct(crypto.randomUUID(), "Test", "Cat", "BATCH-X", 10, "Harvested");
  console.log("Not Configured Result:", unconfResult);
  if (unconfResult.status !== BlockchainStatus.NOT_CONFIGURED) {
    console.error("Failed NOT_CONFIGURED test.");
    process.exit(1);
  }

  // Restore env vars
  process.env.BLOCKCHAIN_RPC_URL = 'http://127.0.0.1:8545';
  blockchainService['initialize']();

  console.log("=== Testing Blockchain Service ===");
  const health = await blockchainService.getHealth();
  console.log("Health:", health);

  if (health.status !== 'healthy') {
    console.error("Blockchain is not healthy. Exiting.");
    process.exit(1);
  }

  const productId = crypto.randomUUID();
  console.log(`\nTesting with Product ID: ${productId}`);

  console.log("1. Testing registerProduct...");
  const regResult = await blockchainService.registerProduct(
    productId,
    "Test Tomato",
    "Vegetables",
    "BATCH-100",
    50,
    "Harvested"
  );
  console.log("Register Result:", regResult);

  if (regResult.status !== BlockchainStatus.ON_CHAIN_CONFIRMED) {
    console.error("Failed to register product.");
    process.exit(1);
  }

  console.log("\n2. Testing duplicate registerProduct (should fail)...");
  const dupResult = await blockchainService.registerProduct(
    productId,
    "Test Tomato",
    "Vegetables",
    "BATCH-100",
    50,
    "Harvested"
  );
  console.log("Duplicate Register Result:", dupResult);
  if (dupResult.status === BlockchainStatus.ON_CHAIN_CONFIRMED) {
    console.error("Duplicate registration succeeded, which is bad!");
    process.exit(1);
  } else {
    console.log("Duplicate registration correctly failed.");
  }

  console.log("\n3. Testing updateStage...");
  const updateResult = await blockchainService.updateStage(productId, "Processed", "Extra Info");
  console.log("Update Result:", updateResult);

  console.log("\n4. Testing recordReceipt...");
  const receiptResult = await blockchainService.recordReceipt(productId);
  console.log("Receipt Result:", receiptResult);

  console.log("\nBlockchain Integration Test Passed.");
  process.exit(0);
}

testBlockchainService().catch(err => {
  console.error("Unhandled error:", err);
  process.exit(1);
});

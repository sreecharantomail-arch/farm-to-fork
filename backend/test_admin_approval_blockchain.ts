import './src/test_preload';
import { assertApprovedLocalEnvironment } from './src/utils/localDatabaseGuard';

assertApprovedLocalEnvironment('TestAdminApprovalBlockchain');

import axios from 'axios';
import { supabase } from './src/config/supabase';
import { blockchainService } from './src/services/blockchainService';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(__dirname, '.env') });
assertApprovedLocalEnvironment('TestAdminApprovalBlockchain');

const API_URL = 'http://localhost:5000/api';

import jwt from 'jsonwebtoken';

async function testAdminApprovalBlockchain() {
  console.log('===============================================================');
  console.log('   FARMCHAINAI — ADMIN APPROVAL BLOCKCHAIN REGISTRATION TEST   ');
  console.log('===============================================================\n');

  const createdUserIds: string[] = [];
  const createdProductIds: string[] = [];

  try {
    // 1. Create Farmer & Admin test users directly in DB to bypass login rate limiter
    console.log('1. Setting up test accounts...');
    const timestamp = Date.now();
    const farmerEmail = `test_farmer_bc_${timestamp}@farmchain.internal`;
    const adminEmail = `test_admin_bc_${timestamp}@farmchain.internal`;
    const jwtSecret = process.env.JWT_SECRET || 'farmchain_super_secret_key';

    const farmerId = crypto.randomUUID();
    const adminId = crypto.randomUUID();

    await supabase.from('users').insert({
      id: farmerId,
      name: 'Approval Test Farmer',
      email: farmerEmail,
      password: 'test_hash_password',
      role: 'farmer'
    });
    createdUserIds.push(farmerId);
    const farmerToken = jwt.sign({ id: farmerId, role: 'farmer' }, jwtSecret, { expiresIn: '1h' });

    await supabase.from('users').insert({
      id: adminId,
      name: 'Approval Test Admin',
      email: adminEmail,
      password: 'test_hash_password',
      role: 'admin'
    });
    createdUserIds.push(adminId);
    const adminToken = jwt.sign({ id: adminId, role: 'admin' }, jwtSecret, { expiresIn: '1h' });

    console.log(`   ✓ Farmer created: ${farmerEmail} (${farmerId})`);
    console.log(`   ✓ Admin created: ${adminEmail} (${adminId})`);

    // 2. Farmer registers product (Pending Approval)
    console.log('\n2. Farmer registering product for approval...');
    const prodRes = await axios.post(`${API_URL}/products`, {
      name: 'Blockchain Certified Strawberries',
      category: 'Fruits',
      batchNumber: `STR-${timestamp}`,
      quantity: 150,
      organic_status: true
    }, { headers: { Authorization: `Bearer ${farmerToken}` } });

    const product = prodRes.data.data;
    createdProductIds.push(product.id);
    console.log(`   ✓ Product created: ${product.name} (ID: ${product.id}, Status: ${product.status})`);
    if (product.status !== 'Pending Approval') {
      throw new Error(`Expected product status 'Pending Approval', got '${product.status}'`);
    }

    // 3. Admin approves product
    console.log('\n3. Admin approving product via PUT /api/admin/products/:id/approve...');
    const approveRes = await axios.put(
      `${API_URL}/admin/products/${product.id}/approve`,
      {},
      { headers: { Authorization: `Bearer ${adminToken}` } }
    );

    console.log('   Approve Response Status:', approveRes.status);
    console.log('   Approve Response Message:', approveRes.data.message);
    console.log('   Approved Product Status:', approveRes.data.data?.status);
    console.log('   Approved Blockchain Hash:', approveRes.data.data?.blockchain_hash);

    if (approveRes.status !== 200) {
      throw new Error(`Approval failed with status ${approveRes.status}`);
    }
    if (!approveRes.data.data?.blockchain_hash || !approveRes.data.data?.blockchain_hash.startsWith('0x')) {
      throw new Error('Approval succeeded but blockchain_hash was not populated with on-chain transaction hash');
    }
    if (approveRes.data.data?.status !== 'Harvested') {
      throw new Error(`Expected status 'Harvested', got '${approveRes.data.data?.status}'`);
    }
    console.log('   ✓ Admin approval successfully triggered on-chain registration and returned tx hash!\n');

    // 4. Verify on-chain record via read query
    console.log('4. Verifying product authenticity on smart contract...');
    const verifyResult = await blockchainService.verifyProduct(product.id, {
      name: product.name,
      batchNumber: product.batch_number
    });

    console.log('   On-chain Verification Status:', verifyResult.status);
    console.log('   On-chain Product Name:', verifyResult.chainData?.name);
    console.log('   On-chain Farmer Address:', verifyResult.chainData?.farmer);
    console.log('   On-chain Current Owner:', verifyResult.chainData?.currentOwner);

    if (verifyResult.status !== 'VERIFIED_ON_CHAIN') {
      throw new Error(`Expected VERIFIED_ON_CHAIN, got '${verifyResult.status}': ${verifyResult.message}`);
    }
    console.log('   ✓ Smart contract confirmed genuine on-chain registration!\n');

    // 5. Cleanup
    console.log('5. Cleaning up test records...');
    for (const pid of createdProductIds) {
      await supabase.from('traceability_events').delete().eq('product_id', pid);
      await supabase.from('products').delete().eq('id', pid);
    }
    for (const uid of createdUserIds) {
      await supabase.from('users').delete().eq('id', uid);
    }
    console.log('   ✓ Test records cleaned up successfully.');

    console.log('\n===============================================================');
    console.log('   ADMIN APPROVAL & BLOCKCHAIN REGISTRATION PASSED (100%)      ');
    console.log('===============================================================');
  } catch (err: any) {
    console.error('\n❌ Test failed:', err.response?.data || err.message);
    for (const pid of createdProductIds) {
      try {
        await supabase.from('traceability_events').delete().eq('product_id', pid);
        await supabase.from('products').delete().eq('id', pid);
      } catch {}
    }
    for (const uid of createdUserIds) {
      try {
        await supabase.from('users').delete().eq('id', uid);
      } catch {}
    }
    process.exit(1);
  }
}

testAdminApprovalBlockchain();

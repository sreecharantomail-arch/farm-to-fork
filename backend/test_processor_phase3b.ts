import './src/test_preload';
import { assertApprovedLocalEnvironment } from './src/utils/localDatabaseGuard';

assertApprovedLocalEnvironment('TestProcessorPhase3b');

import axios from 'axios';
import { supabase } from './src/config/supabase';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(__dirname, '.env') });
assertApprovedLocalEnvironment('TestProcessorPhase3b');

const API_URL = 'http://localhost:5000/api';

async function verifyPhase3B() {
  console.log('=== VERIFYING PHASE 3B ===\n');

  try {
    // 1. Setup Users
    console.log('Setting up test users...');
    const farmerEmail = `farmer_${Date.now()}@example.com`;
    await axios.post(`${API_URL}/auth/register`, {
      name: 'Farmer Test 3B', email: farmerEmail, password: 'password123', role: 'farmer'
    }).catch(e => e.response);
    await supabase.from('users').update({ role: 'farmer' }).eq('email', farmerEmail);
    const farmerLogin = await axios.post(`${API_URL}/auth/login`, { email: farmerEmail, password: 'password123' });
    const farmerToken = farmerLogin.data.token;
    const farmerId = farmerLogin.data.user.id;

    const proc1Email = `proc1_${Date.now()}@example.com`;
    await axios.post(`${API_URL}/auth/register`, {
      name: 'Processor 1 3B', email: proc1Email, password: 'password123', role: 'processor'
    }).catch(e => e.response);
    await supabase.from('users').update({ role: 'processor' }).eq('email', proc1Email);
    const proc1Login = await axios.post(`${API_URL}/auth/login`, { email: proc1Email, password: 'password123' });
    const proc1Token = proc1Login.data.token;
    const proc1Id = proc1Login.data.user.id;

    const proc2Email = `proc2_${Date.now()}@example.com`;
    await axios.post(`${API_URL}/auth/register`, {
      name: 'Processor 2 3B', email: proc2Email, password: 'password123', role: 'processor'
    }).catch(e => e.response);
    await supabase.from('users').update({ role: 'processor' }).eq('email', proc2Email);
    const proc2Login = await axios.post(`${API_URL}/auth/login`, { email: proc2Email, password: 'password123' });
    const proc2Token = proc2Login.data.token;

    // 2. Farmer registers product
    console.log('\nRegistering product...');
    const prodRes = await axios.post(`${API_URL}/products`, {
      name: 'Test Apples 3B',
      category: 'Fruits',
      batchNumber: `BATCH-${Date.now()}`,
      quantity: 100,
      organic_status: true
    }, { headers: { Authorization: `Bearer ${farmerToken}` } });
    if (!prodRes.data?.data) {
       console.log('Product Reg Error:', prodRes.data);
    }
    const product = prodRes.data.data;
    const productId = product.id;

    // 3. Create Shipment manually in DB (Farmer -> Processor 1)
    console.log('\nCreating shipment (Farmer -> Processor 1)...');
    const trackingId = `TRK-${Date.now()}`;
    const { data: shipment, error: shipErr } = await supabase.from('shipments').insert({
      shipment_tracking_id: trackingId,
      batch_number: product.batch_number,
      product_id: productId,
      sender_id: farmerId,
      receiver_id: proc1Id,
      quantity: 100,
      unit: 'kg',
      status: 'IN_TRANSIT'
    }).select().single();

    if (shipErr || !shipment) {
      throw new Error(`Failed to create shipment: ${shipErr?.message}`);
    }
    const shipmentId = shipment.id;

    // 4. Test GET /incoming
    console.log('\nTesting GET /api/processor/shipments/incoming...');
    const unauthGet = await axios.get(`${API_URL}/processor/shipments/incoming`).catch(e => e.response);
    console.log('Unauthenticated GET:', unauthGet.status === 401 ? 'PASS (401)' : `FAIL (${unauthGet.status})`);

    const farmerGet = await axios.get(`${API_URL}/processor/shipments/incoming`, { headers: { Authorization: `Bearer ${farmerToken}` } }).catch(e => e.response);
    console.log('Farmer GET:', farmerGet.status === 403 ? 'PASS (403)' : `FAIL (${farmerGet.status})`);

    const proc1Get = await axios.get(`${API_URL}/processor/shipments/incoming`, { headers: { Authorization: `Bearer ${proc1Token}` } });
    const proc1Shipments = proc1Get.data.data;
    console.log('Processor 1 GET:', proc1Get.status === 200 && proc1Shipments.some((s: any) => s.id === shipmentId) ? 'PASS (Found Shipment)' : 'FAIL');

    // 5. Test Receiving
    console.log('\nTesting POST /api/processor/shipments/:id/receive...');
    const proc2Recv = await axios.post(`${API_URL}/processor/shipments/${shipmentId}/receive`, {}, { headers: { Authorization: `Bearer ${proc2Token}` } }).catch(e => e.response);
    console.log('Processor 2 receiving Processor 1 shipment:', proc2Recv.status === 403 ? 'PASS (403)' : `FAIL (${proc2Recv.status})`);

    const proc1Recv = await axios.post(`${API_URL}/processor/shipments/${shipmentId}/receive`, { received_quantity: 95 }, { headers: { Authorization: `Bearer ${proc1Token}` } });
    console.log('Processor 1 receiving shipment:', proc1Recv.status === 200 ? 'PASS (200)' : `FAIL (${proc1Recv.status})`);

    const proc1RecvDup = await axios.post(`${API_URL}/processor/shipments/${shipmentId}/receive`, { received_quantity: 95 }, { headers: { Authorization: `Bearer ${proc1Token}` } }).catch(e => e.response);
    console.log('Processor 1 receiving shipment again (Duplicate):', proc1RecvDup.status === 400 ? 'PASS (400)' : `FAIL (${proc1RecvDup.status})`);

    // 6. Test Processing
    console.log('\nTesting POST /api/processor/batches/:id/process...');
    const proc2Proc = await axios.post(`${API_URL}/processor/batches/${productId}/process`, { quantity_used: 50 }, { headers: { Authorization: `Bearer ${proc2Token}` } }).catch(e => e.response);
    console.log('Processor 2 processing Processor 1 batch:', proc2Proc.status === 403 ? 'PASS (403)' : `FAIL (${proc2Proc.status})`);

    const proc1ProcOver = await axios.post(`${API_URL}/processor/batches/${productId}/process`, { quantity_used: 150 }, { headers: { Authorization: `Bearer ${proc1Token}` } }).catch(e => e.response);
    console.log('Processor 1 processing over-quantity:', proc1ProcOver.status === 400 ? 'PASS (400)' : `FAIL (${proc1ProcOver.status})`);

    const proc1Proc = await axios.post(`${API_URL}/processor/batches/${productId}/process`, { quantity_used: 60, new_product_name: 'Apple Juice' }, { headers: { Authorization: `Bearer ${proc1Token}` } });
    console.log('Processor 1 processing valid quantity:', proc1Proc.status === 201 ? 'PASS (201)' : `FAIL (${proc1Proc.status})`);
    const childProduct = proc1Proc.data.data;

    // 7. Verify Database Records
    console.log('\nVerifying Database Records...');
    const { data: finalShipment } = await supabase.from('shipments').select('*').eq('id', shipmentId).single();
    console.log('Shipment status updated to RECEIVED:', finalShipment.status === 'RECEIVED' ? 'PASS' : 'FAIL');

    const { data: finalParent } = await supabase.from('products').select('*').eq('id', productId).single();
    console.log('Parent ownership updated to Processor 1:', finalParent.current_owner_id === proc1Id ? 'PASS' : 'FAIL');
    console.log('Parent quantity correctly reduced (100 - 60 = 40):', finalParent.quantity === 40 ? 'PASS' : `FAIL (${finalParent.quantity})`);

    const { data: dbChild } = await supabase.from('products').select('*').eq('id', childProduct.id).single();
    console.log('Child product created and owned by Processor 1:', dbChild && dbChild.current_owner_id === proc1Id ? 'PASS' : 'FAIL');

    const { data: lineage } = await supabase.from('batch_lineage').select('*').eq('parent_product_id', productId).eq('child_product_id', childProduct.id).single();
    console.log('Batch lineage record created:', lineage ? 'PASS' : 'FAIL');

    const { data: events } = await supabase.from('traceability_events').select('*').eq('parent_id_or_product_id', productId); // We need to query events for product and child
    const { data: recvEvent } = await supabase.from('traceability_events').select('*').eq('product_id', productId).eq('event_type', 'PROCESSOR_RECEIVED').single();
    console.log('PROCESSOR_RECEIVED event created:', recvEvent ? 'PASS' : 'FAIL');

    const { data: procEvent } = await supabase.from('traceability_events').select('*').eq('product_id', childProduct.id).eq('event_type', 'PROCESSED').single();
    console.log('PROCESSED event created on child batch:', procEvent ? 'PASS' : 'FAIL');

  } catch (error) {
    console.error('Test script encountered an error:', error);
  }
}

verifyPhase3B();

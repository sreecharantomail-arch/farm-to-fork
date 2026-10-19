import './src/test_preload';
import { assertApprovedLocalEnvironment } from './src/utils/localDatabaseGuard';

assertApprovedLocalEnvironment('TestDistributorPhase3c');

import axios from 'axios';
import { supabase } from './src/config/supabase';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(__dirname, '.env') });
assertApprovedLocalEnvironment('TestDistributorPhase3c');

const API_URL = 'http://localhost:5000/api';

async function verifyPhase3C() {
  console.log('=== VERIFYING PHASE 3C ===\n');

  try {
    // 1. Setup Users
    console.log('Setting up test users...');
    const procEmail = `proc_${Date.now()}@example.com`;
    await axios.post(`${API_URL}/auth/register`, {
      name: 'Processor 3C', email: procEmail, password: 'password123', role: 'processor'
    }).catch(e => e.response);
    await supabase.from('users').update({ role: 'processor' }).eq('email', procEmail);
    const procLogin = await axios.post(`${API_URL}/auth/login`, { email: procEmail, password: 'password123' });
    const procToken = procLogin.data.token;
    const procId = procLogin.data.user.id;

    const dist1Email = `dist1_${Date.now()}@example.com`;
    await axios.post(`${API_URL}/auth/register`, {
      name: 'Distributor 1 3C', email: dist1Email, password: 'password123', role: 'distributor'
    }).catch(e => e.response);
    await supabase.from('users').update({ role: 'distributor' }).eq('email', dist1Email);
    const dist1Login = await axios.post(`${API_URL}/auth/login`, { email: dist1Email, password: 'password123' });
    const dist1Token = dist1Login.data.token;
    const dist1Id = dist1Login.data.user.id;

    const dist2Email = `dist2_${Date.now()}@example.com`;
    await axios.post(`${API_URL}/auth/register`, {
      name: 'Distributor 2 3C', email: dist2Email, password: 'password123', role: 'distributor'
    }).catch(e => e.response);
    await supabase.from('users').update({ role: 'distributor' }).eq('email', dist2Email);
    const dist2Login = await axios.post(`${API_URL}/auth/login`, { email: dist2Email, password: 'password123' });
    const dist2Token = dist2Login.data.token;

    const retEmail = `ret_${Date.now()}@example.com`;
    await axios.post(`${API_URL}/auth/register`, {
      name: 'Retailer 3C', email: retEmail, password: 'password123', role: 'retailer'
    }).catch(e => e.response);
    await supabase.from('users').update({ role: 'retailer' }).eq('email', retEmail);
    const retLogin = await axios.post(`${API_URL}/auth/login`, { email: retEmail, password: 'password123' });
    const retToken = retLogin.data.token;
    const retId = retLogin.data.user.id;

    // 2. Processor owns a product
    console.log('\nCreating product for Processor...');
    const { data: product, error: prodErr } = await supabase.from('products').insert({
      name: 'Test Product 3C',
      category: 'Test',
      batch_number: `BATCH-3C-${Date.now()}`,
      quantity: 100,
      current_owner_id: procId,
      farmer_id: procId, // Using processor ID as a mock farmer ID for this test since farmer_id is required
      status: 'Ready'
    }).select().single();
    if (prodErr) throw prodErr;
    const productId = product.id;

    // 3. Create Shipment manually in DB (Processor -> Distributor 1)
    console.log('\nCreating shipment (Processor -> Distributor 1)...');
    const { data: shipment, error: shipErr } = await supabase.from('shipments').insert({
      shipment_tracking_id: `TRK-3C-${Date.now()}`,
      batch_number: product.batch_number,
      product_id: productId,
      sender_id: procId,
      receiver_id: dist1Id,
      quantity: 100,
      unit: 'kg',
      status: 'IN_TRANSIT'
    }).select().single();
    if (shipErr) throw shipErr;
    const shipmentId = shipment.id;

    // 4. Test GET /incoming
    console.log('\nTesting GET /api/distributor/shipments/incoming...');
    const unauthGet = await axios.get(`${API_URL}/distributor/shipments/incoming`).catch(e => e.response);
    console.log('Unauthenticated GET:', unauthGet.status === 401 ? 'PASS (401)' : `FAIL (${unauthGet.status})`);

    const procGet = await axios.get(`${API_URL}/distributor/shipments/incoming`, { headers: { Authorization: `Bearer ${procToken}` } }).catch(e => e.response);
    console.log('Processor GET:', procGet.status === 403 ? 'PASS (403)' : `FAIL (${procGet.status})`);

    const dist1Get = await axios.get(`${API_URL}/distributor/shipments/incoming`, { headers: { Authorization: `Bearer ${dist1Token}` } });
    const dist1Shipments = dist1Get.data.data;
    console.log('Distributor 1 GET:', dist1Get.status === 200 && dist1Shipments.some((s: any) => s.id === shipmentId) ? 'PASS (Found Shipment)' : 'FAIL');

    // 5. Test Receiving
    console.log('\nTesting POST /api/distributor/shipments/:id/receive...');
    const dist2Recv = await axios.post(`${API_URL}/distributor/shipments/${shipmentId}/receive`, {}, { headers: { Authorization: `Bearer ${dist2Token}` } }).catch(e => e.response);
    console.log('Distributor 2 receiving Distributor 1 shipment:', dist2Recv.status === 403 ? 'PASS (403)' : `FAIL (${dist2Recv.status})`);

    const dist1Recv = await axios.post(`${API_URL}/distributor/shipments/${shipmentId}/receive`, {}, { headers: { Authorization: `Bearer ${dist1Token}` } });
    console.log('Distributor 1 receiving shipment:', dist1Recv.status === 200 ? 'PASS (200)' : `FAIL (${dist1Recv.status})`);

    const dist1RecvDup = await axios.post(`${API_URL}/distributor/shipments/${shipmentId}/receive`, {}, { headers: { Authorization: `Bearer ${dist1Token}` } }).catch(e => e.response);
    console.log('Distributor 1 receiving shipment again (Duplicate):', dist1RecvDup.status === 400 ? 'PASS (400)' : `FAIL (${dist1RecvDup.status})`);

    // 6. Test GET /batches
    console.log('\nTesting GET /api/distributor/batches...');
    const dist1Batches = await axios.get(`${API_URL}/distributor/batches`, { headers: { Authorization: `Bearer ${dist1Token}` } });
    console.log('Distributor 1 GET Batches:', dist1Batches.status === 200 && dist1Batches.data.data.some((p: any) => p.id === productId) ? 'PASS' : 'FAIL');

    // 7. Test Distributor -> Retailer Shipment
    console.log('\nTesting POST /api/distributor/shipments...');

    // First, Retailer creates a product request
    const { data: request, error: reqErr } = await supabase.from('product_requests').insert({
      request_id: `REQ-3C-${Date.now()}`,
      retailer_id: retId,
      product_name: 'Test Product 3C',
      quantity: 50,
      unit: 'kg',
      required_date: new Date().toISOString(),
      status: 'ACCEPTED'
    }).select().single();
    if (reqErr) throw reqErr;
    const requestId = request.id;

    // Dist2 tries to ship Dist1's product
    const dist2Ship = await axios.post(`${API_URL}/distributor/shipments`, {
      product_id: productId,
      request_id: requestId,
      quantity: 50
    }, { headers: { Authorization: `Bearer ${dist2Token}` } }).catch(e => e.response);
    console.log('Distributor 2 shipping Distributor 1 product:', dist2Ship.status === 403 ? 'PASS (403)' : `FAIL (${dist2Ship.status})`);

    // Dist1 ships with invalid quantity
    const dist1ShipInv = await axios.post(`${API_URL}/distributor/shipments`, {
      product_id: productId,
      request_id: requestId,
      quantity: 150
    }, { headers: { Authorization: `Bearer ${dist1Token}` } }).catch(e => e.response);
    console.log('Distributor 1 shipping > available quantity:', dist1ShipInv.status === 400 ? 'PASS (400)' : `FAIL (${dist1ShipInv.status})`);

    // Dist1 ships successfully for 60
    const dist1Ship = await axios.post(`${API_URL}/distributor/shipments`, {
      product_id: productId,
      request_id: requestId,
      quantity: 60
    }, { headers: { Authorization: `Bearer ${dist1Token}` } });
    console.log('Distributor 1 shipping 60/100:', dist1Ship.status === 201 ? 'PASS (201)' : `FAIL (${dist1Ship.status})`);

    // Dist1 attempts to ship 60 again (cumulative 120 > 100)
    const dist1ShipOver = await axios.post(`${API_URL}/distributor/shipments`, {
      product_id: productId,
      request_id: requestId,
      quantity: 60
    }, { headers: { Authorization: `Bearer ${dist1Token}` } }).catch(e => e.response);
    console.log('Distributor 1 shipping cumulative > available:', dist1ShipOver.status === 400 ? 'PASS (400)' : `FAIL (${dist1ShipOver.status})`);

    // 8. Verify Database Records
    console.log('\nVerifying Database Records...');
    const { data: checkShip1 } = await supabase.from('shipments').select('*').eq('id', shipmentId).single();
    console.log('Processor -> Distributor Shipment status updated to RECEIVED:', checkShip1?.status === 'RECEIVED' ? 'PASS' : 'FAIL');

    const { data: checkProd } = await supabase.from('products').select('*').eq('id', productId).single();
    console.log('Product ownership updated to Distributor 1:', checkProd?.current_owner_id === dist1Id ? 'PASS' : 'FAIL');

    const newShipmentId = dist1Ship.data.data.id;
    const { data: checkShip2 } = await supabase.from('shipments').select('*').eq('id', newShipmentId).single();
    console.log('Distributor -> Retailer Shipment created:', checkShip2?.sender_id === dist1Id && checkShip2?.receiver_id === retId ? 'PASS' : 'FAIL');

    const { data: checkEvents } = await supabase.from('traceability_events').select('*').eq('product_id', productId).in('event_type', ['DISTRIBUTOR_RECEIVED', 'DISTRIBUTOR_SHIPPED']);
    console.log('Traceability events created:', checkEvents?.length === 2 ? 'PASS' : 'FAIL');

    console.log('\nPHASE 3C VERIFICATION COMPLETE!');

  } catch (error: any) {
    console.error('Test Failed:', error.response?.data || error.message);
  }
}

verifyPhase3C();

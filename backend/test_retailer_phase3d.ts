import './src/test_preload';
import { assertApprovedLocalEnvironment } from './src/utils/localDatabaseGuard';

assertApprovedLocalEnvironment('TestRetailerPhase3d');

import * as dotenv from 'dotenv';
import { resolve } from 'path';
import axios from 'axios';
import { supabase } from './src/config/supabase';

dotenv.config({ path: resolve(__dirname, '.env') });
assertApprovedLocalEnvironment('TestRetailerPhase3d');

const API_URL = 'http://localhost:5000/api';

async function run() {
  console.log('=== VERIFYING PHASE 3D ===\n');

  try {
    const getAuth = async (name: string, role: string) => {
      const email = `${name.replace(/\s+/g, '')}_${Date.now()}@t.com`.toLowerCase();
      await axios.post(`${API_URL}/auth/register`, { name, email, password: 'password123', role });
      const { error } = await supabase.from('users').update({ role }).eq('email', email);
      if (error) console.log('UPDATE ERROR:', error);
      const res = await axios.post(`${API_URL}/auth/login`, { email, password: 'password123' });
      return { token: res.data.token, id: res.data.user.id };
    };

    const proc = await getAuth('Proc3D', 'processor');
    const dist1 = await getAuth('Dist13D', 'distributor');
    const ret1 = await getAuth('Ret13D', 'retailer');
    const ret2 = await getAuth('Ret23D', 'retailer');
    const f = await getAuth('F3D', 'farmer');

    const procToken = proc.token; const procId = proc.id;
    const dist1Token = dist1.token; const dist1Id = dist1.id;
    const ret1Token = ret1.token; const ret1Id = ret1.id;
    const ret2Token = ret2.token; const ret2Id = ret2.id;

    // 2. Setup Data: Product (Farmer -> Processor -> Distributor)
    const bNum = `BATCH-3D-${Date.now()}`;
    const { data: prod, error: prodErr } = await supabase.from('products').insert({
      name: 'Retail 3D Apples',
      category: 'Fruits',
      quantity: 100,
      batch_number: bNum,
      farmer_id: f.id,
      current_owner_id: dist1Id, // Force ownership to Distributor
      status: 'In Transit'
    }).select().single();
    if (prodErr) console.error('PROD ERR:', prodErr);

    const productId = prod.id;

    // 3. Setup Request from Retailer to Distributor
    const { data: req } = await supabase.from('product_requests').insert({
      request_id: `REQ-3D-${Date.now()}`,
      product_name: 'Retail 3D Apples',
      quantity: 50,
      unit: 'kg',
      required_date: new Date().toISOString(),
      processor_id: dist1Id, // Using processor_id column generically for the upstream target
      retailer_id: ret1Id,
      status: 'PENDING'
    }).select().single();
    const requestId = req.id;

    // 4. Distributor ships to Retailer 1
    const distShip = await axios.post(`${API_URL}/distributor/shipments`, {
      product_id: productId,
      request_id: requestId,
      quantity: 50
    }, { headers: { Authorization: `Bearer ${dist1Token}` } });

    const shipmentId = distShip.data.data.id;

    // 5. Test RETAILER RECEIVE
    console.log('\nTesting POST /api/retailer/receive-product...');

    // Unauthenticated
    const unauth = await axios.post(`${API_URL}/retailer/receive-product`, { shipment_id: shipmentId, qr_data: bNum }).catch(e => e.response);
    console.log('Unauthenticated receive:', unauth.status === 401 ? 'PASS (401)' : `FAIL (${unauth.status})`);

    // Wrong role (Processor)
    const wrongRole = await axios.post(`${API_URL}/retailer/receive-product`, { shipment_id: shipmentId, qr_data: bNum }, { headers: { Authorization: `Bearer ${procToken}` } }).catch(e => e.response);
    console.log('Processor receiving Retailer shipment:', wrongRole.status === 403 ? 'PASS (403)' : `FAIL (${wrongRole.status})`);

    // Retailer 2 attempting to receive Retailer 1 shipment
    const wrongRet = await axios.post(`${API_URL}/retailer/receive-product`, { shipment_id: shipmentId, qr_data: bNum }, { headers: { Authorization: `Bearer ${ret2Token}` } }).catch(e => e.response);
    console.log('Retailer 2 receiving Retailer 1 shipment:', wrongRet.status === 403 ? 'PASS (403)' : `FAIL (${wrongRet.status})`);

    // Retailer 1 successfully receives
    const retReceive = await axios.post(`${API_URL}/retailer/receive-product`, { shipment_id: shipmentId, qr_data: bNum }, { headers: { Authorization: `Bearer ${ret1Token}` } });
    console.log('Retailer 1 receiving shipment:', retReceive.status === 200 ? 'PASS (200)' : `FAIL (${retReceive.status})`);

    // Duplicate Receive
    const dupReceive = await axios.post(`${API_URL}/retailer/receive-product`, { shipment_id: shipmentId, qr_data: bNum }, { headers: { Authorization: `Bearer ${ret1Token}` } }).catch(e => e.response);
    console.log('Duplicate receive attempt:', dupReceive.status === 400 ? 'PASS (400)' : `FAIL (${dupReceive.status})`);

    // 6. DB Validation
    console.log('\nVerifying DB constraints...');

    const { data: finalShipment } = await supabase.from('shipments').select('*').eq('id', shipmentId).single();
    console.log('Shipment status updated to RECEIVED:', finalShipment.status === 'RECEIVED' ? 'PASS' : `FAIL (${finalShipment.status})`);

    const { data: finalProduct } = await supabase.from('products').select('*').eq('id', productId).single();
    console.log('products.current_owner_id updated to Retailer:', finalProduct.current_owner_id === ret1Id ? 'PASS' : `FAIL (${finalProduct.current_owner_id})`);

    const { data: retInv } = await supabase.from('retailer_inventory').select('*').eq('retailer_id', ret1Id).eq('product_id', productId);
    console.log('retailer_inventory created:', retInv.length === 1 ? 'PASS' : `FAIL (Found ${retInv.length})`);

    const { data: traceEvents } = await supabase.from('traceability_events').select('*').eq('batch_number', bNum).eq('event_type', 'RETAILER_RECEIVED');
    console.log('Exactly 1 RETAILER_RECEIVED trace event:', traceEvents.length === 1 ? 'PASS' : `FAIL (Found ${traceEvents.length})`);

    console.log('\nPHASE 3D VERIFICATION COMPLETE!');

  } catch (err: any) {
    console.error('Test script crashed:', err.response?.data || err.message || err);
  }
}

run();

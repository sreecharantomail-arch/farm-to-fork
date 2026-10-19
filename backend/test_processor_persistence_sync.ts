import './src/test_preload';
import { assertApprovedLocalEnvironment } from './src/utils/localDatabaseGuard';

assertApprovedLocalEnvironment('TestProcessorPersistenceSync');

import axios from 'axios';
import { supabase } from './src/config/supabase';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(__dirname, '.env') });
assertApprovedLocalEnvironment('TestProcessorPersistenceSync');

const API_URL = 'http://localhost:5000/api';

async function runProcessorPersistenceSyncTest() {
  console.log('===============================================================');
  console.log('   FARMCHAINAI — PROCESSOR PERSISTENCE & SYNC VERIFICATION   ');
  console.log('===============================================================\n');

  const createdUserIds: string[] = [];
  const createdProductIds: string[] = [];
  const createdShipmentIds: string[] = [];

  try {
    // -------------------------------------------------------------------------
    // 1. SETUP: Create isolated test farmer and processor accounts
    // -------------------------------------------------------------------------
    console.log('1. Setting up test accounts...');
    const timestamp = Date.now();
    const farmerEmail = `test_farmer_${timestamp}@farmchain.internal`;
    const processorEmail = `test_processor_${timestamp}@farmchain.internal`;
    const password = 'TestPassword123!';

    await axios.post(`${API_URL}/auth/register`, {
      name: 'Sync Test Farmer',
      email: farmerEmail,
      password,
      role: 'farmer'
    });
    await supabase.from('users').update({ role: 'farmer' }).eq('email', farmerEmail);

    const fLogin = await axios.post(`${API_URL}/auth/login`, { email: farmerEmail, password });
    const farmerToken = fLogin.data.token;
    const farmerId = fLogin.data.user.id;
    createdUserIds.push(farmerId);

    await axios.post(`${API_URL}/auth/register`, {
      name: 'Sync Test Processor Facility',
      email: processorEmail,
      password,
      role: 'processor'
    });
    await supabase.from('users').update({ role: 'processor' }).eq('email', processorEmail);

    // Session 1 Login
    const pLogin1 = await axios.post(`${API_URL}/auth/login`, { email: processorEmail, password });
    const processorToken1 = pLogin1.data.token;
    const processorId = pLogin1.data.user.id;
    createdUserIds.push(processorId);

    // Session 2 Login (simulating a separate browser or mobile session for the same processor)
    const pLogin2 = await axios.post(`${API_URL}/auth/login`, { email: processorEmail, password });
    const processorToken2 = pLogin2.data.token;

    console.log(`   ✓ Farmer created: ${farmerEmail} (${farmerId})`);
    console.log(`   ✓ Processor created: ${processorEmail} (${processorId})`);
    console.log(`   ✓ Session 1 Token generated`);
    console.log(`   ✓ Session 2 Token generated (independent session)`);

    // -------------------------------------------------------------------------
    // 2. FARMER: Register two crop batches
    // -------------------------------------------------------------------------
    console.log('\n2. Farmer registering crop batches...');
    // Batch A: For direct gate intake test
    const batchResA = await axios.post(`${API_URL}/products`, {
      name: 'Organic Heritage Tomatoes',
      category: 'Vegetables',
      batchNumber: `TOM-${timestamp}`,
      quantity: 500,
      organic_status: true
    }, { headers: { Authorization: `Bearer ${farmerToken}` } });
    const productA = batchResA.data.data;
    createdProductIds.push(productA.id);

    // Batch B: For incoming shipment receipt test
    const batchResB = await axios.post(`${API_URL}/products`, {
      name: 'Alphonso Mangoes Premium',
      category: 'Fruits',
      batchNumber: `MNG-${timestamp}`,
      quantity: 300,
      organic_status: true
    }, { headers: { Authorization: `Bearer ${farmerToken}` } });
    const productB = batchResB.data.data;
    createdProductIds.push(productB.id);

    console.log(`   ✓ Product A registered: ${productA.name} (${productA.id}, 500 kg)`);
    console.log(`   ✓ Product B registered: ${productB.name} (${productB.id}, 300 kg)`);

    // -------------------------------------------------------------------------
    // 3. SHIPMENT: Create shipment for Product B (Farmer -> Processor)
    // -------------------------------------------------------------------------
    console.log('\n3. Creating shipment for Product B...');
    const { data: shipmentB, error: shipErr } = await supabase.from('shipments').insert({
      shipment_tracking_id: `TRK-MNG-${timestamp}`,
      batch_number: productB.batch_number,
      product_id: productB.id,
      sender_id: farmerId,
      receiver_id: processorId,
      quantity: 300,
      unit: 'kg',
      status: 'DELIVERED' // Delivered by logistics, ready for processor receipt
    }).select().single();

    if (shipErr || !shipmentB) throw new Error(`Failed to create shipment: ${shipErr?.message}`);
    createdShipmentIds.push(shipmentB.id);
    console.log(`   ✓ Shipment created: ${shipmentB.shipment_tracking_id} (${shipmentB.id})`);

    // -------------------------------------------------------------------------
    // 4. PROCESSOR (Session 1): Direct Gate Intake for Product A
    // -------------------------------------------------------------------------
    console.log('\n4. Testing Direct Gate Intake (Session 1)...');
    const intakeRes = await axios.post(`${API_URL}/processor/intake`, {
      product_id: productA.id,
      received_quantity: 480, // 20 kg transit shortage
      ai_quality_score: 94,
      ai_quality_label: 'Grade A',
      remarks: 'Gate verified at processing facility intake scale'
    }, { headers: { Authorization: `Bearer ${processorToken1}` } });

    if (!intakeRes.data.success) throw new Error('Gate intake failed');
    console.log(`   ✓ Gate Intake Success: received 480 kg, Grade A (94%)`);

    // Verify DB update
    const { data: dbProductA } = await supabase.from('products').select('*').eq('id', productA.id).single();
    if (dbProductA.current_owner_id !== processorId) throw new Error('Ownership was not transferred to processor');
    if (dbProductA.quantity !== 480) throw new Error(`Quantity not updated to 480, got ${dbProductA.quantity}`);
    if (dbProductA.status !== 'Processing') throw new Error(`Status not updated to Processing, got ${dbProductA.status}`);
    console.log(`   ✓ Database Verified: current_owner_id = processor, quantity = 480, status = Processing`);

    // -------------------------------------------------------------------------
    // 5. PROCESSOR (Session 1): Shipment Receipt for Product B
    // -------------------------------------------------------------------------
    console.log('\n5. Testing Shipment Receipt (Session 1)...');
    const recvRes = await axios.post(`${API_URL}/processor/shipments/${shipmentB.id}/receive`, {
      received_quantity: 295 // 5 kg transit loss
    }, { headers: { Authorization: `Bearer ${processorToken1}` } });

    if (!recvRes.data.success) throw new Error('Shipment receive failed');
    console.log(`   ✓ Shipment Received: 295 kg accepted`);

    // Verify duplicate receipt is blocked
    const dupRecv = await axios.post(`${API_URL}/processor/shipments/${shipmentB.id}/receive`, {
      received_quantity: 295
    }, { headers: { Authorization: `Bearer ${processorToken1}` } }).catch(e => e.response);

    if (dupRecv.status === 400) {
      console.log(`   ✓ Duplicate Receipt Blocked (400 Bad Request)`);
    } else {
      throw new Error(`Duplicate receipt not blocked: status ${dupRecv.status}`);
    }

    // -------------------------------------------------------------------------
    // 6. PROCESSOR (Session 1): Process Batch A (Partial: 300 kg into Tomato Puree)
    // -------------------------------------------------------------------------
    console.log('\n6. Testing Batch Processing (Session 1)...');
    const procRes = await axios.post(`${API_URL}/processor/batches/${productA.id}/process`, {
      quantity_used: 300,
      new_product_name: 'Organic Tomato Puree (Processed)',
      new_category: 'Processed Food'
    }, { headers: { Authorization: `Bearer ${processorToken1}` } });

    if (!procRes.data.success) throw new Error('Processing failed');
    const childProduct = procRes.data.data;
    createdProductIds.push(childProduct.id);
    console.log(`   ✓ Child Batch Created: ${childProduct.name} (${childProduct.id}, 300 kg, ${childProduct.batch_number})`);

    // Check parent quantity was decremented in database
    const { data: finalParentA } = await supabase.from('products').select('*').eq('id', productA.id).single();
    if (finalParentA.quantity !== 180) throw new Error(`Parent quantity expected 180 (480-300), got ${finalParentA.quantity}`);
    console.log(`   ✓ Parent Quantity Correctly Decremented: 480 - 300 = ${finalParentA.quantity} kg`);

    // Check batch_lineage table
    const { data: lineageRecord } = await supabase.from('batch_lineage')
      .select('*')
      .eq('parent_product_id', productA.id)
      .eq('child_product_id', childProduct.id)
      .single();
    if (!lineageRecord) throw new Error('Batch lineage record not found in database');
    console.log(`   ✓ Batch Lineage Stored in DB: parent ${productA.id} -> child ${childProduct.id} (used: ${lineageRecord.quantity_used} kg)`);

    // -------------------------------------------------------------------------
    // 7. PROCESSOR (Session 1): Transfer Child Batch to Distributor
    // -------------------------------------------------------------------------
    console.log('\n7. Testing Batch Transfer to Distributor (Session 1)...');
    const transferRes = await axios.post(`${API_URL}/processor/batches/${childProduct.id}/transfer`, {
      distributor: 'ColdChain Express Logistics',
      destination_hub: 'Metro Cold Storage Hub A',
      remarks: 'Handover complete with temperature sensor active'
    }, { headers: { Authorization: `Bearer ${processorToken1}` } });

    if (!transferRes.data.success) throw new Error('Batch transfer failed');
    console.log(`   ✓ Batch Transfer Status: Transferred`);

    // -------------------------------------------------------------------------
    // 8. CROSS-SESSION PERSISTENCE VERIFICATION (Session 2)
    // -------------------------------------------------------------------------
    console.log('\n8. CROSS-SESSION VERIFICATION: Querying from Session 2 (Independent Browser/Session)...');

    // 8a. GET /api/processor/batches
    const s2BatchesRes = await axios.get(`${API_URL}/processor/batches`, {
      headers: { Authorization: `Bearer ${processorToken2}` }
    });
    if (!s2BatchesRes.data.success) throw new Error('Session 2 failed to get batches');
    const s2Batches = s2BatchesRes.data.data;

    const foundParentA = s2Batches.find((b: any) => b.id === productA.id);
    const foundChildA = s2Batches.find((b: any) => b.id === childProduct.id);
    const foundProductB = s2Batches.find((b: any) => b.id === productB.id);

    if (!foundParentA) throw new Error('Session 2 could not find Parent Batch A');
    if (!foundChildA) throw new Error('Session 2 could not find Processed Child Batch');
    if (!foundProductB) throw new Error('Session 2 could not find Received Batch B');

    console.log(`   ✓ Session 2 retrieved active Parent Batch: ${foundParentA.name} (Remaining: ${foundParentA.quantity} kg, Status: ${foundParentA.status})`);
    console.log(`   ✓ Session 2 retrieved Processed Batch: ${foundChildA.name} (Quantity: ${foundChildA.quantity} kg, Status: ${foundChildA.status})`);
    console.log(`   ✓ Session 2 retrieved Received Batch B: ${foundProductB.name} (Quantity: ${foundProductB.quantity} kg, Status: ${foundProductB.status})`);

    // Verify lineage join in Session 2
    if (!foundChildA.parent_lineage || foundChildA.parent_lineage.length === 0) {
      throw new Error('Session 2 did not receive parent_lineage on child batch');
    }
    const parentLineage = foundChildA.parent_lineage[0];
    console.log(`   ✓ Session 2 Lineage Joined: Parent ID ${parentLineage.parent_product_id}, Used: ${parentLineage.quantity_used} kg`);
    if (parentLineage.parent?.farmer?.name) {
      console.log(`   ✓ Session 2 Deep Lineage Join: Farmer Name "${parentLineage.parent.farmer.name}"`);
    }

    // 8b. GET /api/processor/events (Audit Trail)
    const s2EventsRes = await axios.get(`${API_URL}/processor/events`, {
      headers: { Authorization: `Bearer ${processorToken2}` }
    });
    if (!s2EventsRes.data.success) throw new Error('Session 2 failed to get events');
    const s2Events = s2EventsRes.data.data;

    const eventTypes = s2Events.map((e: any) => e.event_type);
    console.log(`   ✓ Session 2 Audit Events count: ${s2Events.length}`);
    console.log(`   ✓ Session 2 Audit Events types: ${Array.from(new Set(eventTypes)).join(', ')}`);

    const hasIntakeEvent = s2Events.some((e: any) => e.product_id === productA.id && e.event_type === 'PROCESSOR_RECEIVED');
    const hasProcessEvent = s2Events.some((e: any) => e.product_id === childProduct.id && e.event_type === 'PROCESSED');
    const hasTransferEvent = s2Events.some((e: any) => e.product_id === childProduct.id && e.event_type === 'DISPATCHED_TO_DISTRIBUTOR');

    if (!hasIntakeEvent) throw new Error('Session 2 missing PROCESSOR_RECEIVED audit event');
    if (!hasProcessEvent) throw new Error('Session 2 missing PROCESSED audit event');
    if (!hasTransferEvent) throw new Error('Session 2 missing DISPATCHED_TO_DISTRIBUTOR audit event');

    console.log(`   ✓ All 3 workflow audit events confirmed persistent in database for Session 2`);

    // -------------------------------------------------------------------------
    // 9. CLEANUP: Safe non-destructive deletion of test records
    // -------------------------------------------------------------------------
    console.log('\n9. Cleaning up test records...');
    for (const pid of createdProductIds) {
      await supabase.from('traceability_events').delete().eq('product_id', pid);
      await supabase.from('batch_lineage').delete().or(`parent_product_id.eq.${pid},child_product_id.eq.${pid}`);
    }
    for (const sid of createdShipmentIds) {
      await supabase.from('shipments').delete().eq('id', sid);
    }
    for (const pid of createdProductIds) {
      await supabase.from('products').delete().eq('id', pid);
    }
    for (const uid of createdUserIds) {
      await supabase.from('users').delete().eq('id', uid);
    }
    console.log('   ✓ Test data safely cleaned up without touching baseline data.');

    console.log('\n===============================================================');
    console.log('   ALL PROCESSOR PERSISTENCE & SYNC TESTS PASSED (100%)       ');
    console.log('===============================================================');
  } catch (err: any) {
    console.error('\n❌ Test failed with error:', err.response?.data || err.message);
    // Cleanup on error
    for (const pid of createdProductIds) {
      await supabase.from('traceability_events').delete().eq('product_id', pid).catch(() => {});
      await supabase.from('batch_lineage').delete().or(`parent_product_id.eq.${pid},child_product_id.eq.${pid}`).catch(() => {});
      await supabase.from('products').delete().eq('id', pid).catch(() => {});
    }
    for (const sid of createdShipmentIds) {
      await supabase.from('shipments').delete().eq('id', sid).catch(() => {});
    }
    for (const uid of createdUserIds) {
      await supabase.from('users').delete().eq('id', uid).catch(() => {});
    }
    process.exit(1);
  }
}

runProcessorPersistenceSyncTest();

import './src/test_preload';
import { assertApprovedLocalEnvironment } from './src/utils/localDatabaseGuard';

assertApprovedLocalEnvironment('ProofOfDeliveryUnit');

import test from 'node:test';
import assert from 'node:assert';
import { Request, Response } from 'express';
import { supabase } from './src/config/supabase';
import { submitProofOfDelivery, getDeliveryProof, getOutgoingShipments } from './src/controllers/distributorController';
import { getShipmentDeliveryProof, acknowledgeDeliveryReceipt, reportDeliveryDiscrepancy, receiveProduct } from './src/controllers/retailerController';

// --- Test State and Mock Infrastructure ---
let mockState: Record<string, any> = {};
let mockInserts: Record<string, any[]> = {};
let mockUpdates: Record<string, any[]> = {};

const resetMockDb = () => {
  mockState = {};
  mockInserts = {
    proof_of_delivery: [],
    shipments: [],
    retailer_inventory: [],
    traceability_events: [],
    event_outbox: []
  };
  mockUpdates = {
    proof_of_delivery: [],
    shipments: [],
    products: []
  };
};

// Mock Helper for Express Request/Response
const createMockReqRes = (options: {
  user?: any;
  params?: Record<string, string>;
  body?: Record<string, any>;
}) => {
  const req: any = {
    user: options.user || { id: 'dist-user-1', role: 'distributor' },
    params: options.params || {},
    body: options.body || {}
  };

  const res: any = {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: any) {
      this.body = data;
      return this;
    }
  };

  return { req, res };
};

// Override supabase.from and supabase.rpc with mock handlers
const originalFrom = supabase.from;
const originalRpc = (supabase as any).rpc;

(supabase as any).rpc = async (fnName: string, args: any) => {
  return { data: null, error: { message: 'function does not exist in unit mock', code: '42883' } };
};

supabase.from = (table: string): any => {
  const query: any = {
    table,
    action: 'select',
    filters: [] as { col: string; val: any }[],
    inFilters: [] as { col: string; vals: any[] }[],
    singleVal: false,
    maybeSingleVal: false
  };

  const chain: any = {
    select: (cols: string = '*') => {
      query.cols = cols;
      return chain;
    },
    eq: (col: string, val: any) => {
      query.filters.push({ col, val });
      return chain;
    },
    neq: (col: string, val: any) => {
      query.filters.push({ col: `neq_${col}`, val });
      return chain;
    },
    in: (col: string, vals: any[]) => {
      query.inFilters.push({ col, vals });
      return chain;
    },
    order: () => chain,
    limit: () => chain,
    single: () => {
      query.singleVal = true;
      return chain;
    },
    maybeSingle: () => {
      query.maybeSingleVal = true;
      return chain;
    },
    insert: (payload: any) => {
      query.action = 'insert';
      query.payload = payload;
      if (!mockInserts[table]) mockInserts[table] = [];
      if (Array.isArray(payload)) {
        mockInserts[table].push(...payload);
      } else {
        mockInserts[table].push(payload);
      }
      return chain;
    },
    update: (payload: any) => {
      query.action = 'update';
      query.payload = payload;
      if (!mockUpdates[table]) mockUpdates[table] = [];
      mockUpdates[table].push({ payload, filters: query.filters });
      return chain;
    },
    then: (resolve: any, reject: any) => {
      try {
        if (query.action === 'insert') {
          const inserted = Array.isArray(query.payload) ? query.payload : [query.payload];
          const enriched = inserted.map(item => ({ id: item.id || `gen-${Date.now()}`, ...item }));
          return resolve({ data: query.singleVal ? enriched[0] : enriched, error: null });
        }

        if (query.action === 'update') {
          return resolve({ data: query.payload, error: null });
        }

        // Handle SELECT queries based on mockState
        const tableData = mockState[table] || [];
        let filtered = tableData.filter((row: any) => {
          for (const f of query.filters) {
            if (f.col.startsWith('neq_')) {
              const actualCol = f.col.replace('neq_', '');
              if (row[actualCol] === f.val) return false;
            } else if (row[f.col] !== f.val) {
              return false;
            }
          }
          return true;
        });

        if (query.singleVal) {
          if (filtered.length === 0) {
            return resolve({ data: null, error: { message: 'Row not found', code: 'PGRST116' } });
          }
          return resolve({ data: filtered[0], error: null });
        }

        if (query.maybeSingleVal) {
          return resolve({ data: filtered.length > 0 ? filtered[0] : null, error: null });
        }

        return resolve({ data: filtered, error: null });
      } catch (err) {
        reject(err);
      }
    }
  };

  return chain;
};

// ==========================================
// TEST SUITE: Digital Proof of Delivery
// ==========================================

test('1. Valid distributor proof submission updates shipment to DELIVERED and records outbox/traceability', async () => {
  resetMockDb();

  const shipmentId = 'ship-101';
  const distId = 'dist-1';
  const retId = 'ret-1';

  mockState['shipments'] = [{
    id: shipmentId,
    shipment_tracking_id: 'TRK-101',
    batch_number: 'BATCH-APPLE-1',
    product_id: 'prod-apple',
    sender_id: distId,
    receiver_id: retId,
    quantity: 100,
    unit: 'kg',
    status: 'IN_TRANSIT'
  }];
  mockState['proof_of_delivery'] = [];

  const { req, res } = createMockReqRes({
    user: { id: distId, role: 'distributor' },
    params: { id: shipmentId },
    body: {
      recipient_name: 'Store Manager John',
      quantity_delivered: 100,
      delivery_notes: 'Delivered in good condition',
      photo_url: 'https://storage.local/photo.jpg'
    }
  });

  await submitProofOfDelivery(req, res);

  assert.strictEqual(res.statusCode, 201);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(res.body.data.shipment.status, 'DELIVERED');

  // Verify POD record created
  assert.strictEqual(mockInserts['proof_of_delivery'].length, 1);
  assert.strictEqual(mockInserts['proof_of_delivery'][0].recipient_name, 'Store Manager John');
  assert.strictEqual(mockInserts['proof_of_delivery'][0].quantity_delivered, 100);
  assert.strictEqual(mockInserts['proof_of_delivery'][0].status, 'SUBMITTED');

  // Verify traceability event created
  assert.strictEqual(mockInserts['traceability_events'].length, 1);
  assert.strictEqual(mockInserts['traceability_events'][0].event_type, 'DISTRIBUTOR_DELIVERED');

  // Verify outbox event created
  assert.strictEqual(mockInserts['event_outbox'].length, 1);
  assert.strictEqual(mockInserts['event_outbox'][0].event_type, 'DELIVERY_PROOF_SUBMITTED');
});

test('2. Unauthorized distributor access is rejected (403 Forbidden)', async () => {
  resetMockDb();

  const shipmentId = 'ship-102';
  mockState['shipments'] = [{
    id: shipmentId,
    sender_id: 'dist-owner',
    receiver_id: 'ret-1',
    quantity: 50,
    status: 'IN_TRANSIT'
  }];

  const { req, res } = createMockReqRes({
    user: { id: 'dist-imposter', role: 'distributor' },
    params: { id: shipmentId },
    body: {
      recipient_name: 'Jane Doe',
      quantity_delivered: 50
    }
  });

  await submitProofOfDelivery(req, res);

  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(res.body.success, false);
  assert.match(res.body.message, /not the distributor/i);
});

test('3. Invalid or excessive delivery quantity is rejected (400 Bad Request)', async () => {
  resetMockDb();

  const shipmentId = 'ship-103';
  const distId = 'dist-1';
  mockState['shipments'] = [{
    id: shipmentId,
    sender_id: distId,
    receiver_id: 'ret-1',
    quantity: 50,
    status: 'IN_TRANSIT'
  }];

  // Test 3a: Excessive quantity
  const { req: reqExcess, res: resExcess } = createMockReqRes({
    user: { id: distId, role: 'distributor' },
    params: { id: shipmentId },
    body: { recipient_name: 'Manager', quantity_delivered: 100 } // Exceeds 50
  });

  await submitProofOfDelivery(reqExcess, resExcess);
  assert.strictEqual(resExcess.statusCode, 400);
  assert.match(resExcess.body.message, /cannot exceed dispatched/i);

  // Test 3b: Zero or negative quantity
  const { req: reqZero, res: resZero } = createMockReqRes({
    user: { id: distId, role: 'distributor' },
    params: { id: shipmentId },
    body: { recipient_name: 'Manager', quantity_delivered: 0 }
  });

  await submitProofOfDelivery(reqZero, resZero);
  assert.strictEqual(resZero.statusCode, 400);
  assert.match(resZero.body.message, /positive delivery quantity/i);
});

test('4. Duplicate proof submission is rejected (409 Conflict)', async () => {
  resetMockDb();

  const shipmentId = 'ship-104';
  const distId = 'dist-1';
  mockState['shipments'] = [{
    id: shipmentId,
    sender_id: distId,
    receiver_id: 'ret-1',
    quantity: 50,
    status: 'IN_TRANSIT'
  }];
  mockState['proof_of_delivery'] = [{
    id: 'pod-existing',
    shipment_id: shipmentId,
    status: 'SUBMITTED'
  }];

  const { req, res } = createMockReqRes({
    user: { id: distId, role: 'distributor' },
    params: { id: shipmentId },
    body: { recipient_name: 'Manager', quantity_delivered: 50 }
  });

  await submitProofOfDelivery(req, res);

  assert.strictEqual(res.statusCode, 409);
  assert.strictEqual(res.body.success, false);
  assert.match(res.body.message, /already been submitted/i);
});

test('5. Correct retailer can retrieve delivery proof', async () => {
  resetMockDb();

  const shipmentId = 'ship-105';
  const retId = 'ret-owner';

  mockState['shipments'] = [{
    id: shipmentId,
    receiver_id: retId
  }];
  mockState['proof_of_delivery'] = [{
    id: 'pod-105',
    shipment_id: shipmentId,
    recipient_name: 'John Store',
    quantity_delivered: 75,
    unit: 'boxes',
    status: 'SUBMITTED'
  }];

  const { req, res } = createMockReqRes({
    user: { id: retId, role: 'retailer' },
    params: { id: shipmentId }
  });

  await getShipmentDeliveryProof(req, res);

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(res.body.data.recipient_name, 'John Store');
});

test('6. Unauthorized retailer cannot view or acknowledge another store shipment', async () => {
  resetMockDb();

  const shipmentId = 'ship-106';
  mockState['shipments'] = [{
    id: shipmentId,
    receiver_id: 'ret-true-owner',
    status: 'DELIVERED',
    batch_number: 'BATCH-ABC'
  }];

  // Unauthorized view
  const { req: reqView, res: resView } = createMockReqRes({
    user: { id: 'ret-intruder', role: 'retailer' },
    params: { id: shipmentId }
  });
  await getShipmentDeliveryProof(reqView, resView);
  assert.strictEqual(resView.statusCode, 403);

  // Unauthorized acknowledgement
  const { req: reqAck, res: resAck } = createMockReqRes({
    user: { id: 'ret-intruder', role: 'retailer' },
    params: { id: shipmentId },
    body: { qr_data: 'BATCH-ABC' }
  });
  await acknowledgeDeliveryReceipt(reqAck, resAck);
  assert.strictEqual(resAck.statusCode, 403);
});

test('7. Successful retailer acknowledgement transitions shipment to RECEIVED and intakes inventory', async () => {
  resetMockDb();

  const shipmentId = 'ship-107';
  const retId = 'ret-valid';
  const batchNum = 'BATCH-ORANGE-7';
  const prodId = 'prod-orange';

  mockState['shipments'] = [{
    id: shipmentId,
    batch_number: batchNum,
    product_id: prodId,
    receiver_id: retId,
    quantity: 40,
    unit: 'kg',
    status: 'DELIVERED'
  }];

  mockState['proof_of_delivery'] = [{
    id: 'pod-107',
    shipment_id: shipmentId,
    quantity_delivered: 40,
    unit: 'kg',
    status: 'SUBMITTED'
  }];

  mockState['products'] = [{
    id: prodId,
    current_owner_id: 'dist-1',
    expiry_date: '2027-01-01'
  }];

  mockState['retailer_inventory'] = [];

  const { req, res } = createMockReqRes({
    user: { id: retId, role: 'retailer' },
    params: { id: shipmentId },
    body: { qr_data: batchNum }
  });

  await acknowledgeDeliveryReceipt(req, res);

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(res.body.data.status, 'ACKNOWLEDGED');

  // Verify inventory intake happened
  assert.strictEqual(mockInserts['retailer_inventory'].length, 1);
  assert.strictEqual(mockInserts['retailer_inventory'][0].quantity, 40);
  assert.strictEqual(mockInserts['retailer_inventory'][0].retailer_id, retId);

  // Verify traceability event
  const recvEvents = mockInserts['traceability_events'].filter(e => e.event_type === 'RETAILER_RECEIVED');
  assert.strictEqual(recvEvents.length, 1);

  // Verify outbox events
  const invOutbox = mockInserts['event_outbox'].filter(e => e.event_type === 'INVENTORY_CREATED');
  assert.strictEqual(invOutbox.length, 1);
});

test('8. Duplicate acknowledgement is prevented without creating duplicate inventory', async () => {
  resetMockDb();

  const shipmentId = 'ship-108';
  const retId = 'ret-valid';
  const batchNum = 'BATCH-BERRY-8';
  const prodId = 'prod-berry';

  mockState['shipments'] = [{
    id: shipmentId,
    batch_number: batchNum,
    product_id: prodId,
    receiver_id: retId,
    quantity: 20,
    unit: 'boxes',
    status: 'DELIVERED'
  }];

  mockState['proof_of_delivery'] = [{
    id: 'pod-108',
    shipment_id: shipmentId,
    quantity_delivered: 20,
    unit: 'boxes',
    status: 'SUBMITTED'
  }];

  // Pre-existing inventory record simulates prior intake
  mockState['retailer_inventory'] = [{
    id: 'inv-existing',
    retailer_id: retId,
    batch_number: batchNum,
    product_id: prodId,
    quantity: 20
  }];

  const { req, res } = createMockReqRes({
    user: { id: retId, role: 'retailer' },
    params: { id: shipmentId },
    body: { qr_data: batchNum }
  });

  await acknowledgeDeliveryReceipt(req, res);

  assert.strictEqual(res.statusCode, 409);
  assert.strictEqual(res.body.success, false);
  assert.match(res.body.message, /intake already completed/i);

  // Assert NO new inventory was inserted
  assert.strictEqual(mockInserts['retailer_inventory'].length, 0);
});

test('9. Discrepancy reporting preserves original delivery proof and sets status to DELIVERY_DISPUTED', async () => {
  resetMockDb();

  const shipmentId = 'ship-109';
  const retId = 'ret-valid';

  mockState['shipments'] = [{
    id: shipmentId,
    sender_id: 'dist-1',
    receiver_id: retId,
    batch_number: 'BATCH-MILK-9',
    product_id: 'prod-milk',
    quantity: 100,
    status: 'DELIVERED'
  }];

  mockState['proof_of_delivery'] = [{
    id: 'pod-109',
    shipment_id: shipmentId,
    recipient_name: 'Warehouse Guard',
    quantity_delivered: 100,
    delivery_notes: 'Claimed 100 delivered',
    status: 'SUBMITTED'
  }];

  const { req, res } = createMockReqRes({
    user: { id: retId, role: 'retailer' },
    params: { id: shipmentId },
    body: {
      reason: 'Quantity Mismatch (Short Delivery)',
      notes: 'Received only 70 cartons. 30 cartons missing from pallet.'
    }
  });

  await reportDeliveryDiscrepancy(req, res);

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(res.body.data.status, 'DISPUTED');

  // Verify shipment updated to DELIVERY_DISPUTED
  const shipUpdate = mockUpdates['shipments'].find(u => u.payload.status === 'DELIVERY_DISPUTED');
  assert.ok(shipUpdate);

  // Verify POD was updated with dispute reason while preserving original record
  const podUpdate = mockUpdates['proof_of_delivery'].find(u => u.payload.status === 'DISPUTED');
  assert.ok(podUpdate);
  assert.strictEqual(podUpdate.payload.discrepancy_reason, 'Quantity Mismatch (Short Delivery)');

  // Verify traceability event
  const dispEvents = mockInserts['traceability_events'].filter(e => e.event_type === 'DELIVERY_DISPUTED');
  assert.strictEqual(dispEvents.length, 1);
});

test('10. Invalid shipment status transitions are rejected', async () => {
  resetMockDb();

  const shipmentId = 'ship-110';
  const retId = 'ret-valid';

  // Shipment is already in RECEIVED status
  mockState['shipments'] = [{
    id: shipmentId,
    receiver_id: retId,
    status: 'RECEIVED',
    batch_number: 'BATCH-110'
  }];

  // Attempting to acknowledge already received shipment
  const { req: reqAck, res: resAck } = createMockReqRes({
    user: { id: retId, role: 'retailer' },
    params: { id: shipmentId },
    body: { qr_data: 'BATCH-110' }
  });
  await acknowledgeDeliveryReceipt(reqAck, resAck);
  assert.strictEqual(resAck.statusCode, 400);
  assert.match(resAck.body.message, /already been received/i);

  // Attempting to dispute already received shipment
  const { req: reqDisp, res: resDisp } = createMockReqRes({
    user: { id: retId, role: 'retailer' },
    params: { id: shipmentId },
    body: { reason: 'Late delivery' }
  });
  await reportDeliveryDiscrepancy(reqDisp, resDisp);
  assert.strictEqual(resDisp.statusCode, 400);
  assert.match(resDisp.body.message, /already received/i);
});

test('11. QR Code mismatch prevents acknowledgement', async () => {
  resetMockDb();

  const shipmentId = 'ship-111';
  const retId = 'ret-valid';

  mockState['shipments'] = [{
    id: shipmentId,
    receiver_id: retId,
    batch_number: 'BATCH-REAL-111',
    status: 'DELIVERED'
  }];

  const { req, res } = createMockReqRes({
    user: { id: retId, role: 'retailer' },
    params: { id: shipmentId },
    body: { qr_data: 'WRONG-QR-SCANNED' }
  });

  await acknowledgeDeliveryReceipt(req, res);

  assert.strictEqual(res.statusCode, 400);
  assert.match(res.body.message, /QR Code mismatch/i);
});

test('12. Existing receiveProduct seamlessly marks proof acknowledged if one exists', async () => {
  resetMockDb();

  const shipmentId = 'ship-112';
  const retId = 'ret-legacy';
  const batchNum = 'BATCH-LEGACY-112';
  const prodId = 'prod-legacy';

  mockState['shipments'] = [{
    id: shipmentId,
    batch_number: batchNum,
    product_id: prodId,
    receiver_id: retId,
    quantity: 30,
    unit: 'kg',
    status: 'DELIVERED'
  }];

  mockState['proof_of_delivery'] = [{
    id: 'pod-112',
    shipment_id: shipmentId,
    status: 'SUBMITTED'
  }];

  mockState['products'] = [{
    id: prodId,
    current_owner_id: 'dist-1'
  }];

  const { req, res } = createMockReqRes({
    user: { id: retId, role: 'retailer' },
    body: { shipment_id: shipmentId, qr_data: batchNum }
  });

  await receiveProduct(req, res);

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.success, true);

  // Verify POD status was updated to ACKNOWLEDGED
  const podUpdate = mockUpdates['proof_of_delivery'].find(u => u.payload.status === 'ACKNOWLEDGED');
  assert.ok(podUpdate, 'proof_of_delivery should be updated to ACKNOWLEDGED');
});

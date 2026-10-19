import './src/test_preload';
import { assertApprovedLocalEnvironment } from './src/utils/localDatabaseGuard';

assertApprovedLocalEnvironment('RetailerSalesUnit');

import test from 'node:test';
import assert from 'node:assert';
import { Request, Response } from 'express';
import { supabase } from './src/config/supabase';
import { recordSale } from './src/controllers/retailerController';

// --- Mocking Strategy ---
const originalFrom = supabase.from;

let mockState: Record<string, any> = {};
let mockCalls: any[] = [];

supabase.from = (table: string): any => {
  const state = mockState[table] || {};

  // Track the lifecycle of this query builder chain
  const query = {
    table,
    action: 'select',
    filters: [] as {col: string, val: any}[],
    selectCols: '*',
    payload: null as any,
    isSingle: false,
    returnsData: false
  };

  const chain: any = {
    select: (cols: string = '*') => {
      if (query.action === 'select') query.selectCols = cols;
      query.returnsData = true;
      return chain;
    },
    eq: (col: string, val: any) => {
      query.filters.push({col, val});
      return chain;
    },
    update: (payload: any) => {
      query.action = 'update';
      query.payload = payload;
      return chain;
    },
    insert: (payload: any) => {
      query.action = 'insert';
      query.payload = payload;
      return chain;
    },
    single: () => {
      query.isSingle = true;
      return chain;
    },
    // The query builder acts as a Promise when awaited
    then: (resolve: any, reject: any) => {
      // Record the exact state of the query at execution time
      mockCalls.push(JSON.parse(JSON.stringify(query)));

      let result;
      if (query.action === 'select') {
        result = state.onSelect ? state.onSelect(query) : { data: query.isSingle ? null : [], error: null };
      } else if (query.action === 'update') {
        result = state.onUpdate ? state.onUpdate(query) : { data: [], error: null };
      } else if (query.action === 'insert') {
        result = state.onInsert ? state.onInsert(query) : { data: null, error: null };
      }

      Promise.resolve(result).then(resolve).catch(reject);
    }
  };
  return chain;
};

// Express Request/Response Mock Builders
const mockReq = (body: any, user: any) => ({
  body,
  user
} as Request);

const mockRes = () => {
  const res: any = {};
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (data: any) => {
    res.body = data;
    return res;
  };
  return res as Response & { statusCode: number, body: any };
};

// --- Test Suite ---
test('recordSale Controller Unit Tests', async (t) => {

  t.beforeEach(() => {
    // Ensure total isolation between tests
    mockState = {
      retailer_inventory: {},
      retailer_sales: {},
      event_outbox: {},
      traceability_events: {}
    };
    mockCalls = [];
  });

  t.after(() => {
    // Un-mock global supabase singleton
    supabase.from = originalFrom;
  });

  await t.test('1. Missing retailer identity returns 401', async () => {
    const req = mockReq({ inventory_id: 'inv1', quantity_sold: 5 }, null);
    const res = mockRes();
    await recordSale(req, res);
    assert.strictEqual(res.statusCode, 401);
  });

  await t.test('2. Missing inventory ID and non-positive quantity return 400', async () => {
    const req1 = mockReq({ quantity_sold: 5 }, { id: 'ret1' });
    const res1 = mockRes();
    await recordSale(req1, res1);
    assert.strictEqual(res1.statusCode, 400);

    const req2 = mockReq({ inventory_id: 'inv1', quantity_sold: 0 }, { id: 'ret1' });
    const res2 = mockRes();
    await recordSale(req2, res2);
    assert.strictEqual(res2.statusCode, 400);
  });

  await t.test('3. Inventory belonging to another retailer returns 403', async () => {
    mockState.retailer_inventory.onSelect = () => ({
      data: { retailer_id: 'ret2', quantity: 10, expiry_date: '2099-01-01' }
    });
    const req = mockReq({ inventory_id: 'inv1', quantity_sold: 5 }, { id: 'ret1' });
    const res = mockRes();
    await recordSale(req, res);
    assert.strictEqual(res.statusCode, 403);
  });

  await t.test('4. Expired inventory returns 400', async () => {
    mockState.retailer_inventory.onSelect = () => ({
      data: { retailer_id: 'ret1', quantity: 10, expiry_date: '2000-01-01' }
    });
    const req = mockReq({ inventory_id: 'inv1', quantity_sold: 5 }, { id: 'ret1' });
    const res = mockRes();
    await recordSale(req, res);
    assert.strictEqual(res.statusCode, 400);
    assert.match(res.body.message, /expired/);
  });

  await t.test('5. Insufficient inventory returns 400', async () => {
    mockState.retailer_inventory.onSelect = () => ({
      data: { retailer_id: 'ret1', quantity: 2, expiry_date: '2099-01-01' }
    });
    const req = mockReq({ inventory_id: 'inv1', quantity_sold: 5 }, { id: 'ret1' });
    const res = mockRes();
    await recordSale(req, res);
    assert.strictEqual(res.statusCode, 400);
    assert.match(res.body.message, /Insufficient stock/);
  });

  await t.test('6. Successful sale updates inventory, inserts record, handles outbox/traceability', async () => {
    mockState.retailer_inventory.onSelect = (query: any) => {
      // Assert the initial select query filters
      assert.strictEqual(query.isSingle, true);
      assert.ok(query.filters.find((f: any) => f.col === 'id' && f.val === 'inv1'));
      return {
        data: { retailer_id: 'ret1', quantity: 10, status: 'AVAILABLE', expiry_date: '2099-01-01', batch_number: 'B1', unit: 'kg', product_id: 'prod1' }
      };
    };
    mockState.retailer_inventory.onUpdate = (query: any) => ({
      data: [{ id: 'inv1', quantity: query.payload.quantity, status: query.payload.status }]
    });

    const req = mockReq({ inventory_id: 'inv1', quantity_sold: 5, price_per_unit: 10 }, { id: 'ret1' });
    const res = mockRes();
    await recordSale(req, res);

    assert.strictEqual(res.statusCode, 200, res.body?.message);
    assert.strictEqual(res.body.data.remaining_quantity, 5);

    // Assert Inventory Update
    const invUpdates = mockCalls.filter(c => c.table === 'retailer_inventory' && c.action === 'update');
    assert.strictEqual(invUpdates.length, 1);
    assert.strictEqual(invUpdates[0].payload.quantity, 5);
    assert.strictEqual(invUpdates[0].payload.status, 'AVAILABLE');

    // Assert Sale Insert
    const saleInserts = mockCalls.filter(c => c.table === 'retailer_sales' && c.action === 'insert');
    assert.strictEqual(saleInserts.length, 1);
    assert.strictEqual(saleInserts[0].payload.retailer_id, 'ret1');
    assert.strictEqual(saleInserts[0].payload.inventory_id, 'inv1');
    assert.strictEqual(saleInserts[0].payload.quantity_sold, 5);
    assert.strictEqual(saleInserts[0].payload.price_per_unit, 10);

    // Assert Outbox Events
    const outboxInserts = mockCalls.filter(c => c.table === 'event_outbox' && c.action === 'insert');
    assert.strictEqual(outboxInserts.length, 2);

    const saleEvent = outboxInserts.find(c => c.payload.event_type === 'SALE_CREATED');
    assert.ok(saleEvent, 'Missing SALE_CREATED event');
    assert.strictEqual(saleEvent.payload.payload.quantity_sold, 5);
    assert.strictEqual(saleEvent.payload.payload.batch_id, 'B1');

    const invEvent = outboxInserts.find(c => c.payload.event_type === 'INVENTORY_UPDATED');
    assert.ok(invEvent, 'Missing INVENTORY_UPDATED event');
    assert.strictEqual(invEvent.payload.payload.new_quantity, 5);

    // Assert Traceability Event
    const traceInserts = mockCalls.filter(c => c.table === 'traceability_events' && c.action === 'insert');
    assert.strictEqual(traceInserts.length, 1);
    assert.strictEqual(traceInserts[0].payload.event_type, 'RETAILER_SOLD');
    assert.strictEqual(traceInserts[0].payload.actor_id, 'ret1');
    assert.strictEqual(traceInserts[0].payload.batch_number, 'B1');
    assert.strictEqual(traceInserts[0].payload.metadata.quantity_sold, 5);
  });

  await t.test('7. Sale-record insertion failure attempts compensation and returns 500', async () => {
    mockState.retailer_inventory.onSelect = () => ({
      data: { retailer_id: 'ret1', quantity: 10, status: 'AVAILABLE', expiry_date: '2099-01-01', batch_number: 'B1' }
    });
    mockState.retailer_inventory.onUpdate = () => ({ data: [{ id: 'inv1' }] });

    // Explicitly return a Supabase `{ error }` payload to simulate DB failure
    mockState.retailer_sales.onInsert = () => ({ error: new Error('DB Error') });

    const req = mockReq({ inventory_id: 'inv1', quantity_sold: 5 }, { id: 'ret1' });
    const res = mockRes();
    await recordSale(req, res);

    assert.strictEqual(res.statusCode, 500);
    assert.match(res.body.message, /reverted/);

    const invUpdates = mockCalls.filter(c => c.table === 'retailer_inventory' && c.action === 'update');
    assert.strictEqual(invUpdates.length, 2, 'Compensation rollback update was not called');

    // First update (sale attempt)
    assert.strictEqual(invUpdates[0].payload.quantity, 5);
    // Second update (compensation rollback to original)
    assert.strictEqual(invUpdates[1].payload.quantity, 10);
    assert.strictEqual(invUpdates[1].payload.status, 'AVAILABLE');
  });

  await t.test('8. Traceability insertion failure follows implementation behavior', async () => {
    mockState.retailer_inventory.onSelect = () => ({
      data: { retailer_id: 'ret1', quantity: 10, expiry_date: '2099-01-01' }
    });
    mockState.retailer_inventory.onUpdate = () => ({ data: [{}] });
    // Returns `{ error }` object per Supabase standard, does not throw
    mockState.traceability_events.onInsert = () => ({ error: new Error('Trace Err') });

    const req = mockReq({ inventory_id: 'inv1', quantity_sold: 5 }, { id: 'ret1' });
    const res = mockRes();
    await recordSale(req, res);

    // Traceability failure is logged internally but doesn't halt the 200 response
    assert.strictEqual(res.statusCode, 200);
  });

  await t.test('9. Outbox insertion failures are explicitly characterized', async () => {
    mockState.retailer_inventory.onSelect = () => ({
      data: { retailer_id: 'ret1', quantity: 10, expiry_date: '2099-01-01' }
    });
    mockState.retailer_inventory.onUpdate = () => ({ data: [{}] });

    // Returns `{ error }` object per Supabase standard, does not throw
    mockState.event_outbox.onInsert = () => ({ error: new Error('Outbox Insert Failed') });

    const req = mockReq({ inventory_id: 'inv1', quantity_sold: 5 }, { id: 'ret1' });
    const res = mockRes();
    await recordSale(req, res);

    const outboxInserts = mockCalls.filter(c => c.table === 'event_outbox' && c.action === 'insert');
    assert.strictEqual(outboxInserts.length, 2, 'Outbox inserts should have been attempted');

    // The controller awaits `insert()` but does not extract or check the `{ error }` returned.
    // This swallows the failure.
    assert.strictEqual(res.statusCode, 200, 'Controller ignores returned error objects from outbox inserts');
  });

  await t.test('10. Inventory update conflict handling (Unit-level handling of empty update)', async () => {
    mockState.retailer_inventory.onSelect = () => ({
      data: { retailer_id: 'ret1', quantity: 10, expiry_date: '2099-01-01' }
    });

    // Unit test proof: By returning an empty array `data: []` from the update mock,
    // we simulate the controller's condition for `updateData.length === 0` (OCC conflict).
    // Note: This does not prove real-world concurrency safety, only the controller's logic path.
    mockState.retailer_inventory.onUpdate = () => ({ data: [] });

    const req = mockReq({ inventory_id: 'inv1', quantity_sold: 5 }, { id: 'ret1' });
    const res = mockRes();
    await recordSale(req, res);

    assert.strictEqual(res.statusCode, 409);
    assert.match(res.body.message, /concurrently/);
  });

});

import './src/test_preload';
import { assertApprovedLocalEnvironment } from './src/utils/localDatabaseGuard';

assertApprovedLocalEnvironment('RetailerSalesUnit');

import test from 'node:test';
import assert from 'node:assert';
import { Request, Response } from 'express';
import { supabase } from './src/config/supabase';
import { recordSale } from './src/controllers/retailerController';

// --- Mocking Strategy for v2 Atomic Stored Procedure ---
const originalRpc = supabase.rpc;

let mockRpcHandler: ((proc: string, params: any) => Promise<any>) | null = null;
let mockRpcCalls: { proc: string; params: any }[] = [];

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
test('recordSale Controller Unit Tests (v2 Atomic Stored Procedure)', async (t) => {

  t.beforeEach(() => {
    mockRpcCalls = [];
    (supabase as any).rpc = async (proc: string, params: any) => {
      mockRpcCalls.push({ proc, params });
      if (mockRpcHandler) {
        return mockRpcHandler(proc, params);
      }
      return { data: null, error: null };
    };
  });

  t.after(() => {
    supabase.rpc = originalRpc;
  });

  await t.test('1. Missing retailer identity returns 401', async () => {
    const req = mockReq({ inventory_id: 'inv1', quantity_sold: 5, price_per_unit: 10 }, null);
    const res = mockRes();
    await recordSale(req, res);
    assert.strictEqual(res.statusCode, 401);
  });

  await t.test('2. Missing inventory ID, non-positive quantity, or invalid price returns 400', async () => {
    // Missing inventory_id
    const req1 = mockReq({ quantity_sold: 5, price_per_unit: 10 }, { id: 'ret1' });
    const res1 = mockRes();
    await recordSale(req1, res1);
    assert.strictEqual(res1.statusCode, 400);

    // Zero quantity
    const req2 = mockReq({ inventory_id: 'inv1', quantity_sold: 0, price_per_unit: 10 }, { id: 'ret1' });
    const res2 = mockRes();
    await recordSale(req2, res2);
    assert.strictEqual(res2.statusCode, 400);

    // Negative price
    const req3 = mockReq({ inventory_id: 'inv1', quantity_sold: 5, price_per_unit: -1 }, { id: 'ret1' });
    const res3 = mockRes();
    await recordSale(req3, res3);
    assert.strictEqual(res3.statusCode, 400);
  });

  await t.test('3. Inventory not found (P0002) returns 404', async () => {
    mockRpcHandler = async () => ({
      data: null,
      error: { code: 'P0002', message: 'Inventory item not found' }
    });
    const req = mockReq({ inventory_id: 'inv1', quantity_sold: 5, price_per_unit: 10 }, { id: 'ret1' });
    const res = mockRes();
    await recordSale(req, res);
    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.body.message, 'Inventory item not found');
  });

  await t.test('4. Inventory belonging to another retailer (42501) returns 403', async () => {
    mockRpcHandler = async () => ({
      data: null,
      error: { code: '42501', message: 'You do not own this inventory item' }
    });
    const req = mockReq({ inventory_id: 'inv1', quantity_sold: 5, price_per_unit: 10 }, { id: 'ret1' });
    const res = mockRes();
    await recordSale(req, res);
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.body.message, 'You do not own this inventory item');
  });

  await t.test('5. Expired inventory (22023 expired) returns 400', async () => {
    mockRpcHandler = async () => ({
      data: null,
      error: { code: '22023', message: 'Cannot sell expired items' }
    });
    const req = mockReq({ inventory_id: 'inv1', quantity_sold: 5, price_per_unit: 10 }, { id: 'ret1' });
    const res = mockRes();
    await recordSale(req, res);
    assert.strictEqual(res.statusCode, 400);
    assert.match(res.body.message, /expired/);
  });

  await t.test('6. Insufficient inventory (22023 Insufficient stock) returns 400', async () => {
    mockRpcHandler = async () => ({
      data: null,
      error: { code: '22023', message: 'Insufficient stock in inventory' }
    });
    const req = mockReq({ inventory_id: 'inv1', quantity_sold: 5, price_per_unit: 10 }, { id: 'ret1' });
    const res = mockRes();
    await recordSale(req, res);
    assert.strictEqual(res.statusCode, 400);
    assert.match(res.body.message, /Insufficient stock/);
  });

  await t.test('7. Concurrency conflict (40001) returns 409', async () => {
    mockRpcHandler = async () => ({
      data: null,
      error: { code: '40001', message: 'Serialization error' }
    });
    const req = mockReq({ inventory_id: 'inv1', quantity_sold: 5, price_per_unit: 10 }, { id: 'ret1' });
    const res = mockRes();
    await recordSale(req, res);
    assert.strictEqual(res.statusCode, 409);
    assert.match(res.body.message, /modified/);
  });

  await t.test('8. Generic database error returns 500', async () => {
    mockRpcHandler = async () => ({
      data: null,
      error: { code: '50000', message: 'Unexpected database failure' }
    });
    const req = mockReq({ inventory_id: 'inv1', quantity_sold: 5, price_per_unit: 10 }, { id: 'ret1' });
    const res = mockRes();
    await recordSale(req, res);
    assert.strictEqual(res.statusCode, 500);
    assert.strictEqual(res.body.message, 'Failed to record sale');
  });

  await t.test('9. Successful sale records transaction and returns 200 with remaining quantity', async () => {
    mockRpcHandler = async (proc, params) => {
      assert.strictEqual(proc, 'record_retailer_sale');
      assert.strictEqual(params.p_retailer_id, 'ret1');
      assert.strictEqual(params.p_inventory_id, 'inv1');
      assert.strictEqual(params.p_quantity_sold, 5);
      assert.strictEqual(params.p_price_per_unit, 10);
      return {
        data: {
          sale_id: 'sale-uuid-1234',
          remaining_quantity: 5,
          status: 'AVAILABLE'
        },
        error: null
      };
    };

    const req = mockReq({ inventory_id: 'inv1', quantity_sold: 5, price_per_unit: 10 }, { id: 'ret1' });
    const res = mockRes();
    await recordSale(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.sale_id, 'sale-uuid-1234');
    assert.strictEqual(res.body.data.remaining_quantity, 5);
    assert.strictEqual(mockRpcCalls.length, 1);
  });

});

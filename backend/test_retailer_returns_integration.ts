
import './src/test_preload';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import assert from 'node:assert/strict';
import { assertApprovedLocalEnvironment } from './src/utils/localDatabaseGuard';

assertApprovedLocalEnvironment('RetailerReturnsIntegration');

if (process.env.SUPABASE_URL !== 'http://127.0.0.1:54321') {
    throw new Error('ABORT: Local Supabase only.');
}

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('ABORT: Local service-role key missing.');
}

const API = 'http://127.0.0.1:5000/api';
const RUN_ID = `INT-RETURN-${Date.now()}`;
const BATCH = `${RUN_ID}-B1`;

const db = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
);

const state = {
    userIds: [] as string[],
    productIds: [] as string[],
    inventoryIds: [] as string[]
};

async function main() {
    let retailerId = '';
    let token = '';
    let inventoryId = '';

    try {
        console.log(`=== Retailer Returns Test: ${RUN_ID} ===`);

        const email = `${RUN_ID}@local.dev`;
        const password = 'SafePassword123';

        const { data: user, error: userError } = await db
            .from('users')
            .insert({
                name: 'Returns Integration Retailer',
                email,
                password: await bcrypt.hash(password, 10),
                role: 'retailer'
            })
            .select('id')
            .single();

        if (userError || !user) {
            throw new Error(`User fixture failed: ${userError?.message}`);
        }

        retailerId = user.id;
        state.userIds.push(user.id);

        const login = await axios.post(`${API}/auth/login`, {
            email,
            password
        });

        assert.equal(login.status, 200);
        token = login.data.token;
        console.log('[Pass] Local retailer login.');

        const { data: product, error: productError } = await db
            .from('products')
            .insert({
                name: 'Returns Test Apples',
                category: 'Fruits',
                batch_number: BATCH,
                quantity: 100,
                farmer_id: retailerId,
                current_owner_id: retailerId,
                status: 'AVAILABLE',
                unit: 'kg'
            })
            .select('id')
            .single();

        if (productError || !product) {
            throw new Error(`Product fixture failed: ${productError?.message}`);
        }

        state.productIds.push(product.id);

        const { data: inventory, error: inventoryError } = await db
            .from('retailer_inventory')
            .insert({
                retailer_id: retailerId,
                product_id: product.id,
                batch_number: BATCH,
                quantity: 100,
                unit: 'kg',
                expiry_date: '2099-01-01',
                status: 'AVAILABLE'
            })
            .select('id')
            .single();

        if (inventoryError || !inventory) {
            throw new Error(`Inventory fixture failed: ${inventoryError?.message}`);
        }

        inventoryId = inventory.id;
        state.inventoryIds.push(inventory.id);

        const sale = await axios.post(`${API}/retailer/sales`, {
            inventory_id: inventoryId,
            quantity_sold: 10,
            price_per_unit: 20
        }, {
            headers: { Authorization: `Bearer ${token}` }
        });

        assert.equal(sale.status, 200, 'Sale fixture should succeed');
        console.log('[Pass] Created a real 10 kg sale.');

        const response = await axios.post(`${API}/retailer/returns`, {
            inventory_id: inventoryId,
            quantity: 5,
            condition: 'Good',
            reason: 'Integration test'
        }, {
            headers: { Authorization: `Bearer ${token}` }
        });

        assert.equal(response.status, 200, 'Good return should succeed');
        assert.equal(response.data.success, true);

        const { data: returns, error: returnsError } = await db
            .from('retailer_returns')
            .select('id, retailer_id, inventory_id, quantity, condition')
            .eq('inventory_id', inventoryId)
            .eq('retailer_id', retailerId);

        if (returnsError) throw new Error(returnsError.message);
        assert.equal(returns?.length, 1);
        assert.equal(Number(returns?.[0].quantity), 5);
        assert.equal(returns?.[0].condition, 'Good');

        const { data: updatedInventory, error: updatedError } = await db
            .from('retailer_inventory')
            .select('quantity, status')
            .eq('id', inventoryId)
            .single();

        if (updatedError || !updatedInventory) {
            throw new Error(`Inventory verification failed: ${updatedError?.message}`);
        }

        assert.equal(Number(updatedInventory.quantity), 95);
        assert.equal(updatedInventory.status, 'AVAILABLE');

        console.log('[Pass] Good return recorded.');
        console.log('[Pass] Inventory restored to 95 kg.');
        console.log('[Pass] Return database assertions passed.');

        // Reject a return exceeding the remaining eligible sold quantity.
        let excessiveReturnRejected = false;

        try {
            await axios.post(`${API}/retailer/returns`, {
                inventory_id: inventoryId,
                quantity: 6,
                condition: 'Good',
                reason: 'Excessive return integration test'
            }, {
                headers: { Authorization: `Bearer ${token}` }
            });
        } catch (error: any) {
            if (error.response?.status === 400) {
                excessiveReturnRejected = true;
            } else {
                throw error;
            }
        }

        assert.equal(
            excessiveReturnRejected,
            true,
            'Returning 6 kg after only 5 kg remains eligible should return HTTP 400'
        );

        const { data: returnsAfterRejection, error: rejectedReturnsError } = await db
            .from('retailer_returns')
            .select('id')
            .eq('inventory_id', inventoryId)
            .eq('retailer_id', retailerId);

        if (rejectedReturnsError) throw new Error(rejectedReturnsError.message);

        assert.equal(
            returnsAfterRejection?.length,
            1,
            'Rejected return must not create another return record'
        );

        const { data: inventoryAfterRejection, error: rejectedInventoryError } = await db
            .from('retailer_inventory')
            .select('quantity')
            .eq('id', inventoryId)
            .single();

        if (rejectedInventoryError || !inventoryAfterRejection) {
            throw new Error(`Post-rejection inventory check failed: ${rejectedInventoryError?.message}`);
        }

        assert.equal(
            Number(inventoryAfterRejection.quantity),
            95,
            'Rejected return must not change inventory'
        );

        console.log('[Pass] Excessive return rejected with HTTP 400.');
        console.log('[Pass] Rejected return left database records and inventory unchanged.');

                // Reject invalid return quantities and conditions.
        const invalidCases = [
            { quantity: -1, condition: 'Good' },
            { quantity: 0, condition: 'Good' },
            { quantity: 1, condition: 'Unknown' }
        ];

        for (const testCase of invalidCases) {
            let rejected = false;

            try {
                await axios.post(`${API}/retailer/returns`, {
                    inventory_id: inventoryId,
                    quantity: testCase.quantity,
                    condition: testCase.condition,
                    reason: 'Invalid input integration test'
                }, {
                    headers: { Authorization: `Bearer ${token}` }
                });
            } catch (error: any) {
                if (error.response?.status === 400) {
                    rejected = true;
                } else {
                    throw error;
                }
            }

            assert.equal(
                rejected,
                true,
                `Invalid return should be rejected: quantity=${testCase.quantity}, condition=${testCase.condition}`
            );
        }

        console.log('[Pass] Negative, zero, and invalid-condition returns rejected.');


        // Verify a damaged return is sent to wastage without changing remaining stock.
        const damagedReturn = await axios.post(`${API}/retailer/returns`, {
            inventory_id: inventoryId,
            quantity: 2,
            condition: 'Damaged',
            reason: 'Damaged return integration test'
        }, {
            headers: { Authorization: `Bearer ${token}` }
        });

        assert.equal(damagedReturn.status, 200);
        assert.equal(damagedReturn.data.data.resolution, 'Sent to Wastage');
        assert.equal(damagedReturn.data.data.effective_condition, 'Damaged');

        const { data: damagedInventory, error: damagedInventoryError } = await db
            .from('retailer_inventory')
            .select('quantity')
            .eq('id', inventoryId)
            .single();

        if (damagedInventoryError || !damagedInventory) {
            throw new Error(`Damaged-return inventory check failed: ${damagedInventoryError?.message}`);
        }

        assert.equal(Number(damagedInventory.quantity), 95);

        const { data: damagedWastage, error: damagedWastageError } = await db
            .from('retailer_wastage')
            .select('id, quantity, reason')
            .eq('inventory_id', inventoryId)
            .eq('retailer_id', retailerId)
            .eq('reason', 'Customer Return - Damaged');

        if (damagedWastageError) throw new Error(damagedWastageError.message);
        assert.equal(damagedWastage?.length, 1);
        assert.equal(Number(damagedWastage?.[0].quantity), 2);

        console.log('[Pass] Damaged return created wastage without changing inventory.');

        // Make the same inventory expired for the next scenario.
        const { error: expireInventoryError } = await db
            .from('retailer_inventory')
            .update({ expiry_date: '2000-01-01' })
            .eq('id', inventoryId);

        if (expireInventoryError) {
            throw new Error(`Could not prepare expired-return fixture: ${expireInventoryError.message}`);
        }

        // The request says Good, but the expired inventory must go to wastage.
        const expiredReturn = await axios.post(`${API}/retailer/returns`, {
            inventory_id: inventoryId,
            quantity: 1,
            condition: 'Good',
            reason: 'Expired return integration test'
        }, {
            headers: { Authorization: `Bearer ${token}` }
        });

        assert.equal(expiredReturn.status, 200);
        assert.equal(expiredReturn.data.data.resolution, 'Sent to Wastage');
        assert.equal(expiredReturn.data.data.effective_condition, 'Expired');

        const { data: expiredInventory, error: expiredInventoryError } = await db
            .from('retailer_inventory')
            .select('quantity')
            .eq('id', inventoryId)
            .single();

        if (expiredInventoryError || !expiredInventory) {
            throw new Error(`Expired-return inventory check failed: ${expiredInventoryError?.message}`);
        }

        assert.equal(Number(expiredInventory.quantity), 95);

        const { data: expiredWastage, error: expiredWastageError } = await db
            .from('retailer_wastage')
            .select('id, quantity, reason')
            .eq('inventory_id', inventoryId)
            .eq('retailer_id', retailerId)
            .eq('reason', 'Customer Return - Expired');

        if (expiredWastageError) throw new Error(expiredWastageError.message);
        assert.equal(expiredWastage?.length, 1);
        assert.equal(Number(expiredWastage?.[0].quantity), 1);

        // Confirm both returns have corresponding traceability events.
        const { data: returnEvents, error: returnEventsError } = await db
            .from('traceability_events')
            .select('metadata')
            .eq('batch_number', BATCH)
            .eq('event_type', 'RETAILER_RETURNED')
            .eq('actor_id', retailerId);

        if (returnEventsError) throw new Error(returnEventsError.message);
        assert.equal(returnEvents?.length, 3);

        console.log('[Pass] Expired inventory was sent to wastage despite Good condition.');
        console.log('[Pass] Damaged and expired returns preserved inventory and recorded traceability.');


    } catch (error: any) {
        console.error('[Fail]', error?.response?.data || error?.message || error);
        throw error;
    } finally {
        console.log('Cleaning up records created by this test...');

        const cleanup = async (name: string, query: PromiseLike<any>) => {
            const { error } = await query;
            if (error) {
                console.error(`[Cleanup warning] ${name}: ${error.message}`);
            }
        };

        // Delete dependent event records before deleting their product.
        await cleanup(
            'Outbox events',
            db.from('event_outbox')
                .delete()
                .filter('payload->>batch_id', 'eq', BATCH)
        );

        await cleanup(
            'Traceability events',
            db.from('traceability_events')
                .delete()
                .eq('batch_number', BATCH)
        );

        if (inventoryId) {
            await cleanup(
                'Returns',
                db.from('retailer_returns')
                    .delete()
                    .eq('inventory_id', inventoryId)
                    .eq('retailer_id', retailerId)
            );

            await cleanup(
                'Sales',
                db.from('retailer_sales')
                    .delete()
                    .eq('inventory_id', inventoryId)
                    .eq('retailer_id', retailerId)
            );

            await cleanup(
                'Wastage',
                db.from('retailer_wastage')
                    .delete()
                    .eq('inventory_id', inventoryId)
                    .eq('retailer_id', retailerId)
            );
        }

        if (state.inventoryIds.length) {
            await cleanup(
                'Inventory',
                db.from('retailer_inventory')
                    .delete()
                    .in('id', state.inventoryIds)
            );
        }

        if (state.productIds.length) {
            await cleanup(
                'Product',
                db.from('products')
                    .delete()
                    .in('id', state.productIds)
            );
        }

        if (state.userIds.length) {
            await cleanup(
                'User',
                db.from('users')
                    .delete()
                    .in('id', state.userIds)
            );
        }

        console.log('Cleanup finished.');
    }
}

main().catch(() => {
    process.exitCode = 1;
});

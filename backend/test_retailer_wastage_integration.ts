
import './src/test_preload';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import assert from 'node:assert';
import { assertApprovedLocalEnvironment } from './src/utils/localDatabaseGuard';

assertApprovedLocalEnvironment('RetailerWastageIntegration');

if (process.env.SUPABASE_URL !== 'http://127.0.0.1:54321') {
    console.error('ABORT: This test only runs against local Supabase.');
    process.exit(1);
}

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('ABORT: Local service-role key is missing.');
    process.exit(1);
}

const API_URL = 'http://127.0.0.1:5000/api';
const RUN_ID = `INT-WASTE-${Date.now()}`;
const BATCH_ID = `${RUN_ID}-B1`;

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
);

const state = {
    userIds: [] as string[],
    userEmails: [] as string[],
    productIds: [] as string[],
    inventoryIds: [] as string[],
    wastageIds: [] as string[]
};

const postWastage = (token: string, payload: object) =>
    axios.post(`${API_URL}/retailer/wastage`, payload, {
        headers: { Authorization: `Bearer ${token}` }
    }).catch((error) => error.response);

export async function run() {
    console.log(`\n=== Retailer Wastage Integration Test: ${RUN_ID} ===`);
    const dbErrors: string[] = [];

    try {
        // Canary login confirms the backend uses the local database.
        const canaryEmail = `canary_${RUN_ID}@local.dev`;
        const canaryPassword = 'SafePassword123';
        state.userEmails.push(canaryEmail);

        const hash = await bcrypt.hash(canaryPassword, 10);
        const { data: canary, error: canaryError } = await supabase
            .from('users')
            .insert({
                name: 'Wastage Canary',
                email: canaryEmail,
                password: hash,
                role: 'retailer'
            })
            .select('id')
            .single();

        if (canaryError || !canary) {
            throw new Error(`Canary creation failed: ${canaryError?.message}`);
        }

        state.userIds.push(canary.id);
        const loginCheck = await axios.post(`${API_URL}/auth/login`, {
            email: canaryEmail,
            password: canaryPassword
        });
        assert.strictEqual(loginCheck.status, 200);
        console.log('[Pass] Local backend canary login.');

        const registerUser = async (name: string, role: string) => {
            const email = `${name}_${RUN_ID}@test.local`;
            state.userEmails.push(email);

            await axios.post(`${API_URL}/auth/register`, {
                name,
                email,
                password: 'password123',
                role
            });

            const { data: user, error } = await supabase
                .from('users')
                .select('id')
                .eq('email', email)
                .single();

            if (error || !user) {
                throw new Error(`User fixture failed: ${error?.message}`);
            }

            state.userIds.push(user.id);

            const { error: roleError } = await supabase
                .from('users')
                .update({ role })
                .eq('id', user.id);

            if (roleError) throw new Error(`Role update failed: ${roleError.message}`);

            const login = await axios.post(`${API_URL}/auth/login`, {
                email,
                password: 'password123'
            });

            return { id: user.id, token: login.data.token };
        };

        const farmer = await registerUser('WastageFarmer', 'farmer');
        const retailerA = await registerUser('WastageRetailerA', 'retailer');
        const retailerB = await registerUser('WastageRetailerB', 'retailer');

        const { data: product, error: productError } = await supabase
            .from('products')
            .insert({
                name: 'Wastage Test Apples',
                category: 'Fruits',
                quantity: 500,
                batch_number: BATCH_ID,
                farmer_id: farmer.id,
                current_owner_id: retailerA.id,
                status: 'AVAILABLE'
            })
            .select('id')
            .single();

        if (productError || !product) {
            throw new Error(`Product fixture failed: ${productError?.message}`);
        }
        state.productIds.push(product.id);

        const createInventory = async (retailerId: string, quantity: number) => {
            const { data, error } = await supabase
                .from('retailer_inventory')
                .insert({
                    retailer_id: retailerId,
                    product_id: product.id,
                    batch_number: BATCH_ID,
                    quantity,
                    unit: 'kg',
                    expiry_date: '2099-01-01',
                    status: 'AVAILABLE'
                })
                .select('id')
                .single();

            if (error || !data) {
                throw new Error(`Inventory fixture failed: ${error?.message}`);
            }

            state.inventoryIds.push(data.id);
            return data;
        };

        const ownedInventory = await createInventory(retailerA.id, 100);
        const otherInventory = await createInventory(retailerB.id, 20);
        const concurrencyInventory = await createInventory(retailerA.id, 10);

        console.log('\n-> API assertions');

        const t1 = await postWastage('invalid_token', {
            inventory_id: ownedInventory.id,
            quantity: 5,
            reason: 'Damaged'
        });
        assert.strictEqual(t1?.status, 401, 'Unauthenticated request should return 401');
        console.log('[Pass] Unauthenticated request -> 401');

        const t2 = await postWastage(retailerA.token, {
            inventory_id: ownedInventory.id,
            quantity: -5,
            reason: 'Damaged'
        });
        assert.strictEqual(t2?.status, 400, 'Invalid quantity should return 400');
        console.log('[Pass] Negative quantity -> 400');

        const t3 = await postWastage(retailerA.token, {
            inventory_id: otherInventory.id,
            quantity: 5,
            reason: 'Damaged'
        });
        assert.strictEqual(t3?.status, 403, 'Cross-owner request should return 403');
        console.log('[Pass] Cross-retailer request -> 403');


        const t4 = await postWastage(retailerA.token, {
            inventory_id: ownedInventory.id,
            quantity: 101,
            reason: 'Damaged'
        });

        console.log('[T4 diagnostic]', t4?.status, t4?.data);
        assert.strictEqual(t4?.status, 409, 'Insufficient stock should return 409');
        console.log('[Pass] Insufficient stock -> 409');


        const t5 = await postWastage(retailerA.token, {
            inventory_id: ownedInventory.id,
            quantity: 10,
            reason: 'Damaged packaging',
            notes: 'Integration test'
        });
        assert.strictEqual(t5?.status, 200, 'Valid wastage should return 200');
        assert.ok(t5?.data?.data?.wastage_id, 'Response must contain wastage_id');
        state.wastageIds.push(t5.data.data.wastage_id);
        assert.strictEqual(Number(t5.data.data.remaining_quantity), 90);
        assert.strictEqual(t5.data.data.status, 'AVAILABLE');
        console.log('[Pass] Valid wastage; remaining stock = 90 kg');

        // Two requests compete for the same 10 kg inventory.
        const [c1, c2] = await Promise.all([
            postWastage(retailerA.token, {
                inventory_id: concurrencyInventory.id,
                quantity: 10,
                reason: 'Concurrent test'
            }),
            postWastage(retailerA.token, {
                inventory_id: concurrencyInventory.id,
                quantity: 10,
                reason: 'Concurrent test'
            })
        ]);

        const statuses = [c1?.status, c2?.status].sort((a, b) => a - b);
        console.log(`[Concurrency] HTTP statuses: ${statuses.join(', ')}`);
        assert.deepStrictEqual(statuses, [200, 409]);
        const concurrentSuccess = [c1, c2].find((response) => response?.status === 200);
        assert.ok(concurrentSuccess?.data?.data?.wastage_id);
        state.wastageIds.push(concurrentSuccess.data.data.wastage_id);
        console.log('[Pass] Concurrent wastage allows exactly one success.');

        console.log('\n-> Database assertions');

        const { data: inventoryRows, error: inventoryError } = await supabase
            .from('retailer_inventory')
            .select('id, quantity, status')
            .in('id', [ownedInventory.id, concurrencyInventory.id]);

        if (inventoryError) throw new Error(inventoryError.message);

        const ownedRow = inventoryRows?.find((row) => row.id === ownedInventory.id);
        const concurrentRow = inventoryRows?.find((row) => row.id === concurrencyInventory.id);

        assert.strictEqual(Number(ownedRow?.quantity), 90);
        assert.strictEqual(ownedRow?.status, 'AVAILABLE');
        assert.strictEqual(Number(concurrentRow?.quantity), 0);
        assert.strictEqual(concurrentRow?.status, 'DEPLETED');
        console.log('[Pass] Inventory quantities and statuses persisted.');

        const { data: wastageRows, error: wastageError } = await supabase
            .from('retailer_wastage')
            .select('id, retailer_id, inventory_id, quantity, reason, notes')
            .in('inventory_id', [ownedInventory.id, concurrencyInventory.id]);

        if (wastageError) throw new Error(wastageError.message);

        assert.strictEqual(wastageRows?.length, 2);
        assert.ok(wastageRows?.some((row) =>
            row.inventory_id === ownedInventory.id &&
            Number(row.quantity) === 10 &&
            row.reason === 'Damaged packaging' &&
            row.notes === 'Integration test'
        ));
        assert.ok(wastageRows?.every((row) => row.retailer_id === retailerA.id));
        state.wastageIds = [...new Set([
            ...state.wastageIds,
            ...(wastageRows || []).map((row) => row.id)
        ])];
        console.log('[Pass] Exactly two expected wastage records persisted.');

        const { data: outbox, error: outboxError } = await supabase
            .from('event_outbox')
            .select('event_type, payload')
            .eq('payload->>batch_id', BATCH_ID);

        if (outboxError) throw new Error(outboxError.message);

        const wastageEvents = outbox?.filter((row) => row.event_type === 'WASTAGE_RECORDED') || [];
        const inventoryEvents = outbox?.filter((row) => row.event_type === 'INVENTORY_UPDATED') || [];

        assert.strictEqual(wastageEvents.length, 2);
        assert.strictEqual(inventoryEvents.length, 2);
        assert.ok(wastageEvents.some((row) => row.payload?.quantity_wasted === 10));
        console.log('[Pass] Outbox events persisted.');

        const { data: trace, error: traceError } = await supabase
            .from('traceability_events')
            .select('event_type, actor_id, metadata')
            .eq('batch_number', BATCH_ID)
            .eq('event_type', 'RETAILER_WASTED');

        if (traceError) throw new Error(traceError.message);

        assert.strictEqual(trace?.length, 2);
        assert.ok(trace?.every((row) => row.actor_id === retailerA.id));
        assert.ok(trace?.every((row) => row.metadata?.quantity_wasted === 10));
        console.log('[Pass] Traceability events persisted.');
    } catch (error: any) {
        console.error(`\nTEST FAILED: ${error?.message || error}`);
        throw error;
    } finally {
        console.log('\n-> Safe teardown');
        const cleanupErrors: string[] = [];

        const attemptDelete = async (name: string, query: PromiseLike<any>) => {
            try {
                const { error } = await query;
                if (error) throw new Error(error.message);
            } catch (error: any) {
                cleanupErrors.push(`${name}: ${error.message}`);
            }
        };

        // Only records tied to this test's unique batch are targeted.
        await attemptDelete(
            'Event outbox',
            supabase.from('event_outbox').delete().eq('payload->>batch_id', BATCH_ID)
        );
        await attemptDelete(
            'Traceability',
            supabase.from('traceability_events').delete().eq('batch_number', BATCH_ID)
        );

        if (state.wastageIds.length) {
            await attemptDelete(
                'Retailer wastage',
                supabase.from('retailer_wastage').delete().in('id', state.wastageIds)
            );
        }
        if (state.inventoryIds.length) {
            await attemptDelete(
                'Retailer wastage fallback cleanup',
                supabase.from('retailer_wastage').delete().in('inventory_id', state.inventoryIds)
            );
            await attemptDelete(
                'Retailer inventory',
                supabase.from('retailer_inventory').delete().in('id', state.inventoryIds)
            );
        }
        if (state.productIds.length) {
            await attemptDelete(
                'Products',
                supabase.from('products').delete().in('id', state.productIds)
            );
        }
        if (state.userIds.length) {
            await attemptDelete(
                'Users',
                supabase.from('users').delete().in('id', state.userIds)
            );
        }

        if (cleanupErrors.length) {
            console.error('[Fail] Cleanup errors:', cleanupErrors);
            throw new Error(`Cleanup failed (${cleanupErrors.length} errors).`);
        }
        console.log('[Pass] Test cleanup completed.');
        console.log('=== Wastage integration test concluded ===');
    }
}

if (require.main === module) {
    run().catch(() => {
        process.exitCode = 1;
    });
}

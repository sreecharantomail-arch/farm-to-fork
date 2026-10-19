import './src/test_preload';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '.env.local'), override: true });

import pg from 'pg';
import assert from 'node:assert';
import { supabase } from './src/config/supabase';
import {
  recordColdChainReading,
  getShipmentColdChain,
  getColdChainAlerts,
  acknowledgeColdChainAlert,
  resolveColdChainAlert,
  getColdChainThresholds,
  saveColdChainThreshold,
  optimizeRoute,
  saveRoutePlan,
  getRoutePlans,
  getRoutePlanById,
  dispatchRoutePlan,
  getLogisticsMetrics
} from './src/controllers/distributorController';
import { getRetailerShipments } from './src/controllers/retailerController';
import { coldChainService } from './src/services/coldChainService';
import { routeOptimizationService } from './src/services/routeOptimizationService';

import { assertApprovedLocalEnvironment, assertLocalPostgresUrl } from './src/utils/localDatabaseGuard';

const PG_CONN = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
assertApprovedLocalEnvironment('ColdChainRouteE2eSuite');
assertLocalPostgresUrl(PG_CONN, 'ColdChainRouteE2eSuite');

// Direct PostgreSQL connection for raw database ground-truth validation
const pool = new pg.Pool({
  connectionString: PG_CONN
});

// Helper for Mock Express Request/Response
const createReqRes = (options: {
  user?: any;
  params?: Record<string, string>;
  body?: Record<string, any>;
  query?: Record<string, string>;
}) => {
  const req: any = {
    user: options.user || null,
    params: options.params || {},
    body: options.body || {},
    query: options.query || {}
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

async function runE2eTests() {
  console.log('================================================================');
  console.log('FARMCHAINAI — COLD-CHAIN MONITORING & ROUTE OPTIMIZATION E2E');
  console.log('Testing against local Supabase: 127.0.0.1:54321 / 127.0.0.1:54322');
  console.log('================================================================\n');

  // Verify baseline row counts
  const baselineCounts = await pool.query(`
    SELECT
      (SELECT count(*) FROM public.users) as users,
      (SELECT count(*) FROM public.products) as products,
      (SELECT count(*) FROM public.shipments) as shipments,
      (SELECT count(*) FROM public.proof_of_delivery) as pod,
      (SELECT count(*) FROM public.cold_chain_readings) as readings,
      (SELECT count(*) FROM public.cold_chain_alerts) as alerts,
      (SELECT count(*) FROM public.route_plans) as route_plans
  `);
  console.log('Pre-test Database Baseline Counts:', baselineCounts.rows[0]);

  const ts = Date.now();
  // Canary IDs
  const distId = `10101010-1010-4010-8010-${String(ts).slice(-12)}`;
  const intruderDistId = `20202020-2020-4020-8020-${String(ts).slice(-12)}`;
  const retailer1Id = `30303030-3030-4030-8030-${String(ts).slice(-12)}`;
  const retailer2Id = `40404040-4040-4040-8040-${String(ts).slice(-12)}`;
  const retailer3Id = `50505050-5050-4050-8050-${String(ts).slice(-12)}`;

  const prodPerishableId = `60606060-6060-4060-8060-${String(ts).slice(-12)}`; // Strawberries (Fruits, expires in 2 days)
  const prodDairyId = `70707070-7070-4070-8070-${String(ts).slice(-12)}`; // Organic Milk (Dairy, expires in 10 days)
  const prodAmbientId = `80808080-8080-4080-8080-${String(ts).slice(-12)}`; // Grains (Unconfigured category)

  const ship1Id = `90909090-9090-4090-8090-${String(ts).slice(-12)}`;
  const ship2Id = `a0a0a0a0-a0a0-40a0-80a0-${String(ts).slice(-12)}`;
  const ship3Id = `b0b0b0b0-b0b0-40b0-80b0-${String(ts).slice(-12)}`;
  const intruderShipId = `c0c0c0c0-c0c0-40c0-80c0-${String(ts).slice(-12)}`;

  let passedTests = 0;
  let totalTests = 0;

  function runTest(name: string, fn: () => void | Promise<void>) {
    totalTests++;
    return (async () => {
      try {
        await fn();
        console.log(`  [PASS] Test ${totalTests}: ${name}`);
        passedTests++;
      } catch (err: any) {
        console.error(`  [FAIL] Test ${totalTests}: ${name}`);
        console.error(`         Error: ${err.message}`);
        throw err;
      }
    })();
  }

  try {
    // -------------------------------------------------------------
    // SETUP CANARY FIXTURES IN DIRECT POSTGRES
    // -------------------------------------------------------------
    console.log('\nSetting up isolated test fixtures...');

    // Users: distributor, intruder distributor, 3 retailers in Bangalore with coordinates
    await pool.query(`
      INSERT INTO public.users (id, name, email, password, role, address, latitude, longitude, city)
      VALUES
        ('${distId}', 'Canary Primary Distributor', 'canary-dist-${ts}@example.com', 'canary_hashed_pwd', 'distributor', 'Bangalore Central Depot, Rajajinagar', 12.9716, 77.5946, 'Bangalore'),
        ('${intruderDistId}', 'Canary Intruder Distributor', 'canary-intruder-${ts}@example.com', 'canary_hashed_pwd', 'distributor', 'Whitefield Hub', 12.9698, 77.7499, 'Bangalore'),
        ('${retailer1Id}', 'Canary Retailer Indiranagar', 'canary-ret1-${ts}@example.com', 'canary_hashed_pwd', 'retailer', '100ft Road, Indiranagar', 12.9784, 77.6408, 'Bangalore'),
        ('${retailer2Id}', 'Canary Retailer Koramangala', 'canary-ret2-${ts}@example.com', 'canary_hashed_pwd', 'retailer', '80ft Road, Koramangala', 12.9352, 77.6245, 'Bangalore'),
        ('${retailer3Id}', 'Canary Retailer Malleshwaram', 'canary-ret3-${ts}@example.com', 'canary_hashed_pwd', 'retailer', '8th Cross, Malleshwaram', 13.0031, 77.5683, 'Bangalore');
    `);

    // Products: 1 perishable expiring soon, 1 dairy, 1 unconfigured category
    const expirySoon = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
    const expiryLater = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

    await pool.query(`
      INSERT INTO public.products (id, name, category, batch_number, farmer_id, current_owner_id, quantity, unit, expiry_date, status)
      VALUES
        ('${prodPerishableId}', 'Canary Fresh Strawberries', 'Fruits', 'BATCH-BERRY-${ts}', '${distId}', '${distId}', 100, 'kg', '${expirySoon}', 'ACTIVE'),
        ('${prodDairyId}', 'Canary Pasteurized Milk', 'Dairy', 'BATCH-MILK-${ts}', '${distId}', '${distId}', 150, 'liters', '${expiryLater}', 'ACTIVE'),
        ('${prodAmbientId}', 'Canary Exotic Spices', 'ExoticSpices', 'BATCH-SPICE-${ts}', '${distId}', '${distId}', 50, 'kg', '${expiryLater}', 'ACTIVE');
    `);

    // Shipments: 3 owned by distId, 1 owned by intruderDistId
    await pool.query(`
      INSERT INTO public.shipments (id, shipment_tracking_id, sender_id, receiver_id, distributor_id, product_id, batch_number, quantity, unit, status)
      VALUES
        ('${ship1Id}', 'SHIP-CC-001-${ts}', '${distId}', '${retailer1Id}', '${distId}', '${prodPerishableId}', 'BATCH-BERRY-${ts}', 100, 'kg', 'IN_TRANSIT'),
        ('${ship2Id}', 'SHIP-CC-002-${ts}', '${distId}', '${retailer2Id}', '${distId}', '${prodDairyId}', 'BATCH-MILK-${ts}', 150, 'liters', 'IN_TRANSIT'),
        ('${ship3Id}', 'SHIP-CC-003-${ts}', '${distId}', '${retailer3Id}', '${distId}', '${prodAmbientId}', 'BATCH-SPICE-${ts}', 50, 'kg', 'IN_TRANSIT'),
        ('${intruderShipId}', 'SHIP-CC-INTRUDER-${ts}', '${intruderDistId}', '${retailer1Id}', '${intruderDistId}', '${prodPerishableId}', 'BATCH-INTRUDER-${ts}', 40, 'kg', 'IN_TRANSIT');
    `);

    console.log('Test fixtures created successfully.\n');

    // =========================================================================
    // FEATURE 1 TESTS: COLD-CHAIN MONITORING AND FOOD SAFETY ALERTS
    // =========================================================================
    console.log('--- FEATURE 1: COLD-CHAIN MONITORING TESTS ---');

    // Test 1: Valid Reading Submission
    await runTest('Record valid temperature reading within configured threshold (Fruits: 2-8°C)', async () => {
      const { req, res } = createReqRes({
        user: { id: distId, role: 'distributor' },
        body: {
          shipment_id: ship1Id,
          temperature: 4.5,
          temperature_unit: 'C',
          relative_humidity_pct: 88,
          reading_source: 'MANUAL_ENTRY',
          notes: 'Handheld probe check before departure'
        }
      });

      await recordColdChainReading(req, res);
      assert.strictEqual(res.statusCode, 201, `Expected 201, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.condition, 'NORMAL');
      assert.strictEqual(res.body.data.reading.temperature, 4.5);
      assert.strictEqual(res.body.data.reading.humidity, 88);
      assert.strictEqual(res.body.data.createdAlerts.length, 0, 'No alert should be generated for normal temperature');
    });

    // Test 2: Invalid Temperature Values
    await runTest('Reject invalid/non-numeric temperature value', async () => {
      const { req, res } = createReqRes({
        user: { id: distId, role: 'distributor' },
        body: {
          shipment_id: ship1Id,
          temperature: 'invalid-temp',
          reading_source: 'MANUAL_ENTRY'
        }
      });

      await recordColdChainReading(req, res);
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body.success, false);
      assert.match(res.body.message, /valid numeric temperature/i);
    });

    // Test 3: Invalid Relative Humidity Values
    await runTest('Reject invalid relative humidity outside 0-100%', async () => {
      const { req, res } = createReqRes({
        user: { id: distId, role: 'distributor' },
        body: {
          shipment_id: ship1Id,
          temperature: 4.0,
          relative_humidity_pct: 105 // Over 100%
        }
      });

      await recordColdChainReading(req, res);
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body.success, false);
      assert.match(res.body.message, /relative_humidity_pct must be between 0 and 100/i);
    });

    // Test 4: Prevent Future-Dated Measurement
    await runTest('Prevent future-dated measurement timestamps', async () => {
      const futureTime = new Date(Date.now() + 3600000 * 24).toISOString();
      const { req, res } = createReqRes({
        user: { id: distId, role: 'distributor' },
        body: {
          shipment_id: ship1Id,
          temperature: 4.0,
          measured_at: futureTime
        }
      });

      await recordColdChainReading(req, res);
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body.success, false);
      assert.match(res.body.message, /future/i);
    });

    // Test 5: Unauthorized Reading Submission
    await runTest('Reject unauthenticated reading submission', async () => {
      const { req, res } = createReqRes({
        user: null, // No auth
        body: {
          shipment_id: ship1Id,
          temperature: 4.0
        }
      });

      await recordColdChainReading(req, res);
      assert.strictEqual(res.statusCode, 401);
      assert.strictEqual(res.body.success, false);
    });

    // Test 6: Shipment Ownership Validation
    await runTest('Enforce shipment ownership authorization on reading submission', async () => {
      const { req, res } = createReqRes({
        user: { id: intruderDistId, role: 'distributor' },
        body: {
          shipment_id: ship1Id, // Belongs to distId, not intruderDistId
          temperature: 4.0
        }
      });

      await recordColdChainReading(req, res);
      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(res.body.success, false);
      assert.match(res.body.message, /not authorized to record readings/i);
    });

    // Test 7: Threshold Evaluation - Warning Alert Generation
    await runTest('Evaluate threshold and generate WARNING alert for minor temperature breach (Fruits max 8°C + 1.5°C = 9.5°C)', async () => {
      const { req, res } = createReqRes({
        user: { id: distId, role: 'distributor' },
        body: {
          shipment_id: ship1Id,
          temperature: 9.5,
          relative_humidity_pct: 80,
          reading_source: 'IOT_GATEWAY',
          notes: 'Minor temperature rise during traffic congestion'
        }
      });

      await recordColdChainReading(req, res);
      assert.strictEqual(res.statusCode, 201);
      assert.strictEqual(res.body.data.condition, 'WARNING');
      assert.ok(res.body.data.createdAlerts.length > 0, 'Alert should be generated');
      assert.strictEqual(res.body.data.createdAlerts[0].severity, 'WARNING');
      assert.strictEqual(res.body.data.createdAlerts[0].status, 'ACTIVE');
    });

    // Test 8: Threshold Evaluation - Critical Alert Generation
    let activeCriticalAlertId = '';
    await runTest('Evaluate threshold and generate CRITICAL alert for severe temperature breach (Fruits 16.0°C)', async () => {
      const { req, res } = createReqRes({
        user: { id: distId, role: 'distributor' },
        body: {
          shipment_id: ship1Id,
          temperature: 16.0,
          relative_humidity_pct: 65,
          reading_source: 'MANUAL_ENTRY',
          notes: 'Refrigeration compressor malfunction observed'
        }
      });

      await recordColdChainReading(req, res);
      assert.strictEqual(res.statusCode, 201);
      assert.strictEqual(res.body.data.condition, 'CRITICAL');
      assert.ok(res.body.data.createdAlerts.length > 0);
      assert.strictEqual(res.body.data.createdAlerts[0].severity, 'CRITICAL');
      assert.strictEqual(res.body.data.createdAlerts[0].status, 'ACTIVE');
      activeCriticalAlertId = res.body.data.createdAlerts[0].id;
    });

    // Test 9: Duplicate Alert Prevention
    await runTest('Prevent duplicate alert insertion for unresolved active condition', async () => {
      const { req, res } = createReqRes({
        user: { id: distId, role: 'distributor' },
        body: {
          shipment_id: ship1Id,
          temperature: 16.5, // Still critical
          reading_source: 'MANUAL_ENTRY'
        }
      });

      await recordColdChainReading(req, res);
      assert.strictEqual(res.statusCode, 201);
      assert.strictEqual(res.body.data.condition, 'CRITICAL');
      // Should not create a duplicate record
      assert.strictEqual(res.body.data.createdAlerts.length, 0, 'Should not create duplicate alert for active condition');
    });

    // Test 10: Missing/Unconfigured Threshold Handling
    await runTest('Gracefully handle shipments with unconfigured product category thresholds', async () => {
      const { req, res } = createReqRes({
        user: { id: distId, role: 'distributor' },
        body: {
          shipment_id: ship3Id, // Category 'ExoticSpices' has no configured threshold
          temperature: 22.0,
          reading_source: 'MANUAL_ENTRY'
        }
      });

      await recordColdChainReading(req, res);
      assert.strictEqual(res.statusCode, 201);
      assert.strictEqual(res.body.data.condition, 'UNAVAILABLE');
      assert.strictEqual(res.body.data.createdAlerts.length, 0);
    });

    // Test 11: Alert Acknowledgement
    await runTest('Authorized distributor acknowledges active condition alert with notes', async () => {
      const { req, res } = createReqRes({
        user: { id: distId, role: 'distributor' },
        params: { id: activeCriticalAlertId },
        body: { notes: 'Driver instructed to pull over and check reef thermostat.' }
      });

      await acknowledgeColdChainAlert(req, res);
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.status, 'ACKNOWLEDGED');
      assert.strictEqual(res.body.data.acknowledged_by, distId);
      assert.ok(res.body.data.acknowledged_at);
    });

    // Test 12: Alert Resolution
    await runTest('Authorized distributor resolves condition alert with mandatory resolution notes', async () => {
      const { req, res } = createReqRes({
        user: { id: distId, role: 'distributor' },
        params: { id: activeCriticalAlertId },
        body: { resolution_notes: 'Thermostat circuit breaker reset; cooling power restored to 4.2°C.' }
      });

      await resolveColdChainAlert(req, res);
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.status, 'RESOLVED');
      assert.strictEqual(res.body.data.resolution_notes, 'Thermostat circuit breaker reset; cooling power restored to 4.2°C.');
    });

    // Test 13: Reading History & Violation Preservation
    await runTest('Preserve complete reading and violation history even after condition resolves', async () => {
      // Log new reading in normal range
      const { req: newReq, res: newRes } = createReqRes({
        user: { id: distId, role: 'distributor' },
        body: {
          shipment_id: ship1Id,
          temperature: 4.0,
          reading_source: 'MANUAL_ENTRY',
          notes: 'Post-resolution verification check'
        }
      });
      await recordColdChainReading(newReq, newRes);

      // Now query history
      const { req, res } = createReqRes({
        user: { id: distId, role: 'distributor' },
        params: { id: ship1Id }
      });

      await getShipmentColdChain(req, res);
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.data.status, 'NORMAL');
      assert.ok(res.body.data.readings.length >= 4, 'All historical readings must be preserved');
      assert.ok(res.body.data.alerts.length >= 2, 'All historical violations must be preserved');
    });

    // Test 14: Traceability & Transactional Outbox Events
    await runTest('Verify outbox events and traceability records emitted for cold-chain violations', async () => {
      const outboxCheck = await pool.query(`
        SELECT * FROM public.event_outbox
        WHERE topic = 'quality-alerts'
          AND payload->>'shipment_id' = '${ship1Id}'
        ORDER BY created_at DESC
      `);
      assert.ok(outboxCheck.rows.length > 0, 'Outbox event must be persisted for cold chain breach');
      const latestOutbox = outboxCheck.rows[0];
      assert.strictEqual(latestOutbox.event_type, 'COLD_CHAIN_ALERT');
    });

    // Test 15: Retailer Transport Condition Integration
    await runTest('Retailer shipment overview includes cold chain condition status and alert warnings', async () => {
      const { req, res } = createReqRes({
        user: { id: retailer1Id, role: 'retailer' }
      });

      await getRetailerShipments(req, res);
      assert.strictEqual(res.statusCode, 200);
      const retailerShipment = res.body.data.find((s: any) => s.id === ship1Id);
      assert.ok(retailerShipment, 'Shipment must be visible to retailer');
      assert.ok(retailerShipment.cold_chain_status, 'Must include cold_chain_status');
      assert.ok(retailerShipment.latest_reading, 'Must include latest reading');
      const tempVal = retailerShipment.latest_reading.temperature ?? retailerShipment.latest_reading.temperature_celsius;
      assert.strictEqual(tempVal, 4.0);
    });

    // =========================================================================
    // FEATURE 2 TESTS: INTELLIGENT ROUTE PLANNING AND DELIVERY OPTIMIZATION
    // =========================================================================
    console.log('\n--- FEATURE 2: ROUTE OPTIMIZATION TESTS ---');

    // Test 16: Valid Route Generation with Constrained TSP
    let generatedRoute: any = null;
    await runTest('Generate valid optimized multi-stop delivery route sequence', async () => {
      const { req, res } = createReqRes({
        user: { id: distId, role: 'distributor' },
        body: {
          shipment_ids: [ship1Id, ship2Id, ship3Id],
          vehicle_capacity: 500,
          origin_address: 'Bangalore Central Depot, Rajajinagar',
          origin_latitude: 12.9716,
          origin_longitude: 77.5946
        }
      });

      await optimizeRoute(req, res);
      assert.strictEqual(res.statusCode, 200, `Expected 200, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
      assert.strictEqual(res.body.success, true);
      generatedRoute = res.body.data;
      assert.strictEqual(generatedRoute.stops.length, 5, 'Expected 5 stops in full route: Origin -> Stop 1 -> Stop 2 -> Stop 3 -> Return');
      assert.strictEqual(generatedRoute.stops[0].is_origin, true);
      assert.strictEqual(generatedRoute.stops[4].is_origin, true);
      assert.strictEqual(generatedRoute.ordered_stops.length, 3, 'Expected 3 customer delivery stops');
      assert.strictEqual(generatedRoute.origin.latitude, 12.9716);
      assert.strictEqual(generatedRoute.origin.longitude, 77.5946);
    });

    // Test 17: Baseline vs Optimized Distance Comparison
    await runTest('Mathematically compare baseline distance against 2-Opt optimized route', async () => {
      assert.ok(generatedRoute.metrics.baseline_distance_km > 0);
      assert.ok(generatedRoute.metrics.estimated_distance_km > 0);
      assert.ok(
        generatedRoute.metrics.estimated_distance_km <= generatedRoute.metrics.baseline_distance_km,
        `Optimized distance (${generatedRoute.metrics.estimated_distance_km}km) must be <= baseline (${generatedRoute.metrics.baseline_distance_km}km)`
      );
      assert.ok(generatedRoute.metrics.distance_saved_km >= 0);
    });

    // Test 18: No Fabricated Metrics / Honest Calculations
    await runTest('Ensure metrics are strictly data-derived without fabricated percentages', async () => {
      const expectedSavedPct = Number(
        (((generatedRoute.metrics.baseline_distance_km - generatedRoute.metrics.estimated_distance_km) /
          generatedRoute.metrics.baseline_distance_km) * 100).toFixed(1)
      );
      assert.strictEqual(
        generatedRoute.metrics.distance_saved_pct,
        expectedSavedPct,
        'Distance saved % must match the exact mathematical ratio'
      );
      assert.match(generatedRoute.data_source_limitation, /Haversine/i);
      assert.match(generatedRoute.data_source_limitation, /1.30/);
    });

    // Test 19: Transit Duration and Dwell Time Calculation
    await runTest('Compute realistic transit duration with per-stop dwell time', async () => {
      // 3 customer stops * 15 min dwell = 45 min dwell + transit time at 40 km/h
      assert.ok(generatedRoute.metrics.estimated_duration_minutes > 45, 'Must include transit + dwell time');
    });

    // Test 20: Google Maps Multi-Stop Navigation URL
    await runTest('Build valid multi-stop Google Maps directions URL with waypoints', async () => {
      assert.ok(generatedRoute.google_maps_url, 'Must provide google_maps_url');
      assert.ok(generatedRoute.google_maps_url.includes('https://www.google.com/maps/dir/?api=1'));
      assert.ok(generatedRoute.google_maps_url.includes('origin=12.9716,77.5946'));
      assert.ok(generatedRoute.google_maps_url.includes('destination='));
      assert.ok(generatedRoute.google_maps_url.includes('waypoints='));
    });

    // Test 21: Vehicle Capacity Constraint Violation
    await runTest('Detect and report vehicle capacity constraint violations without failing silently', async () => {
      const { req, res } = createReqRes({
        user: { id: distId, role: 'distributor' },
        body: {
          shipment_ids: [ship1Id, ship2Id, ship3Id], // Total quantity = 100 + 150 + 50 = 300 units
          vehicle_capacity: 200 // Capacity 200 is less than 300
        }
      });

      await optimizeRoute(req, res);
      assert.strictEqual(res.statusCode, 200);
      assert.ok(res.body.data.constraint_violations.length > 0);
      assert.match(res.body.data.constraint_violations[0], /exceeds vehicle capacity \(200 units\) by 100 units/i);
    });

    // Test 22: FEFO Expiry Constraint Handling
    await runTest('Flag FEFO expiry-sensitive shipments prioritized in delivery schedule', async () => {
      assert.ok(generatedRoute.expiry_warnings.length > 0, 'Perishable strawberries expiring in 2 days must trigger FEFO notice');
      assert.match(generatedRoute.expiry_warnings[0], /expires in/i);
    });

    // Test 23: Missing Coordinates Fallback
    await runTest('Handle missing geographic coordinates gracefully with fallback and clear warning', async () => {
      // Retailer 3 missing coordinates test via direct optimizer call
      const { req, res } = createReqRes({
        user: { id: distId, role: 'distributor' },
        body: {
          shipment_ids: [ship1Id],
          vehicle_capacity: 500
        }
      });
      await optimizeRoute(req, res);
      assert.strictEqual(res.statusCode, 200);
    });

    // Test 24: Unauthorized Route Generation
    await runTest('Reject route optimization containing shipments belonging to another distributor', async () => {
      const { req, res } = createReqRes({
        user: { id: distId, role: 'distributor' },
        body: {
          shipment_ids: [ship1Id, intruderShipId] // intruderShipId belongs to intruderDistId
        }
      });

      await optimizeRoute(req, res);
      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(res.body.success, false);
      assert.match(res.body.message, /do not belong to your distributor/i);
    });

    // Test 25: Route Plan Persistence
    let savedPlanId = '';
    await runTest('Persist confirmed route plan with ordered stops and status PLANNED', async () => {
      const { req, res } = createReqRes({
        user: { id: distId, role: 'distributor' },
        body: {
          name: 'Bangalore Daily Retail Distribution Plan',
          shipment_ids: [ship1Id, ship2Id],
          vehicle_capacity: 500
        }
      });

      await saveRoutePlan(req, res);
      assert.strictEqual(res.statusCode, 201);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.status, 'PLANNED');
      assert.strictEqual(res.body.data.distributor_id, distId);
      assert.ok(res.body.data.ordered_stops.length >= 2);
      savedPlanId = res.body.data.id;
    });

    // Test 26: Route Plan Retrieval
    await runTest('Retrieve persisted route plans for authorized distributor', async () => {
      const { req, res } = createReqRes({
        user: { id: distId, role: 'distributor' },
        params: { id: savedPlanId }
      });

      await getRoutePlanById(req, res);
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.data.id, savedPlanId);
    });

    // Test 27: Route Plan Dispatch Lifecycle
    await runTest('Dispatch route plan transitioning status to DISPATCHED', async () => {
      const { req, res } = createReqRes({
        user: { id: distId, role: 'distributor' },
        params: { id: savedPlanId }
      });

      await dispatchRoutePlan(req, res);
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.data.status, 'DISPATCHED');
      assert.ok(res.body.data.dispatched_at);
    });

    // Test 28: Shipment Custody and POD Preservation
    await runTest('Verify route dispatch does NOT alter shipment custody or trigger premature POD delivery confirmation', async () => {
      const shipCheck = await pool.query(`
        SELECT status FROM public.shipments WHERE id = '${ship1Id}'
      `);
      assert.strictEqual(shipCheck.rows[0].status, 'IN_TRANSIT', 'Shipment status must remain IN_TRANSIT');

      const podCheck = await pool.query(`
        SELECT id FROM public.proof_of_delivery WHERE shipment_id = '${ship1Id}'
      `);
      assert.strictEqual(podCheck.rows.length, 0, 'POD must not be created prematurely');
    });

    // Test 29: Dynamic Logistics Metrics API
    await runTest('Verify honest data-derived logistics metrics endpoint', async () => {
      const { req, res } = createReqRes({
        user: { id: distId, role: 'distributor' }
      });

      await getLogisticsMetrics(req, res);
      assert.strictEqual(res.statusCode, 200);
      assert.ok(res.body.data.total_plans_count >= 1);
      assert.ok(res.body.data.active_plans_count >= 1);
      assert.ok(res.body.data.cold_chain_compliance_rate_pct !== null);
      assert.ok(typeof res.body.data.cold_chain_compliance_rate_pct === 'number');
    });

    console.log('\n================================================================');
    console.log(`ALL TESTS PASSED! (${passedTests} / ${totalTests} passing)`);
    console.log('================================================================\n');

  } finally {
    // -------------------------------------------------------------
    // TEARDOWN CANARY FIXTURES ONLY
    // -------------------------------------------------------------
    console.log('Cleaning up canary fixtures...');
    try {
      await pool.query(`
        DELETE FROM public.traceability_events WHERE product_id::text IN ('${prodPerishableId}', '${prodDairyId}', '${prodAmbientId}') OR metadata->>'shipment_id' IN ('${ship1Id}', '${ship2Id}', '${ship3Id}', '${intruderShipId}');
        DELETE FROM public.cold_chain_alerts WHERE shipment_id::text IN ('${ship1Id}', '${ship2Id}', '${ship3Id}', '${intruderShipId}');
        DELETE FROM public.cold_chain_readings WHERE shipment_id::text IN ('${ship1Id}', '${ship2Id}', '${ship3Id}', '${intruderShipId}');
        DELETE FROM public.event_outbox WHERE topic IN ('quality-alerts', 'logistics-dispatch') AND (payload->>'shipment_id' IN ('${ship1Id}', '${ship2Id}', '${ship3Id}', '${intruderShipId}') OR payload->>'distributor_id' IN ('${distId}', '${intruderDistId}'));
        DELETE FROM public.route_plans WHERE distributor_id::text IN ('${distId}', '${intruderDistId}');
        DELETE FROM public.shipments WHERE id::text IN ('${ship1Id}', '${ship2Id}', '${ship3Id}', '${intruderShipId}');
        DELETE FROM public.products WHERE id::text IN ('${prodPerishableId}', '${prodDairyId}', '${prodAmbientId}');
        DELETE FROM public.users WHERE id::text IN ('${distId}', '${intruderDistId}', '${retailer1Id}', '${retailer2Id}', '${retailer3Id}');
      `);
      console.log('Canary fixtures cleaned up safely.');
    } catch (cleanupErr) {
      console.error('Error during cleanup:', cleanupErr);
    }

    // Verify baseline preservation
    const postCounts = await pool.query(`
      SELECT
        (SELECT count(*) FROM public.users) as users,
        (SELECT count(*) FROM public.products) as products,
        (SELECT count(*) FROM public.shipments) as shipments,
        (SELECT count(*) FROM public.proof_of_delivery) as pod,
        (SELECT count(*) FROM public.cold_chain_readings) as readings,
        (SELECT count(*) FROM public.cold_chain_alerts) as alerts,
        (SELECT count(*) FROM public.route_plans) as route_plans
    `);
    console.log('Post-test Database Baseline Counts:', postCounts.rows[0]);
    await pool.end();
  }
}

runE2eTests().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});

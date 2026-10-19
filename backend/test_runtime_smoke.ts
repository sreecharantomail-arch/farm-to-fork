import './src/test_preload';
import { assertApprovedLocalEnvironment, assertLocalSupabaseUrl } from './src/utils/localDatabaseGuard';
import express from 'express';
import http from 'http';

assertApprovedLocalEnvironment('RuntimeSmokeTest');
assertLocalSupabaseUrl(process.env.SUPABASE_URL || 'http://127.0.0.1:54321', 'RuntimeSmokeTest');

import { supabase } from './src/config/supabase';
import productRoutes from './src/routes/productRoutes';
import authRoutes from './src/routes/authRoutes';
import retailerRoutes from './src/routes/retailerRoutes';
import { outboxPublisherService } from './src/services/outboxPublisherService';

async function runSmokeTest() {
  console.log('===================================================================');
  console.log('  FarmChainAI — Step 27 Backend Runtime Smoke Test');
  console.log('===================================================================\n');

  const app = express();
  app.use(express.json());

  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/ready', async (req, res) => {
    const { error } = await supabase.from('users').select('id', { count: 'exact', head: true });
    const isReady = !error;
    const outboxHealth = outboxPublisherService.getHealth();
    res.status(isReady ? 200 : 503).json({
      status: isReady ? 'ready' : 'unavailable',
      dependencies: {
        supabase: isReady ? 'healthy' : 'unavailable',
        kafka: outboxHealth.isConnected ? 'healthy' : 'offline',
      },
      outbox: {
        mode: outboxHealth.mode,
        running: outboxHealth.isRunning,
      }
    });
  });

  app.use('/api/products', productRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/retailer', retailerRoutes);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(5099, '127.0.0.1', () => resolve()));
  console.log('[SERVER] Temporary test Express server listening on http://127.0.0.1:5099');

  try {
    // 1. Health check
    console.log('\n--- 1. Probing GET /health ---');
    const healthRes = await fetch('http://127.0.0.1:5099/health');
    const healthJson = await healthRes.json();
    console.log(`Status: ${healthRes.status}, Body:`, healthJson);
    if (healthRes.status !== 200 || healthJson.status !== 'ok') {
      throw new Error(`Health check failed: ${JSON.stringify(healthJson)}`);
    }

    // 2. Ready check
    console.log('\n--- 2. Probing GET /ready ---');
    const readyRes = await fetch('http://127.0.0.1:5099/ready');
    const readyJson = await readyRes.json();
    console.log(`Status: ${readyRes.status}, Body:`, readyJson);
    if (readyRes.status !== 200 || readyJson.dependencies?.supabase !== 'healthy') {
      throw new Error(`Ready check failed: ${JSON.stringify(readyJson)}`);
    }

    // 3. Auth boundary check: unauthenticated request to protected endpoint
    console.log('\n--- 3. Probing GET /api/retailer/inventory (No token) ---');
    const unauthRes = await fetch('http://127.0.0.1:5099/api/retailer/inventory');
    console.log(`Status: ${unauthRes.status} (Expected 401 Unauthorized)`);
    if (unauthRes.status !== 401) {
      throw new Error(`Auth boundary failed: expected 401, got ${unauthRes.status}`);
    }

    // 4. Auth validation check: invalid login payload
    console.log('\n--- 4. Probing POST /api/auth/login (Invalid credentials) ---');
    const loginRes = await fetch('http://127.0.0.1:5099/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nonexistent_test_probe@example.com', password: 'wrongpassword' }),
    });
    const loginJson = await loginRes.json();
    console.log(`Status: ${loginRes.status}, Message:`, loginJson.message || loginJson.error);
    if (loginRes.status !== 401 && loginRes.status !== 400 && loginRes.status !== 404) {
      throw new Error(`Login rejection failed: expected 401/400/404, got ${loginRes.status}`);
    }

    // 5. Read-only product query check (Public tracker / view)
    console.log('\n--- 5. Probing Public Batch Tracking Probe (/api/products/blockchain/1) ---');
    const trackRes = await fetch('http://127.0.0.1:5099/api/products/blockchain/1');
    console.log(`Status: ${trackRes.status}`);
    const trackJson = await trackRes.json();
    console.log('Track Response Summary:', {
      success: trackJson.success,
      product: trackJson.data ? 'Found' : 'Not Found',
    });

    console.log('\n===================================================================');
    console.log('  ALL RUNTIME SMOKE CHECKS PASSED SUCCESSFULLY');
    console.log('===================================================================\n');

  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    console.log('[SERVER] Temporary test Express server stopped cleanly.');
  }
}

runSmokeTest().catch((err) => {
  console.error('[SMOKE_TEST_ERROR]', err);
  process.exit(1);
});

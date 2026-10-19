import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { supabase } from './config/supabase';
import { generalLimiter } from './middleware/rateLimit';
import productRoutes from './routes/productRoutes';
import authRoutes from './routes/authRoutes';
import adminRoutes from './routes/adminRoutes';
import retailerRoutes from './routes/retailerRoutes';
import farmerRoutes from './routes/farmerRoutes';
import notificationRoutes from './routes/notificationRoutes';
import processorRoutes from './routes/processorRoutes';
import distributorRoutes from './routes/distributorRoutes';
import analyticsRoutes from './routes/analyticsRoutes';
import anomalyRoutes from './routes/anomalyRoutes';
import aiRoutes from './routes/aiRoutes';
import decisionRoutes from './routes/decisionRoutes';
import { outboxPublisherService } from './services/outboxPublisherService';

import path from 'path';
import fs from 'fs';

dotenv.config();
const envLocalPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath, override: false });
}

const app = express();
const PORT = process.env.BACKEND_PORT || 5000;
const configuredCorsOrigins = process.env.CORS_ORIGIN?.trim();
const defaultLocalOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'];
const corsOrigin = !configuredCorsOrigins || configuredCorsOrigins === '*'
  ? '*'
  : configuredCorsOrigins.split(',').map((origin) => origin.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || configuredCorsOrigins === '*' || !configuredCorsOrigins) {
      callback(null, true);
      return;
    }

    const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    const allowedOrigins = new Set([...corsOrigin, ...defaultLocalOrigins]);
    if (isLocalhost || allowedOrigins.has(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '8mb' }));

// Minimal Security Headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

let isReady = false;

// Verify Supabase connectivity on boot (throwing early is more useful than
// discovering a bad URL/key on the first request)
supabase
  .from('users')
  .select('id', { count: 'exact', head: true })
  .then(({ error }) => {
    if (error) {
      console.error('Supabase connection error:', error.message);
    } else {
      console.log('Supabase connected');
      isReady = true;
    }
  });

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/ready', async (req, res) => {
  try {
    await outboxPublisherService.syncConnectionState();
  } catch (err: any) {
    console.warn('Error during outbox publisher health sync:', err?.message || err);
  }

  const outboxHealth = outboxPublisherService.getHealth();
  if (isReady) {
    res.status(200).json({
      status: 'ready',
      dependencies: {
        supabase: 'healthy',
        kafka: outboxHealth.isConnected ? 'healthy' : (outboxHealth.brokerReachable ? 'degraded' : 'offline'),
      },
      outbox: {
        running: outboxHealth.isRunning,
        brokerReachable: outboxHealth.brokerReachable,
        connected: outboxHealth.isConnected,
        mode: outboxHealth.mode,
        lastError: outboxHealth.lastError,
        publishedCount: outboxHealth.publishedCount,
        failedCount: outboxHealth.failedCount,
      },
    });
  } else {
    res.status(503).json({ status: 'unavailable', dependencies: { supabase: 'unavailable' } });
  }
});

app.use('/api/', generalLimiter);

app.use('/api/products', productRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/retailer', retailerRoutes);
app.use('/api/farmer', farmerRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/processor', processorRoutes);
app.use('/api/distributor', distributorRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/analytics', anomalyRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/decisions', decisionRoutes);

import { traceabilityAnalyticsConsumer } from './services/traceabilityAnalyticsConsumer';
import { shipmentAnalyticsConsumer } from './services/shipmentAnalyticsConsumer';
import { inventoryAnalyticsConsumer } from './services/inventoryAnalyticsConsumer';

const server = app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
  outboxPublisherService.start();

  // The traceability consumer is strictly disabled by default to prevent unintended consumption of business topics
  if (process.env.ENABLE_TRACEABILITY_CONSUMER === 'true') {
    traceabilityAnalyticsConsumer.enabled = true;
    traceabilityAnalyticsConsumer.start().catch((err) => {
      console.error('Failed to start traceability analytics consumer:', err);
    });
  } else {
    console.log('[TraceabilityConsumer] Consumer is disabled by default. Will not consume business topics.');
  }

  // The shipment consumer is strictly disabled by default to prevent unintended consumption of business topics
  if (process.env.ENABLE_SHIPMENT_CONSUMER === 'true') {
    shipmentAnalyticsConsumer.enabled = true;
    shipmentAnalyticsConsumer.start().catch((err) => {
      console.error('Failed to start shipment analytics consumer:', err);
    });
  } else {
    console.log('[ShipmentConsumer] Consumer is disabled by default. Will not consume business topics.');
  }

  // The inventory consumer is strictly disabled by default to prevent unintended consumption of business topics
  if (process.env.ENABLE_INVENTORY_CONSUMER === 'true') {
    inventoryAnalyticsConsumer.enabled = true;
    inventoryAnalyticsConsumer.start().catch((err) => {
      console.error('Failed to start inventory analytics consumer:', err);
    });
  } else {
    console.log('[InventoryConsumer] Consumer is disabled by default. Will not consume business topics.');
  }
});

const gracefulShutdown = async () => {
  console.log('Received kill signal, shutting down gracefully');
  try {
    await outboxPublisherService.stop();
    if (traceabilityAnalyticsConsumer.getHealth().isRunning) {
      await traceabilityAnalyticsConsumer.stop();
    }
    if (shipmentAnalyticsConsumer.getHealth().isRunning) {
      await shipmentAnalyticsConsumer.stop();
    }
    if (inventoryAnalyticsConsumer.getHealth().isRunning) {
      await inventoryAnalyticsConsumer.stop();
    }
  } catch (err) {
    console.warn('Error stopping outbox publisher or consumer during shutdown:', err);
  }

  server.close(() => {
    console.log('Closed out remaining connections');
    process.exit(0);
  });
  
  setTimeout(() => {
    console.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

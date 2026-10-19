import { Request, Response } from 'express';
import axios from 'axios';
import { supabase } from '../config/supabase';
import { recordAiAudit } from '../services/aiAuditService';

const AI_SERVICE_URL = process.env.AI_SERVICE_URL
    || (process.env.AI_SERVICE_HOSTPORT ? `http://${process.env.AI_SERVICE_HOSTPORT}` : 'http://localhost:8000');

export const proxyPricePrediction = async (req: Request, res: Response) => {
  const farmerId = (req as any).user?.id || 'anonymous';
  const startTime = Date.now();
  let status: 'SUCCESS' | 'UNAVAILABLE' | 'VALIDATION_ERROR' | 'TIMEOUT' | 'MODEL_ERROR' | 'INTERNAL_ERROR' = 'SUCCESS';
  let errorCode = null;
  let modelVersion = null;

  try {
    const response = await axios.post(`${AI_SERVICE_URL}/api/farmer/price-prediction`, req.body, { timeout: 10000 });

    if (response.data.available === false || response.data.error_code === 'VERIFIED_DATA_UNAVAILABLE') {
      status = 'UNAVAILABLE';
      errorCode = response.data.error_code || 'VERIFIED_DATA_UNAVAILABLE';
    } else {
      modelVersion = response.data.model_version || '1.0.0';
    }

    res.status(response.status).json(response.data);
  } catch (err: any) {
    if (err.response) {
      if (err.response.status === 422) {
        status = 'VALIDATION_ERROR';
      } else if (err.response.status === 503) {
        status = 'UNAVAILABLE';
        errorCode = err.response.data?.error_code || 'MODEL_UNAVAILABLE';
      } else {
        status = 'INTERNAL_ERROR';
      }
      res.status(err.response.status).json(err.response.data);
    } else if (err.code === 'ECONNABORTED') {
      status = 'TIMEOUT';
      res.status(504).json({ success: false, message: 'AI Service timeout.' });
    } else {
      status = 'INTERNAL_ERROR';
      res.status(500).json({ success: false, message: 'AI Service unavailable.' });
    }
  } finally {
    await recordAiAudit({
      user_id: farmerId,
      capability: 'PRICE_PREDICTION',
      endpoint: '/api/farmer/price-prediction',
      status,
      error_code: errorCode,
      latency_ms: Date.now() - startTime,
      model_version: modelVersion
    });
  }
};

export const getAiObservability = async (req: Request, res: Response) => {
  try {
    const { data: logs, error } = await supabase
      .from('ai_audit_logs')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      if (error.code === 'PGRST205') {
        res.status(200).json({ success: true, message: 'No AI activity recorded. (Audit table not initialized)', data: null });
        return;
      }
      throw error;
    }

    if (!logs || logs.length === 0) {
      res.status(200).json({ success: true, message: 'No AI activity recorded.', data: null });
      return;
    }

    const totalRequests = logs.length;
    const successfulRequests = logs.filter(l => l.status === 'SUCCESS').length;
    const unavailableRequests = logs.filter(l => l.status === 'UNAVAILABLE').length;
    const timeouts = logs.filter(l => l.status === 'TIMEOUT').length;
    const validationErrors = logs.filter(l => l.status === 'VALIDATION_ERROR').length;
    const internalErrors = logs.filter(l => l.status === 'INTERNAL_ERROR').length;

    const latencies = logs.map(l => l.latency_ms).filter(l => l !== null && l !== undefined) as number[];
    let avgLatency = null;
    let maxLatency = null;
    let minLatency = null;
    let medianLatency = null;

    if (latencies.length > 0) {
      const sum = latencies.reduce((a, b) => a + b, 0);
      avgLatency = sum / latencies.length;
      maxLatency = Math.max(...latencies);
      minLatency = Math.min(...latencies);
      const sorted = [...latencies].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      medianLatency = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }

    const capabilities = ['PRICE_PREDICTION', 'QUALITY_INSPECTION', 'DISEASE_DETECTION', 'SHELF_LIFE', 'DEMAND_PREDICTION', 'FRAUD_ANALYSIS'];
    const capabilityBreakdown: Record<string, any> = {};

    for (const cap of capabilities) {
      const capLogs = logs.filter(l => l.capability === cap);
      capabilityBreakdown[cap] = {
        requests: capLogs.length,
        success: capLogs.filter(l => l.status === 'SUCCESS').length,
        unavailable: capLogs.filter(l => l.status === 'UNAVAILABLE').length,
        errors: capLogs.filter(l => ['VALIDATION_ERROR', 'TIMEOUT', 'INTERNAL_ERROR', 'MODEL_ERROR'].includes(l.status)).length
      };
    }

    res.status(200).json({
      success: true,
      data: {
        overview: {
          totalRequests,
          successfulRequests,
          unavailableRequests,
          timeouts,
          validationErrors,
          internalErrors,
          availabilityRate: totalRequests > 0 ? successfulRequests / totalRequests : 0
        },
        latency: latencies.length > 0 ? {
          average: avgLatency,
          median: medianLatency,
          min: minLatency,
          max: maxLatency,
          samples: latencies.length
        } : 'Insufficient Data',
        capabilityBreakdown,
        recentEvents: logs.slice(0, 50)
      }
    });
  } catch (error) {
    console.error('AI Observability Error:', error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

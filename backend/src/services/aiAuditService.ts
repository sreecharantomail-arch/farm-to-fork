import { supabase } from '../config/supabase';

export interface AiAuditLog {
  user_id?: string | null;
  capability: 'PRICE_PREDICTION' | 'QUALITY_INSPECTION' | 'DISEASE_DETECTION' | 'SHELF_LIFE' | 'DEMAND_PREDICTION' | 'FRAUD_ANALYSIS';
  endpoint: string;
  status: 'SUCCESS' | 'UNAVAILABLE' | 'VALIDATION_ERROR' | 'TIMEOUT' | 'MODEL_ERROR' | 'INTERNAL_ERROR';
  error_code?: string | null;
  latency_ms?: number | null;
  model_version?: string | null;
  related_entity_type?: string | null;
  related_entity_id?: string | null;
}

export const recordAiAudit = async (log: AiAuditLog) => {
  try {
    const { error } = await supabase
      .from('ai_audit_logs')
      .insert([
        {
          ...log,
          created_at: new Date().toISOString()
        }
      ]);

    if (error) {
      console.error('Failed to insert AI audit log:', error);
    }
  } catch (err) {
    console.error('Unexpected error recording AI audit:', err);
    // Do not throw! Audit logging must never cause business operation to fail.
  }
};

import { supabase } from '../config/supabase';

export interface DecisionSignal {
  type: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  title: string;
  reason: string;
  source: string;
  entityId?: string;
  meta?: any;
}

export interface DecisionSupportResponse {
  status: 'AVAILABLE' | 'PARTIAL' | 'INSUFFICIENT_DATA';
  signals: DecisionSignal[];
}

export const getFarmerDecisions = async (userId: string): Promise<DecisionSupportResponse> => {
  const signals: DecisionSignal[] = [];

  // 1. Check active products
  const { data: products } = await supabase
    .from('products')
    .select('id, name, batch_number, expiry_date, status, quantity, ai_quality_score, ai_quality_label')
    .eq('farmer_id', userId);

  if (products && products.length > 0) {
    const now = new Date();
    
    products.forEach(p => {
      // Expiry risk
      if (p.expiry_date && !['Delivered', 'Sold'].includes(p.status)) {
        const expDate = new Date(p.expiry_date);
        const daysDiff = Math.ceil((expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (daysDiff >= 0 && daysDiff <= 7) {
          signals.push({
            type: 'EXPIRY_RISK',
            priority: daysDiff <= 3 ? 'HIGH' : 'MEDIUM',
            title: `Product ${p.name} approaching expiry`,
            reason: `Batch ${p.batch_number} expires in ${daysDiff} days.`,
            source: 'PRODUCT_EXPIRY',
            entityId: p.id
          });
        }
      }

      // Quality assessment missing on active inventory
      if (!p.ai_quality_label && !['Harvested', 'Processing'].includes(p.status)) {
        // Just an info signal
        signals.push({
          type: 'QUALITY_DATA_MISSING',
          priority: 'INFO',
          title: `Quality inspection unavailable for ${p.name}`,
          reason: `Batch ${p.batch_number} has no AI quality label recorded.`,
          source: 'PRODUCT_AI',
          entityId: p.id
        });
      }
    });
  }

  return {
    status: signals.length > 0 ? 'AVAILABLE' : 'INSUFFICIENT_DATA',
    signals
  };
};

export const getProcessorDecisions = async (userId: string): Promise<DecisionSupportResponse> => {
  const signals: DecisionSignal[] = [];

  // Check incoming shipments
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, batch_number, status')
    .eq('receiver_id', userId)
    .eq('status', 'DELIVERED');

  if (shipments && shipments.length > 0) {
    shipments.forEach(s => {
      signals.push({
        type: 'SHIPMENT_ACTION_REQUIRED',
        priority: 'HIGH',
        title: `Shipment awaiting receipt`,
        reason: `Batch ${s.batch_number} is delivered and needs to be received.`,
        source: 'SHIPMENT_STATUS',
        entityId: s.id
      });
    });
  }

  return {
    status: signals.length > 0 ? 'AVAILABLE' : 'INSUFFICIENT_DATA',
    signals
  };
};

export const getDistributorDecisions = async (userId: string): Promise<DecisionSupportResponse> => {
  const signals: DecisionSignal[] = [];

  // Check assigned shipments
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, batch_number, status')
    .eq('distributor_id', userId)
    .eq('status', 'ASSIGNED');

  if (shipments && shipments.length > 0) {
    shipments.forEach(s => {
      signals.push({
        type: 'SHIPMENT_PICKUP_REQUIRED',
        priority: 'HIGH',
        title: `Shipment assigned for pickup`,
        reason: `Batch ${s.batch_number} is assigned and awaits pickup.`,
        source: 'SHIPMENT_STATUS',
        entityId: s.id
      });
    });
  }

  return {
    status: signals.length > 0 ? 'AVAILABLE' : 'INSUFFICIENT_DATA',
    signals
  };
};

export const getRetailerDecisions = async (userId: string): Promise<DecisionSupportResponse> => {
  const signals: DecisionSignal[] = [];

  // Low Inventory Check
  const { data: inventory } = await supabase
    .from('retailer_inventory')
    .select('id, product_name, current_stock, batch_number, expiry_date')
    .eq('retailer_id', userId);

  if (inventory && inventory.length > 0) {
    const now = new Date();

    inventory.forEach(inv => {
      if (inv.current_stock <= 10 && inv.current_stock > 0) {
        signals.push({
          type: 'LOW_INVENTORY',
          priority: 'MEDIUM',
          title: `Low stock for ${inv.product_name}`,
          reason: `Only ${inv.current_stock} units remaining for batch ${inv.batch_number}.`,
          source: 'INVENTORY_LEVEL',
          entityId: inv.id
        });
      }

      if (inv.expiry_date) {
        const expDate = new Date(inv.expiry_date);
        const daysDiff = Math.ceil((expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (daysDiff >= 0 && daysDiff <= 5 && inv.current_stock > 0) {
          signals.push({
            type: 'EXPIRY_RISK',
            priority: daysDiff <= 2 ? 'HIGH' : 'MEDIUM',
            title: `Inventory approaching expiry: ${inv.product_name}`,
            reason: `Batch ${inv.batch_number} expires in ${daysDiff} days.`,
            source: 'INVENTORY_EXPIRY',
            entityId: inv.id
          });
        }
      }
    });
  }

  return {
    status: signals.length > 0 ? 'AVAILABLE' : 'INSUFFICIENT_DATA',
    signals
  };
};

export const getAdminDecisions = async (): Promise<DecisionSupportResponse> => {
  const signals: DecisionSignal[] = [];

  // Check anomalies from DB view or query
  // For admin we could check AI Observability health
  const { data: recentAiError } = await supabase
    .from('ai_audit_logs')
    .select('status, capability, created_at')
    .neq('status', 'SUCCESS')
    .order('created_at', { ascending: false })
    .limit(1);

  if (recentAiError && recentAiError.length > 0) {
    const err = recentAiError[0];
    const ageHours = (new Date().getTime() - new Date(err.created_at).getTime()) / (1000 * 60 * 60);
    if (ageHours < 24) {
      signals.push({
        type: 'AI_SERVICE_UNHEALTHY',
        priority: err.status === 'UNAVAILABLE' ? 'MEDIUM' : 'HIGH',
        title: `AI Service Event: ${err.capability}`,
        reason: `Most recent AI audit log indicates ${err.status}.`,
        source: 'AI_OBSERVABILITY'
      });
    }
  }

  return {
    status: signals.length > 0 ? 'AVAILABLE' : 'INSUFFICIENT_DATA',
    signals
  };
};

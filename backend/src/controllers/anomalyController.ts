import { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import crypto from 'crypto';

export const analyzeAnomalies = (events: any[]) => {
  const anomalies: any[] = [];
  const summary = {
    total: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0
  };

  const addAnomaly = (type: string, severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW', productId: string, batchNumber: string | null, explanation: string, evidence: any, detectedAt: string) => {
    anomalies.push({
      id: crypto.randomUUID(),
      type,
      severity,
      product_id: productId,
      batch_number: batchNumber,
      explanation,
      evidence,
      detected_at: detectedAt
    });
    summary.total++;
    if (severity === 'CRITICAL') summary.critical++;
    if (severity === 'HIGH') summary.high++;
    if (severity === 'MEDIUM') summary.medium++;
    if (severity === 'LOW') summary.low++;
  };

  const eventsByProduct: Record<string, any[]> = {};
  events?.forEach(e => {
    if (!eventsByProduct[e.product_id]) eventsByProduct[e.product_id] = [];
    eventsByProduct[e.product_id].push(e);
  });

  const expectedSequence = [
    'REGISTERED',
    'PROCESSOR_RECEIVED',
    'PROCESSED',
    'DISTRIBUTOR_RECEIVED',
    'DISTRIBUTOR_SHIPPED',
    'RETAILER_RECEIVED'
  ];

  Object.entries(eventsByProduct).forEach(([productId, pEvents]) => {
    const eventCounts: Record<string, number> = {};
    const latestEventOfType: Record<string, any> = {};
    
    pEvents.forEach(e => {
      const type = e.event_type;
      eventCounts[type] = (eventCounts[type] || 0) + 1;
      
      if (!latestEventOfType[type] || new Date(e.timestamp) < new Date(latestEventOfType[type].timestamp)) {
         latestEventOfType[type] = e;
      }

      if (eventCounts[type] === 2) {
        addAnomaly(
          'Duplicate Lifecycle Event',
          'MEDIUM',
          productId,
          e.batch_number || null,
          `Multiple '${type}' events recorded for this product.`,
          { event_type: type },
          new Date().toISOString()
        );
      }
    });

    for (let i = 0; i < expectedSequence.length; i++) {
      const currentTypeName = expectedSequence[i];
      const currentEvent = latestEventOfType[currentTypeName];

      if (currentEvent) {
        for (let j = 0; j < i; j++) {
          const upstreamTypeName = expectedSequence[j];
          const upstreamEvent = latestEventOfType[upstreamTypeName];

          if (!upstreamEvent) {
             addAnomaly(
               'Impossible Event Sequence',
               'CRITICAL',
               productId,
               currentEvent.batch_number || null,
               `Event '${currentTypeName}' exists but required preceding event '${upstreamTypeName}' is missing.`,
               { current_event: currentTypeName, missing_upstream_event: upstreamTypeName },
               new Date().toISOString()
             );
          } else {
             const currentTs = new Date(currentEvent.timestamp).getTime();
             const upstreamTs = new Date(upstreamEvent.timestamp).getTime();

             if (currentTs < upstreamTs) {
                addAnomaly(
                  'Temporal Anomaly',
                  'CRITICAL',
                  productId,
                  currentEvent.batch_number || null,
                  `Event '${currentTypeName}' has an earlier timestamp than its preceding event '${upstreamTypeName}'.`,
                  { 
                    upstream_event: upstreamTypeName, 
                    upstream_time: upstreamEvent.timestamp,
                    current_event: currentTypeName, 
                    current_time: currentEvent.timestamp 
                  },
                  new Date().toISOString()
                );
             }
          }
        }
      }
    }
  });

  return { summary, anomalies };
};

export const getSupplyChainAnomalies = async (req: Request, res: Response) => {
  try {
    const { data: events, error: eventError } = await supabase
      .from('traceability_events')
      .select('*')
      .limit(5000);

    if (eventError) throw eventError;

    const { summary, anomalies } = analyzeAnomalies(events || []);

    res.status(200).json({
      success: true,
      data: {
        summary,
        anomalies,
        methodology: {
          deterministic_rules: [
            "CRITICAL: Impossible Event Sequence (downstream event exists without required upstream custody event).",
            "CRITICAL: Temporal Anomaly (upstream and downstream events exist, but timestamps violate chronological order).",
            "MEDIUM: Duplicate Lifecycle Event (multiple events of the same type for a single product)."
          ]
        }
      }
    });

  } catch (error) {
    console.error('Anomaly Detection Error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate anomaly intelligence' });
  }
};
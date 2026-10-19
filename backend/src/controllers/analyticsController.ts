import { Request, Response } from 'express';
import { supabase } from '../config/supabase';

/**
 * Intelligent Supply-Chain Analytics Controller
 * Calculates operational metrics exclusively from real database events.
 */

export const getSupplyChainAnalytics = async (req: Request, res: Response) => {
  try {
    // 1. Fetch relevant traceability events
    const { data: events, error: eventError } = await supabase
      .from('traceability_events')
      .select('*')
      .order('timestamp', { ascending: true })
      .limit(5000);

    if (eventError) throw eventError;

    // 2. Fetch shipments
    const { data: shipments, error: shipmentError } = await supabase
      .from('shipments')
      .select('*')
      .limit(5000);

    if (shipmentError) throw shipmentError;

    // 3. Fetch retailer inventory & sales data
    const { data: inventory, error: invError } = await supabase
      .from('retailer_inventory')
      .select('*')
      .limit(5000);
    if (invError) throw invError;

    const { data: sales, error: salesError } = await supabase
      .from('retailer_sales')
      .select('*')
      .limit(5000);
    if (salesError) throw salesError;

    const { data: wastage, error: wasteError } = await supabase
      .from('retailer_wastage')
      .select('*')
      .limit(5000);
    if (wasteError) throw wasteError;

    const { data: returns, error: returnError } = await supabase
      .from('retailer_returns')
      .select('*')
      .limit(5000);
    if (returnError) throw returnError;

    const { data: batchLineage, error: lineageError } = await supabase
      .from('batch_lineage')
      .select('*')
      .limit(5000);
    if (lineageError) throw lineageError;

    const { data: products, error: prodError } = await supabase
      .from('products')
      .select('id, created_at')
      .limit(5000);
    if (prodError) throw prodError;

    // ---------------------------------------------------------
    // A/B/C. PRODUCT JOURNEY & TIME METRICS
    // ---------------------------------------------------------
    
    // Group events by product_id
    const eventsByProduct: Record<string, any[]> = {};
    events?.forEach(e => {
      if (!eventsByProduct[e.product_id]) eventsByProduct[e.product_id] = [];
      eventsByProduct[e.product_id].push(e);
    });

    let totalProcessingTime = 0;
    let processingSamples = 0;
    let minProcessingTime = Infinity;
    let maxProcessingTime = 0;

    let totalTransitTime = 0;
    let transitSamples = 0;
    let minTransitTime = Infinity;
    let maxTransitTime = 0;

    let totalE2ETime = 0;
    let e2eSamples = 0;
    
    let completeJourneys = 0;
    let partialJourneys = 0;

    // Bottleneck analysis mapping
    const stageTimes: Record<string, number[]> = {
      'Farmer -> Processor': [],
      'Processor Processing': [],
      'Processor -> Distributor': [],
      'Distributor -> Retailer': []
    };

    Object.entries(eventsByProduct).forEach(([productId, pEvents]) => {
      // Find key events
      const registered = pEvents.find(e => e.event_type === 'REGISTERED');
      const procReceived = pEvents.find(e => e.event_type === 'PROCESSOR_RECEIVED');
      const processed = pEvents.find(e => e.event_type === 'PROCESSED');
      const distReceived = pEvents.find(e => e.event_type === 'DISTRIBUTOR_RECEIVED');
      const distShipped = pEvents.find(e => e.event_type === 'DISTRIBUTOR_SHIPPED');
      const retReceived = pEvents.find(e => e.event_type === 'RETAILER_RECEIVED');

      // Processing Time (PROCESSOR_RECEIVED -> PROCESSED)
      if (procReceived && processed) {
        const durationHours = (new Date(processed.timestamp).getTime() - new Date(procReceived.timestamp).getTime()) / (1000 * 60 * 60);
        if (durationHours >= 0) {
          totalProcessingTime += durationHours;
          processingSamples++;
          minProcessingTime = Math.min(minProcessingTime, durationHours);
          maxProcessingTime = Math.max(maxProcessingTime, durationHours);
          stageTimes['Processor Processing'].push(durationHours);
        }
      }

      // Transit Time (DISTRIBUTOR_SHIPPED -> RETAILER_RECEIVED)
      if (distShipped && retReceived) {
        const durationHours = (new Date(retReceived.timestamp).getTime() - new Date(distShipped.timestamp).getTime()) / (1000 * 60 * 60);
        if (durationHours >= 0) {
          totalTransitTime += durationHours;
          transitSamples++;
          minTransitTime = Math.min(minTransitTime, durationHours);
          maxTransitTime = Math.max(maxTransitTime, durationHours);
          stageTimes['Distributor -> Retailer'].push(durationHours);
        }
      }

      // Farmer -> Processor
      if (registered && procReceived) {
        const durationHours = (new Date(procReceived.timestamp).getTime() - new Date(registered.timestamp).getTime()) / (1000 * 60 * 60);
        if (durationHours >= 0) stageTimes['Farmer -> Processor'].push(durationHours);
      }
      
      // Processor -> Distributor
      if (processed && distReceived) {
        const durationHours = (new Date(distReceived.timestamp).getTime() - new Date(processed.timestamp).getTime()) / (1000 * 60 * 60);
        if (durationHours >= 0) stageTimes['Processor -> Distributor'].push(durationHours);
      }

      // Traceability completeness and E2E Time (strict)
      const isCompleteJourney = registered && procReceived && processed && distReceived && distShipped && retReceived;

      if (isCompleteJourney) {
        completeJourneys++;
        const durationHours = (new Date(retReceived.timestamp).getTime() - new Date(registered.timestamp).getTime()) / (1000 * 60 * 60);
        if (durationHours >= 0) {
          totalE2ETime += durationHours;
          e2eSamples++;
        }
      } else if (pEvents.length > 0) {
        partialJourneys++;
      }
    });

    const getMedian = (arr: number[]) => {
      if (arr.length === 0) return 0;
      const sorted = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    };

    // Bottleneck Evaluation
    const bottlenecks = Object.entries(stageTimes).map(([stage, times]) => {
      if (times.length < 5) return { stage, status: 'Insufficient Data' };
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      const median = getMedian(times);
      const relative = avg > 0 && median > 0 ? (avg - median) / median : 0;
      return {
        stage,
        average_hours: avg,
        median_hours: median,
        sample_count: times.length,
        relative_to_median: relative,
        status: (relative > 0.5 && times.length >= 5) ? 'Potential Bottleneck' : 'Normal'
      };
    });

    // ---------------------------------------------------------
    // D. PRODUCT LOSS / WASTAGE ANALYTICS
    // ---------------------------------------------------------
    const totalWastageQuantity = wastage?.reduce((sum, w) => sum + Number(w.quantity), 0) || 0;
    const totalReturnedQuantity = returns?.reduce((sum, r) => sum + Number(r.quantity), 0) || 0;
    const totalSalesQuantity = sales?.reduce((sum, s) => sum + Number(s.quantity), 0) || 0;
    
    // Denominator = Sales + Wastage + Returns (i.e. all disposed items)
    const totalDisposed = totalSalesQuantity + totalWastageQuantity + totalReturnedQuantity;
    const wastageRate = totalDisposed > 0 ? totalWastageQuantity / totalDisposed : null;
    const returnRate = totalDisposed > 0 ? totalReturnedQuantity / totalDisposed : null;

    const damagedReturns = returns?.filter(r => r.reason === 'DAMAGED').reduce((sum, r) => sum + Number(r.quantity), 0) || 0;
    const expiredWastage = wastage?.filter(w => w.reason === 'EXPIRED').reduce((sum, w) => sum + Number(w.quantity), 0) || 0;

    // ---------------------------------------------------------
    // E. RETAILER INVENTORY INTELLIGENCE
    // ---------------------------------------------------------
    const totalInventoryQuantity = inventory?.reduce((sum, i) => sum + Number(i.quantity), 0) || 0;
    const availableInventory = inventory?.filter(i => i.status === 'AVAILABLE').reduce((sum, i) => sum + Number(i.quantity), 0) || 0;
    const expiredInventory = inventory?.filter(i => i.status === 'EXPIRED').reduce((sum, i) => sum + Number(i.quantity), 0) || 0;
    
    const inventoryByStatus = {
      AVAILABLE: availableInventory,
      EXPIRED: expiredInventory,
      SOLD_OUT: inventory?.filter(i => i.status === 'SOLD_OUT').reduce((sum, i) => sum + Number(i.quantity), 0) || 0,
    };

    // ---------------------------------------------------------
    // F. SHIPMENT PERFORMANCE
    // ---------------------------------------------------------
    const totalShipments = shipments?.length || 0;
    const completedShipments = shipments?.filter(s => s.status === 'DELIVERED' || s.status === 'COMPLETED').length || 0;
    const pendingShipments = shipments?.filter(s => s.status === 'PENDING' || s.status === 'SHIPPED').length || 0;
    const cancelledShipments = shipments?.filter(s => s.status === 'CANCELLED').length || 0;
    const shipmentCompletionRate = totalShipments > 0 ? completedShipments / totalShipments : null;

    // ---------------------------------------------------------
    // G. BATCH LINEAGE ANALYTICS
    // ---------------------------------------------------------
    const totalTransformations = batchLineage?.length || 0;
    // unique children
    const childSet = new Set(batchLineage?.map(b => b.child_product_id));
    const processedChildBatches = childSet.size;

    const lineageAnalytics = {
      totalTransformations,
      processedChildBatches,
      batchesWithLineage: totalTransformations > 0 ? true : false
    };

    // ---------------------------------------------------------
    // H. TRACEABILITY COMPLETENESS
    // ---------------------------------------------------------
    const productsWithEvents = Object.keys(eventsByProduct).length;
    const productsWithoutEvents = (products?.length || 0) - productsWithEvents;

    const eventCountsByType: Record<string, number> = {};
    events?.forEach(e => {
      eventCountsByType[e.event_type] = (eventCountsByType[e.event_type] || 0) + 1;
    });

    // ---------------------------------------------------------
    // COMPILE RESULTS
    // ---------------------------------------------------------
    res.status(200).json({
      success: true,
      data: {
        journeyTimes: {
          processing: {
            averageHours: processingSamples > 0 ? totalProcessingTime / processingSamples : null,
            medianHours: stageTimes['Processor Processing'].length > 0 ? getMedian(stageTimes['Processor Processing']) : null,
            minHours: processingSamples > 0 ? minProcessingTime : null,
            maxHours: processingSamples > 0 ? maxProcessingTime : null,
            samples: processingSamples
          },
          transit: {
            averageHours: transitSamples > 0 ? totalTransitTime / transitSamples : null,
            medianHours: stageTimes['Distributor -> Retailer'].length > 0 ? getMedian(stageTimes['Distributor -> Retailer']) : null,
            minHours: transitSamples > 0 ? minTransitTime : null,
            maxHours: transitSamples > 0 ? maxTransitTime : null,
            samples: transitSamples
          },
          endToEnd: {
            averageHours: e2eSamples > 0 ? totalE2ETime / e2eSamples : null,
            samples: e2eSamples
          }
        },
        bottlenecks,
        lossAnalytics: {
          totalWastageQuantity,
          totalReturnedQuantity,
          totalSalesQuantity,
          wastageRate,
          returnRate,
          damagedReturns,
          expiredWastage
        },
        inventoryIntelligence: {
          totalInventoryQuantity,
          availableInventory,
          expiredInventory,
          inventoryByStatus
        },
        shipmentPerformance: {
          totalShipments,
          completedShipments,
          pendingShipments,
          cancelledShipments,
          shipmentCompletionRate
        },
        traceabilityCompleteness: {
          productsWithEvents,
          productsWithoutEvents,
          completeJourneys,
          partialJourneys,
          eventCountsByType
        },
        lineageAnalytics
      }
    });

  } catch (error) {
    console.error('Supply Chain Analytics Error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate analytics' });
  }
};

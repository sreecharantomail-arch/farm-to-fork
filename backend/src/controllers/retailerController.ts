import { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { blockchainService, BlockchainStatus } from '../services/blockchainService';

// Generate a unique Request ID (e.g., REQ-1023)
const generateRequestId = async () => {
  const { data, error } = await supabase
    .from('product_requests')
    .select('request_id')
    .order('created_at', { ascending: false })
    .limit(500)
    .limit(1);

  if (error || !data || data.length === 0) {
    return 'REQ-1000';
  }

  const lastId = data[0].request_id;
  const num = parseInt(lastId.split('-')[1]);
  return `REQ-${num + 1}`;
};

export const createProductRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const { product_name, quantity, unit, required_date, priority, notes } = req.body;
    const retailer_id = (req as any).user?.id;

    if (!retailer_id) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    if (!product_name || !quantity || !unit || !required_date) {
      res.status(400).json({ success: false, message: 'Missing required fields' });
      return;
    }

    const request_id = await generateRequestId();

    const { data: request, error } = await supabase
      .from('product_requests')
      .insert({
        request_id,
        retailer_id,
        product_name,
        quantity,
        unit,
        required_date,
        priority: priority || 'NORMAL',
        notes: notes || null,
        status: 'PENDING'
      })
      .select()
      .single();

    if (error) {
      console.error('error occurred');
      res.status(500).json({ success: false, message: 'Database error' });
      return;
    }

    res.status(201).json({ success: true, data: request });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const getMyRequests = async (req: Request, res: Response): Promise<void> => {
  try {
    const retailer_id = (req as any).user?.id;

    if (!retailer_id) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const { data: requests, error } = await supabase
      .from('product_requests')
      .select('*')
      .eq('retailer_id', retailer_id)
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) {
      res.status(500).json({ success: false, message: 'Database error' });
      return;
    }

    res.status(200).json({ success: true, data: requests });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const getRetailerShipments = async (req: Request, res: Response): Promise<void> => {
  try {
    const retailer_id = (req as any).user?.id;

    if (!retailer_id) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const { data: shipments, error } = await supabase
      .from('shipments')
      .select('*, sender:sender_id(name, email), distributor:distributor_id(name, email), request:request_id(product_name, request_id)')
      .eq('receiver_id', retailer_id)
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) {
      res.status(500).json({ success: false, message: 'Database error' });
      return;
    }

    // Attach proof of delivery and cold-chain status if available
    const shipmentIds = (shipments || []).map((s: any) => s.id);
    let proofsMap: Record<string, any> = {};
    let coldChainMap: Record<string, any> = {};

    if (shipmentIds.length > 0) {
      const { data: proofs } = await supabase
        .from('proof_of_delivery')
        .select('*')
        .in('shipment_id', shipmentIds);

      if (proofs) {
        proofs.forEach((p: any) => {
          proofsMap[p.shipment_id] = p;
        });
      }

      const { data: readings } = await supabase
        .from('cold_chain_readings')
        .select('*')
        .in('shipment_id', shipmentIds)
        .order('measured_at', { ascending: false });

      if (readings) {
        readings.forEach((r: any) => {
          if (!coldChainMap[r.shipment_id]) {
            coldChainMap[r.shipment_id] = { latest_reading: r, active_alerts: [] };
          }
        });
      }

      const { data: activeAlerts } = await supabase
        .from('cold_chain_alerts')
        .select('*')
        .in('shipment_id', shipmentIds)
        .in('status', ['ACTIVE', 'ACKNOWLEDGED']);

      if (activeAlerts) {
        activeAlerts.forEach((a: any) => {
          if (!coldChainMap[a.shipment_id]) {
            coldChainMap[a.shipment_id] = { latest_reading: null, active_alerts: [] };
          }
          coldChainMap[a.shipment_id].active_alerts.push(a);
        });
      }
    }

    const enrichedShipments = (shipments || []).map((s: any) => {
      const cc = coldChainMap[s.id] || null;
      let conditionStatus = 'UNAVAILABLE';
      if (cc?.active_alerts?.some((a: any) => a.severity === 'CRITICAL')) {
        conditionStatus = 'CRITICAL';
      } else if (cc?.active_alerts?.some((a: any) => a.severity === 'WARNING')) {
        conditionStatus = 'WARNING';
      } else if (cc?.latest_reading) {
        conditionStatus = 'NORMAL';
      }

      return {
        ...s,
        proof_of_delivery: proofsMap[s.id] || null,
        cold_chain_status: conditionStatus,
        latest_reading: cc?.latest_reading || null,
        active_alerts: cc?.active_alerts || [],
        has_critical_alert: cc?.active_alerts?.some((a: any) => a.severity === 'CRITICAL') || false,
        cold_chain: cc ? { ...cc, condition_status: conditionStatus } : { latest_reading: null, active_alerts: [], condition_status: 'UNAVAILABLE' }
      };
    });

    res.status(200).json({ success: true, data: enrichedShipments });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const verifyBatch = async (req: Request, res: Response): Promise<void> => {
  try {
    const retailer_id = (req as any).user?.id;
    const { shipment_id, qr_data } = req.body;

    if (!retailer_id) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    if (!shipment_id || !qr_data) {
      res.status(400).json({ success: false, message: 'Shipment ID and QR Data are required' });
      return;
    }

    const { data: shipment, error: shipmentErr } = await supabase
      .from('shipments')
      .select('*, request:request_id(product_name)')
      .eq('id', shipment_id)
      .single();

    if (shipmentErr || !shipment) {
      res.status(404).json({ success: false, message: 'Shipment not found' });
      return;
    }

    if (shipment.receiver_id !== retailer_id) {
      res.status(403).json({ success: false, message: 'This shipment does not belong to your store' });
      return;
    }

    if (shipment.status === 'RECEIVED') {
      res.status(400).json({ success: false, message: 'Shipment has already been received' });
      return;
    }
    if (shipment.status === 'CANCELLED') {
      res.status(400).json({ success: false, message: 'Shipment is cancelled and cannot be received' });
      return;
    }

    if (shipment.batch_number !== qr_data) {
      res.status(400).json({ success: false, message: `QR Code mismatch. Expected batch ${shipment.batch_number}, but scanned ${qr_data}` });
      return;
    }

    const { data: product, error: productErr } = await supabase
      .from('products')
      .select('*')
      .eq('id', shipment.product_id)
      .single();

    if (productErr || !product) {
      res.status(404).json({ success: false, message: 'Associated product/batch not found in system' });
      return;
    }

    if (product.status === 'RECALLED') {
      res.status(400).json({ success: false, message: 'DANGER: This batch has been recalled. DO NOT RECEIVE.' });
      return;
    }

    res.status(200).json({ 
      success: true, 
      message: 'Batch verified successfully',
      data: {
        product_name: shipment.request?.product_name || product.name,
        batch_number: product.batch_number,
        quantity: shipment.quantity,
        unit: shipment.unit,
        sender_id: shipment.sender_id,
        expiry_date: product.expiry_date
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error during verification' });
  }
};

export const receiveProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const retailer_id = (req as any).user?.id;
    const { shipment_id, qr_data } = req.body;

    if (!retailer_id) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    if (!shipment_id || !qr_data) {
      res.status(400).json({ success: false, message: 'Shipment ID and QR Data are required' });
      return;
    }

    // 1. Shipment validation (Must re-validate everything from Phase 4)
    const { data: shipment, error: shipmentErr } = await supabase
      .from('shipments')
      .select('*, request:request_id(product_name)')
      .eq('id', shipment_id)
      .single();

    if (shipmentErr || !shipment) {
      res.status(404).json({ success: false, message: 'Shipment not found' });
      return;
    }

    if (shipment.receiver_id !== retailer_id) {
      res.status(403).json({ success: false, message: 'This shipment does not belong to your store' });
      return;
    }

    if (shipment.status === 'RECEIVED') {
      res.status(400).json({ success: false, message: 'Shipment has already been received' });
      return;
    }
    if (shipment.status === 'CANCELLED') {
      res.status(400).json({ success: false, message: 'Shipment is cancelled and cannot be received' });
      return;
    }

    if (shipment.batch_number !== qr_data) {
      res.status(400).json({ success: false, message: `QR Code mismatch.` });
      return;
    }

    // 2. Blockchain Transaction execution (Non-fatal)
    let txHash = null;
    let blockchainError = null;
    try {
      const bcResult = await blockchainService.recordReceipt(shipment.product_id);
      if (bcResult.status === BlockchainStatus.ON_CHAIN_VERIFICATION_FAILED) {
        console.warn("Blockchain transaction failed. Continuing with database only.");
        blockchainError = 'ON_CHAIN_VERIFICATION_FAILED';
      } else {
        txHash = bcResult.txHash;
      }
    } catch (bcError) {
      console.error("Blockchain transaction exception:", bcError);
      blockchainError = 'EXCEPTION';
    }

    // 3. Mark Shipment RECEIVED
    const { error: updateShipmentErr } = await supabase
      .from('shipments')
      .update({ status: 'RECEIVED' })
      .eq('id', shipment_id);

    if (updateShipmentErr) {
      res.status(500).json({ success: false, message: 'Failed to update shipment status'});
      return;
    }

    // 3.1 Update Product Ownership
    const { error: updateProductErr } = await supabase
      .from('products')
      .update({ current_owner_id: retailer_id })
      .eq('id', shipment.product_id);

    if (updateProductErr) {
      console.error('error occurred');
      res.status(500).json({ success: false, message: 'Failed to update product ownership'});
      return;
    }

    // 3.2 Update Proof of Delivery if one exists
    await supabase
      .from('proof_of_delivery')
      .update({
        status: 'ACKNOWLEDGED',
        acknowledged_at: new Date().toISOString(),
        acknowledged_by: retailer_id,
        updated_at: new Date().toISOString()
      })
      .eq('shipment_id', shipment_id)
      .eq('status', 'SUBMITTED');

    // 3.5 Create Kafka Outbox Event (Phase 7 - Event Streaming)
    const { randomUUID } = require('crypto');
    await supabase.from('event_outbox').insert({
      event_id: randomUUID(),
      event_type: 'SHIPMENT_RECEIVED',
      topic: 'shipment-events',
      payload: {
        shipment_id: shipment.id,
        batch_id: shipment.batch_number,
        retailer_id: retailer_id,
        quantity: shipment.quantity,
        unit: shipment.unit
      }
    });

    // 4. Create RETAILER_RECEIVED Traceability Event
    const { error: eventErr } = await supabase
      .from('traceability_events')
      .insert({
        product_id: shipment.product_id,
        batch_number: shipment.batch_number,
        event_type: 'RETAILER_RECEIVED',
        actor_id: retailer_id,
        location: 'Retail Store',
        blockchain_hash: txHash,
        metadata: {
          shipment_id: shipment.id,
          quantity_received: shipment.quantity,
          unit: shipment.unit
        }
      });

    if (eventErr) {
      console.error("Traceability event creation failed:", eventErr);
    } else {
      const { randomUUID } = require('crypto');
      // Phase 9: RETAILER_RECEIVED Traceability Kafka Event
      await supabase.from('event_outbox').insert({
        event_id: randomUUID(),
        event_type: 'RETAILER_RECEIVED',
        topic: 'traceability-events',
        payload: {
          batch_id: shipment.batch_number,
          shipment_id: shipment.id,
          retailer_id: retailer_id,
          quantity: shipment.quantity
        }
      });
      // Phase 9: BLOCKCHAIN_RECORDED Traceability Kafka Event
      if (txHash) {
        await supabase.from('event_outbox').insert({
          event_id: randomUUID(),
          event_type: 'BLOCKCHAIN_RECORDED',
          topic: 'traceability-events',
          payload: {
            batch_id: shipment.batch_number,
            tx_hash: txHash,
            event_source: 'RETAILER_RECEIVED'
          }
        });
      }
    }

    // 5. Fetch product to get expiry_date and create Inventory Record
    const { data: product } = await supabase
      .from('products')
      .select('expiry_date')
      .eq('id', shipment.product_id)
      .single();

    const { error: invErr } = await supabase
      .from('retailer_inventory')
      .insert({
        retailer_id,
        product_id: shipment.product_id,
        batch_number: shipment.batch_number,
        quantity: shipment.quantity,
        unit: shipment.unit,
        expiry_date: product?.expiry_date || null,
        status: 'AVAILABLE'
      });

    if (invErr) {
      console.error("Inventory creation failed:", invErr);
    } else {
      // Create Kafka Outbox Event for Inventory (Phase 8)
      await supabase.from('event_outbox').insert({
        event_id: randomUUID(),
        event_type: 'INVENTORY_CREATED',
        topic: 'inventory-events',
        payload: {
          batch_id: shipment.batch_number,
          retailer_id: retailer_id,
          product_id: shipment.product_id,
          quantity: shipment.quantity,
          unit: shipment.unit
        }
      });
    }

    res.status(200).json({ 
      success: true, 
      message: 'Product successfully received and recorded on the blockchain.',
      data: {
        blockchain_hash: txHash,
        shipment_id: shipment.id
      }
    });

  } catch (error) {
    console.error('error occurred');
      res.status(500).json({ success: false, message: 'Server Error during receiving' });
  }
};

// GET /api/retailer/shipments/:id/proof-of-delivery
export const getShipmentDeliveryProof = async (req: Request, res: Response): Promise<void> => {
  try {
    const retailer_id = (req as any).user?.id;
    const { id: shipment_id } = req.params;

    if (!retailer_id) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    // Verify shipment receiver
    const { data: shipment, error: shipErr } = await supabase
      .from('shipments')
      .select('id, receiver_id')
      .eq('id', shipment_id)
      .single();

    if (shipErr || !shipment) {
      res.status(404).json({ success: false, message: 'Shipment not found' });
      return;
    }

    if (shipment.receiver_id !== retailer_id) {
      res.status(403).json({ success: false, message: 'This shipment does not belong to your store' });
      return;
    }

    const { data: proof, error: proofErr } = await supabase
      .from('proof_of_delivery')
      .select('*, distributor:distributor_id(name, email)')
      .eq('shipment_id', shipment_id)
      .maybeSingle();

    if (proofErr) {
      res.status(500).json({ success: false, message: 'Database error fetching proof of delivery' });
      return;
    }

    if (!proof) {
      res.status(404).json({ success: false, message: 'No delivery proof found for this shipment' });
      return;
    }

    res.status(200).json({ success: true, data: proof });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// POST /api/retailer/shipments/:id/acknowledge-delivery
export const acknowledgeDeliveryReceipt = async (req: Request, res: Response): Promise<void> => {
  try {
    const retailer_id = (req as any).user?.id;
    const { id: shipment_id } = req.params;
    const { qr_data } = req.body;

    if (!retailer_id) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    if (!shipment_id || !qr_data) {
      res.status(400).json({ success: false, message: 'Shipment ID and QR Data are required' });
      return;
    }

    // 1. Fetch shipment
    const { data: shipment, error: shipErr } = await supabase
      .from('shipments')
      .select('*, request:request_id(product_name)')
      .eq('id', shipment_id)
      .single();

    if (shipErr || !shipment) {
      res.status(404).json({ success: false, message: 'Shipment not found' });
      return;
    }

    // Verify retailer ownership
    if (shipment.receiver_id !== retailer_id) {
      res.status(403).json({ success: false, message: 'This shipment does not belong to your store' });
      return;
    }

    // Status validations
    if (shipment.status === 'RECEIVED') {
      res.status(400).json({ success: false, message: 'Shipment has already been received' });
      return;
    }

    if (shipment.status === 'DELIVERY_DISPUTED') {
      res.status(400).json({ success: false, message: 'Shipment has an active discrepancy dispute. Resolve before receiving.' });
      return;
    }

    if (shipment.status !== 'DELIVERED') {
      res.status(400).json({ success: false, message: `Shipment is in status '${shipment.status}'. Expected 'DELIVERED'.` });
      return;
    }

    // Verify QR code match
    if (shipment.batch_number !== qr_data) {
      res.status(400).json({ success: false, message: `QR Code mismatch. Expected batch ${shipment.batch_number}, but scanned ${qr_data}` });
      return;
    }

    // 2. Fetch Proof of Delivery
    const { data: proof, error: proofErr } = await supabase
      .from('proof_of_delivery')
      .select('*')
      .eq('shipment_id', shipment_id)
      .maybeSingle();

    if (proofErr || !proof) {
      res.status(404).json({ success: false, message: 'Proof of delivery not found for this shipment' });
      return;
    }

    if (proof.status === 'ACKNOWLEDGED') {
      res.status(400).json({ success: false, message: 'Delivery proof has already been acknowledged' });
      return;
    }

    if (proof.status === 'DISPUTED') {
      res.status(400).json({ success: false, message: 'Delivery proof is currently disputed' });
      return;
    }

    // 3. Double-Intake Protection: Check if inventory item already exists
    const { data: existingInv } = await supabase
      .from('retailer_inventory')
      .select('id')
      .eq('retailer_id', retailer_id)
      .eq('batch_number', shipment.batch_number)
      .eq('product_id', shipment.product_id)
      .maybeSingle();

    if (existingInv) {
      res.status(409).json({ success: false, message: 'Inventory intake already completed for this batch' });
      return;
    }

    // 4. Non-fatal Blockchain transaction
    let txHash = null;
    try {
      const bcResult = await blockchainService.recordReceipt(shipment.product_id);
      if (bcResult.status === BlockchainStatus.ON_CHAIN_CONFIRMED) {
        txHash = bcResult.txHash;
      }
    } catch (bcError) {
      console.warn("Blockchain recording skipped or failed:", bcError);
    }

    const deliveredQty = Number(proof.quantity_delivered) || Number(shipment.quantity);

    // 5. Atomic execution using transactional stored procedure
    const { data: rpcData, error: rpcErr } = await (supabase as any).rpc('acknowledge_delivery_receipt', {
      p_shipment_id: shipment_id,
      p_retailer_id: retailer_id,
      p_qr_data: qr_data,
      p_tx_hash: txHash
    });

    if (!rpcErr && rpcData?.success) {
      res.status(200).json({
        success: true,
        message: 'Delivery receipt successfully acknowledged and inventory intake completed.',
        data: {
          shipment_id: shipment.id,
          pod_id: proof.id,
          status: 'ACKNOWLEDGED',
          quantity_received: rpcData.quantity || deliveredQty,
          blockchain_hash: txHash,
          inventory_id: rpcData.inventory_id
        }
      });
      return;
    }

    if (rpcErr && !rpcErr.message?.includes('does not exist')) {
      if (rpcErr.code === 'P0002' || rpcErr.message?.includes('not found')) {
        res.status(404).json({ success: false, message: rpcErr.message });
        return;
      }
      if (rpcErr.code === '42501' || rpcErr.message?.includes('not assigned') || rpcErr.message?.includes('not belong')) {
        res.status(403).json({ success: false, message: rpcErr.message });
        return;
      }
      if (rpcErr.code === '23505' || rpcErr.message?.includes('already exists')) {
        res.status(409).json({ success: false, message: rpcErr.message });
        return;
      }
      if (rpcErr.code === '22023' || rpcErr.message?.includes('already') || rpcErr.message?.includes('mismatch') || rpcErr.message?.includes('DELIVERED')) {
        res.status(400).json({ success: false, message: rpcErr.message });
        return;
      }
      res.status(500).json({ success: false, message: rpcErr.message || 'Database transaction error during acknowledgement' });
      return;
    }

    const acknowledgedAt = new Date().toISOString();

    // 5b. Fallback for mock environments: Update POD status
    const { error: updatePodErr } = await supabase
      .from('proof_of_delivery')
      .update({
        status: 'ACKNOWLEDGED',
        acknowledged_at: acknowledgedAt,
        acknowledged_by: retailer_id,
        updated_at: acknowledgedAt
      })
      .eq('shipment_id', shipment_id);

    if (updatePodErr) {
      res.status(500).json({ success: false, message: 'Failed to update proof of delivery status' });
      return;
    }

    // 6. Update Shipment status to RECEIVED
    const { error: updateShipErr } = await supabase
      .from('shipments')
      .update({ status: 'RECEIVED', updated_at: acknowledgedAt })
      .eq('id', shipment_id);

    if (updateShipErr) {
      res.status(500).json({ success: false, message: 'Failed to update shipment status' });
      return;
    }

    // 7. Update Product ownership
    await supabase
      .from('products')
      .update({ current_owner_id: retailer_id, updated_at: acknowledgedAt })
      .eq('id', shipment.product_id);

    // 8. Fetch product for expiry date and create Retailer Inventory Record
    const { data: product } = await supabase
      .from('products')
      .select('expiry_date')
      .eq('id', shipment.product_id)
      .single();

    const { data: newInventory, error: invErr } = await supabase
      .from('retailer_inventory')
      .insert({
        retailer_id,
        product_id: shipment.product_id,
        batch_number: shipment.batch_number,
        quantity: deliveredQty,
        unit: proof.unit || shipment.unit || 'units',
        expiry_date: product?.expiry_date || null,
        status: 'AVAILABLE'
      })
      .select()
      .single();

    if (invErr) {
      console.error("Inventory creation failed:", invErr);
    }

    // 9. Traceability Event
    await supabase.from('traceability_events').insert({
      product_id: shipment.product_id,
      batch_number: shipment.batch_number,
      event_type: 'RETAILER_RECEIVED',
      actor_id: retailer_id,
      location: 'Retail Store',
      blockchain_hash: txHash,
      metadata: {
        shipment_id: shipment.id,
        quantity_received: deliveredQty,
        unit: proof.unit || shipment.unit,
        pod_id: proof.id,
        acknowledged_at: acknowledgedAt
      }
    });

    // 10. Event Outbox
    const { randomUUID } = require('crypto');
    await supabase.from('event_outbox').insert([
      {
        event_id: randomUUID(),
        event_type: 'SHIPMENT_RECEIVED',
        topic: 'shipment-events',
        payload: {
          shipment_id: shipment.id,
          batch_id: shipment.batch_number,
          retailer_id,
          quantity: deliveredQty,
          unit: proof.unit || shipment.unit,
          pod_id: proof.id
        }
      },
      {
        event_id: randomUUID(),
        event_type: 'RETAILER_RECEIVED',
        topic: 'traceability-events',
        payload: {
          batch_id: shipment.batch_number,
          shipment_id: shipment.id,
          retailer_id,
          quantity: deliveredQty
        }
      },
      {
        event_id: randomUUID(),
        event_type: 'INVENTORY_CREATED',
        topic: 'inventory-events',
        payload: {
          inventory_id: newInventory?.id,
          batch_id: shipment.batch_number,
          retailer_id,
          product_id: shipment.product_id,
          quantity: deliveredQty,
          unit: proof.unit || shipment.unit
        }
      }
    ]);

    if (txHash) {
      await supabase.from('event_outbox').insert({
        event_id: randomUUID(),
        event_type: 'BLOCKCHAIN_RECORDED',
        topic: 'traceability-events',
        payload: {
          batch_id: shipment.batch_number,
          tx_hash: txHash,
          event_source: 'RETAILER_ACKNOWLEDGED'
        }
      });
    }

    res.status(200).json({
      success: true,
      message: 'Delivery receipt successfully acknowledged and inventory intake completed.',
      data: {
        shipment_id: shipment.id,
        pod_id: proof.id,
        status: 'ACKNOWLEDGED',
        quantity_received: deliveredQty,
        blockchain_hash: txHash,
        inventory_id: newInventory?.id
      }
    });
  } catch (error) {
    console.error('Acknowledgement error:', error);
    res.status(500).json({ success: false, message: 'Server Error during delivery acknowledgement' });
  }
};

// POST /api/retailer/shipments/:id/report-discrepancy
export const reportDeliveryDiscrepancy = async (req: Request, res: Response): Promise<void> => {
  try {
    const retailer_id = (req as any).user?.id;
    const { id: shipment_id } = req.params;
    const { reason, notes } = req.body;

    if (!retailer_id) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    if (!reason || typeof reason !== 'string' || !reason.trim()) {
      res.status(400).json({ success: false, message: 'Discrepancy reason is required' });
      return;
    }

    // 1. Fetch shipment
    const { data: shipment, error: shipErr } = await supabase
      .from('shipments')
      .select('*')
      .eq('id', shipment_id)
      .single();

    if (shipErr || !shipment) {
      res.status(404).json({ success: false, message: 'Shipment not found' });
      return;
    }

    if (shipment.receiver_id !== retailer_id) {
      res.status(403).json({ success: false, message: 'This shipment does not belong to your store' });
      return;
    }

    if (shipment.status === 'RECEIVED') {
      res.status(400).json({ success: false, message: 'Cannot dispute an already received shipment' });
      return;
    }

    // 2. Fetch Proof of Delivery
    const { data: proof, error: proofErr } = await supabase
      .from('proof_of_delivery')
      .select('*')
      .eq('shipment_id', shipment_id)
      .maybeSingle();

    if (proofErr || !proof) {
      res.status(404).json({ success: false, message: 'Proof of delivery not found for this shipment' });
      return;
    }

    if (proof.status === 'DISPUTED') {
      res.status(400).json({ success: false, message: 'A discrepancy has already been reported for this delivery' });
      return;
    }

    if (proof.status === 'ACKNOWLEDGED') {
      res.status(400).json({ success: false, message: 'Cannot dispute an already acknowledged delivery' });
      return;
    }

    // 3. Atomic execution using transactional stored procedure
    const { data: rpcData, error: rpcErr } = await (supabase as any).rpc('report_delivery_discrepancy', {
      p_shipment_id: shipment_id,
      p_retailer_id: retailer_id,
      p_reason: reason.trim(),
      p_notes: notes?.trim() || null
    });

    if (!rpcErr && rpcData?.success) {
      res.status(200).json({
        success: true,
        message: 'Delivery discrepancy reported successfully. Shipment status updated to DELIVERY_DISPUTED.',
        data: {
          shipment_id: shipment.id,
          pod_id: rpcData.pod_id || proof.id,
          status: 'DISPUTED',
          reason: reason.trim(),
          notes: notes?.trim() || null
        }
      });
      return;
    }

    if (rpcErr && !rpcErr.message?.includes('does not exist')) {
      if (rpcErr.code === 'P0002' || rpcErr.message?.includes('not found')) {
        res.status(404).json({ success: false, message: rpcErr.message });
        return;
      }
      if (rpcErr.code === '42501' || rpcErr.message?.includes('not assigned') || rpcErr.message?.includes('not belong')) {
        res.status(403).json({ success: false, message: rpcErr.message });
        return;
      }
      if (rpcErr.code === '22023' || rpcErr.message?.includes('already') || rpcErr.message?.includes('required')) {
        res.status(400).json({ success: false, message: rpcErr.message });
        return;
      }
      res.status(500).json({ success: false, message: rpcErr.message || 'Database transaction error during discrepancy reporting' });
      return;
    }

    const disputedAt = new Date().toISOString();

    // 3b. Fallback for mock environments: Update POD (Preserve original distributor proof, record discrepancy)
    const { error: updatePodErr } = await supabase
      .from('proof_of_delivery')
      .update({
        status: 'DISPUTED',
        discrepancy_reason: reason.trim(),
        discrepancy_notes: notes?.trim() || null,
        acknowledged_by: retailer_id,
        acknowledged_at: disputedAt,
        updated_at: disputedAt
      })
      .eq('shipment_id', shipment_id);

    if (updatePodErr) {
      res.status(500).json({ success: false, message: 'Failed to update proof of delivery with discrepancy' });
      return;
    }

    // 4. Update Shipment status to DELIVERY_DISPUTED
    const { error: updateShipErr } = await supabase
      .from('shipments')
      .update({ status: 'DELIVERY_DISPUTED', updated_at: disputedAt })
      .eq('id', shipment_id);

    if (updateShipErr) {
      res.status(500).json({ success: false, message: 'Failed to update shipment status' });
      return;
    }

    // 5. Traceability Event
    await supabase.from('traceability_events').insert({
      product_id: shipment.product_id,
      batch_number: shipment.batch_number,
      event_type: 'DELIVERY_DISPUTED',
      actor_id: retailer_id,
      location: 'Retail Store',
      metadata: {
        shipment_id: shipment.id,
        reason: reason.trim(),
        notes: notes?.trim() || null,
        pod_id: proof.id,
        quantity_disputed: proof.quantity_delivered
      }
    });

    // 6. Event Outbox
    const { randomUUID } = require('crypto');
    await supabase.from('event_outbox').insert({
      event_id: randomUUID(),
      event_type: 'DELIVERY_DISPUTED',
      topic: 'shipment-events',
      payload: {
        shipment_id: shipment.id,
        batch_id: shipment.batch_number,
        retailer_id,
        distributor_id: shipment.sender_id,
        reason: reason.trim(),
        notes: notes?.trim() || null,
        pod_id: proof.id
      }
    });

    res.status(200).json({
      success: true,
      message: 'Delivery discrepancy reported successfully. Distributor notified.',
      data: {
        shipment_id: shipment.id,
        pod_id: proof.id,
        status: 'DISPUTED',
        discrepancy_reason: reason.trim()
      }
    });
  } catch (error) {
    console.error('Discrepancy error:', error);
    res.status(500).json({ success: false, message: 'Server Error during reporting discrepancy' });
  }
};

export const getRetailerInventory = async (req: Request, res: Response): Promise<void> => {
  try {
    const retailer_id = (req as any).user?.id;

    if (!retailer_id) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const { data: inventory, error } = await supabase
      .from('retailer_inventory')
      .select('*, product:product_id(name, category, product_image_url)')
      .eq('retailer_id', retailer_id)
      .order('expiry_date', { ascending: true })
      .limit(500);

    if (error) {
      res.status(500).json({ success: false, message: 'Database error' });
      return;
    }

    res.status(200).json({ success: true, data: inventory });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};


export const recordSale = async (req: Request, res: Response): Promise<void> => {
  try {
    const retailer_id = (req as any).user?.id;
    const { inventory_id, quantity_sold, price_per_unit } = req.body;

    if (!retailer_id) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    if (
      !inventory_id ||
      typeof quantity_sold !== 'number' ||
      !Number.isFinite(quantity_sold) ||
      quantity_sold <= 0 ||
      typeof price_per_unit !== 'number' ||
      !Number.isFinite(price_per_unit) ||
      price_per_unit < 0
    ) {
      res.status(400).json({
        success: false,
        message: 'Valid inventory ID, positive quantity, and nonnegative price are required'
      });
      return;
    }

    const { data, error } = await supabase.rpc('record_retailer_sale', {
      p_retailer_id: retailer_id,
      p_inventory_id: inventory_id,
      p_quantity_sold: quantity_sold,
      p_price_per_unit: price_per_unit
    });

    if (error) {
      console.error('Retailer sale transaction failed:', error.code, error.message);

      if (error.code === 'P0002') {
        res.status(404).json({ success: false, message: 'Inventory item not found' });
        return;
      }

      if (error.code === '42501') {
        res.status(403).json({
          success: false,
          message: 'You do not own this inventory item'
        });
        return;
      }

      if (error.code === '40001') {
        res.status(409).json({
          success: false,
          message: 'Inventory was modified or stock is insufficient. Please refresh and try again.'
        });
        return;
      }

      if (error.code === '22023') {
        res.status(400).json({
          success: false,
          message: error.message.includes('expired')
            ? 'Cannot sell expired items'
            : error.message.includes('Insufficient stock')
              ? 'Insufficient stock'
              : 'Invalid sale input'
        });
        return;
      }

      res.status(500).json({
        success: false,
        message: 'Failed to record sale'
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: 'Sale recorded successfully',
      data: {
        sale_id: data.sale_id,
    remaining_quantity: data.remaining_quantity,
    status: data.status
      }
    });
  } catch (error) {
    console.error('Unexpected recordSale error:', error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};
export const getSales = async (req: Request, res: Response): Promise<void> => {
  try {
    const retailer_id = (req as any).user?.id;

    if (!retailer_id) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const { data: sales, error } = await supabase
      .from('retailer_sales')
      .select('*, inventory:inventory_id(batch_number, unit, product:product_id(name))')
      .eq('retailer_id', retailer_id)
      .order('sale_date', { ascending: false })
      .limit(500);

    if (error) {
      res.status(500).json({ success: false, message: 'Database error' });
      return;
    }

    res.status(200).json({ success: true, data: sales });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};


export const reportWastage = async (req: Request, res: Response): Promise<void> => {
  try {
    const retailer_id = (req as any).user?.id;
    const { inventory_id, quantity, reason, notes } = req.body;

    if (!retailer_id) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    if (
      typeof inventory_id !== 'string' ||
      !inventory_id.trim() ||
      typeof quantity !== 'number' ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      typeof reason !== 'string' ||
      !reason.trim() ||
      (notes !== undefined && notes !== null && typeof notes !== 'string')
    ) {
      res.status(400).json({
        success: false,
        message: 'Valid inventory ID, positive quantity, and reason are required'
      });
      return;
    }

    const { data, error } = await supabase.rpc('record_retailer_wastage', {
      p_retailer_id: retailer_id,
      p_inventory_id: inventory_id,
      p_quantity: quantity,
      p_reason: reason.trim(),
      p_notes: typeof notes === 'string' ? notes.trim() || null : null
    });

    if (error) {
      console.error('Transactional wastage recording failed:', error);

      const code = (error as any).code;
      const message = error.message || '';

      if (code === 'P0002') {
        res.status(404).json({
          success: false,
          message: 'Inventory item not found'
        });
        return;
      }

      if (code === '42501') {
        res.status(403).json({
          success: false,
          message: 'You do not own this inventory item'
        });
        return;
      }

      if (code === '40001') {
        res.status(409).json({
          success: false,
          message: 'Insufficient stock or concurrent inventory change. Please refresh and try again.'
        });
        return;
      }

      if (code === '22023') {
        res.status(400).json({
          success: false,
          message: 'Valid inventory ID, positive quantity, and reason are required'
        });
        return;
      }

      res.status(500).json({
        success: false,
        message: 'Failed to record wastage'
      });
      return;
    }

    if (!data?.wastage_id) {
      console.error('Wastage RPC returned an unexpected response:', data);
      res.status(500).json({
        success: false,
        message: 'Unexpected response while recording wastage'
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: 'Wastage reported successfully',
      data: {
        wastage_id: data.wastage_id,
        remaining_quantity: data.remaining_quantity,
        status: data.status
      }
    });
  } catch (error) {
    console.error('Unexpected wastage reporting error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error'
    });
  }
};
export const getWastage = async (req: Request, res: Response): Promise<void> => {
  try {
    const retailer_id = (req as any).user?.id;

    if (!retailer_id) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const { data: wastage, error } = await supabase
      .from('retailer_wastage')
      .select('*, inventory:inventory_id(batch_number, unit, product:product_id(name))')
      .eq('retailer_id', retailer_id)
      .order('report_date', { ascending: false })
      .limit(500);

    if (error) {
      res.status(500).json({ success: false, message: 'Database error' });
      return;
    }

    res.status(200).json({ success: true, data: wastage });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const getBatchTraceability = async (req: Request, res: Response): Promise<void> => {
  try {
    const { batch_number } = req.params;

    if (!batch_number) {
      res.status(400).json({ success: false, message: 'Batch number is required' });
      return;
    }

    // 1. Fetch Product details
    const { data: product, error: productErr } = await supabase
      .from('products')
      .select('*, farmer:farmer_id(name, email)')
      .eq('batch_number', batch_number)
      .single();

    if (productErr || !product) {
      res.status(404).json({ success: false, message: 'Product not found for this batch' });
      return;
    }

    // 2. Fetch Traceability Events
    const { data: events, error: eventsErr } = await supabase
      .from('traceability_events')
      .select('*, actor:actor_id(name, role)')
      .eq('batch_number', batch_number)
      .order('created_at', { ascending: true })
      .limit(500);

    if (eventsErr) {
      res.status(500).json({ success: false, message: 'Database error fetching events'});
      return;
    }

    res.status(200).json({ 
      success: true, 
      data: {
        product,
        events
      }
    });

  } catch (error) {
    console.error('error occurred');
      res.status(500).json({ success: false, message: 'Server Error' });
  }
};


export const processReturn = async (req: Request, res: Response): Promise<void> => {
  try {
    const retailer_id = (req as any).user?.id;
    const { inventory_id, quantity, condition, reason } = req.body;

    if (!retailer_id) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    if (
      typeof inventory_id !== 'string' ||
      !inventory_id.trim() ||
      typeof quantity !== 'number' ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      typeof condition !== 'string' ||
      !['Good', 'Damaged', 'Expired'].includes(condition) ||
      (reason !== undefined && reason !== null && typeof reason !== 'string')
    ) {
      res.status(400).json({
        success: false,
        message: 'Valid inventory ID, positive quantity, and condition (Good, Damaged, or Expired) are required'
      });
      return;
    }

    const { data, error } = await supabase.rpc('record_retailer_return', {
      p_retailer_id: retailer_id,
      p_inventory_id: inventory_id,
      p_quantity: quantity,
      p_condition: condition,
      p_reason: typeof reason === 'string' ? reason.trim() || null : null
    });

    if (error) {
      console.error('Retailer return transaction failed:', error.code, error.message);

      if (error.code === 'P0002') {
        res.status(404).json({
          success: false,
          message: 'Inventory item not found'
        });
        return;
      }

      if (error.code === '42501') {
        res.status(403).json({
          success: false,
          message: 'You do not own this inventory item'
        });
        return;
      }

      if (error.code === '22023') {
        const exceedsEligible = error.message.includes('exceeds eligible sold quantity');

        res.status(400).json({
          success: false,
          message: exceedsEligible
            ? 'Return quantity exceeds eligible sold quantity'
            : 'Invalid return input'
        });
        return;
      }

      if (error.code === '40001') {
        res.status(409).json({
          success: false,
          message: 'Inventory was modified concurrently. Please try again.'
        });
        return;
      }

      res.status(500).json({
        success: false,
        message: 'Failed to process return'
      });
      return;
    }

    if (!data || !data.resolution) {
      console.error('Return RPC returned an unexpected response:', data);
      res.status(500).json({
        success: false,
        message: 'Unexpected response while processing return'
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: `Return processed successfully. Action: ${data.resolution}`,
      data
    });
  } catch (error) {
    console.error('Unexpected retailer return error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error'
    });
  }
};

export const getReturns = async (req: Request, res: Response): Promise<void> => {
  try {
    const retailer_id = (req as any).user?.id;

    if (!retailer_id) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const { data: returns, error } = await supabase
      .from('retailer_returns')
      .select('*, inventory:inventory_id(batch_number, unit, product:product_id(name))')
      .eq('retailer_id', retailer_id)
      .order('return_date', { ascending: false })
      .limit(500);

    if (error) {
      res.status(500).json({ success: false, message: 'Database error' });
      return;
    }

    res.status(200).json({ success: true, data: returns });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const getDashboardData = async (req: Request, res: Response): Promise<void> => {
  try {
    const retailer_id = (req as any).user?.id;

    if (!retailer_id) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    // 1. Fetch Inventory count and Low Stock
    const { data: inventory } = await supabase
      .from('retailer_inventory')
      .select('quantity, expiry_date, status')
      .eq('retailer_id', retailer_id);

    const activeInventory = inventory?.filter(i => i.status !== 'DEPLETED') || [];
    const totalItems = activeInventory.length;
    const lowStockItems = activeInventory.filter(i => i.quantity < 10).length;
    const expiredItems = activeInventory.filter(i => i.expiry_date && new Date(i.expiry_date) < new Date()).length;

    // 2. Fetch Recent Sales
    const { data: sales } = await supabase
      .from('retailer_sales')
      .select('quantity_sold, price_per_unit, sale_date')
      .eq('retailer_id', retailer_id)
      .order('sale_date', { ascending: false })
      .limit(500);

    // Calculate revenue
    const totalRevenue = sales?.reduce((sum, s) => sum + ((s.quantity_sold || 0) * (s.price_per_unit || 0)), 0) || 0;
    const recentSalesCount = sales?.length || 0;

    res.status(200).json({ 
      success: true, 
      data: {
        total_inventory_items: totalItems,
        low_stock_alerts: lowStockItems,
        expired_alerts: expiredItems,
        total_sales: recentSalesCount,
        total_revenue: totalRevenue
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};


import { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { blockchainService, BlockchainStatus } from '../services/blockchainService';
import crypto from 'crypto';

// GET /api/processor/requests
export const getProcessorRequests = async (req: Request, res: Response): Promise<void> => {
  try {
    const processor_id = (req as any).user?.id;

    if (!processor_id) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    // Return pending/open requests OR requests assigned to this processor
    const { data: requests, error } = await supabase
      .from('product_requests')
      .select('id, request_id, retailer_id, product_name, quantity, unit, required_date, priority, notes, status, processor_id, created_at, updated_at')
      .or(`processor_id.is.null,processor_id.eq.${processor_id}`)
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) {
      console.error('error occurred');
      res.status(500).json({ success: false, message: 'Database error' });
      return;
    }

    res.status(200).json({ success: true, data: requests });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// POST /api/processor/requests/:id/claim
export const claimProcessorRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const processor_id = (req as any).user?.id;
    const { id } = req.params;

    if (!processor_id) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    if (!id) {
      res.status(400).json({ success: false, message: 'Request ID is required' });
      return;
    }

    // Verify request exists and is claimable
    const { data: request, error: fetchErr } = await supabase
      .from('product_requests')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !request) {
      res.status(404).json({ success: false, message: 'Request not found' });
      return;
    }

    if (request.processor_id) {
      if (request.processor_id === processor_id) {
        res.status(200).json({ success: true, message: 'Already claimed by you', data: request });
        return;
      }
      res.status(409).json({ success: false, message: 'Request already claimed by another processor' });
      return;
    }

    // Atomic update strategy: only update if processor_id is still null
    const { data: updatedRequest, error: updateErr } = await supabase
      .from('product_requests')
      .update({ processor_id, status: 'ACCEPTED' })
      .eq('id', id)
      .is('processor_id', null)
      .select()
      .single();

    if (updateErr || !updatedRequest) {
      res.status(409).json({ success: false, message: 'Failed to claim request. It may have been claimed concurrently.' });
      return;
    }

    res.status(200).json({ success: true, message: 'Request claimed successfully', data: updatedRequest });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// GET /api/processor/batches
export const getProcessorBatches = async (req: Request, res: Response): Promise<void> => {
  try {
    const processor_id = (req as any).user?.id;

    if (!processor_id) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    // Return batches actually owned by the processor, with lineage and farmer information
    const { data: batches, error } = await supabase
      .from('products')
      .select('id, product_id, batch_number, quantity, category, name, status, current_owner_id, expiry_date, created_at, ai_quality_score, ai_quality_label, farmer:farmer_id(name, email), parent_lineage:batch_lineage!batch_lineage_child_product_id_fkey(parent_product_id, quantity_used, processing_action, parent:parent_product_id(id, name, batch_number, quantity, ai_quality_score, ai_quality_label, farmer:farmer_id(name, email)))')
      .eq('current_owner_id', processor_id)
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) {
      res.status(500).json({ success: false, message: 'Database error' });
      return;
    }

    res.status(200).json({ success: true, data: batches });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// GET /api/processor/shipments/incoming
export const getIncomingShipments = async (req: Request, res: Response): Promise<void> => {
  try {
    const processor_id = (req as any).user?.id;

    if (!processor_id) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const { data: shipments, error } = await supabase
      .from('shipments')
      .select('*, sender:sender_id(name, email), distributor:distributor_id(name, email), request:request_id(product_name, request_id), product:product_id(*, farmer:farmer_id(name, email))')
      .eq('receiver_id', processor_id)
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) {
      res.status(500).json({ success: false, message: 'Database error' });
      return;
    }

    res.status(200).json({ success: true, data: shipments });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// POST /api/processor/shipments/:id/receive
export const receiveShipment = async (req: Request, res: Response): Promise<void> => {
  try {
    const processor_id = (req as any).user?.id;
    const { id } = req.params;

    if (!processor_id) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const { data: shipment, error: fetchErr } = await supabase
      .from('shipments')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !shipment) {
      res.status(404).json({ success: false, message: 'Shipment not found' });
      return;
    }

    if (shipment.receiver_id !== processor_id) {
      res.status(403).json({ success: false, message: 'This shipment does not belong to you' });
      return;
    }

    if (shipment.status === 'RECEIVED') {
      res.status(400).json({ success: false, message: 'Shipment has already been received' });
      return;
    }

    const receivedQty = req.body.received_quantity ? Number(req.body.received_quantity) : shipment.quantity;
    if (receivedQty < 0) {
      res.status(400).json({ success: false, message: 'Invalid received quantity' });
      return;
    }

    // Update shipment status
    const { error: updateShipmentErr } = await supabase
      .from('shipments')
      .update({ status: 'RECEIVED' })
      .eq('id', id);

    if (updateShipmentErr) {
      res.status(500).json({ success: false, message: 'Failed to update shipment status'});
      return;
    }

    // Update product ownership
    const { error: updateProductErr } = await supabase
      .from('products')
      .update({ current_owner_id: processor_id })
      .eq('id', shipment.product_id);

    if (updateProductErr) {
      console.error("Failed to update product ownership", updateProductErr);
    }

    // Traceability event
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

    await supabase.from('traceability_events').insert({
      product_id: shipment.product_id,
      batch_number: shipment.batch_number,
      event_type: 'PROCESSOR_RECEIVED',
      actor_id: processor_id,
      location: 'Processing Facility',
      blockchain_hash: txHash,
      metadata: {
        shipment_id: id,
        expected_quantity: shipment.quantity,
        received_quantity: receivedQty,
        unit: shipment.unit
      }
    });

    res.status(200).json({ success: true, message: 'Shipment received successfully', data: { shipment_id: id } });
  } catch (error) {
    console.error('error occurred');
      res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// POST /api/processor/batches/:id/process
export const processBatch = async (req: Request, res: Response): Promise<void> => {
  try {
    const processor_id = (req as any).user?.id;
    const { id } = req.params;
    const { quantity_used, new_product_name, new_category } = req.body;

    if (!processor_id) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const qtyUsed = Number(quantity_used);
    if (!qtyUsed || qtyUsed <= 0) {
      res.status(400).json({ success: false, message: 'Quantity used must be greater than zero' });
      return;
    }

    const { data: parentProduct, error: fetchErr } = await supabase
      .from('products')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !parentProduct) {
      res.status(404).json({ success: false, message: 'Product not found' });
      return;
    }

    if (parentProduct.current_owner_id !== processor_id) {
      res.status(403).json({ success: false, message: 'You do not own this product' });
      return;
    }

    if (parentProduct.quantity < qtyUsed) {
      res.status(400).json({ success: false, message: `Cannot process more than available quantity (${parentProduct.quantity})` });
      return;
    }

    // 1. Update parent quantity
    const remainingQty = parentProduct.quantity - qtyUsed;
    const newStatus = remainingQty <= 0 ? 'DEPLETED' : parentProduct.status;
    const { error: updateParentErr } = await supabase
      .from('products')
      .update({ quantity: remainingQty, status: newStatus })
      .eq('id', id);

    if (updateParentErr) {
      res.status(500).json({ success: false, message: 'Failed to update parent product'});
      return;
    }

    // 2. Create child product
    const childBatchNumber = `PB-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
    const childProductId = crypto.randomInt(100000, 999999);

    const { data: childProduct, error: childErr } = await supabase
      .from('products')
      .insert({
        product_id: childProductId,
        name: new_product_name || `Processed ${parentProduct.name}`,
        category: new_category || 'Processed Food',
        batch_number: childBatchNumber,
        quantity: qtyUsed, // Initial child quantity
        farmer_id: parentProduct.farmer_id,
        current_owner_id: processor_id,
        status: 'PROCESSED',
        organic_status: parentProduct.organic_status
      })
      .select()
      .single();

    if (childErr) {
      console.error('error occurred');
      res.status(500).json({ success: false, message: 'Failed to create processed batch'});
      return;
    }

    // 3. Create batch_lineage
    await supabase.from('batch_lineage').insert({
      parent_product_id: parentProduct.id,
      child_product_id: childProduct.id,
      processing_action: 'Processing',
      quantity_used: qtyUsed
    });

    // Blockchain integration
    let childTxHash = null;
    try {
      await blockchainService.updateStage(parentProduct.id, newStatus, `Processed ${qtyUsed} units`);
      const bcChild = await blockchainService.registerProduct(childProduct.id, childProduct.name, childProduct.category, childProduct.batch_number, childProduct.quantity, childProduct.status);
      if (bcChild.status === BlockchainStatus.ON_CHAIN_CONFIRMED) {
        childTxHash = bcChild.txHash;
        // Best effort hash update on the new product
        await supabase.from('products').update({ blockchain_hash: childTxHash }).eq('id', childProduct.id);
      } else {
        console.warn("Blockchain registration failed. Continuing with DB only.");
      }
    } catch (err) {
      console.error("Blockchain transaction exception:", err);
    }

    // 4. Traceability event
    await supabase.from('traceability_events').insert({
      product_id: childProduct.id,
      batch_number: childProduct.batch_number,
      event_type: 'PROCESSED',
      actor_id: processor_id,
      location: 'Processing Facility',
      blockchain_hash: childTxHash,
      metadata: {
        parent_batch: parentProduct.batch_number,
        parent_id: parentProduct.id,
        quantity_processed: qtyUsed
      }
    });

    res.status(201).json({ success: true, message: 'Batch processed successfully', data: childProduct });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// POST /api/processor/intake
// Direct gate intake/receipt of a harvest batch when no pre-existing shipment exists
export const intakeProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const processor_id = (req as any).user?.id;
    const { product_id, received_quantity, ai_quality_score, ai_quality_label, remarks } = req.body;

    if (!processor_id) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    if (!product_id) {
      res.status(400).json({ success: false, message: 'product_id is required' });
      return;
    }

    const { data: product, error: fetchErr } = await supabase
      .from('products')
      .select('*, farmer:farmer_id(name, email)')
      .eq('id', product_id)
      .single();

    if (fetchErr || !product) {
      res.status(404).json({ success: false, message: 'Product not found' });
      return;
    }

    // Check if already owned by another party (other than farmer or this processor)
    if (product.current_owner_id && product.current_owner_id !== processor_id && product.current_owner_id !== product.farmer_id) {
      res.status(403).json({ success: false, message: 'Product is already owned by another party' });
      return;
    }

    if (product.status === 'DEPLETED') {
      res.status(400).json({ success: false, message: 'Product has already been depleted or processed' });
      return;
    }

    const verifiedQty = received_quantity !== undefined && Number(received_quantity) > 0
      ? Number(received_quantity)
      : Number(product.quantity);

    // Update product ownership, status, quantity, and quality score
    const updatePayload: any = {
      current_owner_id: processor_id,
      status: 'Processing',
      quantity: verifiedQty
    };

    if (ai_quality_score !== undefined && ai_quality_score !== null) {
      updatePayload.ai_quality_score = Number(ai_quality_score);
    }
    if (ai_quality_label) {
      updatePayload.ai_quality_label = String(ai_quality_label);
    }

    const { data: updatedProduct, error: updateErr } = await supabase
      .from('products')
      .update(updatePayload)
      .eq('id', product_id)
      .select('*, farmer:farmer_id(name, email)')
      .single();

    if (updateErr || !updatedProduct) {
      res.status(500).json({ success: false, message: 'Failed to record product intake in database' });
      return;
    }

    // Best-effort blockchain recordReceipt
    let txHash = null;
    try {
      const bcResult = await blockchainService.recordReceipt(product_id);
      if (bcResult && bcResult.status !== BlockchainStatus.ON_CHAIN_VERIFICATION_FAILED) {
        txHash = bcResult.txHash;
      }
    } catch (bcError) {
      console.warn("Blockchain transaction exception in intake:", bcError);
    }

    // Traceability event
    await supabase.from('traceability_events').insert({
      product_id: product_id,
      batch_number: product.batch_number,
      event_type: 'PROCESSOR_RECEIVED',
      actor_id: processor_id,
      location: 'Processing Facility',
      blockchain_hash: txHash,
      metadata: {
        intake_type: 'GATE_INTAKE',
        original_quantity: product.quantity,
        received_quantity: verifiedQty,
        ai_quality_score: updatePayload.ai_quality_score || product.ai_quality_score,
        ai_quality_label: updatePayload.ai_quality_label || product.ai_quality_label,
        remarks: remarks || 'Intake verified and accepted at facility'
      }
    });

    res.status(200).json({
      success: true,
      message: 'Product intake recorded successfully',
      data: updatedProduct
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// POST /api/processor/batches/:id/transfer
// Record dispatch and handover of a certified batch to a distribution partner
export const transferBatch = async (req: Request, res: Response): Promise<void> => {
  try {
    const processor_id = (req as any).user?.id;
    const { id } = req.params;
    const { distributor, destination_hub, remarks } = req.body;

    if (!processor_id) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const { data: product, error: fetchErr } = await supabase
      .from('products')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !product) {
      res.status(404).json({ success: false, message: 'Batch not found' });
      return;
    }

    if (product.current_owner_id !== processor_id) {
      res.status(403).json({ success: false, message: 'You do not own this batch' });
      return;
    }

    const { data: updatedBatch, error: updateErr } = await supabase
      .from('products')
      .update({ status: 'Transferred' })
      .eq('id', id)
      .select()
      .single();

    if (updateErr) {
      res.status(500).json({ success: false, message: 'Failed to update batch transfer status' });
      return;
    }

    // Traceability event
    await supabase.from('traceability_events').insert({
      product_id: id,
      batch_number: product.batch_number,
      event_type: 'DISPATCHED_TO_DISTRIBUTOR',
      actor_id: processor_id,
      location: 'Processing Facility Dispatch Bay',
      metadata: {
        distributor: distributor || 'XYZ Logistics Partner',
        destination_hub: destination_hub || 'Central Distribution Hub',
        remarks: remarks || 'Transferred to distribution pipeline'
      }
    });

    res.status(200).json({
      success: true,
      message: 'Batch successfully transferred to distributor',
      data: updatedBatch
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// GET /api/processor/events
// Return persistent audit trail events for the processor
export const getProcessorEvents = async (req: Request, res: Response): Promise<void> => {
  try {
    const processor_id = (req as any).user?.id;

    if (!processor_id) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const { data: events, error } = await supabase
      .from('traceability_events')
      .select('id, product_id, batch_number, event_type, actor_id, location, metadata, blockchain_hash, created_at, actor:actor_id(name, role)')
      .eq('actor_id', processor_id)
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) {
      res.status(500).json({ success: false, message: 'Database error' });
      return;
    }

    res.status(200).json({ success: true, data: events });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

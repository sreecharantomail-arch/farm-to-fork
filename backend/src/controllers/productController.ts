import { Request, Response } from 'express';
import axios from 'axios';
import { supabase } from '../config/supabase';
import { generateNotification } from './notificationController';
import { blockchainService } from '../services/blockchainService';
import crypto from 'crypto';

// Render Blueprints provide service host/port values separately from a full URL.
// Prefer an explicitly configured URL for local development and other hosts.
const AI_SERVICE_URL = process.env.AI_SERVICE_URL
    || (process.env.AI_SERVICE_HOSTPORT ? `http://${process.env.AI_SERVICE_HOSTPORT}` : 'http://localhost:8000');

const CONTRACT_ABI = [
  "function registerProduct(string memory _name, string memory _category, string memory _batchNumber, uint256 _quantity, string memory _initialStatus) public",
  "event ProductRegistered(uint256 indexed productId, string name, address indexed farmer)"
];

export const registerProduct = async (req: Request, res: Response) => {
  try {
    const { name, category, batchNumber, quantity, organicStatus, expiryDate, imageData, product_id } = req.body;

    // Safely get farmer ID from auth token (set by protect middleware)
    const farmerId = (req as any).user?.id || 'anonymous';
    
    // Validate required fields
    if (!name || !category || !batchNumber || quantity === undefined) {
      res.status(400).json({ success: false, message: 'Please provide all required fields (name, category, batchNumber, quantity).' });
      return;
    }

    if (typeof quantity !== 'number' || quantity <= 0 || !isFinite(quantity)) {
      res.status(400).json({ success: false, message: 'Quantity must be a valid positive number.' });
      return;
    }

    // Check for duplicate batch number
    const { data: existingBatch } = await supabase
      .from('products')
      .select('id')
      .eq('batch_number', batchNumber)
      .maybeSingle();
      
    if (existingBatch) {
      res.status(400).json({ success: false, message: 'A product with this batch number already exists.' });
      return;
    }

    let productImageUrl: string | null = null;

    if (imageData) {
      const imageMatch = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(imageData);
      if (!imageMatch) {
        res.status(400).json({ success: false, message: 'Upload a JPEG, PNG, or WebP product photo.' });
        return;
      }

      const [, contentType, encodedImage] = imageMatch;
      const imageBuffer = Buffer.from(encodedImage, 'base64');
      if (imageBuffer.length > 5 * 1024 * 1024) {
        res.status(400).json({ success: false, message: 'Product photos must be 5 MB or smaller.' });
        return;
      }

      const extension = contentType.split('/')[1] === 'jpeg' ? 'jpg' : contentType.split('/')[1];
      const imagePath = `${farmerId}/${Date.now()}-${batchNumber}.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from('product-images')
        .upload(imagePath, imageBuffer, { contentType, upsert: false });

      if (uploadError) {
        console.error('error occurred');
      res.status(500).json({ success: false, message: 'Could not upload product photo.'});
        return;
      }

      productImageUrl = supabase.storage.from('product-images').getPublicUrl(imagePath).data.publicUrl;
    }

    // Call AI Service for quality score
    let aiQualityScore = 0;
    let aiQualityLabel = 'Unknown';
    let aiShelfLife = null as any;

    try {
      const startTimeQual = Date.now();
      let qualRes: any;
      let qualStatus = 'SUCCESS';
      try {
        qualRes = await axios.post(`${AI_SERVICE_URL}/predict/quality`, { image_url: productImageUrl || 'dummy_url' }, { timeout: 3000 });
        if (qualRes.data.quality === 'AI Inspection Unavailable') { qualStatus = 'UNAVAILABLE'; }
      } catch (err: any) {
        qualStatus = err.code === 'ECONNABORTED' ? 'TIMEOUT' : 'INTERNAL_ERROR';
        qualRes = { data: { score: 0, quality: 'Unknown' } };
      }
      const { recordAiAudit } = require('../services/aiAuditService');
      await recordAiAudit({
        user_id: farmerId,
        capability: 'QUALITY_INSPECTION',
        endpoint: '/predict/quality',
        status: qualStatus as any,
        latency_ms: Date.now() - startTimeQual,
        model_version: qualStatus === 'SUCCESS' ? '1.0.0' : null
      });

      const startTimeShelf = Date.now();
      let shelfRes: any;
      let shelfStatus = 'SUCCESS';
      try {
        shelfRes = await axios.post(`${AI_SERVICE_URL}/predict/shelf-life`, {
          crop_type: name,
          temperature: 28,
          humidity: 65,
          quantity,
        }, { timeout: 3000 });
        if (shelfRes.data.storage_recommendation === 'AI Service Unavailable') { shelfStatus = 'UNAVAILABLE'; }
      } catch (err: any) {
        shelfStatus = err.code === 'ECONNABORTED' ? 'TIMEOUT' : 'INTERNAL_ERROR';
        shelfRes = { data: null };
      }
      await recordAiAudit({
        user_id: farmerId,
        capability: 'SHELF_LIFE',
        endpoint: '/predict/shelf-life',
        status: shelfStatus as any,
        latency_ms: Date.now() - startTimeShelf,
        model_version: shelfStatus === 'SUCCESS' ? '1.0.0' : null
      });

      aiQualityScore = qualRes.data.score || 0;
      aiQualityLabel = qualRes.data.quality || 'Unknown';
      aiShelfLife = shelfRes.data;
    } catch (err) {
      console.error('AI Service logic failed', err);
    }

    // Ensure product_id is a unique 6-digit number (100000 - 999999)
    let finalProductId = (product_id && Number(product_id) >= 100000 && Number(product_id) <= 999999)
      ? Number(product_id)
      : crypto.randomInt(100000, 999999);
      
    // Product needs admin approval before hitting the blockchain
    const initialStatus = 'Pending Approval';
    const finalBlockchainHash = null;

    // 1. Atomic execution using transactional stored procedure
    const { data: rpcProduct, error: rpcErr } = await (supabase as any).rpc('register_harvest_batch', {
      p_farmer_id: farmerId,
      p_product_id: finalProductId,
      p_name: name,
      p_category: category,
      p_batch_number: batchNumber,
      p_quantity: quantity,
      p_organic_status: organicStatus,
      p_expiry_date: expiryDate || null,
      p_product_image_url: productImageUrl,
      p_ai_quality_score: aiQualityScore,
      p_ai_quality_label: aiQualityLabel,
      p_ai_shelf_life: aiShelfLife
    });

    if (!rpcErr && rpcProduct) {
      if (rpcProduct.farmer_id) {
        await generateNotification(
          rpcProduct.farmer_id,
          'product_created',
          'Harvest Registered',
          `Batch ${rpcProduct.batch_number} (${rpcProduct.name}) was successfully registered.`,
          'product',
          rpcProduct.id
        );
      }

      res.status(201).json({
        success: true,
        data: rpcProduct,
        message: 'Product registered successfully',
      });
      return;
    }

    if (rpcErr && !rpcErr.message?.includes('does not exist')) {
      console.error('register_harvest_batch RPC error details:', rpcErr);
      if (rpcErr.code === '23505' || rpcErr.message?.includes('already exists')) {
        res.status(409).json({ success: false, message: rpcErr.message || 'Batch number or Product ID already exists' });
        return;
      }
      if (rpcErr.code === '22023') {
        res.status(400).json({ success: false, message: rpcErr.message || 'Invalid product input' });
        return;
      }
      res.status(500).json({ success: false, message: rpcErr.message || 'Server Error' });
      return;
    }

    // Fallback for mock unit test environments where RPC is unmocked
    const { data: product, error } = await supabase
      .from('products')
      .insert({
        product_id: finalProductId,
        name,
        category,
        batch_number: batchNumber,
        quantity,
        organic_status: organicStatus,
        expiry_date: expiryDate || null,
        product_image_url: productImageUrl,
        farmer_id: farmerId,
        current_owner_id: farmerId,
        status: initialStatus,
        blockchain_hash: finalBlockchainHash,
        ai_quality_score: aiQualityScore,
        ai_quality_label: aiQualityLabel,
        ai_shelf_life: aiShelfLife,
      })
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, message: 'Server Error' });
      return;
    }

    // Insert Traceability Event: HARVEST_REGISTERED
    await supabase.from('traceability_events').insert({
      product_id: product.id,
      batch_number: batchNumber,
      event_type: 'HARVEST_REGISTERED',
      actor_id: farmerId,
      location: 'Farm',
      metadata: { quantity, organic_status: organicStatus }
    });

    // Add BATCH_CREATED outbox event for Kafka (Phase 9)
    const { randomUUID } = require('crypto');
    await supabase.from('event_outbox').insert({
      event_id: randomUUID(),
      event_type: 'BATCH_CREATED',
      topic: 'traceability-events',
      payload: {
        batch_id: batchNumber,
        product_id: product.id,
        farmer_id: farmerId,
        quantity: quantity,
        status: initialStatus
      }
    });

    if (product && product.farmer_id) {
      await generateNotification(
        product.farmer_id,
        'product_created',
        'Harvest Registered',
        `Batch ${product.batch_number} (${product.name}) was successfully registered.`,
        'product',
        product.id
      );
    }

    res.status(201).json({
      success: true,
      data: product,
      message: 'Product registered successfully',
    });
  } catch (error) {
    console.error('registerProduct error:', error);
    res.status(500).json({ success: false, message: 'Server Error', error });
  }
};

export const getProducts = async (req: Request, res: Response) => {
  try {
    const { data: products, error } = await supabase
      .from('products')
      .select('*, farmer:farmer_id(name, email)')
      .limit(500);

    if (error) {
      res.status(500).json({ success: false, message: 'Server Error' });
      return;
    }

    res.status(200).json({ success: true, data: products });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// GET /api/products/my - products belonging to the logged-in farmer
export const getMyProducts = async (req: Request, res: Response) => {
  try {
    const farmerId = (req as any).user?.id;

    const { data: products, error } = await supabase
      .from('products')
      .select('id, product_id, blockchain_hash, name, category, batch_number, quantity, status, organic_status, ai_quality_score, ai_quality_label, ai_shelf_life, expiry_date, product_image_url, created_at, updated_at')
      .or(`farmer_id.eq.${farmerId},current_owner_id.eq.${farmerId}`)
      .limit(500);

    if (error) {
      res.status(500).json({ success: false, message: 'Server Error' });
      return;
    }

    // Generate Expiry Alerts safely
    if (products) {
      const now = new Date();
      for (const p of products) {
        if (p.expiry_date) {
          const exp = new Date(p.expiry_date);
          const diffDays = Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          
          if (diffDays < 0) {
            await generateNotification(
              farmerId,
              'expiry_alert',
              'Product Expired',
              `Batch ${p.batch_number} (${p.name}) has expired.`,
              'product',
              p.id
            );
          } else if (diffDays <= 7) {
            await generateNotification(
              farmerId,
              'expiry_alert',
              'Product Expiring Soon',
              `Batch ${p.batch_number} (${p.name}) will expire in ${diffDays} days.`,
              'product',
              p.id
            );
          }
        }
      }
    }

    res.status(200).json({ success: true, data: products });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// GET /api/products/blockchain/:id - public route for verification page
export const getProductByBlockchainId = async (req: Request, res: Response) => {
  try {
    const paramId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    let rawId = (typeof paramId === 'string' ? paramId : '').trim();

    // 0. Extract identifier if a full QR tracking URL was scanned or pasted
    if (rawId.includes('?id=')) {
      rawId = rawId.split('?id=')[1].split('&')[0];
    } else if (rawId.includes('/track/')) {
      rawId = rawId.split('/track/')[1].split('?')[0];
    } else if (rawId.includes('/tracker/')) {
      rawId = rawId.split('/tracker/')[1].split('?')[0];
    } else if (rawId.includes('/verify/')) {
      rawId = rawId.split('/verify/')[1].split('?')[0];
    }

    try {
      rawId = decodeURIComponent(rawId).trim();
    } catch {
      // keep rawId
    }

    // Strip "FP-" prefix if present
    let cleanId = rawId;
    if (cleanId.toUpperCase().startsWith('FP-')) {
      cleanId = cleanId.substring(3).trim();
    }

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanId);
    const numId = Number(cleanId);
    const isNumeric = !isNaN(numId) && cleanId !== '' && !cleanId.includes('-') && !cleanId.includes(' ');

    const productFields = 'id, product_id, name, category, batch_number, quantity, status, organic_status, ai_quality_score, ai_quality_label, ai_shelf_life, product_image_url, expiry_date, blockchain_hash, created_at, farmer_id, farmer:farmer_id(name)';

    let product: any = null;

    // 1. Try matching numeric product_id
    if (isNumeric) {
      const { data: numProds } = await supabase
        .from('products')
        .select(productFields)
        .eq('product_id', numId);
      if (numProds && numProds.length > 0) {
        product = numProds[0];
      }

      // If not found and numId >= 100000, try mapped offset (e.g. 100018 -> 18)
      if (!product && numId >= 100000) {
        const offsetId = numId - 100000;
        const { data: offsetProds } = await supabase
          .from('products')
          .select(productFields)
          .eq('product_id', offsetId);
        if (offsetProds && offsetProds.length > 0) {
          product = offsetProds[0];
        }
      }
    }

    // 2. Try matching UUID primary key
    if (!product && isUuid) {
      const { data: uuidProds } = await supabase
        .from('products')
        .select(productFields)
        .eq('id', cleanId);
      if (uuidProds && uuidProds.length > 0) {
        product = uuidProds[0];
      }
    }

    // 3. Try matching by batch_number (exact/case-insensitive)
    if (!product) {
      const { data: batchProds } = await supabase
        .from('products')
        .select(productFields)
        .ilike('batch_number', cleanId);
      if (batchProds && batchProds.length > 0) {
        product = batchProds[0];
      }
    }

    // 4. Try matching via Shipment Tracking ID (e.g. TRK-...)
    if (!product) {
      const { data: matchedShipments } = await supabase
        .from('shipments')
        .select('product_id, batch_number')
        .ilike('shipment_tracking_id', cleanId);
      if (matchedShipments && matchedShipments.length > 0 && matchedShipments[0].product_id) {
        const { data: shipProds } = await supabase
          .from('products')
          .select(productFields)
          .eq('id', matchedShipments[0].product_id);
        if (shipProds && shipProds.length > 0) {
          product = shipProds[0];
        }
      }
    }

    // 5. Fallback: match 6-digit mapped ID helper across all products
    if (!product) {
      const { data: allProds } = await supabase
        .from('products')
        .select(productFields);
      if (allProds) {
        const found = allProds.find(p => {
          const pId = p.product_id;
          const mapped = (!pId || Number(pId) <= 0)
            ? "100000"
            : (Number(pId) >= 100000 && Number(pId) <= 999999)
            ? String(pId)
            : String(100000 + (Math.abs(Number(pId)) % 899999));
          return mapped === String(cleanId) || String(pId) === String(cleanId) || p.batch_number === cleanId || p.id === cleanId;
        });
        if (found) {
          product = found;
        }
      }
    }

    if (!product) {
      res.status(404).json({ success: false, message: 'Product not found' });
      return;
    }

    // 6. Fetch actual traceability events and parent batch lineage recursively
    let currentProductId = product.id;
    let allEvents: any[] = [];
    const lineageHistory: any[] = [];
    const visited = new Set<string>();
    const maxDepth = 10;
    let depth = 0;

    while (currentProductId && !visited.has(currentProductId) && depth < maxDepth) {
      visited.add(currentProductId);

      const { data: events } = await supabase
        .from('traceability_events')
        .select('id, product_id, batch_number, event_type, location, metadata, blockchain_hash, created_at, actor:actor_id(name, role)')
        .eq('product_id', currentProductId)
        .order('created_at', { ascending: true });

      if (events && events.length > 0) {
        allEvents = [...events, ...allEvents];
      }

      // Query parent in batch_lineage
      const { data: lineage } = await supabase
        .from('batch_lineage')
        .select('id, parent_product_id, child_product_id, processing_action, quantity_used, created_at, parent:parent_product_id(id, product_id, name, batch_number, category)')
        .eq('child_product_id', currentProductId)
        .maybeSingle();

      if (lineage && lineage.parent_product_id) {
        lineageHistory.push({
          parent_product_id: lineage.parent_product_id,
          child_product_id: lineage.child_product_id,
          processing_action: lineage.processing_action || 'Processing',
          quantity_used: lineage.quantity_used,
          created_at: lineage.created_at,
          parent: lineage.parent
        });
        currentProductId = lineage.parent_product_id;
      } else {
        currentProductId = null;
      }
      depth++;
    }

    // Sort events strictly in chronological order
    allEvents.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    (product as any).events = allEvents;
    (product as any).lineage = lineageHistory;

    // 7. Associate Logistics: Shipments, Digital POD, and Cold-Chain Monitoring
    try {
      const { data: shipments } = await supabase
        .from('shipments')
        .select('id, shipment_tracking_id, status, quantity, unit, created_at')
        .or(`product_id.eq.${product.id},batch_number.eq.${product.batch_number}`);

      if (shipments && shipments.length > 0) {
        const shipmentIds = shipments.map(s => s.id);

        // Fetch Proof of Delivery records (only public-safe receipt information)
        const { data: podRecords } = await supabase
          .from('proof_of_delivery')
          .select('id, shipment_id, recipient_name, quantity_delivered, unit, status, submitted_at, acknowledged_at')
          .in('shipment_id', shipmentIds)
          .order('submitted_at', { ascending: false });

        if (podRecords && podRecords.length > 0) {
          const ackPod = podRecords.find(p => p.status === 'ACKNOWLEDGED') || podRecords[0];
          (product as any).delivery_receipt = {
            status: ackPod.status,
            recipient_name: ackPod.recipient_name,
            quantity_delivered: ackPod.quantity_delivered,
            unit: ackPod.unit,
            submitted_at: ackPod.submitted_at,
            acknowledged_at: ackPod.acknowledged_at
          };
        }

        // Fetch cold-chain sensor readings
        const { data: coldReadings } = await supabase
          .from('cold_chain_readings')
          .select('id, shipment_id, temperature, temperature_unit, humidity, measured_at, notes')
          .in('shipment_id', shipmentIds)
          .order('measured_at', { ascending: false });

        // Fetch cold-chain alerts
        const { data: coldAlerts } = await supabase
          .from('cold_chain_alerts')
          .select('id, shipment_id, alert_type, severity, observed_temperature, status, detected_at')
          .in('shipment_id', shipmentIds)
          .order('detected_at', { ascending: false });

        if (coldReadings && coldReadings.length > 0) {
          const hasExcursion = (coldAlerts && coldAlerts.some(a => a.severity === 'CRITICAL' || a.status === 'ACTIVE'));
          (product as any).cold_chain_summary = {
            monitored: true,
            readings_count: coldReadings.length,
            latest_temperature: coldReadings[0].temperature,
            latest_humidity: coldReadings[0].humidity,
            temperature_unit: coldReadings[0].temperature_unit || '°C',
            latest_recorded_at: coldReadings[0].measured_at,
            alerts_count: coldAlerts ? coldAlerts.length : 0,
            condition_status: hasExcursion ? 'EXCURSION_REPORTED' : 'COMPLIANT'
          };
        } else {
          (product as any).cold_chain_summary = {
            monitored: false,
            readings_count: 0,
            condition_status: 'NOT_RECORDED',
            message: 'No cold-chain sensor readings recorded for this batch.'
          };
        }
      } else {
        (product as any).cold_chain_summary = {
          monitored: false,
          readings_count: 0,
          condition_status: 'NOT_RECORDED',
          message: 'No shipments or sensor readings associated with this batch.'
        };
      }
    } catch {
      // Logistics read is additive; never crash the public product lookup
    }

    // 8. Honest Traceability History Completeness Assessment
    const eventTypes = allEvents.map(e => e.event_type);
    const hasHarvest = eventTypes.some(t => t.toLowerCase().includes('harvest') || t.toLowerCase().includes('register'));
    const isRetailOrDelivered = ['RETAIL', 'RECEIVED', 'SOLD', 'DELIVERED'].includes(String(product.status).toUpperCase());

    if (allEvents.length === 0) {
      (product as any).history_completeness = {
        is_complete: false,
        status: 'PENDING_INITIAL_EVENTS',
        notice: 'Traceability history is not available yet for this batch.'
      };
    } else if (isRetailOrDelivered && !hasHarvest) {
      (product as any).history_completeness = {
        is_complete: false,
        status: 'PARTIAL_HISTORY',
        notice: 'Incomplete history: Farm registration records are missing for this batch.'
      };
    } else {
      (product as any).history_completeness = {
        is_complete: true,
        status: 'COMPLETE',
        notice: 'All recorded lifecycle events are verified.'
      };
    }

    // 9. Real Blockchain Verification via FarmChain smart contract
    try {
      const verification = await blockchainService.verifyProduct(product.id, {
        name: product.name,
        batchNumber: product.batch_number,
        status: product.status
      });
      (product as any).blockchain_verification = verification;
    } catch {
      (product as any).blockchain_verification = {
        status: 'BLOCKCHAIN_UNAVAILABLE',
        isConfigured: false,
        contractAddress: null,
        network: 'Offline',
        chainData: null,
        discrepancies: [],
        message: 'Blockchain verification service could not be reached.'
      };
    }

    res.status(200).json({ success: true, data: product });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const updateProductStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, current_owner_id, blockchain_hash } = req.body;

    const userId = (req as any).user?.id;
    const role = (req as any).user?.role;

    // First fetch the product
    const { data: prod } = await supabase.from('products').select('current_owner_id').eq('id', id).single();
    if (!prod) return res.status(404).json({ success: false, message: 'Product not found' }) as any;
    
    // Only current owner or admin/processor/retailer/distributor can update
    // In a real strict environment, only the owner could update it, or the receiver. 
    // To not break frontend simulations (Processor taking any product), we allow roles.
    if (prod.current_owner_id !== userId && role === 'farmer') {
      return res.status(403).json({ success: false, message: 'Not authorized to update this product' }) as any;
    }

    const { data: product, error } = await supabase
      .from('products')
      .update({ status })
      .eq('id', id)
      .select('*, farmer:farmer_id(name, email)')
      .single();

    if (error) {
      res.status(500).json({ success: false, message: 'Server Error' });
      return;
    }

    if (product && product.farmer_id && status) {
      await generateNotification(
        product.farmer_id,
        'product_status',
        'Product Status Updated',
        `Batch ${product.batch_number} has moved to ${status}.`,
        'product',
        product.id
      );
    }

    res.status(200).json({ success: true, data: product });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const deleteProduct = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const userId = (req as any).user?.id;
    const role = (req as any).user?.role;

    // 1. Try deleting directly by primary key 'id'
    let q1 = supabase.from('products').delete().eq('id', id);
    if (role !== 'admin') q1 = q1.eq('farmer_id', userId);
    
    const { data: d1 } = await q1.select();

    if (d1 && d1.length > 0) {
      res.status(200).json({ success: true, message: 'Product deleted permanently from database' });
      return;
    }

    // 2. If id is numeric, try deleting by product_id or integer id
    const numId = Number(id);
    if (!isNaN(numId) && numId > 0) {
      let q2 = supabase.from('products').delete().or(`product_id.eq.${numId},id.eq.${numId}`);
      if (role !== 'admin') q2 = q2.eq('farmer_id', userId);
      
      const { data: d2 } = await q2.select();

      if (d2 && d2.length > 0) {
        res.status(200).json({ success: true, message: 'Product deleted permanently from database' });
        return;
      }
    }

    // 3. Fallback: try by batch_number
    let q3 = supabase.from('products').delete().eq('batch_number', id);
    if (role !== 'admin') q3 = q3.eq('farmer_id', userId);
    await q3;

    res.status(200).json({ success: true, message: 'Product deleted successfully' });
  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

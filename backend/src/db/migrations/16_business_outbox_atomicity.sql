-- FarmChainAI — Business Transaction and Outbox Atomicity
-- Migration 16: Transactional functions ensuring business mutations and outbox events commit together atomically

-- 1. Stored Procedure for Atomic Farmer Batch Registration
CREATE OR REPLACE FUNCTION public.register_harvest_batch(
  p_farmer_id uuid,
  p_product_id int,
  p_name text,
  p_category text,
  p_batch_number text,
  p_quantity numeric,
  p_organic_status text,
  p_expiry_date date DEFAULT NULL,
  p_product_image_url text DEFAULT NULL,
  p_ai_quality_score numeric DEFAULT NULL,
  p_ai_quality_label text DEFAULT NULL,
  p_ai_shelf_life jsonb DEFAULT NULL,
  p_event_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_product public.products%ROWTYPE;
  v_event_id text;
BEGIN
  -- 1. Validate inputs
  IF p_farmer_id IS NULL OR p_product_id IS NULL OR p_name IS NULL OR trim(p_name) = '' OR p_batch_number IS NULL OR trim(p_batch_number) = '' THEN
    RAISE EXCEPTION 'Farmer ID, product ID, name, and batch number are required'
      USING ERRCODE = '22023';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero'
      USING ERRCODE = '22023';
  END IF;

  -- 2. Check for duplicate batch_number or product_id
  IF EXISTS (SELECT 1 FROM public.products WHERE batch_number = p_batch_number) THEN
    RAISE EXCEPTION 'Batch number already exists: %', p_batch_number
      USING ERRCODE = '23505';
  END IF;

  IF EXISTS (SELECT 1 FROM public.products WHERE product_id = p_product_id) THEN
    RAISE EXCEPTION 'Product ID already exists: %', p_product_id
      USING ERRCODE = '23505';
  END IF;

  -- 3. Insert Product
  INSERT INTO public.products (
    product_id,
    name,
    category,
    batch_number,
    quantity,
    organic_status,
    expiry_date,
    product_image_url,
    farmer_id,
    current_owner_id,
    status,
    blockchain_hash,
    ai_quality_score,
    ai_quality_label,
    ai_shelf_life
  )
  VALUES (
    p_product_id,
    trim(p_name),
    p_category,
    trim(p_batch_number),
    p_quantity,
    CASE
      WHEN p_organic_status IS NULL THEN false
      WHEN p_organic_status ILIKE '%organic%' OR p_organic_status ILIKE '%true%' OR p_organic_status = '1' THEN true
      ELSE false
    END,
    p_expiry_date,
    p_product_image_url,
    p_farmer_id,
    p_farmer_id,
    'Pending Approval',
    NULL,
    p_ai_quality_score,
    p_ai_quality_label,
    p_ai_shelf_life
  )
  RETURNING * INTO v_product;

  -- 4. Insert Traceability Event (HARVEST_REGISTERED)
  INSERT INTO public.traceability_events (
    product_id,
    batch_number,
    event_type,
    actor_id,
    location,
    metadata
  )
  VALUES (
    v_product.id,
    v_product.batch_number,
    'HARVEST_REGISTERED',
    p_farmer_id,
    'Farm',
    jsonb_build_object(
      'quantity', p_quantity,
      'organic_status', p_organic_status
    )
  );

  -- 5. Insert Kafka Outbox Event (BATCH_CREATED)
  v_event_id := COALESCE(p_event_id, gen_random_uuid()::text);
  INSERT INTO public.event_outbox (
    event_id,
    event_type,
    topic,
    payload
  )
  VALUES (
    v_event_id,
    'BATCH_CREATED',
    'traceability-events',
    jsonb_build_object(
      'batch_id', v_product.batch_number,
      'product_id', v_product.id,
      'farmer_id', p_farmer_id,
      'quantity', p_quantity,
      'status', 'Pending Approval'
    )
  );

  RETURN to_jsonb(v_product);
END;
$$;

-- 2. Stored Procedure for Atomic Distributor Proof of Delivery Submission
CREATE OR REPLACE FUNCTION public.submit_proof_of_delivery(
  p_shipment_id uuid,
  p_distributor_id uuid,
  p_recipient_name text,
  p_quantity_delivered numeric,
  p_unit text DEFAULT 'units',
  p_delivery_notes text DEFAULT NULL,
  p_photo_url text DEFAULT NULL,
  p_event_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_shipment public.shipments%ROWTYPE;
  v_pod public.proof_of_delivery%ROWTYPE;
  v_event_id text;
  v_unit text;
BEGIN
  -- 1. Validate inputs
  IF p_shipment_id IS NULL OR p_distributor_id IS NULL OR p_recipient_name IS NULL OR trim(p_recipient_name) = '' THEN
    RAISE EXCEPTION 'Shipment ID, distributor ID, and recipient name are required'
      USING ERRCODE = '22023';
  END IF;

  IF p_quantity_delivered IS NULL OR p_quantity_delivered <= 0 THEN
    RAISE EXCEPTION 'Delivered quantity must be greater than zero'
      USING ERRCODE = '22023';
  END IF;

  -- 2. Lock and fetch Shipment
  SELECT *
  INTO v_shipment
  FROM public.shipments
  WHERE id = p_shipment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shipment not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_shipment.sender_id <> p_distributor_id THEN
    RAISE EXCEPTION 'Shipment is not assigned to or dispatched by you'
      USING ERRCODE = '42501';
  END IF;

  IF p_quantity_delivered > v_shipment.quantity THEN
    RAISE EXCEPTION 'Delivered quantity cannot exceed shipment quantity'
      USING ERRCODE = '22023';
  END IF;

  IF v_shipment.status = 'DELIVERED' OR v_shipment.status = 'RECEIVED' THEN
    RAISE EXCEPTION 'Proof of delivery has already been submitted for this shipment'
      USING ERRCODE = '23505';
  END IF;

  -- 3. Check for existing POD record
  IF EXISTS (SELECT 1 FROM public.proof_of_delivery WHERE shipment_id = p_shipment_id) THEN
    RAISE EXCEPTION 'Proof of delivery has already been submitted for this shipment'
      USING ERRCODE = '23505';
  END IF;

  v_unit := COALESCE(p_unit, v_shipment.unit, 'units');

  -- 4. Insert Proof of Delivery
  INSERT INTO public.proof_of_delivery (
    shipment_id,
    distributor_id,
    retailer_id,
    recipient_name,
    quantity_delivered,
    unit,
    delivery_notes,
    photo_url,
    status
  )
  VALUES (
    p_shipment_id,
    p_distributor_id,
    v_shipment.receiver_id,
    trim(p_recipient_name),
    p_quantity_delivered,
    v_unit,
    trim(p_delivery_notes),
    trim(p_photo_url),
    'SUBMITTED'
  )
  RETURNING * INTO v_pod;

  -- 5. Update Shipment status to DELIVERED
  UPDATE public.shipments
  SET status = 'DELIVERED',
      updated_at = now()
  WHERE id = p_shipment_id
  RETURNING * INTO v_shipment;

  -- 6. Insert Traceability Event (DISTRIBUTOR_DELIVERED)
  INSERT INTO public.traceability_events (
    product_id,
    batch_number,
    event_type,
    actor_id,
    location,
    metadata
  )
  VALUES (
    v_shipment.product_id,
    v_shipment.batch_number,
    'DISTRIBUTOR_DELIVERED',
    p_distributor_id,
    'Retailer Destination',
    jsonb_build_object(
      'shipment_id', v_shipment.id,
      'quantity_delivered', p_quantity_delivered,
      'unit', v_unit,
      'recipient_name', v_pod.recipient_name,
      'pod_id', v_pod.id
    )
  );

  -- 7. Insert Kafka Outbox Event (DELIVERY_PROOF_SUBMITTED)
  v_event_id := COALESCE(p_event_id, gen_random_uuid()::text);
  INSERT INTO public.event_outbox (
    event_id,
    event_type,
    topic,
    payload
  )
  VALUES (
    v_event_id,
    'DELIVERY_PROOF_SUBMITTED',
    'shipment-events',
    jsonb_build_object(
      'pod_id', v_pod.id,
      'shipment_id', v_shipment.id,
      'batch_id', v_shipment.batch_number,
      'distributor_id', p_distributor_id,
      'retailer_id', v_shipment.receiver_id,
      'quantity_delivered', p_quantity_delivered,
      'unit', v_unit,
      'recipient_name', v_pod.recipient_name
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'proof', to_jsonb(v_pod),
    'shipment', to_jsonb(v_shipment)
  );
END;
$$;

-- 3. Update acknowledge_delivery_receipt to atomically record BLOCKCHAIN_RECORDED when txHash is provided
CREATE OR REPLACE FUNCTION public.acknowledge_delivery_receipt(
  p_shipment_id uuid,
  p_retailer_id uuid,
  p_qr_data text,
  p_tx_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_shipment public.shipments%ROWTYPE;
  v_pod public.proof_of_delivery%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_inventory_id uuid;
  v_existing_inv_count int;
BEGIN
  -- 1. Input validation
  IF p_shipment_id IS NULL OR p_retailer_id IS NULL OR p_qr_data IS NULL THEN
    RAISE EXCEPTION 'Shipment ID, retailer ID, and QR code are required'
      USING ERRCODE = '22023';
  END IF;

  -- 2. Lock and fetch shipment
  SELECT *
  INTO v_shipment
  FROM public.shipments
  WHERE id = p_shipment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shipment not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_shipment.receiver_id <> p_retailer_id THEN
    RAISE EXCEPTION 'Shipment is not assigned to your store'
      USING ERRCODE = '42501';
  END IF;

  IF v_shipment.status = 'RECEIVED' THEN
    RAISE EXCEPTION 'Shipment has already been received'
      USING ERRCODE = '22023';
  END IF;

  IF v_shipment.status <> 'DELIVERED' THEN
    RAISE EXCEPTION 'Shipment must be in DELIVERED status to acknowledge'
      USING ERRCODE = '22023';
  END IF;

  -- 3. QR verification
  IF v_shipment.batch_number <> p_qr_data THEN
    RAISE EXCEPTION 'QR code mismatch: expected %, got %', v_shipment.batch_number, p_qr_data
      USING ERRCODE = '22023';
  END IF;

  -- 4. Lock and fetch Proof of Delivery
  SELECT *
  INTO v_pod
  FROM public.proof_of_delivery
  WHERE shipment_id = p_shipment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proof of delivery record not found for this shipment'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_pod.status <> 'SUBMITTED' THEN
    RAISE EXCEPTION 'Proof of delivery is already %', v_pod.status
      USING ERRCODE = '22023';
  END IF;

  -- 5. Guard against double inventory intake
  SELECT COUNT(*)
  INTO v_existing_inv_count
  FROM public.retailer_inventory
  WHERE retailer_id = p_retailer_id
    AND batch_number = v_shipment.batch_number
    AND product_id = v_shipment.product_id;

  IF v_existing_inv_count > 0 THEN
    RAISE EXCEPTION 'Inventory record already exists for this batch'
      USING ERRCODE = '23505';
  END IF;

  -- 6. Fetch Product Details
  SELECT *
  INTO v_product
  FROM public.products
  WHERE id = v_shipment.product_id;

  -- 7. Update Proof of Delivery Status
  UPDATE public.proof_of_delivery
  SET status = 'ACKNOWLEDGED',
      acknowledged_at = now(),
      acknowledged_by = p_retailer_id,
      updated_at = now()
  WHERE shipment_id = p_shipment_id;

  -- 8. Update Shipment Status
  UPDATE public.shipments
  SET status = 'RECEIVED',
      updated_at = now()
  WHERE id = p_shipment_id;

  -- 9. Update Product Ownership
  UPDATE public.products
  SET current_owner_id = p_retailer_id,
      updated_at = now()
  WHERE id = v_shipment.product_id;

  -- 10. Insert Retailer Inventory Record
  INSERT INTO public.retailer_inventory (
    retailer_id,
    product_id,
    batch_number,
    quantity,
    unit,
    expiry_date,
    status
  )
  VALUES (
    p_retailer_id,
    v_shipment.product_id,
    v_shipment.batch_number,
    v_pod.quantity_delivered,
    v_pod.unit,
    v_product.expiry_date,
    'AVAILABLE'
  )
  RETURNING id INTO v_inventory_id;

  -- 11. Traceability Event
  INSERT INTO public.traceability_events (
    product_id,
    batch_number,
    event_type,
    actor_id,
    location,
    blockchain_hash,
    metadata
  )
  VALUES (
    v_shipment.product_id,
    v_shipment.batch_number,
    'RETAILER_RECEIVED',
    p_retailer_id,
    'Retail Store',
    p_tx_hash,
    jsonb_build_object(
      'shipment_id', v_shipment.id,
      'quantity_received', v_pod.quantity_delivered,
      'unit', v_pod.unit,
      'pod_id', v_pod.id,
      'acknowledged_at', now()
    )
  );

  -- 12. Kafka Outbox Events
  INSERT INTO public.event_outbox (
    event_id,
    event_type,
    topic,
    payload
  )
  VALUES
  (
    gen_random_uuid()::text,
    'SHIPMENT_RECEIVED',
    'shipment-events',
    jsonb_build_object(
      'shipment_id', v_shipment.id,
      'batch_id', v_shipment.batch_number,
      'retailer_id', p_retailer_id,
      'quantity', v_pod.quantity_delivered,
      'unit', v_pod.unit,
      'pod_id', v_pod.id
    )
  ),
  (
    gen_random_uuid()::text,
    'RETAILER_RECEIVED',
    'traceability-events',
    jsonb_build_object(
      'batch_id', v_shipment.batch_number,
      'shipment_id', v_shipment.id,
      'retailer_id', p_retailer_id,
      'quantity', v_pod.quantity_delivered
    )
  ),
  (
    gen_random_uuid()::text,
    'INVENTORY_CREATED',
    'inventory-events',
    jsonb_build_object(
      'inventory_id', v_inventory_id,
      'batch_id', v_shipment.batch_number,
      'retailer_id', p_retailer_id,
      'product_id', v_shipment.product_id,
      'quantity', v_pod.quantity_delivered,
      'unit', v_pod.unit
    )
  );

  -- 13. If blockchain tx_hash is present, atomically insert BLOCKCHAIN_RECORDED in same transaction
  IF p_tx_hash IS NOT NULL AND length(trim(p_tx_hash)) > 0 THEN
    INSERT INTO public.event_outbox (
      event_id,
      event_type,
      topic,
      payload
    )
    VALUES (
      gen_random_uuid()::text,
      'BLOCKCHAIN_RECORDED',
      'traceability-events',
      jsonb_build_object(
        'batch_id', v_shipment.batch_number,
        'tx_hash', p_tx_hash,
        'event_source', 'RETAILER_ACKNOWLEDGED'
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'shipment_id', v_shipment.id,
    'inventory_id', v_inventory_id,
    'quantity', v_pod.quantity_delivered,
    'status', 'ACKNOWLEDGED'
  );
END;
$$;

-- Explicit Grants for Supabase Backend Services (Restricted to service_role and postgres)
REVOKE ALL ON FUNCTION public.register_harvest_batch FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_harvest_batch TO service_role, postgres;

REVOKE ALL ON FUNCTION public.submit_proof_of_delivery FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_proof_of_delivery TO service_role, postgres;

REVOKE ALL ON FUNCTION public.acknowledge_delivery_receipt FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acknowledge_delivery_receipt TO service_role, postgres;

NOTIFY pgrst, 'reload schema';

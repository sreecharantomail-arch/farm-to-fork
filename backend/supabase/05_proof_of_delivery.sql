-- Supabase Migration: 05_proof_of_delivery.sql
-- Digital Proof of Delivery (POD) with Two-Party Confirmation

-- 1. Create proof_of_delivery table
CREATE TABLE IF NOT EXISTS public.proof_of_delivery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  distributor_id uuid NOT NULL REFERENCES public.users(id),
  retailer_id uuid NOT NULL REFERENCES public.users(id),
  recipient_name text NOT NULL,
  quantity_delivered numeric NOT NULL CHECK (quantity_delivered > 0),
  unit text NOT NULL DEFAULT 'units',
  delivery_notes text,
  photo_url text,
  status text NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED', 'ACKNOWLEDGED', 'DISPUTED')),
  discrepancy_reason text,
  discrepancy_notes text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_proof_of_delivery_shipment UNIQUE (shipment_id)
);

-- 2. Indexes for efficient lookup
CREATE INDEX IF NOT EXISTS idx_pod_shipment ON public.proof_of_delivery (shipment_id);
CREATE INDEX IF NOT EXISTS idx_pod_distributor ON public.proof_of_delivery (distributor_id);
CREATE INDEX IF NOT EXISTS idx_pod_retailer ON public.proof_of_delivery (retailer_id);
CREATE INDEX IF NOT EXISTS idx_pod_status ON public.proof_of_delivery (status);

-- 3. Trigger for updated_at
DROP TRIGGER IF EXISTS trg_proof_of_delivery_updated_at ON public.proof_of_delivery;
CREATE TRIGGER trg_proof_of_delivery_updated_at
  BEFORE UPDATE ON public.proof_of_delivery
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. Enable Row Level Security
ALTER TABLE public.proof_of_delivery ENABLE ROW LEVEL SECURITY;

-- 5. Stored Procedure for Atomic Retailer Acknowledgement and Inventory Intake
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

  RETURN jsonb_build_object(
    'success', true,
    'shipment_id', v_shipment.id,
    'inventory_id', v_inventory_id,
    'quantity', v_pod.quantity_delivered,
    'status', 'ACKNOWLEDGED'
  );
END;
$$;

-- 6. Stored Procedure for Reporting Delivery Discrepancy
CREATE OR REPLACE FUNCTION public.report_delivery_discrepancy(
  p_shipment_id uuid,
  p_retailer_id uuid,
  p_reason text,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_shipment public.shipments%ROWTYPE;
  v_pod public.proof_of_delivery%ROWTYPE;
BEGIN
  IF p_shipment_id IS NULL OR p_retailer_id IS NULL OR p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'Shipment ID, retailer ID, and discrepancy reason are required'
      USING ERRCODE = '22023';
  END IF;

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
    RAISE EXCEPTION 'Cannot dispute an already received shipment'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_pod
  FROM public.proof_of_delivery
  WHERE shipment_id = p_shipment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proof of delivery record not found for this shipment'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_pod.status = 'DISPUTED' THEN
    RAISE EXCEPTION 'A discrepancy has already been reported for this delivery'
      USING ERRCODE = '22023';
  END IF;

  -- Update POD record preserving original evidence
  UPDATE public.proof_of_delivery
  SET status = 'DISPUTED',
      discrepancy_reason = p_reason,
      discrepancy_notes = p_notes,
      acknowledged_by = p_retailer_id,
      acknowledged_at = now(),
      updated_at = now()
  WHERE shipment_id = p_shipment_id;

  -- Update Shipment Status
  UPDATE public.shipments
  SET status = 'DELIVERY_DISPUTED',
      updated_at = now()
  WHERE id = p_shipment_id;

  -- Record Traceability Event
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
    'DELIVERY_DISPUTED',
    p_retailer_id,
    'Retail Store',
    jsonb_build_object(
      'shipment_id', v_shipment.id,
      'reason', p_reason,
      'notes', p_notes,
      'pod_id', v_pod.id,
      'quantity_disputed', v_pod.quantity_delivered
    )
  );

  -- Kafka Outbox Event
  INSERT INTO public.event_outbox (
    event_id,
    event_type,
    topic,
    payload
  )
  VALUES (
    gen_random_uuid()::text,
    'DELIVERY_DISPUTED',
    'shipment-events',
    jsonb_build_object(
      'shipment_id', v_shipment.id,
      'batch_id', v_shipment.batch_number,
      'retailer_id', p_retailer_id,
      'distributor_id', v_shipment.sender_id,
      'reason', p_reason,
      'notes', p_notes
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'shipment_id', v_shipment.id,
    'status', 'DISPUTED',
    'reason', p_reason
  );
END;
$$;

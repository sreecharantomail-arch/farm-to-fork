CREATE OR REPLACE FUNCTION public.record_retailer_wastage(
  p_retailer_id uuid,
  p_inventory_id uuid,
  p_quantity numeric,
  p_reason text,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_inventory public.retailer_inventory%ROWTYPE;
  v_new_quantity numeric;
  v_new_status text;
  v_wastage_id uuid;
BEGIN
  IF p_retailer_id IS NULL
     OR p_inventory_id IS NULL
     OR p_quantity IS NULL
     OR p_quantity <= 0
     OR p_reason IS NULL
     OR pg_catalog.btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Invalid wastage input'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_inventory
  FROM public.retailer_inventory
  WHERE id = p_inventory_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory item not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_inventory.retailer_id <> p_retailer_id THEN
    RAISE EXCEPTION 'You do not own this inventory item'
      USING ERRCODE = '42501';
  END IF;

  IF v_inventory.quantity < p_quantity THEN
    RAISE EXCEPTION 'Insufficient stock'
      USING ERRCODE = '40001';
  END IF;

  v_new_quantity := v_inventory.quantity - p_quantity;
  v_new_status := CASE
    WHEN v_new_quantity <= 0 THEN 'DEPLETED'
    ELSE 'AVAILABLE'
  END;

  UPDATE public.retailer_inventory
  SET quantity = v_new_quantity,
      status = v_new_status
  WHERE id = p_inventory_id;

  INSERT INTO public.retailer_wastage (
    retailer_id,
    inventory_id,
    quantity,
    reason,
    notes
  )
  VALUES (
    p_retailer_id,
    p_inventory_id,
    p_quantity,
    p_reason,
    p_notes
  )
  RETURNING id INTO v_wastage_id;

  INSERT INTO public.event_outbox (
    event_id,
    event_type,
    topic,
    payload
  )
  VALUES
  (
    pg_catalog.gen_random_uuid()::text,
    'WASTAGE_RECORDED',
    'inventory-events',
    pg_catalog.jsonb_build_object(
      'batch_id', v_inventory.batch_number,
      'retailer_id', p_retailer_id,
      'quantity_wasted', p_quantity,
      'reason', p_reason
    )
  ),
  (
    pg_catalog.gen_random_uuid()::text,
    'INVENTORY_UPDATED',
    'inventory-events',
    pg_catalog.jsonb_build_object(
      'batch_id', v_inventory.batch_number,
      'retailer_id', p_retailer_id,
      'new_quantity', v_new_quantity
    )
  );

  INSERT INTO public.traceability_events (
    product_id,
    batch_number,
    event_type,
    actor_id,
    location,
    metadata
  )
  VALUES (
    v_inventory.product_id,
    v_inventory.batch_number,
    'RETAILER_WASTED',
    p_retailer_id,
    'Retail Store',
    pg_catalog.jsonb_build_object(
      'quantity_wasted', p_quantity,
      'unit', v_inventory.unit,
      'reason', p_reason,
      'notes', p_notes
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'wastage_id', v_wastage_id,
    'remaining_quantity', v_new_quantity,
    'status', v_new_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_retailer_wastage(
  uuid, uuid, numeric, text, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_retailer_wastage(
  uuid, uuid, numeric, text, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.record_retailer_sale(
  p_retailer_id uuid,
  p_inventory_id uuid,
  p_quantity_sold numeric,
  p_price_per_unit numeric
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
  v_sale_id uuid;
BEGIN
  IF p_retailer_id IS NULL
     OR p_inventory_id IS NULL
     OR p_quantity_sold IS NULL
     OR p_quantity_sold <= 0
     OR p_price_per_unit IS NULL
     OR p_price_per_unit < 0 THEN
    RAISE EXCEPTION 'Invalid sale input'
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

  IF v_inventory.expiry_date < CURRENT_DATE THEN
    RAISE EXCEPTION 'Cannot sell expired items'
      USING ERRCODE = '22023';
  END IF;

  IF v_inventory.quantity < p_quantity_sold THEN
    RAISE EXCEPTION 'Insufficient stock'
      USING ERRCODE = '40001';
  END IF;

  v_new_quantity := v_inventory.quantity - p_quantity_sold;
  v_new_status := CASE
    WHEN v_new_quantity <= 0 THEN 'DEPLETED'
    ELSE 'AVAILABLE'
  END;

  UPDATE public.retailer_inventory
  SET quantity = v_new_quantity,
      status = v_new_status
  WHERE id = p_inventory_id;

  INSERT INTO public.retailer_sales (
    retailer_id,
    inventory_id,
    quantity_sold,
    price_per_unit
  )
  VALUES (
    p_retailer_id,
    p_inventory_id,
    p_quantity_sold,
    p_price_per_unit
  )
  RETURNING id INTO v_sale_id;

  INSERT INTO public.event_outbox (
    event_id,
    event_type,
    topic,
    payload
  )
  VALUES
  (
    gen_random_uuid()::text,
    'SALE_CREATED',
    'inventory-events',
    jsonb_build_object(
      'batch_id', v_inventory.batch_number,
      'retailer_id', p_retailer_id,
      'quantity_sold', p_quantity_sold
    )
  ),
  (
    gen_random_uuid()::text,
    'INVENTORY_UPDATED',
    'inventory-events',
    jsonb_build_object(
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
    'RETAILER_SOLD',
    p_retailer_id,
    'Retail Store',
    jsonb_build_object(
      'quantity_sold', p_quantity_sold,
      'unit', v_inventory.unit,
      'price_per_unit', p_price_per_unit
    )
  );

  RETURN jsonb_build_object(
    'sale_id', v_sale_id,
    'remaining_quantity', v_new_quantity,
    'status', v_new_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_retailer_sale(uuid, uuid, numeric, numeric)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_retailer_sale(uuid, uuid, numeric, numeric)
  TO service_role;

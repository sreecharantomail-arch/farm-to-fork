CREATE OR REPLACE FUNCTION public.record_retailer_return(
  p_retailer_id uuid,
  p_inventory_id uuid,
  p_quantity numeric,
  p_condition text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_inventory public.retailer_inventory%ROWTYPE;
  v_total_sold numeric;
  v_total_returned numeric;
  v_effective_condition text;
  v_resolution text;
  v_return_id uuid;
  v_wastage_id uuid;
  v_new_quantity numeric;
BEGIN
  -- Validate inputs.
  IF p_retailer_id IS NULL
     OR p_inventory_id IS NULL
     OR p_quantity IS NULL
     OR p_quantity <= 0
     OR p_condition IS NULL
     OR p_condition NOT IN ('Good', 'Damaged', 'Expired')
     OR (p_reason IS NOT NULL AND pg_catalog.length(p_reason) > 1000)
  THEN
    RAISE EXCEPTION 'Invalid return input'
      USING ERRCODE = '22023';
  END IF;

  -- Lock inventory so concurrent returns serialize.
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

  -- Serialize against sales and other returns for this inventory.
  -- Sales must use the same inventory-row lock.
  SELECT COALESCE(SUM(s.quantity_sold), 0)
  INTO v_total_sold
  FROM public.retailer_sales AS s
  WHERE s.inventory_id = p_inventory_id
  AND s.retailer_id = p_retailer_id;

  SELECT COALESCE(SUM(r.quantity), 0)
  INTO v_total_returned
  FROM public.retailer_returns AS r
  WHERE r.inventory_id = p_inventory_id
  AND r.retailer_id = p_retailer_id;

  IF p_quantity > v_total_sold - v_total_returned THEN
    RAISE EXCEPTION 'Return quantity exceeds eligible sold quantity'
      USING ERRCODE = '22023';
  END IF;

  v_effective_condition := CASE
    WHEN v_inventory.expiry_date IS NOT NULL
         AND v_inventory.expiry_date < CURRENT_DATE
      THEN 'Expired'
    ELSE p_condition
  END;

  v_resolution := CASE
    WHEN v_effective_condition = 'Good' THEN 'Restocked'
    ELSE 'Sent to Wastage'
  END;

  -- Record the return.
  INSERT INTO public.retailer_returns (
    retailer_id, inventory_id, quantity, condition, reason
  )
  VALUES (
    p_retailer_id,
    p_inventory_id,
    p_quantity,
    p_condition,
    COALESCE(p_reason, '')
  )
  RETURNING id INTO v_return_id;

  -- Restock only items that remain safe to sell.
  IF v_effective_condition = 'Good' THEN
    v_new_quantity := v_inventory.quantity + p_quantity;

    UPDATE public.retailer_inventory
    SET quantity = v_new_quantity,
        status = 'AVAILABLE',
        updated_at = CURRENT_TIMESTAMP
    WHERE id = p_inventory_id;

    INSERT INTO public.event_outbox (
      event_id, event_type, topic, payload
    )
    VALUES
    (
      pg_catalog.gen_random_uuid()::text,
      'INVENTORY_UPDATED',
      'inventory-events',
      pg_catalog.jsonb_build_object(
        'batch_id', v_inventory.batch_number,
        'retailer_id', p_retailer_id,
        'new_quantity', v_new_quantity,
        'reason', 'CUSTOMER_RETURN'
      )
    );
  ELSE
    -- Returned damaged/expired units were already sold.
    -- Record wastage without subtracting remaining stock again.
    INSERT INTO public.retailer_wastage (
      retailer_id, inventory_id, quantity, reason, notes
    )
    VALUES (
      p_retailer_id,
      p_inventory_id,
      p_quantity,
      CASE
        WHEN v_effective_condition = 'Expired'
          THEN 'Customer Return - Expired'
        ELSE 'Customer Return - Damaged'
      END,
      p_reason
    )
    RETURNING id INTO v_wastage_id;

    INSERT INTO public.event_outbox (
      event_id, event_type, topic, payload
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
        'reason', 'CUSTOMER_RETURN'
      )
    );
  END IF;

  -- Record the return event in the same transaction.
  INSERT INTO public.traceability_events (
    product_id, batch_number, event_type, actor_id,
    location, metadata
  )
  VALUES (
    v_inventory.product_id,
    v_inventory.batch_number,
    'RETAILER_RETURNED',
    p_retailer_id,
    'Retail Store',
    pg_catalog.jsonb_build_object(
      'return_id', v_return_id,
      'quantity_returned', p_quantity,
      'unit', v_inventory.unit,
      'condition', p_condition,
      'effective_condition', v_effective_condition,
      'resolution', v_resolution,
      'reason', p_reason
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'return_id', v_return_id,
    'wastage_id', v_wastage_id,
    'condition', p_condition,
    'effective_condition', v_effective_condition,
    'resolution', v_resolution,
    'remaining_quantity', CASE
      WHEN v_effective_condition = 'Good' THEN v_new_quantity
      ELSE v_inventory.quantity
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_retailer_return(
  uuid, uuid, numeric, text, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_retailer_return(
  uuid, uuid, numeric, text, text
) TO service_role;
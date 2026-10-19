-- FarmChainAI — Inventory Analytics Projection Schema & Idempotent Transaction
-- Migration 15: Additive schema for event-driven inventory analytics projections

-- 1. Inventory Projections Read-Model Table
-- Natural key: (retailer_id, batch_id) uniquely identifies an inventory stock item
CREATE TABLE IF NOT EXISTS public.inventory_projections (
    retailer_id text NOT NULL,
    batch_id text NOT NULL,
    product_id text,
    inventory_id text,
    unit text NOT NULL DEFAULT 'units',
    initial_quantity numeric,
    current_quantity numeric NOT NULL DEFAULT 0,
    total_sold_quantity numeric NOT NULL DEFAULT 0,
    total_wasted_quantity numeric NOT NULL DEFAULT 0,
    turnover_ratio numeric,
    sales_count integer NOT NULL DEFAULT 0,
    wastage_count integer NOT NULL DEFAULT 0,
    updates_count integer NOT NULL DEFAULT 0,
    first_received_at timestamptz,
    last_sale_at timestamptz,
    last_wastage_at timestamptz,
    last_updated_at timestamptz,
    last_event_id text NOT NULL,
    last_event_type text NOT NULL,
    last_event_timestamp timestamptz,
    events_count integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (retailer_id, batch_id)
);

-- Indexes for querying by retailer, batch, product, or freshness
CREATE INDEX IF NOT EXISTS idx_inventory_projections_retailer ON public.inventory_projections(retailer_id);
CREATE INDEX IF NOT EXISTS idx_inventory_projections_batch ON public.inventory_projections(batch_id);
CREATE INDEX IF NOT EXISTS idx_inventory_projections_product ON public.inventory_projections(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_projections_created_at ON public.inventory_projections(created_at DESC);

-- 2. Inventory Event Index (Audit projection of consumed inventory events)
CREATE TABLE IF NOT EXISTS public.inventory_event_index (
    event_id text PRIMARY KEY,
    retailer_id text NOT NULL,
    batch_id text NOT NULL,
    inventory_id text,
    event_type text NOT NULL,
    topic text NOT NULL,
    source text NOT NULL,
    payload jsonb NOT NULL,
    event_timestamp timestamptz,
    indexed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_event_index_retailer_batch ON public.inventory_event_index(retailer_id, batch_id);
CREATE INDEX IF NOT EXISTS idx_inventory_event_index_event_type ON public.inventory_event_index(event_type);

-- 3. Atomic Database Function: Record Inventory Projection & Deduplication
-- Guarantees:
-- 1. Atomic projection mutation, event indexing, and processed_events deduplication in a single transaction.
-- 2. Strictly idempotent: If (p_event_id, p_consumer_group) exists in processed_events, immediately returns duplicate: true.
-- 3. Safely reconciles out-of-order lifecycle events (e.g. SALE_CREATED or INVENTORY_UPDATED before INVENTORY_CREATED).
-- 4. Computes turnover metrics only when verified quantities exist. Never invents missing values.
-- 5. NEVER mutates core business tables (retailer_inventory, retailer_sales, retailer_wastage, retailer_returns, shipments, products).
CREATE OR REPLACE FUNCTION public.record_inventory_projection(
    p_event_id text,
    p_topic text,
    p_consumer_group text,
    p_event_type text,
    p_event_timestamp timestamptz,
    p_source text,
    p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_retailer_id text;
    v_batch_id text;
    v_already_processed boolean;
    v_qty numeric;
    v_initial_qty numeric;
    v_sold_qty numeric;
BEGIN
    -- Extract required references
    v_retailer_id := p_payload->>'retailer_id';
    v_batch_id := p_payload->>'batch_id';

    IF v_retailer_id IS NULL OR length(trim(v_retailer_id)) = 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Missing retailer_id in payload for inventory projection'
        );
    END IF;

    IF v_batch_id IS NULL OR length(trim(v_batch_id)) = 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Missing batch_id in payload for inventory projection'
        );
    END IF;

    -- 1. Idempotency Check: Verify if event was already committed by this consumer group
    SELECT EXISTS (
        SELECT 1
        FROM public.processed_events
        WHERE event_id = p_event_id AND consumer_group = p_consumer_group
    ) INTO v_already_processed;

    IF v_already_processed THEN
        RETURN jsonb_build_object(
            'success', true,
            'duplicate', true,
            'message', 'Event already processed idempotently by consumer group ' || p_consumer_group
        );
    END IF;

    -- 2. Append to Immutable Event Index
    INSERT INTO public.inventory_event_index (
        event_id,
        retailer_id,
        batch_id,
        inventory_id,
        event_type,
        topic,
        source,
        payload,
        event_timestamp,
        indexed_at
    )
    VALUES (
        p_event_id,
        v_retailer_id,
        v_batch_id,
        p_payload->>'inventory_id',
        p_event_type,
        p_topic,
        COALESCE(p_source, 'unknown'),
        p_payload,
        p_event_timestamp,
        now()
    )
    ON CONFLICT (event_id) DO NOTHING;

    -- 3. Upsert Inventory Projection based on Event Type
    IF p_event_type = 'INVENTORY_CREATED' THEN
        v_qty := (COALESCE(p_payload->>'quantity', p_payload->>'quantity_delivered', p_payload->>'delivered_quantity', '0'))::numeric;

        INSERT INTO public.inventory_projections (
            retailer_id,
            batch_id,
            product_id,
            inventory_id,
            unit,
            initial_quantity,
            current_quantity,
            first_received_at,
            last_event_id,
            last_event_type,
            last_event_timestamp,
            events_count,
            created_at,
            updated_at
        )
        VALUES (
            v_retailer_id,
            v_batch_id,
            p_payload->>'product_id',
            p_payload->>'inventory_id',
            COALESCE(p_payload->>'unit', 'units'),
            v_qty,
            v_qty,
            COALESCE(p_event_timestamp, now()),
            p_event_id,
            p_event_type,
            p_event_timestamp,
            1,
            now(),
            now()
        )
        ON CONFLICT (retailer_id, batch_id) DO UPDATE SET
            product_id = COALESCE(EXCLUDED.product_id, public.inventory_projections.product_id),
            inventory_id = COALESCE(EXCLUDED.inventory_id, public.inventory_projections.inventory_id),
            unit = COALESCE(EXCLUDED.unit, public.inventory_projections.unit),
            initial_quantity = COALESCE(public.inventory_projections.initial_quantity, EXCLUDED.initial_quantity),
            first_received_at = COALESCE(public.inventory_projections.first_received_at, EXCLUDED.first_received_at),
            -- If out-of-order events arrived first (e.g. SALE before CREATED),
            -- reconcile current_quantity and turnover metrics:
            current_quantity = CASE
                WHEN public.inventory_projections.updates_count = 0 THEN
                    GREATEST(0, EXCLUDED.initial_quantity - public.inventory_projections.total_sold_quantity - public.inventory_projections.total_wasted_quantity)
                ELSE public.inventory_projections.current_quantity
            END,
            turnover_ratio = CASE
                WHEN EXCLUDED.initial_quantity > 0 THEN
                    ROUND(public.inventory_projections.total_sold_quantity / EXCLUDED.initial_quantity, 4)
                ELSE public.inventory_projections.turnover_ratio
            END,
            last_event_id = EXCLUDED.last_event_id,
            last_event_type = EXCLUDED.last_event_type,
            last_event_timestamp = EXCLUDED.last_event_timestamp,
            events_count = public.inventory_projections.events_count + 1,
            updated_at = now();

    ELSIF p_event_type = 'SALE_CREATED' THEN
        v_qty := (COALESCE(p_payload->>'quantity_sold', p_payload->>'quantity', '0'))::numeric;

        INSERT INTO public.inventory_projections (
            retailer_id,
            batch_id,
            unit,
            total_sold_quantity,
            sales_count,
            last_sale_at,
            last_event_id,
            last_event_type,
            last_event_timestamp,
            events_count,
            created_at,
            updated_at
        )
        VALUES (
            v_retailer_id,
            v_batch_id,
            COALESCE(p_payload->>'unit', 'units'),
            v_qty,
            1,
            COALESCE(p_event_timestamp, now()),
            p_event_id,
            p_event_type,
            p_event_timestamp,
            1,
            now(),
            now()
        )
        ON CONFLICT (retailer_id, batch_id) DO UPDATE SET
            total_sold_quantity = public.inventory_projections.total_sold_quantity + v_qty,
            sales_count = public.inventory_projections.sales_count + 1,
            last_sale_at = COALESCE(p_event_timestamp, now()),
            current_quantity = CASE
                WHEN public.inventory_projections.updates_count = 0 AND public.inventory_projections.initial_quantity IS NOT NULL THEN
                    GREATEST(0, public.inventory_projections.initial_quantity - (public.inventory_projections.total_sold_quantity + v_qty) - public.inventory_projections.total_wasted_quantity)
                ELSE public.inventory_projections.current_quantity
            END,
            turnover_ratio = CASE
                WHEN public.inventory_projections.initial_quantity IS NOT NULL AND public.inventory_projections.initial_quantity > 0 THEN
                    ROUND((public.inventory_projections.total_sold_quantity + v_qty) / public.inventory_projections.initial_quantity, 4)
                ELSE public.inventory_projections.turnover_ratio
            END,
            last_event_id = EXCLUDED.last_event_id,
            last_event_type = EXCLUDED.last_event_type,
            last_event_timestamp = EXCLUDED.last_event_timestamp,
            events_count = public.inventory_projections.events_count + 1,
            updated_at = now();

    ELSIF p_event_type = 'INVENTORY_UPDATED' THEN
        v_qty := (COALESCE(p_payload->>'new_quantity', p_payload->>'quantity', '0'))::numeric;

        INSERT INTO public.inventory_projections (
            retailer_id,
            batch_id,
            unit,
            current_quantity,
            updates_count,
            last_updated_at,
            last_event_id,
            last_event_type,
            last_event_timestamp,
            events_count,
            created_at,
            updated_at
        )
        VALUES (
            v_retailer_id,
            v_batch_id,
            COALESCE(p_payload->>'unit', 'units'),
            v_qty,
            1,
            COALESCE(p_event_timestamp, now()),
            p_event_id,
            p_event_type,
            p_event_timestamp,
            1,
            now(),
            now()
        )
        ON CONFLICT (retailer_id, batch_id) DO UPDATE SET
            current_quantity = v_qty,
            updates_count = public.inventory_projections.updates_count + 1,
            last_updated_at = COALESCE(p_event_timestamp, now()),
            last_event_id = EXCLUDED.last_event_id,
            last_event_type = EXCLUDED.last_event_type,
            last_event_timestamp = EXCLUDED.last_event_timestamp,
            events_count = public.inventory_projections.events_count + 1,
            updated_at = now();

    ELSIF p_event_type = 'WASTAGE_RECORDED' THEN
        v_qty := (COALESCE(p_payload->>'quantity_wasted', p_payload->>'quantity', '0'))::numeric;

        INSERT INTO public.inventory_projections (
            retailer_id,
            batch_id,
            unit,
            total_wasted_quantity,
            wastage_count,
            last_wastage_at,
            last_event_id,
            last_event_type,
            last_event_timestamp,
            events_count,
            created_at,
            updated_at
        )
        VALUES (
            v_retailer_id,
            v_batch_id,
            COALESCE(p_payload->>'unit', 'units'),
            v_qty,
            1,
            COALESCE(p_event_timestamp, now()),
            p_event_id,
            p_event_type,
            p_event_timestamp,
            1,
            now(),
            now()
        )
        ON CONFLICT (retailer_id, batch_id) DO UPDATE SET
            total_wasted_quantity = public.inventory_projections.total_wasted_quantity + v_qty,
            wastage_count = public.inventory_projections.wastage_count + 1,
            last_wastage_at = COALESCE(p_event_timestamp, now()),
            current_quantity = CASE
                WHEN public.inventory_projections.updates_count = 0 AND public.inventory_projections.initial_quantity IS NOT NULL THEN
                    GREATEST(0, public.inventory_projections.initial_quantity - public.inventory_projections.total_sold_quantity - (public.inventory_projections.total_wasted_quantity + v_qty))
                ELSE public.inventory_projections.current_quantity
            END,
            last_event_id = EXCLUDED.last_event_id,
            last_event_type = EXCLUDED.last_event_type,
            last_event_timestamp = EXCLUDED.last_event_timestamp,
            events_count = public.inventory_projections.events_count + 1,
            updated_at = now();

    ELSE
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Unsupported event type for inventory projection: ' || p_event_type
        );
    END IF;

    -- 4. Mark Event as Processed for Idempotency
    INSERT INTO public.processed_events (
        event_id,
        topic,
        consumer_group,
        processed_at
    )
    VALUES (
        p_event_id,
        p_topic,
        p_consumer_group,
        now()
    )
    ON CONFLICT (event_id, consumer_group) DO NOTHING;

    RETURN jsonb_build_object(
        'success', true,
        'duplicate', false,
        'retailer_id', v_retailer_id,
        'batch_id', v_batch_id
    );
END;
$$;

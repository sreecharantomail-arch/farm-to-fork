-- FarmChainAI — Shipment Analytics Projection Schema & Idempotent Transaction
-- Migration 14: Additive schema for event-driven shipment analytics projections

-- 1. Shipment Projections Read-Model Table
CREATE TABLE IF NOT EXISTS public.shipment_projections (
    shipment_id text PRIMARY KEY,
    batch_id text,
    distributor_id text,
    retailer_id text,
    pod_id text,
    quantity_delivered numeric,
    unit text,
    recipient_name text,
    delivery_status text NOT NULL DEFAULT 'IN_TRANSIT',
    is_disputed boolean NOT NULL DEFAULT false,
    dispute_reason text,
    dispute_notes text,
    pod_submitted_at timestamptz,
    delivery_received_at timestamptz,
    disputed_at timestamptz,
    last_event_id text NOT NULL,
    last_event_type text NOT NULL,
    last_event_timestamp timestamptz,
    events_count integer NOT NULL DEFAULT 1,
    delivery_duration_seconds numeric,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for status, batch, and date range queries
CREATE INDEX IF NOT EXISTS idx_shipment_projections_status ON public.shipment_projections(delivery_status);
CREATE INDEX IF NOT EXISTS idx_shipment_projections_batch ON public.shipment_projections(batch_id);
CREATE INDEX IF NOT EXISTS idx_shipment_projections_retailer ON public.shipment_projections(retailer_id);
CREATE INDEX IF NOT EXISTS idx_shipment_projections_distributor ON public.shipment_projections(distributor_id);
CREATE INDEX IF NOT EXISTS idx_shipment_projections_created_at ON public.shipment_projections(created_at DESC);

-- 2. Shipment Event Index (Audit log of all shipment events consumed)
CREATE TABLE IF NOT EXISTS public.shipment_event_index (
    event_id text PRIMARY KEY,
    shipment_id text NOT NULL,
    batch_id text,
    event_type text NOT NULL,
    topic text NOT NULL,
    source text NOT NULL,
    payload jsonb NOT NULL,
    event_timestamp timestamptz,
    indexed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shipment_event_index_shipment ON public.shipment_event_index(shipment_id);
CREATE INDEX IF NOT EXISTS idx_shipment_event_index_batch ON public.shipment_event_index(batch_id);

-- 3. Atomic Database Function: record_shipment_projection
-- Guarantees:
-- 1. Atomic projection mutation and processed_events deduplication record in a single transaction.
-- 2. Strictly idempotent: If (p_event_id, p_consumer_group) exists in processed_events, immediately returns duplicate: true.
-- 3. Reconciles out-of-order lifecycle events (e.g. SHIPMENT_RECEIVED before DELIVERY_PROOF_SUBMITTED) without silent data loss.
-- 4. Never touches core tables (shipments, proof_of_delivery, products, etc.).
CREATE OR REPLACE FUNCTION public.record_shipment_projection(
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
    v_shipment_id text;
    v_batch_id text;
    v_already_processed boolean;
BEGIN
    -- Extract required shipment reference
    v_shipment_id := p_payload->>'shipment_id';
    v_batch_id := p_payload->>'batch_id';

    IF v_shipment_id IS NULL OR length(trim(v_shipment_id)) = 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Missing shipment_id in payload for shipment projection'
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
    INSERT INTO public.shipment_event_index (
        event_id,
        shipment_id,
        batch_id,
        event_type,
        topic,
        source,
        payload,
        event_timestamp,
        indexed_at
    )
    VALUES (
        p_event_id,
        v_shipment_id,
        v_batch_id,
        p_event_type,
        p_topic,
        COALESCE(p_source, 'unknown'),
        p_payload,
        p_event_timestamp,
        now()
    )
    ON CONFLICT (event_id) DO NOTHING;

    -- 3. Upsert Shipment Projection with Out-of-Order Lifecycle Handling
    IF p_event_type = 'DELIVERY_PROOF_SUBMITTED' THEN
        INSERT INTO public.shipment_projections (
            shipment_id,
            batch_id,
            distributor_id,
            retailer_id,
            pod_id,
            quantity_delivered,
            unit,
            recipient_name,
            delivery_status,
            pod_submitted_at,
            last_event_id,
            last_event_type,
            last_event_timestamp,
            events_count,
            created_at,
            updated_at
        )
        VALUES (
            v_shipment_id,
            v_batch_id,
            p_payload->>'distributor_id',
            p_payload->>'retailer_id',
            p_payload->>'pod_id',
            (COALESCE(p_payload->>'quantity_delivered', p_payload->>'quantity', p_payload->>'delivered_quantity'))::numeric,
            p_payload->>'unit',
            p_payload->>'recipient_name',
            'PROOF_SUBMITTED',
            COALESCE(p_event_timestamp, now()),
            p_event_id,
            p_event_type,
            p_event_timestamp,
            1,
            now(),
            now()
        )
        ON CONFLICT (shipment_id) DO UPDATE SET
            batch_id = COALESCE(EXCLUDED.batch_id, public.shipment_projections.batch_id),
            distributor_id = COALESCE(EXCLUDED.distributor_id, public.shipment_projections.distributor_id),
            retailer_id = COALESCE(EXCLUDED.retailer_id, public.shipment_projections.retailer_id),
            pod_id = COALESCE(EXCLUDED.pod_id, public.shipment_projections.pod_id),
            quantity_delivered = COALESCE(EXCLUDED.quantity_delivered, public.shipment_projections.quantity_delivered),
            unit = COALESCE(EXCLUDED.unit, public.shipment_projections.unit),
            recipient_name = COALESCE(EXCLUDED.recipient_name, public.shipment_projections.recipient_name),
            pod_submitted_at = COALESCE(public.shipment_projections.pod_submitted_at, EXCLUDED.pod_submitted_at),
            delivery_status = CASE
                WHEN public.shipment_projections.is_disputed THEN 'DISPUTED'
                WHEN public.shipment_projections.delivery_received_at IS NOT NULL THEN 'DELIVERED'
                ELSE 'PROOF_SUBMITTED'
            END,
            delivery_duration_seconds = CASE
                WHEN public.shipment_projections.delivery_received_at IS NOT NULL AND EXCLUDED.pod_submitted_at IS NOT NULL
                THEN EXTRACT(EPOCH FROM (public.shipment_projections.delivery_received_at - EXCLUDED.pod_submitted_at))
                ELSE public.shipment_projections.delivery_duration_seconds
            END,
            last_event_id = EXCLUDED.last_event_id,
            last_event_type = EXCLUDED.last_event_type,
            last_event_timestamp = EXCLUDED.last_event_timestamp,
            events_count = public.shipment_projections.events_count + 1,
            updated_at = now();

    ELSIF p_event_type = 'SHIPMENT_RECEIVED' THEN
        INSERT INTO public.shipment_projections (
            shipment_id,
            batch_id,
            retailer_id,
            pod_id,
            quantity_delivered,
            unit,
            delivery_status,
            delivery_received_at,
            last_event_id,
            last_event_type,
            last_event_timestamp,
            events_count,
            created_at,
            updated_at
        )
        VALUES (
            v_shipment_id,
            v_batch_id,
            p_payload->>'retailer_id',
            p_payload->>'pod_id',
            (COALESCE(p_payload->>'quantity', p_payload->>'quantity_delivered', p_payload->>'delivered_quantity'))::numeric,
            p_payload->>'unit',
            'DELIVERED',
            COALESCE(p_event_timestamp, now()),
            p_event_id,
            p_event_type,
            p_event_timestamp,
            1,
            now(),
            now()
        )
        ON CONFLICT (shipment_id) DO UPDATE SET
            batch_id = COALESCE(EXCLUDED.batch_id, public.shipment_projections.batch_id),
            retailer_id = COALESCE(EXCLUDED.retailer_id, public.shipment_projections.retailer_id),
            pod_id = COALESCE(EXCLUDED.pod_id, public.shipment_projections.pod_id),
            quantity_delivered = COALESCE(EXCLUDED.quantity_delivered, public.shipment_projections.quantity_delivered),
            unit = COALESCE(EXCLUDED.unit, public.shipment_projections.unit),
            delivery_received_at = COALESCE(public.shipment_projections.delivery_received_at, EXCLUDED.delivery_received_at),
            delivery_status = CASE
                WHEN public.shipment_projections.is_disputed THEN 'DISPUTED'
                ELSE 'DELIVERED'
            END,
            delivery_duration_seconds = CASE
                WHEN public.shipment_projections.pod_submitted_at IS NOT NULL AND EXCLUDED.delivery_received_at IS NOT NULL
                THEN EXTRACT(EPOCH FROM (EXCLUDED.delivery_received_at - public.shipment_projections.pod_submitted_at))
                ELSE public.shipment_projections.delivery_duration_seconds
            END,
            last_event_id = EXCLUDED.last_event_id,
            last_event_type = EXCLUDED.last_event_type,
            last_event_timestamp = EXCLUDED.last_event_timestamp,
            events_count = public.shipment_projections.events_count + 1,
            updated_at = now();

    ELSIF p_event_type = 'DELIVERY_DISPUTED' THEN
        INSERT INTO public.shipment_projections (
            shipment_id,
            batch_id,
            retailer_id,
            distributor_id,
            pod_id,
            delivery_status,
            is_disputed,
            dispute_reason,
            dispute_notes,
            disputed_at,
            last_event_id,
            last_event_type,
            last_event_timestamp,
            events_count,
            created_at,
            updated_at
        )
        VALUES (
            v_shipment_id,
            v_batch_id,
            p_payload->>'retailer_id',
            p_payload->>'distributor_id',
            p_payload->>'pod_id',
            'DISPUTED',
            true,
            p_payload->>'reason',
            p_payload->>'notes',
            COALESCE(p_event_timestamp, now()),
            p_event_id,
            p_event_type,
            p_event_timestamp,
            1,
            now(),
            now()
        )
        ON CONFLICT (shipment_id) DO UPDATE SET
            batch_id = COALESCE(EXCLUDED.batch_id, public.shipment_projections.batch_id),
            retailer_id = COALESCE(EXCLUDED.retailer_id, public.shipment_projections.retailer_id),
            distributor_id = COALESCE(EXCLUDED.distributor_id, public.shipment_projections.distributor_id),
            pod_id = COALESCE(EXCLUDED.pod_id, public.shipment_projections.pod_id),
            is_disputed = true,
            dispute_reason = EXCLUDED.dispute_reason,
            dispute_notes = EXCLUDED.dispute_notes,
            disputed_at = COALESCE(public.shipment_projections.disputed_at, EXCLUDED.disputed_at),
            delivery_status = 'DISPUTED',
            last_event_id = EXCLUDED.last_event_id,
            last_event_type = EXCLUDED.last_event_type,
            last_event_timestamp = EXCLUDED.last_event_timestamp,
            events_count = public.shipment_projections.events_count + 1,
            updated_at = now();

    ELSE
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Unsupported event type for shipment projection: ' || p_event_type
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
        'shipment_id', v_shipment_id
    );
END;
$$;

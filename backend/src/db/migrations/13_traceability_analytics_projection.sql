-- FarmChainAI — Traceability Analytics Projection Schema & Idempotent Transaction
-- Migration 13: Additive schema for event-driven traceability analytics projections

-- 1. Traceability Projections Read-Model Table
CREATE TABLE IF NOT EXISTS public.traceability_projections (
    batch_id text PRIMARY KEY,
    product_id text,
    farmer_id text,
    initial_quantity numeric,
    received_quantity numeric,
    status text,
    retailer_id text,
    last_shipment_id text,
    blockchain_tx_hash text,
    blockchain_recorded boolean NOT NULL DEFAULT false,
    batch_created_at timestamptz,
    retailer_received_at timestamptz,
    last_event_id text NOT NULL,
    last_event_type text NOT NULL,
    last_event_timestamp timestamptz,
    lifecycle_stage text NOT NULL DEFAULT 'REGISTERED',
    events_count integer NOT NULL DEFAULT 1,
    journey_lead_time_seconds numeric,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Index for analytics range and status queries
CREATE INDEX IF NOT EXISTS idx_traceability_projections_stage ON public.traceability_projections(lifecycle_stage);
CREATE INDEX IF NOT EXISTS idx_traceability_projections_created_at ON public.traceability_projections(created_at DESC);

-- 2. Traceability Event Index (Audit projection of individual events)
CREATE TABLE IF NOT EXISTS public.traceability_event_index (
    event_id text PRIMARY KEY,
    batch_id text NOT NULL,
    event_type text NOT NULL,
    topic text NOT NULL,
    source text NOT NULL,
    payload jsonb NOT NULL,
    event_timestamp timestamptz,
    indexed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_traceability_event_index_batch ON public.traceability_event_index(batch_id);

-- 3. Atomic Database Function: Record Traceability Projection & Idempotency
-- Guarantees that projection writes, event indexing, and processed_events idempotency succeed or fail together.
CREATE OR REPLACE FUNCTION public.record_traceability_projection(
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
AS $$
DECLARE
    v_batch_id text;
    v_existing_lead_time numeric;
    v_created_at timestamptz;
    v_received_at timestamptz;
    v_new_stage text;
BEGIN
    -- 1. Idempotency Check: Safely recognize previously processed event
    IF EXISTS (
        SELECT 1 FROM public.processed_events
        WHERE event_id = p_event_id AND consumer_group = p_consumer_group
    ) THEN
        RETURN jsonb_build_object(
            'success', true,
            'duplicate', true,
            'event_id', p_event_id,
            'message', 'Event already processed by this consumer group'
        );
    END IF;

    -- Extract batch reference
    v_batch_id := p_payload->>'batch_id';
    IF v_batch_id IS NULL OR length(trim(v_batch_id)) = 0 THEN
        RAISE EXCEPTION 'Payload missing required batch_id';
    END IF;

    -- 2. Insert into event index
    INSERT INTO public.traceability_event_index (
        event_id,
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
        v_batch_id,
        p_event_type,
        p_topic,
        COALESCE(p_source, 'unknown'),
        p_payload,
        p_event_timestamp,
        now()
    )
    ON CONFLICT (event_id) DO NOTHING;

    -- 3. Upsert Traceability Projection with Out-of-Order Lifecycle Handling
    IF p_event_type = 'BATCH_CREATED' THEN
        INSERT INTO public.traceability_projections (
            batch_id,
            product_id,
            farmer_id,
            initial_quantity,
            status,
            batch_created_at,
            last_event_id,
            last_event_type,
            last_event_timestamp,
            lifecycle_stage,
            events_count,
            created_at,
            updated_at
        )
        VALUES (
            v_batch_id,
            p_payload->>'product_id',
            p_payload->>'farmer_id',
            (COALESCE(p_payload->>'quantity', p_payload->>'initial_quantity'))::numeric,
            COALESCE(p_payload->>'status', p_payload->>'initial_status'),
            COALESCE(p_event_timestamp, now()),
            p_event_id,
            p_event_type,
            p_event_timestamp,
            'HARVESTED',
            1,
            now(),
            now()
        )
        ON CONFLICT (batch_id) DO UPDATE SET
            product_id = COALESCE(public.traceability_projections.product_id, EXCLUDED.product_id),
            farmer_id = COALESCE(public.traceability_projections.farmer_id, EXCLUDED.farmer_id),
            initial_quantity = COALESCE(public.traceability_projections.initial_quantity, EXCLUDED.initial_quantity),
            status = COALESCE(public.traceability_projections.status, EXCLUDED.status),
            batch_created_at = COALESCE(public.traceability_projections.batch_created_at, EXCLUDED.batch_created_at),
            journey_lead_time_seconds = CASE
                WHEN public.traceability_projections.retailer_received_at IS NOT NULL
                THEN EXTRACT(EPOCH FROM (public.traceability_projections.retailer_received_at - EXCLUDED.batch_created_at))
                ELSE public.traceability_projections.journey_lead_time_seconds
            END,
            last_event_id = EXCLUDED.last_event_id,
            last_event_type = EXCLUDED.last_event_type,
            last_event_timestamp = EXCLUDED.last_event_timestamp,
            events_count = public.traceability_projections.events_count + 1,
            updated_at = now();

    ELSIF p_event_type = 'RETAILER_RECEIVED' THEN
        INSERT INTO public.traceability_projections (
            batch_id,
            retailer_id,
            last_shipment_id,
            received_quantity,
            retailer_received_at,
            last_event_id,
            last_event_type,
            last_event_timestamp,
            lifecycle_stage,
            events_count,
            created_at,
            updated_at
        )
        VALUES (
            v_batch_id,
            p_payload->>'retailer_id',
            COALESCE(p_payload->>'shipment_id', p_payload->>'last_shipment_id'),
            (COALESCE(p_payload->>'quantity', p_payload->>'received_quantity', p_payload->>'quantity_received'))::numeric,
            COALESCE(p_event_timestamp, now()),
            p_event_id,
            p_event_type,
            p_event_timestamp,
            'RETAILED',
            1,
            now(),
            now()
        )
        ON CONFLICT (batch_id) DO UPDATE SET
            retailer_id = COALESCE(EXCLUDED.retailer_id, public.traceability_projections.retailer_id),
            last_shipment_id = COALESCE(EXCLUDED.last_shipment_id, public.traceability_projections.last_shipment_id),
            received_quantity = COALESCE(EXCLUDED.received_quantity, public.traceability_projections.received_quantity),
            retailer_received_at = COALESCE(EXCLUDED.retailer_received_at, public.traceability_projections.retailer_received_at),
            journey_lead_time_seconds = CASE
                WHEN public.traceability_projections.batch_created_at IS NOT NULL
                THEN EXTRACT(EPOCH FROM (EXCLUDED.retailer_received_at - public.traceability_projections.batch_created_at))
                ELSE public.traceability_projections.journey_lead_time_seconds
            END,
            lifecycle_stage = 'RETAILED',
            last_event_id = EXCLUDED.last_event_id,
            last_event_type = EXCLUDED.last_event_type,
            last_event_timestamp = EXCLUDED.last_event_timestamp,
            events_count = public.traceability_projections.events_count + 1,
            updated_at = now();

    ELSIF p_event_type = 'BLOCKCHAIN_RECORDED' THEN
        INSERT INTO public.traceability_projections (
            batch_id,
            blockchain_tx_hash,
            blockchain_recorded,
            last_event_id,
            last_event_type,
            last_event_timestamp,
            lifecycle_stage,
            events_count,
            created_at,
            updated_at
        )
        VALUES (
            v_batch_id,
            COALESCE(p_payload->>'tx_hash', p_payload->>'transaction_hash', p_payload->>'blockchain_hash'),
            true,
            p_event_id,
            p_event_type,
            p_event_timestamp,
            'RECORDED_ON_CHAIN',
            1,
            now(),
            now()
        )
        ON CONFLICT (batch_id) DO UPDATE SET
            blockchain_tx_hash = COALESCE(EXCLUDED.blockchain_tx_hash, public.traceability_projections.blockchain_tx_hash),
            blockchain_recorded = true,
            last_event_id = EXCLUDED.last_event_id,
            last_event_type = EXCLUDED.last_event_type,
            last_event_timestamp = EXCLUDED.last_event_timestamp,
            events_count = public.traceability_projections.events_count + 1,
            updated_at = now();

    ELSE
        RAISE EXCEPTION 'Unsupported event type for traceability projection: %', p_event_type;
    END IF;

    -- 4. Mark Idempotency in processed_events (Same Atomic Transaction)
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
    );

    RETURN jsonb_build_object(
        'success', true,
        'duplicate', false,
        'batch_id', v_batch_id,
        'event_id', p_event_id,
        'event_type', p_event_type
    );
END;
$$;

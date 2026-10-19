-- Phase 2: Supply Chain Foundation (Safe Restructuring)
-- Creates lineage and safely restructures shipments.

-- 1. BATCH LINEAGE (Parent/Child processing)
create table if not exists public.batch_lineage (
  id uuid primary key default gen_random_uuid(),
  parent_product_id uuid not null references public.products(id),
  child_product_id uuid not null references public.products(id),
  processing_action text not null,
  quantity_used numeric not null,
  created_at timestamptz not null default now(),
  constraint chk_no_self_reference check (parent_product_id != child_product_id)
);

create index if not exists idx_lineage_parent on public.batch_lineage (parent_product_id);
create index if not exists idx_lineage_child on public.batch_lineage (child_product_id);

-- 2. PRODUCT REQUESTS (B2B Ordering)
-- Safely ensure the processor_id column exists
alter table public.product_requests add column if not exists processor_id uuid references public.users(id);

-- 3. SHIPMENTS
-- Safe programmatic migration guard
DO $$ 
DECLARE
  row_count INT;
BEGIN
  -- Verify table exists and check for existing data
  SELECT COUNT(*) INTO row_count FROM public.shipments;
  
  IF row_count > 0 THEN
    RAISE EXCEPTION 'CRITICAL: public.shipments contains % rows. Manual migration required to prevent data destruction. Migration aborted.', row_count;
  END IF;

  -- Table is guaranteed empty. Safe to restructure.
  ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS sender_id uuid references public.users(id);
  ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS receiver_id uuid references public.users(id);
  
  -- Make columns NOT NULL safely
  ALTER TABLE public.shipments ALTER COLUMN sender_id SET NOT NULL;
  ALTER TABLE public.shipments ALTER COLUMN receiver_id SET NOT NULL;

  -- Remove obsolete restrictive columns
  ALTER TABLE public.shipments DROP COLUMN IF EXISTS processor_id;
  ALTER TABLE public.shipments DROP COLUMN IF EXISTS retailer_id;
END $$;

create index if not exists idx_shipments_tracking on public.shipments (shipment_tracking_id);
create index if not exists idx_shipments_sender on public.shipments (sender_id);
create index if not exists idx_shipments_receiver on public.shipments (receiver_id);
create index if not exists idx_shipments_distributor on public.shipments (distributor_id);

-- 4. TRIGGERS FOR UPDATED_AT
drop trigger if exists trg_product_requests_updated_at on public.product_requests;
create trigger trg_product_requests_updated_at
  before update on public.product_requests
  for each row execute function public.set_updated_at();

drop trigger if exists trg_shipments_updated_at on public.shipments;
create trigger trg_shipments_updated_at
  before update on public.shipments
  for each row execute function public.set_updated_at();

drop trigger if exists trg_retailer_inventory_updated_at on public.retailer_inventory;
create trigger trg_retailer_inventory_updated_at
  before update on public.retailer_inventory
  for each row execute function public.set_updated_at();

-- 5. ENABLE RLS (Defense in depth, Service Role bypasses this)
alter table public.traceability_events enable row level security;
alter table public.batch_lineage enable row level security;
alter table public.product_requests enable row level security;
alter table public.shipments enable row level security;
alter table public.retailer_inventory enable row level security;
alter table public.retailer_sales enable row level security;
alter table public.retailer_wastage enable row level security;
alter table public.retailer_returns enable row level security;

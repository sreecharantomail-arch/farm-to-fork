-- ==============================================================================
-- FarmChainAI — Complete Production Schema Initialization for Supabase
-- Run this script in your Supabase Dashboard:
-- Project -> SQL Editor -> New Query -> Paste & Run
-- ==============================================================================

-- 1. Enable Cryptographic & UUID Extensions
create extension if not exists "pgcrypto";

-- ==============================================================================
-- 2. CORE USERS TABLE
-- ==============================================================================
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  password text not null, -- bcrypt hash
  role text not null default 'consumer'
    check (role in ('admin', 'farmer', 'processor', 'distributor', 'retailer', 'consumer')),
  wallet_address text,
  availability_status text default 'AVAILABLE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_users_email on public.users (email);
create index if not exists idx_users_role on public.users (role);

-- ==============================================================================
-- 3. PRODUCTS & INVENTORY
-- ==============================================================================
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  product_id integer default 0,
  name text not null,
  category text not null,
  batch_number text not null,
  quantity numeric not null,
  farmer_id uuid not null references public.users(id),
  current_owner_id uuid not null references public.users(id),
  status text not null default 'Harvested',
  organic_status boolean default false,
  ai_quality_score numeric,
  ai_quality_label text,
  ai_shelf_life jsonb,
  blockchain_hash text,
  blockchain_status text default 'NOT_RECORDED',
  expiry_date date,
  product_image_url text,
  wholesale_price numeric default 0,
  retail_price numeric default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_products_farmer_id on public.products (farmer_id);
create index if not exists idx_products_batch_number on public.products (batch_number);
create index if not exists idx_products_created_at on public.products (created_at desc);

-- Storage bucket for product images
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

-- ==============================================================================
-- 4. B2B PRODUCT REQUESTS & ORDERS
-- ==============================================================================
create table if not exists public.product_requests (
  id uuid primary key default gen_random_uuid(),
  request_id text not null,
  retailer_id uuid references public.users(id),
  processor_id uuid references public.users(id),
  product_name text not null,
  quantity numeric not null,
  unit text default 'kg',
  required_date date,
  status text not null default 'PENDING',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_requests_status on public.product_requests (status);

-- ==============================================================================
-- 5. SHIPMENTS & LOGISTICS
-- ==============================================================================
create table if not exists public.shipments (
  id uuid primary key default gen_random_uuid(),
  shipment_tracking_id text not null,
  request_id uuid references public.product_requests(id),
  batch_number text,
  product_id uuid references public.products(id),
  sender_id uuid references public.users(id),
  receiver_id uuid references public.users(id),
  distributor_id uuid references public.users(id),
  pickup_date timestamptz,
  estimated_delivery timestamptz,
  actual_delivery timestamptz,
  status text not null default 'PENDING',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_shipments_tracking on public.shipments (shipment_tracking_id);
create index if not exists idx_shipments_sender on public.shipments (sender_id);
create index if not exists idx_shipments_receiver on public.shipments (receiver_id);
create index if not exists idx_shipments_status on public.shipments (status);

-- ==============================================================================
-- 6. RETAILER INVENTORY, SALES, WASTAGE & RETURNS
-- ==============================================================================
create table if not exists public.retailer_inventory (
  id uuid primary key default gen_random_uuid(),
  retailer_id uuid not null references public.users(id),
  product_id uuid not null references public.products(id),
  batch_number text not null,
  quantity numeric not null default 0,
  unit text default 'kg',
  expiry_date date,
  status text not null default 'AVAILABLE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_retailer_inv_ret on public.retailer_inventory (retailer_id);

create table if not exists public.retailer_sales (
  id uuid primary key default gen_random_uuid(),
  retailer_id uuid not null references public.users(id),
  inventory_id uuid not null references public.retailer_inventory(id),
  batch_number text not null,
  product_id uuid not null references public.products(id),
  quantity_sold numeric not null,
  price_per_unit numeric not null,
  total_amount numeric not null,
  sale_date timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.retailer_wastage (
  id uuid primary key default gen_random_uuid(),
  retailer_id uuid not null references public.users(id),
  inventory_id uuid not null references public.retailer_inventory(id),
  batch_number text not null,
  product_id uuid not null references public.products(id),
  quantity_wasted numeric not null,
  reason text not null,
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.retailer_returns (
  id uuid primary key default gen_random_uuid(),
  retailer_id uuid not null references public.users(id),
  inventory_id uuid not null references public.retailer_inventory(id),
  batch_number text not null,
  product_id uuid not null references public.products(id),
  quantity_returned numeric not null,
  reason text not null,
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- ==============================================================================
-- 7. TRACEABILITY & BATCH LINEAGE
-- ==============================================================================
create table if not exists public.traceability_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null,
  event_type text not null,
  product_id uuid references public.products(id),
  batch_number text not null,
  actor_id uuid references public.users(id),
  actor_role text not null,
  timestamp timestamptz not null default now(),
  location text,
  metadata jsonb default '{}'::jsonb,
  blockchain_tx_hash text,
  created_at timestamptz not null default now()
);

create index if not exists idx_trace_batch on public.traceability_events (batch_number);

create table if not exists public.batch_lineage (
  id uuid primary key default gen_random_uuid(),
  parent_product_id uuid not null references public.products(id),
  child_product_id uuid not null references public.products(id),
  processing_action text not null,
  quantity_used numeric not null,
  created_at timestamptz not null default now(),
  constraint chk_no_self_reference check (parent_product_id != child_product_id)
);

-- ==============================================================================
-- 8. NOTIFICATIONS & MARKET PRICES
-- ==============================================================================
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id),
  type text not null,
  title text not null,
  message text not null,
  read boolean not null default false,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_user on public.notifications (user_id);

create table if not exists public.market_prices (
  id uuid primary key default gen_random_uuid(),
  commodity text not null,
  market text not null,
  wholesale_price numeric not null,
  retail_price numeric not null,
  date date not null,
  created_at timestamptz not null default now(),
  constraint uq_market_price unique (commodity, market, date)
);

create index if not exists idx_market_prices on public.market_prices (commodity, market, date desc);

-- ==============================================================================
-- 9. EVENT OUTBOX (Kafka / Event-driven Architecture)
-- ==============================================================================
create table if not exists public.event_outbox (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  aggregate_type text not null,
  aggregate_id text not null,
  payload jsonb not null,
  status text not null default 'PENDING',
  retry_count integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists idx_event_outbox_status on public.event_outbox (status, created_at);

-- ==============================================================================
-- 10. ATOMIC TRANSACTION FUNCTIONS (Postgres RPC)
-- ==============================================================================
create or replace function public.record_retailer_sale(
  p_retailer_id uuid,
  p_inventory_id uuid,
  p_quantity_sold numeric,
  p_price_per_unit numeric
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_inv record;
  v_sale_id uuid;
  v_rem_qty numeric;
  v_new_status text;
begin
  select * into v_inv
  from public.retailer_inventory
  where id = p_inventory_id and retailer_id = p_retailer_id
  for update;

  if not found then
    raise exception 'INVENTORY_NOT_FOUND: Inventory record % not found for retailer %', p_inventory_id, p_retailer_id;
  end if;

  if v_inv.quantity < p_quantity_sold then
    raise exception 'INSUFFICIENT_STOCK: Requested % but only % available', p_quantity_sold, v_inv.quantity;
  end if;

  v_rem_qty := v_inv.quantity - p_quantity_sold;
  v_new_status := case when v_rem_qty = 0 then 'SOLD_OUT' else 'AVAILABLE' end;

  update public.retailer_inventory
  set quantity = v_rem_qty, status = v_new_status, updated_at = now()
  where id = p_inventory_id;

  insert into public.retailer_sales (
    retailer_id, inventory_id, batch_number, product_id,
    quantity_sold, price_per_unit, total_amount, sale_date
  ) values (
    p_retailer_id, p_inventory_id, v_inv.batch_number, v_inv.product_id,
    p_quantity_sold, p_price_per_unit, (p_quantity_sold * p_price_per_unit), now()
  ) returning id into v_sale_id;

  return jsonb_build_object(
    'sale_id', v_sale_id,
    'remaining_quantity', v_rem_qty,
    'status', v_new_status
  );
end;
$$;

-- ==============================================================================
-- 11. AUTOMATIC UPDATED_AT TRIGGERS
-- ==============================================================================
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create or replace trigger trg_users_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

create or replace trigger trg_products_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

create or replace trigger trg_product_requests_updated_at
  before update on public.product_requests
  for each row execute function public.set_updated_at();

create or replace trigger trg_shipments_updated_at
  before update on public.shipments
  for each row execute function public.set_updated_at();

create or replace trigger trg_retailer_inventory_updated_at
  before update on public.retailer_inventory
  for each row execute function public.set_updated_at();

-- ==============================================================================
-- 12. ROW LEVEL SECURITY (RLS)
-- ==============================================================================
alter table public.users enable row level security;
alter table public.products enable row level security;
alter table public.product_requests enable row level security;
alter table public.shipments enable row level security;
alter table public.retailer_inventory enable row level security;
alter table public.retailer_sales enable row level security;
alter table public.retailer_wastage enable row level security;
alter table public.retailer_returns enable row level security;
alter table public.traceability_events enable row level security;
alter table public.batch_lineage enable row level security;
alter table public.notifications enable row level security;
alter table public.market_prices enable row level security;
alter table public.event_outbox enable row level security;

-- ==============================================================================
-- 13. DEMO SEED ACCOUNTS (Password: 12345678 for all accounts)
-- ==============================================================================
insert into public.users (name, email, password, role) values
  ('Farmer Ramesh', 'farmer@gmail.com', '$2b$10$.FoHaB0SBK4ompzhJvEYUuwByOzYWG7lMllEDb2LQEpq97Obm4n5G', 'farmer'),
  ('Admin Superuser', 'admin@gmail.com', '$2b$10$.FoHaB0SBK4ompzhJvEYUuwByOzYWG7lMllEDb2LQEpq97Obm4n5G', 'admin'),
  ('Processor Agro Foods', 'processor@gmail.com', '$2b$10$.FoHaB0SBK4ompzhJvEYUuwByOzYWG7lMllEDb2LQEpq97Obm4n5G', 'processor'),
  ('Distributor Swift Logistics', 'distributor@gmail.com', '$2b$10$.FoHaB0SBK4ompzhJvEYUuwByOzYWG7lMllEDb2LQEpq97Obm4n5G', 'distributor'),
  ('Retailer FreshMart', 'retailer@gmail.com', '$2b$10$.FoHaB0SBK4ompzhJvEYUuwByOzYWG7lMllEDb2LQEpq97Obm4n5G', 'retailer'),
  ('Consumer Ananya', 'consumer@gmail.com', '$2b$10$.FoHaB0SBK4ompzhJvEYUuwByOzYWG7lMllEDb2LQEpq97Obm4n5G', 'consumer')
on conflict (email) do nothing;


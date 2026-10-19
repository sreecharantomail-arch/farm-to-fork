-- Supabase Migration: 06_cold_chain_and_route_optimization.sql
-- Additive migration for Cold-Chain Monitoring, Food Safety Thresholds, Alerts, and Intelligent Route Optimization

-- 1. Cold Chain Food Safety Thresholds Table
CREATE TABLE IF NOT EXISTS public.cold_chain_thresholds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  category text,
  min_temperature numeric NOT NULL,
  max_temperature numeric NOT NULL,
  warning_tolerance_temp numeric NOT NULL DEFAULT 1.5,
  min_humidity numeric CHECK (min_humidity IS NULL OR (min_humidity >= 0 AND min_humidity <= 100)),
  max_humidity numeric CHECK (max_humidity IS NULL OR (max_humidity >= 0 AND max_humidity <= 100)),
  unit text NOT NULL DEFAULT '°C',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_threshold_product_or_category UNIQUE (product_id, category),
  CONSTRAINT chk_threshold_temp_range CHECK (max_temperature >= min_temperature)
);

CREATE INDEX IF NOT EXISTS idx_thresholds_category ON public.cold_chain_thresholds (category);
CREATE INDEX IF NOT EXISTS idx_thresholds_product ON public.cold_chain_thresholds (product_id);

-- 2. Cold Chain Condition Readings Table
CREATE TABLE IF NOT EXISTS public.cold_chain_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  batch_number text,
  temperature numeric NOT NULL,
  temperature_unit text NOT NULL DEFAULT '°C',
  humidity numeric CHECK (humidity IS NULL OR (humidity >= 0 AND humidity <= 100)),
  source text NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL', 'SENSOR', 'EXTERNAL')),
  recorded_by uuid REFERENCES public.users(id),
  notes text,
  measured_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_readings_shipment ON public.cold_chain_readings (shipment_id, measured_at DESC);
CREATE INDEX IF NOT EXISTS idx_readings_batch ON public.cold_chain_readings (batch_number);

-- 3. Cold Chain Alerts Table
CREATE TABLE IF NOT EXISTS public.cold_chain_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  reading_id uuid REFERENCES public.cold_chain_readings(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  batch_number text,
  alert_type text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('WARNING', 'CRITICAL')),
  observed_temperature numeric,
  observed_humidity numeric,
  expected_min_temp numeric,
  expected_max_temp numeric,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ACKNOWLEDGED', 'RESOLVED')),
  detected_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid REFERENCES public.users(id),
  resolution_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cold_alerts_shipment ON public.cold_chain_alerts (shipment_id, status);
CREATE INDEX IF NOT EXISTS idx_cold_alerts_status ON public.cold_chain_alerts (status);

-- 4. Geographic Location Attributes on Users (Additive)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS latitude numeric;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS longitude numeric;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS city text;

-- 5. Route Plans Table
CREATE TABLE IF NOT EXISTS public.route_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  distributor_id uuid NOT NULL REFERENCES public.users(id),
  plan_name text NOT NULL,
  status text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'DISPATCHED', 'COMPLETED', 'CANCELLED')),
  vehicle_capacity numeric NOT NULL DEFAULT 500,
  total_weight_units numeric NOT NULL DEFAULT 0,
  capacity_utilization_pct numeric NOT NULL DEFAULT 0,
  total_distance_km numeric NOT NULL DEFAULT 0,
  baseline_distance_km numeric NOT NULL DEFAULT 0,
  distance_saved_km numeric NOT NULL DEFAULT 0,
  efficiency_improvement_pct numeric NOT NULL DEFAULT 0,
  estimated_duration_min numeric NOT NULL DEFAULT 0,
  origin_address text NOT NULL,
  origin_lat numeric NOT NULL,
  origin_lng numeric NOT NULL,
  routing_engine text NOT NULL DEFAULT 'CONSTRAINED_NEAREST_NEIGHBOR_2OPT',
  shipment_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  ordered_stops jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  dispatched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_route_plans_distributor ON public.route_plans (distributor_id, status);

-- 6. Updated_at triggers
DROP TRIGGER IF EXISTS trg_cold_chain_thresholds_updated_at ON public.cold_chain_thresholds;
CREATE TRIGGER trg_cold_chain_thresholds_updated_at
  BEFORE UPDATE ON public.cold_chain_thresholds
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_cold_chain_alerts_updated_at ON public.cold_chain_alerts;
CREATE TRIGGER trg_cold_chain_alerts_updated_at
  BEFORE UPDATE ON public.cold_chain_alerts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_route_plans_updated_at ON public.route_plans;
CREATE TRIGGER trg_route_plans_updated_at
  BEFORE UPDATE ON public.route_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 7. Row Level Security
ALTER TABLE public.cold_chain_thresholds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cold_chain_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cold_chain_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.route_plans ENABLE ROW LEVEL SECURITY;

-- 8. Seed Standard Baseline Agricultural Thresholds (If not already present)
INSERT INTO public.cold_chain_thresholds (category, min_temperature, max_temperature, warning_tolerance_temp, min_humidity, max_humidity, notes)
VALUES
  ('Fruits', 2.0, 8.0, 1.5, 85, 95, 'General fresh produce storage standards'),
  ('Vegetables', 1.0, 6.0, 1.5, 90, 98, 'Crisper leaf and root vegetable standards'),
  ('Dairy', 0.0, 4.0, 1.0, 65, 80, 'Strict dairy pasteurization & storage limits'),
  ('Meat', -2.0, 2.0, 1.0, 70, 85, 'Chilled fresh meat standards'),
  ('Seafood', -1.0, 2.0, 1.0, 80, 90, 'Chilled fresh seafood on ice standards'),
  ('Processed Food', 4.0, 12.0, 2.0, 50, 75, 'Packaged juices, sauces, semi-perishables'),
  ('Frozen', -22.0, -18.0, 2.0, NULL, NULL, 'Standard deep freeze storage')
ON CONFLICT (product_id, category) DO NOTHING;

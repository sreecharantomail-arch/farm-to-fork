export interface IColdChainThreshold {
  id?: string;
  product_id?: string | null;
  category: string;
  min_temperature: number;
  max_temperature: number;
  warning_tolerance_temp: number;
  min_humidity?: number | null;
  max_humidity?: number | null;
  unit: string;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

export type ConditionStatus = 'NORMAL' | 'WARNING' | 'CRITICAL' | 'UNAVAILABLE';

export interface IColdChainReading {
  id?: string;
  shipment_id: string;
  product_id?: string | null;
  batch_number?: string | null;
  temperature: number;
  temperature_unit: string;
  humidity?: number | null;
  source: 'MANUAL' | 'SENSOR' | 'EXTERNAL';
  recorded_by?: string | null;
  notes?: string | null;
  measured_at: string;
  created_at?: string;
}

export interface IColdChainAlert {
  id?: string;
  shipment_id: string;
  reading_id?: string | null;
  product_id?: string | null;
  batch_number?: string | null;
  alert_type: string;
  severity: 'WARNING' | 'CRITICAL';
  observed_temperature?: number | null;
  observed_humidity?: number | null;
  expected_min_temp?: number | null;
  expected_max_temp?: number | null;
  status: 'ACTIVE' | 'ACKNOWLEDGED' | 'RESOLVED';
  detected_at?: string;
  acknowledged_at?: string | null;
  acknowledged_by?: string | null;
  resolution_notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface IRouteStop {
  stop_number: number;
  shipment_id: string;
  tracking_id: string;
  batch_number: string;
  product_name: string;
  retailer_id: string;
  retailer_name: string;
  address: string;
  city: string;
  latitude: number;
  longitude: number;
  quantity: number;
  unit: string;
  leg_distance_km: number;
  cumulative_distance_km: number;
  estimated_travel_minutes: number;
  estimated_arrival_minutes_from_depot: number;
  expiry_date?: string | null;
  is_expiry_critical?: boolean;
}

export interface IRoutePlan {
  id?: string;
  distributor_id: string;
  plan_name: string;
  status: 'PLANNED' | 'DISPATCHED' | 'COMPLETED' | 'CANCELLED';
  vehicle_capacity: number;
  total_weight_units: number;
  capacity_utilization_pct: number;
  total_distance_km: number;
  baseline_distance_km: number;
  distance_saved_km: number;
  efficiency_improvement_pct: number;
  estimated_duration_min: number;
  origin_address: string;
  origin_lat: number;
  origin_lng: number;
  routing_engine: string;
  shipment_ids: string[];
  ordered_stops: IRouteStop[];
  notes?: string | null;
  dispatched_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

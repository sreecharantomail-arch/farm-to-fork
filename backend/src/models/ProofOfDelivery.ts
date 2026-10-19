export interface IProofOfDelivery {
  id: string;
  shipment_id: string;
  distributor_id: string;
  retailer_id: string;
  recipient_name: string;
  quantity_delivered: number;
  unit: string;
  delivery_notes?: string | null;
  photo_url?: string | null;
  status: 'SUBMITTED' | 'ACKNOWLEDGED' | 'DISPUTED';
  discrepancy_reason?: string | null;
  discrepancy_notes?: string | null;
  submitted_at: string;
  acknowledged_at?: string | null;
  acknowledged_by?: string | null;
  created_at: string;
  updated_at: string;
}

import { supabase } from '../config/supabase';
import crypto from 'crypto';
import {
  IColdChainThreshold,
  IColdChainReading,
  IColdChainAlert,
  ConditionStatus
} from '../models/ColdChain';

export interface RecordReadingInput {
  shipment_id: string;
  temperature: number;
  temperature_unit?: string;
  humidity?: number | null;
  measured_at: string;
  source?: 'MANUAL' | 'SENSOR' | 'EXTERNAL';
  notes?: string | null;
}

export class ColdChainService {
  /**
   * Fetch applicable food safety storage threshold.
   * Checks for specific product_id override first, then falls back to product category.
   */
  async getThreshold(productId?: string | null, category?: string | null): Promise<IColdChainThreshold | null> {
    if (productId) {
      const { data: prodThreshold } = await supabase
        .from('cold_chain_thresholds')
        .select('*')
        .eq('product_id', productId)
        .maybeSingle();

      if (prodThreshold) return prodThreshold;
    }

    if (category) {
      const { data: catThreshold } = await supabase
        .from('cold_chain_thresholds')
        .select('*')
        .eq('category', category)
        .maybeSingle();

      if (catThreshold) return catThreshold;
    }

    return null;
  }

  /**
   * Evaluate a temperature & humidity measurement against product threshold
   */
  evaluateMeasurement(
    temp: number,
    humidity: number | null | undefined,
    threshold: IColdChainThreshold | null
  ): {
    condition: ConditionStatus;
    alertsToCreate: Array<{
      alert_type: string;
      severity: 'WARNING' | 'CRITICAL';
      observed_temp: number;
      observed_humidity: number | null;
    }>;
  } {
    if (!threshold) {
      return { condition: 'UNAVAILABLE', alertsToCreate: [] };
    }

    const alerts: Array<{
      alert_type: string;
      severity: 'WARNING' | 'CRITICAL';
      observed_temp: number;
      observed_humidity: number | null;
    }> = [];

    let hasCritical = false;
    let hasWarning = false;

    const minTemp = Number(threshold.min_temperature);
    const maxTemp = Number(threshold.max_temperature);
    const tolerance = Number(threshold.warning_tolerance_temp || 1.5);

    // Temperature Evaluation
    if (temp > maxTemp + tolerance) {
      hasCritical = true;
      alerts.push({
        alert_type: 'TEMPERATURE_EXCURSION_HIGH',
        severity: 'CRITICAL',
        observed_temp: temp,
        observed_humidity: humidity ?? null
      });
    } else if (temp < minTemp - tolerance) {
      hasCritical = true;
      alerts.push({
        alert_type: 'TEMPERATURE_EXCURSION_LOW',
        severity: 'CRITICAL',
        observed_temp: temp,
        observed_humidity: humidity ?? null
      });
    } else if (temp > maxTemp) {
      hasWarning = true;
      alerts.push({
        alert_type: 'TEMPERATURE_WARNING_HIGH',
        severity: 'WARNING',
        observed_temp: temp,
        observed_humidity: humidity ?? null
      });
    } else if (temp < minTemp) {
      hasWarning = true;
      alerts.push({
        alert_type: 'TEMPERATURE_WARNING_LOW',
        severity: 'WARNING',
        observed_temp: temp,
        observed_humidity: humidity ?? null
      });
    }

    // Relative Humidity Evaluation (if configured)
    if (humidity !== undefined && humidity !== null) {
      if (threshold.max_humidity !== null && threshold.max_humidity !== undefined && humidity > Number(threshold.max_humidity)) {
        hasWarning = true;
        alerts.push({
          alert_type: 'HUMIDITY_EXCURSION_HIGH',
          severity: 'WARNING',
          observed_temp: temp,
          observed_humidity: humidity
        });
      } else if (threshold.min_humidity !== null && threshold.min_humidity !== undefined && humidity < Number(threshold.min_humidity)) {
        hasWarning = true;
        alerts.push({
          alert_type: 'HUMIDITY_EXCURSION_LOW',
          severity: 'WARNING',
          observed_temp: temp,
          observed_humidity: humidity
        });
      }
    }

    const condition: ConditionStatus = hasCritical ? 'CRITICAL' : hasWarning ? 'WARNING' : 'NORMAL';
    return { condition, alertsToCreate: alerts };
  }

  /**
   * Validate and record a cold chain reading for a shipment
   */
  async recordReading(input: RecordReadingInput, actorId: string): Promise<{
    reading: IColdChainReading;
    condition: ConditionStatus;
    threshold: IColdChainThreshold | null;
    createdAlerts: IColdChainAlert[];
  }> {
    // 1. Numeric validation
    if (typeof input.temperature !== 'number' || isNaN(input.temperature)) {
      throw new Error('Temperature must be a valid number');
    }

    if (input.temperature < -50 || input.temperature > 80) {
      throw new Error('Temperature reading is out of realistic agricultural physical bounds (-50°C to 80°C)');
    }

    if (input.humidity !== undefined && input.humidity !== null) {
      if (typeof input.humidity !== 'number' || isNaN(input.humidity) || input.humidity < 0 || input.humidity > 100) {
        throw new Error('Relative humidity must be a valid percentage between 0 and 100%');
      }
    }

    // 2. Timestamp validation (Disallow future timestamps with 60s tolerance for clock drift)
    const measuredDate = new Date(input.measured_at);
    if (isNaN(measuredDate.getTime())) {
      throw new Error('Invalid measurement timestamp');
    }

    const nowWithBuffer = Date.now() + 60 * 1000;
    if (measuredDate.getTime() > nowWithBuffer) {
      throw new Error('Measurement timestamp cannot be in the future');
    }

    // 3. Fetch shipment details
    const { data: shipment, error: shipErr } = await supabase
      .from('shipments')
      .select('*, product:product_id(id, name, category, batch_number)')
      .eq('id', input.shipment_id)
      .single();

    if (shipErr || !shipment) {
      throw new Error('Shipment not found');
    }

    const product = shipment.product || {};
    const category = product.category || 'General';

    // 4. Threshold Lookup & Evaluation
    const threshold = await this.getThreshold(shipment.product_id, category);
    const { condition, alertsToCreate } = this.evaluateMeasurement(
      input.temperature,
      input.humidity,
      threshold
    );

    // 5. Normalize source to check constraint ('MANUAL', 'SENSOR', 'EXTERNAL')
    let normalizedSource: 'MANUAL' | 'SENSOR' | 'EXTERNAL' = 'MANUAL';
    const sUpper = (input.source || '').toUpperCase();
    if (sUpper.includes('SENSOR') || sUpper.includes('IOT') || sUpper.includes('GATEWAY')) {
      normalizedSource = 'SENSOR';
    } else if (sUpper.includes('EXT')) {
      normalizedSource = 'EXTERNAL';
    } else {
      normalizedSource = 'MANUAL';
    }

    // Insert Reading
    const { data: reading, error: readErr } = await supabase
      .from('cold_chain_readings')
      .insert({
        shipment_id: shipment.id,
        product_id: shipment.product_id,
        batch_number: shipment.batch_number,
        temperature: input.temperature,
        temperature_unit: input.temperature_unit || '°C',
        humidity: input.humidity ?? null,
        source: normalizedSource,
        recorded_by: actorId,
        notes: input.notes?.trim() || null,
        measured_at: measuredDate.toISOString()
      })
      .select()
      .single();

    if (readErr || !reading) {
      throw new Error(`Failed to persist reading: ${readErr?.message || 'Database error'}`);
    }

    // 6. Handle Alerts (Prevent duplicate unresolved alerts for the same condition)
    const createdAlerts: IColdChainAlert[] = [];

    for (const a of alertsToCreate) {
      // Check if an ACTIVE or ACKNOWLEDGED alert already exists for this shipment and alert_type
      const { data: existingAlert } = await supabase
        .from('cold_chain_alerts')
        .select('id, status')
        .eq('shipment_id', shipment.id)
        .eq('alert_type', a.alert_type)
        .in('status', ['ACTIVE', 'ACKNOWLEDGED'])
        .maybeSingle();

      if (!existingAlert) {
        const { data: newAlert } = await supabase
          .from('cold_chain_alerts')
          .insert({
            shipment_id: shipment.id,
            reading_id: reading.id,
            product_id: shipment.product_id,
            batch_number: shipment.batch_number,
            alert_type: a.alert_type,
            severity: a.severity,
            observed_temperature: a.observed_temp,
            observed_humidity: a.observed_humidity,
            expected_min_temp: threshold ? Number(threshold.min_temperature) : null,
            expected_max_temp: threshold ? Number(threshold.max_temperature) : null,
            status: 'ACTIVE'
          })
          .select()
          .single();

        if (newAlert) {
          createdAlerts.push(newAlert);

          // Insert Traceability Event
          await supabase.from('traceability_events').insert({
            product_id: shipment.product_id,
            batch_number: shipment.batch_number,
            event_type: 'COLD_CHAIN_ALERT',
            actor_id: actorId,
            location: 'In Transit',
            metadata: {
              shipment_id: shipment.id,
              reading_id: reading.id,
              severity: a.severity,
              alert_type: a.alert_type,
              temperature: a.observed_temp,
              humidity: a.observed_humidity,
              threshold_min: threshold?.min_temperature,
              threshold_max: threshold?.max_temperature
            }
          });

          // Insert Kafka Event Outbox
          await supabase.from('event_outbox').insert({
            event_id: crypto.randomUUID(),
            event_type: 'COLD_CHAIN_ALERT',
            topic: 'quality-alerts',
            payload: {
              alert_id: newAlert.id,
              shipment_id: shipment.id,
              batch_number: shipment.batch_number,
              severity: a.severity,
              temperature: a.observed_temp
            }
          });
        }
      }
    }

    // Traceability event for reading
    await supabase.from('traceability_events').insert({
      product_id: shipment.product_id,
      batch_number: shipment.batch_number,
      event_type: 'COLD_CHAIN_READING',
      actor_id: actorId,
      location: 'In Transit',
      metadata: {
        shipment_id: shipment.id,
        temperature: input.temperature,
        humidity: input.humidity,
        condition,
        source: input.source || 'MANUAL'
      }
    });

    return {
      reading,
      condition,
      threshold,
      createdAlerts
    };
  }

  /**
   * Get complete condition history and current status for a shipment
   */
  async getShipmentConditionSummary(shipmentId: string): Promise<{
    shipment_id: string;
    status: ConditionStatus;
    condition_status: ConditionStatus;
    threshold: IColdChainThreshold | null;
    latest_reading: IColdChainReading | null;
    readings: IColdChainReading[];
    alerts: IColdChainAlert[];
    active_alerts: IColdChainAlert[];
    resolved_alerts: IColdChainAlert[];
    total_violations_count: number;
  }> {
    const { data: shipment } = await supabase
      .from('shipments')
      .select('id, product_id, batch_number, product:product_id(category)')
      .eq('id', shipmentId)
      .single();

    if (!shipment) {
      throw new Error('Shipment not found');
    }

    const category = (shipment.product as any)?.category || null;
    const threshold = await this.getThreshold(shipment.product_id, category);

    // Fetch readings
    const { data: readings } = await supabase
      .from('cold_chain_readings')
      .select('*')
      .eq('shipment_id', shipmentId)
      .order('measured_at', { ascending: false })
      .limit(100);

    const readingList = readings || [];
    const latestReading = readingList.length > 0 ? readingList[0] : null;

    // Fetch alerts
    const { data: allAlerts } = await supabase
      .from('cold_chain_alerts')
      .select('*')
      .eq('shipment_id', shipmentId)
      .order('detected_at', { ascending: false });

    const activeAlerts = (allAlerts || []).filter(a => a.status === 'ACTIVE' || a.status === 'ACKNOWLEDGED');
    const resolvedAlerts = (allAlerts || []).filter(a => a.status === 'RESOLVED');

    let conditionStatus: ConditionStatus = 'UNAVAILABLE';
    if (!threshold) {
      conditionStatus = 'UNAVAILABLE';
    } else if (!latestReading) {
      conditionStatus = 'UNAVAILABLE';
    } else {
      const evaluation = this.evaluateMeasurement(
        Number(latestReading.temperature),
        latestReading.humidity !== null ? Number(latestReading.humidity) : null,
        threshold
      );
      // If there are any un-resolved CRITICAL alerts, keep condition flagged as CRITICAL
      const hasActiveCritical = activeAlerts.some(a => a.severity === 'CRITICAL');
      conditionStatus = hasActiveCritical ? 'CRITICAL' : evaluation.condition;
    }

    return {
      shipment_id: shipmentId,
      status: conditionStatus,
      condition_status: conditionStatus,
      threshold,
      latest_reading: latestReading,
      readings: readingList,
      alerts: allAlerts || [],
      active_alerts: activeAlerts,
      resolved_alerts: resolvedAlerts,
      total_violations_count: (allAlerts || []).length
    };
  }

  /**
   * Acknowledge an alert
   */
  async acknowledgeAlert(alertId: string, actorId: string, notes?: string): Promise<IColdChainAlert> {
    const { data: alert, error } = await supabase
      .from('cold_chain_alerts')
      .update({
        status: 'ACKNOWLEDGED',
        acknowledged_at: new Date().toISOString(),
        acknowledged_by: actorId,
        resolution_notes: notes ? `ACKNOWLEDGED: ${notes}` : null,
        updated_at: new Date().toISOString()
      })
      .eq('id', alertId)
      .select()
      .single();

    if (error || !alert) {
      throw new Error(error?.message || 'Failed to acknowledge alert');
    }
    return alert;
  }

  /**
   * Resolve an alert with resolution notes
   */
  async resolveAlert(alertId: string, actorId: string, resolutionNotes: string): Promise<IColdChainAlert> {
    if (!resolutionNotes || !resolutionNotes.trim()) {
      throw new Error('Resolution notes are required to resolve a cold-chain alert');
    }

    const { data: alert, error } = await supabase
      .from('cold_chain_alerts')
      .update({
        status: 'RESOLVED',
        resolution_notes: resolutionNotes.trim(),
        updated_at: new Date().toISOString()
      })
      .eq('id', alertId)
      .select()
      .single();

    if (error || !alert) {
      throw new Error(error?.message || 'Failed to resolve alert');
    }
    return alert;
  }
}

export const coldChainService = new ColdChainService();

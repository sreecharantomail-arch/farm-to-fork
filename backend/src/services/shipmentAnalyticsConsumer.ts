import { EachMessagePayload } from 'kafkajs';
import { BaseKafkaConsumer, BaseConsumerConfig, KafkaMessageEnvelope } from './baseKafkaConsumer';

export type ShipmentEventType =
  | 'DELIVERY_PROOF_SUBMITTED'
  | 'SHIPMENT_RECEIVED'
  | 'DELIVERY_DISPUTED';

export interface ShipmentConsumerConfig extends Partial<BaseConsumerConfig> {
  isTestMode?: boolean;
  topic?: string;
}

/**
 * ShipmentAnalyticsConsumer
 *
 * Consumes events from 'shipment-events' (or 'test-diagnostic-events' in test mode)
 * to build an additive read-model projection of shipment lifecycle and delivery performance.
 *
 * Invariants:
 * - NEVER mutates core business tables (shipments, proof_of_delivery, products, etc.).
 * - Never repeats delivery acknowledgements or receipt operations.
 * - Idempotently records processed events inside an atomic PostgreSQL function.
 * - Routes unsupported, corrupted, or schema-violating messages to dead-letter-events.
 * - Default state is DISABLED. Must be explicitly enabled to run.
 */
export class ShipmentAnalyticsConsumer extends BaseKafkaConsumer {
  public readonly isTestMode: boolean;
  public readonly topic: string;

  constructor(config: ShipmentConsumerConfig = {}) {
    const isTestMode = config.isTestMode ?? false;
    const defaultGroup = isTestMode
      ? 'farmchain-shipment-test-consumer'
      : 'farmchain-shipment-analytics-consumer';

    super({
      groupId: config.groupId || defaultGroup,
      clientId: config.clientId || (isTestMode ? 'farmchain-shipment-test-client' : 'farmchain-shipment-analytics-worker'),
      brokers: config.brokers,
      dlqTopic: config.dlqTopic || 'dead-letter-events',
      dbPool: config.dbPool,
      // Strictly disabled by default unless explicitly configured true
      enabled: config.enabled ?? false,
      fromBeginning: config.fromBeginning ?? true,
    });

    this.isTestMode = isTestMode;

    // Safety guard: Test mode must NEVER subscribe to business topics
    if (this.isTestMode && config.topic && config.topic !== 'test-diagnostic-events') {
      throw new Error(`SAFETY VIOLATION: Test mode consumer cannot subscribe to business topic '${config.topic}'`);
    }

    // In test mode: strictly restricted to test-diagnostic-events
    // In business mode: strictly shipment-events
    this.topic = isTestMode ? 'test-diagnostic-events' : (config.topic || 'shipment-events');
  }

  /**
   * Topics subscribed by this consumer.
   */
  public getSubscribedTopics(): string[] {
    return [this.topic];
  }

  /**
   * Process individual message envelope.
   */
  public async processMessage(
    envelope: KafkaMessageEnvelope,
    rawPayload: EachMessagePayload
  ): Promise<{ success: boolean; duplicate?: boolean; error?: string }> {
    const { topic } = rawPayload;

    // Safety check: In test mode, reject any message that does not declare test intent
    if (this.isTestMode) {
      const isTestMessage =
        envelope.event_type.startsWith('TEST_') ||
        envelope.payload?.test === true ||
        envelope.payload?.smoke_test === true ||
        envelope.payload?.shipment_id?.startsWith('test-') ||
        envelope.payload?.batch_id?.startsWith('test-');

      if (!isTestMessage) {
        return {
          success: false,
          error: `Test mode consumer rejected non-test event ${envelope.event_id} (type: ${envelope.event_type})`,
        };
      }
    }

    // Map test event types to standard canonical types for simulation
    const canonicalEventType = this.normalizeEventType(envelope.event_type);

    // Validate event type support
    if (!this.isSupportedEventType(canonicalEventType)) {
      return {
        success: false,
        error: `Unsupported event_type '${envelope.event_type}' for shipment analytics consumer`,
      };
    }

    // Validate required payload fields per event type
    const payloadValidationError = this.validatePayload(canonicalEventType, envelope.payload);
    if (payloadValidationError) {
      return {
        success: false,
        error: `Schema validation failed for ${canonicalEventType}: ${payloadValidationError}`,
      };
    }

    // Normalize payload to canonical field names
    const normalizedPayload = this.normalizePayload(canonicalEventType, envelope.payload);

    // Execute atomic PostgreSQL function:
    // Writes projection, logs event index, and updates processed_events in a single atomic transaction
    try {
      const dbResult = await this.dbPool.query(
        `SELECT public.record_shipment_projection($1, $2, $3, $4, $5, $6, $7) as result;`,
        [
          envelope.event_id,
          topic,
          this.groupId,
          canonicalEventType,
          envelope.event_timestamp ? new Date(envelope.event_timestamp) : new Date(),
          envelope.source,
          JSON.stringify(normalizedPayload),
        ]
      );

      const result = dbResult.rows[0]?.result;
      if (!result || !result.success) {
        return {
          success: false,
          error: result?.error || result?.message || 'Database projection transaction returned unsuccessful',
        };
      }

      return {
        success: true,
        duplicate: result.duplicate === true,
      };
    } catch (dbErr: any) {
      // Re-throw database / connection errors as transient so Kafka re-polls
      throw new Error(`Database transaction failed for event ${envelope.event_id}: ${dbErr.message}`);
    }
  }

  /**
   * Normalize event types (maps TEST_DELIVERY_PROOF_SUBMITTED -> DELIVERY_PROOF_SUBMITTED in test mode).
   */
  public normalizeEventType(eventType: string): string {
    if (this.isTestMode && eventType.startsWith('TEST_')) {
      const stripped = eventType.replace(/^TEST_/, '');
      if (['DELIVERY_PROOF_SUBMITTED', 'SHIPMENT_RECEIVED', 'DELIVERY_DISPUTED'].includes(stripped)) {
        return stripped;
      }
    }
    return eventType;
  }

  /**
   * Verify supported event types.
   */
  public isSupportedEventType(eventType: string): boolean {
    return ['DELIVERY_PROOF_SUBMITTED', 'SHIPMENT_RECEIVED', 'DELIVERY_DISPUTED'].includes(eventType);
  }

  /**
   * Event-specific payload schema validation.
   * Accepts canonical producer payloads as well as unambiguous documented variations.
   */
  public validatePayload(eventType: string, payload: any): string | null {
    if (!payload || typeof payload !== 'object') {
      return 'Payload must be a JSON object';
    }

    if (!payload.shipment_id || typeof payload.shipment_id !== 'string' || payload.shipment_id.trim().length === 0) {
      return 'Missing required field: shipment_id';
    }

    if (!payload.batch_id || typeof payload.batch_id !== 'string' || payload.batch_id.trim().length === 0) {
      return 'Missing required field: batch_id';
    }

    if (!payload.retailer_id || typeof payload.retailer_id !== 'string' || payload.retailer_id.trim().length === 0) {
      return 'Missing required field: retailer_id';
    }

    switch (eventType) {
      case 'DELIVERY_PROOF_SUBMITTED': {
        const qty = payload.quantity_delivered !== undefined
          ? payload.quantity_delivered
          : (payload.quantity !== undefined ? payload.quantity : payload.delivered_quantity);
        if (qty === undefined || qty === null || isNaN(Number(qty)) || Number(qty) <= 0) {
          return 'Missing or invalid numeric field: quantity_delivered (must be positive number)';
        }
        if (!payload.pod_id || typeof payload.pod_id !== 'string' || payload.pod_id.trim().length === 0) {
          return 'Missing required field: pod_id';
        }
        if (payload.distributor_id !== undefined && payload.distributor_id !== null) {
          if (typeof payload.distributor_id !== 'string' || payload.distributor_id.trim().length === 0) {
            return 'Invalid field: distributor_id must be a non-empty string when provided';
          }
        }
        break;
      }

      case 'SHIPMENT_RECEIVED': {
        const qty = payload.quantity !== undefined
          ? payload.quantity
          : (payload.quantity_delivered !== undefined ? payload.quantity_delivered : payload.delivered_quantity);
        if (qty === undefined || qty === null || isNaN(Number(qty)) || Number(qty) <= 0) {
          return 'Missing or invalid numeric field: quantity (must be positive number)';
        }
        if (payload.pod_id !== undefined && payload.pod_id !== null) {
          if (typeof payload.pod_id !== 'string' || payload.pod_id.trim().length === 0) {
            return 'Invalid field: pod_id must be a non-empty string when provided';
          }
        }
        break;
      }

      case 'DELIVERY_DISPUTED': {
        if (!payload.reason || typeof payload.reason !== 'string' || payload.reason.trim().length === 0) {
          return 'Missing required field: reason';
        }
        if (payload.notes !== undefined && payload.notes !== null) {
          if (typeof payload.notes !== 'string') {
            return 'Invalid field: notes must be a string when provided';
          }
        }
        break;
      }

      default:
        return `Unsupported event type: ${eventType}`;
    }

    return null;
  }

  /**
   * Normalize payload field names for database projection.
   */
  public normalizePayload(eventType: string, payload: any): Record<string, any> {
    const normalized = { ...payload };

    switch (eventType) {
      case 'DELIVERY_PROOF_SUBMITTED':
        if (normalized.quantity_delivered === undefined) {
          const rawQty = normalized.quantity !== undefined ? normalized.quantity : normalized.delivered_quantity;
          normalized.quantity_delivered = Number(rawQty);
        } else {
          normalized.quantity_delivered = Number(normalized.quantity_delivered);
        }
        break;

      case 'SHIPMENT_RECEIVED':
        if (normalized.quantity === undefined) {
          const rawQty = normalized.quantity_delivered !== undefined ? normalized.quantity_delivered : normalized.delivered_quantity;
          normalized.quantity = Number(rawQty);
        } else {
          normalized.quantity = Number(normalized.quantity);
        }
        break;

      case 'DELIVERY_DISPUTED':
        // reason, notes preserved as is
        break;
    }

    return normalized;
  }

  /**
   * Isolated Cleanup for Test-Only Mode.
   * Cleans up ONLY the specific test record created by a test run.
   */
  public async cleanupTestRecord(testShipmentId: string, testEventId: string): Promise<void> {
    if (!testShipmentId || !testEventId) {
      return;
    }

    // Safety guard: NEVER delete non-test shipment IDs
    if (!testShipmentId.startsWith('test-') && !testShipmentId.startsWith('TEST-')) {
      console.warn(`[ShipmentConsumer] Refused to clean up non-test shipment_id '${testShipmentId}'`);
      return;
    }

    try {
      await this.dbPool.query(
        `DELETE FROM public.shipment_projections WHERE shipment_id = $1;`,
        [testShipmentId]
      );
      await this.dbPool.query(
        `DELETE FROM public.shipment_event_index WHERE shipment_id = $1 OR event_id = $2;`,
        [testShipmentId, testEventId]
      );
      await this.dbPool.query(
        `DELETE FROM public.processed_events WHERE event_id = $1;`,
        [testEventId]
      );
      console.log(`[ShipmentConsumer] [TestCleanup] Cleaned up test shipment '${testShipmentId}' and event '${testEventId}'.`);
    } catch (err: any) {
      console.warn(`[ShipmentConsumer] [TestCleanup] Error during test record cleanup:`, err.message);
    }
  }
}

// Export singleton instance (strictly disabled by default)
export const shipmentAnalyticsConsumer = new ShipmentAnalyticsConsumer({
  enabled: false,
});

import { BaseKafkaConsumer, BaseConsumerConfig, KafkaMessageEnvelope } from './baseKafkaConsumer';
import { EachMessagePayload } from 'kafkajs';

export interface TraceabilityConsumerConfig extends Partial<BaseConsumerConfig> {
  isTestMode?: boolean;
  topic?: string;
}

export type SupportedTraceabilityEventType =
  | 'BATCH_CREATED'
  | 'RETAILER_RECEIVED'
  | 'BLOCKCHAIN_RECORDED';

/**
 * TraceabilityAnalyticsConsumer
 *
 * Consumes events from 'traceability-events' (or 'test-diagnostic-events' in test mode)
 * and maintains an event-driven read projection for supply chain journey tracking,
 * cycle times, and blockchain verification.
 *
 * Invariants:
 * - NEVER mutates core business tables (products, shipments, retailer_inventory, traceability_events).
 * - Never repeats originating mutations.
 * - Idempotently records processed events inside an atomic PostgreSQL function.
 * - Routes unsupported, corrupted, or schema-violating messages to dead-letter-events.
 * - Default state is DISABLED. Must be explicitly enabled to run.
 */
export class TraceabilityAnalyticsConsumer extends BaseKafkaConsumer {
  public readonly isTestMode: boolean;
  public readonly topic: string;

  constructor(config: TraceabilityConsumerConfig = {}) {
    const isTestMode = config.isTestMode ?? false;
    const defaultGroup = isTestMode
      ? 'farmchain-traceability-test-consumer'
      : 'farmchain-traceability-analytics-consumer';

    super({
      groupId: config.groupId || defaultGroup,
      clientId: config.clientId || (isTestMode ? 'farmchain-traceability-test-client' : 'farmchain-traceability-analytics-worker'),
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
    // In business mode: strictly traceability-events
    this.topic = isTestMode ? 'test-diagnostic-events' : (config.topic || 'traceability-events');
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
        error: `Unsupported event_type '${envelope.event_type}' for traceability analytics consumer`,
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

    // Normalize payload to canonical field names (e.g. received_quantity -> quantity, transaction_hash -> tx_hash)
    const normalizedPayload = this.normalizePayload(canonicalEventType, envelope.payload);

    // Execute atomic PostgreSQL function:
    // Writes projection, logs event index, and updates processed_events in a single atomic transaction
    try {
      const dbResult = await this.dbPool.query(
        `SELECT public.record_traceability_projection($1, $2, $3, $4, $5, $6, $7) as result;`,
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
          error: result?.message || 'Database projection transaction returned unsuccessful',
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
   * Normalize event types (maps TEST_BATCH_CREATED -> BATCH_CREATED in test mode).
   */
  public normalizeEventType(eventType: string): string {
    if (this.isTestMode && eventType.startsWith('TEST_')) {
      const stripped = eventType.replace(/^TEST_/, '');
      if (['BATCH_CREATED', 'RETAILER_RECEIVED', 'BLOCKCHAIN_RECORDED'].includes(stripped)) {
        return stripped;
      }
    }
    return eventType;
  }

  /**
   * Verify supported event types.
   */
  public isSupportedEventType(eventType: string): boolean {
    return ['BATCH_CREATED', 'RETAILER_RECEIVED', 'BLOCKCHAIN_RECORDED'].includes(eventType);
  }

  /**
   * Event-specific payload schema validation.
   * Accepts canonical producer payloads as well as unambiguous documented variations.
   */
  public validatePayload(eventType: string, payload: any): string | null {
    if (!payload || typeof payload !== 'object') {
      return 'Payload must be a JSON object';
    }

    if (!payload.batch_id || typeof payload.batch_id !== 'string' || payload.batch_id.trim().length === 0) {
      return 'Missing required field: batch_id';
    }

    switch (eventType) {
      case 'BATCH_CREATED': {
        if (!payload.product_id || typeof payload.product_id !== 'string' || payload.product_id.trim().length === 0) {
          return 'Missing required field: product_id';
        }
        if (!payload.farmer_id || typeof payload.farmer_id !== 'string' || payload.farmer_id.trim().length === 0) {
          return 'Missing required field: farmer_id';
        }
        const qty = payload.quantity !== undefined ? payload.quantity : payload.initial_quantity;
        if (qty === undefined || qty === null || isNaN(Number(qty)) || Number(qty) <= 0) {
          return 'Missing or invalid numeric field: quantity (must be positive number)';
        }
        const status = payload.status || payload.initial_status;
        if (!status || typeof status !== 'string' || status.trim().length === 0) {
          return 'Missing required field: status';
        }
        break;
      }

      case 'RETAILER_RECEIVED': {
        if (!payload.retailer_id || typeof payload.retailer_id !== 'string' || payload.retailer_id.trim().length === 0) {
          return 'Missing required field: retailer_id';
        }
        // Accepts canonical producer field `quantity`, or alias `received_quantity` / `quantity_received`
        const qty = payload.quantity !== undefined
          ? payload.quantity
          : (payload.received_quantity !== undefined ? payload.received_quantity : payload.quantity_received);
        if (qty === undefined || qty === null || isNaN(Number(qty)) || Number(qty) <= 0) {
          return 'Missing or invalid numeric field: quantity (or received_quantity, must be positive number)';
        }
        // shipment_id is optional linkage when present; if provided, must be string
        if (payload.shipment_id !== undefined && payload.shipment_id !== null) {
          if (typeof payload.shipment_id !== 'string' || payload.shipment_id.trim().length === 0) {
            return 'Invalid field: shipment_id must be a non-empty string when provided';
          }
        }
        // condition is historically absent from producers; accepted if provided
        break;
      }

      case 'BLOCKCHAIN_RECORDED': {
        // Accepts canonical producer field `tx_hash`, or alias `transaction_hash` / `blockchain_hash`
        const txHash = payload.tx_hash || payload.transaction_hash || payload.blockchain_hash;
        if (!txHash || typeof txHash !== 'string' || txHash.trim().length === 0) {
          return 'Missing required field: tx_hash (or transaction_hash)';
        }
        if (!txHash.startsWith('0x') && txHash.length < 10) {
          return 'Invalid field: tx_hash must be a valid transaction hash string';
        }
        // event_source is optional metadata context; if provided, must be non-empty string
        if (payload.event_source !== undefined && payload.event_source !== null) {
          if (typeof payload.event_source !== 'string' || payload.event_source.trim().length === 0) {
            return 'Invalid field: event_source must be a non-empty string when provided';
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
   * Maps documented variations to canonical names while preserving all original keys.
   */
  public normalizePayload(eventType: string, payload: any): Record<string, any> {
    const normalized = { ...payload };

    switch (eventType) {
      case 'BATCH_CREATED':
        if (normalized.quantity === undefined && normalized.initial_quantity !== undefined) {
          normalized.quantity = Number(normalized.initial_quantity);
        } else if (normalized.quantity !== undefined) {
          normalized.quantity = Number(normalized.quantity);
        }
        if (!normalized.status && normalized.initial_status) {
          normalized.status = normalized.initial_status;
        }
        break;

      case 'RETAILER_RECEIVED':
        if (normalized.quantity === undefined) {
          const rawQty = normalized.received_quantity !== undefined
            ? normalized.received_quantity
            : normalized.quantity_received;
          normalized.quantity = Number(rawQty);
        } else {
          normalized.quantity = Number(normalized.quantity);
        }
        break;

      case 'BLOCKCHAIN_RECORDED':
        if (!normalized.tx_hash) {
          normalized.tx_hash = normalized.transaction_hash || normalized.blockchain_hash;
        }
        break;
    }

    return normalized;
  }

  /**
   * Isolated Cleanup for Test-Only Mode.
   * Cleans up ONLY the specific test record created by a test run.
   */
  public async cleanupTestRecord(testBatchId: string, testEventId: string): Promise<void> {
    if (!testBatchId || !testEventId) {
      return;
    }

    // Safety guard: NEVER delete non-test batch IDs
    if (!testBatchId.startsWith('test-') && !testBatchId.startsWith('TEST-')) {
      console.warn(`[TraceabilityConsumer] Refused to clean up non-test batch_id '${testBatchId}'`);
      return;
    }

    try {
      await this.dbPool.query('BEGIN;');
      await this.dbPool.query(`DELETE FROM public.traceability_projections WHERE batch_id = $1;`, [testBatchId]);
      await this.dbPool.query(`DELETE FROM public.traceability_event_index WHERE event_id = $1;`, [testEventId]);
      await this.dbPool.query(`DELETE FROM public.processed_events WHERE event_id = $1 AND consumer_group = $2;`, [
        testEventId,
        this.groupId,
      ]);
      await this.dbPool.query('COMMIT;');
      console.log(`[TraceabilityConsumer] [TestCleanup] Cleaned up test batch '${testBatchId}' and event '${testEventId}'.`);
    } catch (err: any) {
      await this.dbPool.query('ROLLBACK;').catch(() => {});
      console.error(`[TraceabilityConsumer] [TestCleanup] Failed to clean up test records:`, err.message);
    }
  }
}

export const traceabilityAnalyticsConsumer = new TraceabilityAnalyticsConsumer();

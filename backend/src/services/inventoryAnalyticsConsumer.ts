import { EachMessagePayload } from 'kafkajs';
import { BaseKafkaConsumer, BaseConsumerConfig, KafkaMessageEnvelope } from './baseKafkaConsumer';

export type InventoryEventType =
  | 'INVENTORY_CREATED'
  | 'SALE_CREATED'
  | 'INVENTORY_UPDATED'
  | 'WASTAGE_RECORDED';

export interface InventoryConsumerConfig extends Partial<BaseConsumerConfig> {
  isTestMode?: boolean;
  topic?: string;
}

/**
 * InventoryAnalyticsConsumer
 *
 * Consumes events from 'inventory-events' (or 'test-diagnostic-events' in test mode)
 * to build an additive read-model projection of inventory stock levels and turnover metrics.
 *
 * Invariants:
 * - NEVER mutates core business tables (retailer_inventory, retailer_sales, retailer_wastage, retailer_returns, shipments, products).
 * - Never repeats stock deductions, sales recordings, or wastage operations.
 * - Idempotently records processed events inside an atomic PostgreSQL function.
 * - Routes unsupported, corrupted, or schema-violating messages to dead-letter-events.
 * - Default state is DISABLED. Must be explicitly enabled to run.
 */
export class InventoryAnalyticsConsumer extends BaseKafkaConsumer {
  public readonly isTestMode: boolean;
  public readonly topic: string;

  constructor(config: InventoryConsumerConfig = {}) {
    const isTestMode = config.isTestMode ?? false;
    const defaultGroup = isTestMode
      ? 'farmchain-inventory-test-consumer'
      : 'farmchain-inventory-analytics-consumer';

    super({
      groupId: config.groupId || defaultGroup,
      clientId: config.clientId || (isTestMode ? 'farmchain-inventory-test-client' : 'farmchain-inventory-analytics-worker'),
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
    // In business mode: strictly inventory-events
    this.topic = isTestMode ? 'test-diagnostic-events' : (config.topic || 'inventory-events');
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
        envelope.payload?.batch_id?.startsWith('test-') ||
        envelope.payload?.batch_id?.startsWith('TEST-') ||
        envelope.payload?.retailer_id?.startsWith('test-') ||
        envelope.payload?.retailer_id?.startsWith('TEST-');

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
        error: `Unsupported event_type '${envelope.event_type}' for inventory analytics consumer`,
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
        `SELECT public.record_inventory_projection($1, $2, $3, $4, $5, $6, $7) as result;`,
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
   * Normalize event types (maps TEST_INVENTORY_CREATED -> INVENTORY_CREATED in test mode).
   */
  public normalizeEventType(eventType: string): string {
    if (this.isTestMode && eventType.startsWith('TEST_')) {
      const stripped = eventType.replace(/^TEST_/, '');
      if (['INVENTORY_CREATED', 'SALE_CREATED', 'INVENTORY_UPDATED', 'WASTAGE_RECORDED'].includes(stripped)) {
        return stripped;
      }
    }
    return eventType;
  }

  /**
   * Verify supported event types.
   */
  public isSupportedEventType(eventType: string): boolean {
    return ['INVENTORY_CREATED', 'SALE_CREATED', 'INVENTORY_UPDATED', 'WASTAGE_RECORDED'].includes(eventType);
  }

  /**
   * Event-specific payload schema validation.
   * Accepts canonical producer payloads as well as unambiguous documented variations.
   */
  public validatePayload(eventType: string, payload: any): string | null {
    if (!payload || typeof payload !== 'object') {
      return 'Payload must be a JSON object';
    }

    if (!payload.retailer_id || typeof payload.retailer_id !== 'string' || payload.retailer_id.trim().length === 0) {
      return 'Missing required field: retailer_id';
    }

    if (!payload.batch_id || typeof payload.batch_id !== 'string' || payload.batch_id.trim().length === 0) {
      return 'Missing required field: batch_id';
    }

    switch (eventType) {
      case 'INVENTORY_CREATED': {
        const qty = payload.quantity !== undefined
          ? payload.quantity
          : (payload.quantity_delivered !== undefined ? payload.quantity_delivered : payload.delivered_quantity);
        if (qty === undefined || qty === null || isNaN(Number(qty)) || Number(qty) <= 0) {
          return 'Missing or invalid numeric field: quantity (must be positive number)';
        }
        if (payload.product_id !== undefined && payload.product_id !== null) {
          if (typeof payload.product_id !== 'string' || payload.product_id.trim().length === 0) {
            return 'Invalid field: product_id must be a non-empty string when provided';
          }
        }
        if (payload.unit !== undefined && payload.unit !== null) {
          if (typeof payload.unit !== 'string' || payload.unit.trim().length === 0) {
            return 'Invalid field: unit must be a non-empty string when provided';
          }
        }
        if (payload.inventory_id !== undefined && payload.inventory_id !== null) {
          if (typeof payload.inventory_id !== 'string' || payload.inventory_id.trim().length === 0) {
            return 'Invalid field: inventory_id must be a non-empty string when provided';
          }
        }
        break;
      }

      case 'SALE_CREATED': {
        const qtySold = payload.quantity_sold !== undefined ? payload.quantity_sold : payload.quantity;
        if (qtySold === undefined || qtySold === null || isNaN(Number(qtySold)) || Number(qtySold) <= 0) {
          return 'Missing or invalid numeric field: quantity_sold (must be positive number)';
        }
        break;
      }

      case 'INVENTORY_UPDATED': {
        const newQty = payload.new_quantity !== undefined ? payload.new_quantity : payload.quantity;
        if (newQty === undefined || newQty === null || isNaN(Number(newQty)) || Number(newQty) < 0) {
          return 'Missing or invalid numeric field: new_quantity (must be non-negative number)';
        }
        if (payload.reason !== undefined && payload.reason !== null) {
          if (typeof payload.reason !== 'string') {
            return 'Invalid field: reason must be a string when provided';
          }
        }
        break;
      }

      case 'WASTAGE_RECORDED': {
        const qtyWasted = payload.quantity_wasted !== undefined ? payload.quantity_wasted : payload.quantity;
        if (qtyWasted === undefined || qtyWasted === null || isNaN(Number(qtyWasted)) || Number(qtyWasted) <= 0) {
          return 'Missing or invalid numeric field: quantity_wasted (must be positive number)';
        }
        if (payload.reason !== undefined && payload.reason !== null) {
          if (typeof payload.reason !== 'string') {
            return 'Invalid field: reason must be a string when provided';
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
      case 'INVENTORY_CREATED':
        if (normalized.quantity === undefined) {
          const rawQty = normalized.quantity_delivered !== undefined ? normalized.quantity_delivered : normalized.delivered_quantity;
          normalized.quantity = Number(rawQty);
        } else {
          normalized.quantity = Number(normalized.quantity);
        }
        normalized.unit = normalized.unit || 'units';
        break;

      case 'SALE_CREATED':
        if (normalized.quantity_sold === undefined) {
          normalized.quantity_sold = Number(normalized.quantity);
        } else {
          normalized.quantity_sold = Number(normalized.quantity_sold);
        }
        break;

      case 'INVENTORY_UPDATED':
        if (normalized.new_quantity === undefined) {
          normalized.new_quantity = Number(normalized.quantity);
        } else {
          normalized.new_quantity = Number(normalized.new_quantity);
        }
        break;

      case 'WASTAGE_RECORDED':
        if (normalized.quantity_wasted === undefined) {
          normalized.quantity_wasted = Number(normalized.quantity);
        } else {
          normalized.quantity_wasted = Number(normalized.quantity_wasted);
        }
        break;
    }

    return normalized;
  }

  /**
   * Isolated Cleanup for Test-Only Mode.
   * Cleans up ONLY the specific test record created by a test run.
   */
  public async cleanupTestRecord(testRetailerId: string, testBatchId: string, testEventId?: string): Promise<void> {
    if (!testRetailerId || !testBatchId) {
      return;
    }

    // Safety guard: NEVER delete non-test IDs
    const isTestRetailer = testRetailerId.startsWith('test-') || testRetailerId.startsWith('TEST-');
    const isTestBatch = testBatchId.startsWith('test-') || testBatchId.startsWith('TEST-');

    if (!isTestRetailer && !isTestBatch) {
      console.warn(`[InventoryConsumer] Refused to clean up non-test retailer '${testRetailerId}' / batch '${testBatchId}'`);
      return;
    }

    try {
      await this.dbPool.query(
        `DELETE FROM public.inventory_projections WHERE retailer_id = $1 AND batch_id = $2;`,
        [testRetailerId, testBatchId]
      );
      if (testEventId) {
        await this.dbPool.query(
          `DELETE FROM public.inventory_event_index WHERE event_id = $1;`,
          [testEventId]
        );
        await this.dbPool.query(
          `DELETE FROM public.processed_events WHERE event_id = $1;`,
          [testEventId]
        );
      } else {
        await this.dbPool.query(
          `DELETE FROM public.inventory_event_index WHERE retailer_id = $1 AND batch_id = $2;`,
          [testRetailerId, testBatchId]
        );
      }
      console.log(`[InventoryConsumer] [TestCleanup] Cleaned up test inventory (${testRetailerId}, ${testBatchId})`);
    } catch (err: any) {
      console.warn(`[InventoryConsumer] [TestCleanup] Error during test record cleanup:`, err.message);
    }
  }
}

// Export singleton instance (strictly disabled by default)
export const inventoryAnalyticsConsumer = new InventoryAnalyticsConsumer({
  enabled: false,
});

import { Kafka, Consumer, Producer, EachMessagePayload } from 'kafkajs';
import crypto from 'crypto';
import pg from 'pg';

export interface BaseConsumerConfig {
  groupId: string;
  brokers?: string[];
  clientId?: string;
  dlqTopic?: string;
  dbPool?: pg.Pool;
  enabled?: boolean;
  fromBeginning?: boolean;
}

export interface KafkaMessageEnvelope {
  event_id: string;
  event_type: string;
  event_version: string;
  event_timestamp: string;
  source: string;
  payload: any;
}

export interface ConsumerHealthStatus {
  groupId: string;
  clientId: string;
  brokers: string[];
  enabled: boolean;
  isRunning: boolean;
  isConnected: boolean;
  processedCount: number;
  duplicateCount: number;
  dlqCount: number;
  lastProcessedAt: string | null;
  lastError: string | null;
}

/**
 * BaseKafkaConsumer
 *
 * Provides a hardened, reusable TypeScript foundation for Kafka consumers in FarmChainAI.
 *
 * Key Guarantees:
 * 1. Delivery Semantics: At-least-once delivery with durable database-backed idempotency.
 * 2. Offset Management: Manual offset committing (autoCommit: false). Offsets are committed
 *    ONLY AFTER durable processing or verified Dead-Letter Queue (DLQ) acknowledgment.
 * 3. Poison Message Handling: Corrupted or unparseable messages are safely published to the DLQ.
 *    The original message offset is committed only once the DLQ broker acknowledges receipt.
 * 4. Transient Fault Tolerance: Database connection or deadlock errors throw without committing,
 *    allowing Kafka re-delivery without data loss.
 */
export abstract class BaseKafkaConsumer {
  public readonly groupId: string;
  public readonly clientId: string;
  public readonly brokers: string[];
  public readonly dlqTopic: string;
  public readonly fromBeginning: boolean;
  public enabled: boolean;

  protected kafka: Kafka;
  protected consumer: Consumer;
  protected dlqProducer: Producer;
  protected dbPool: pg.Pool;

  protected isRunning: boolean = false;
  protected isConnected: boolean = false;
  protected isDlqConnected: boolean = false;
  protected processedCount: number = 0;
  protected duplicateCount: number = 0;
  protected dlqCount: number = 0;
  protected lastProcessedAt: Date | null = null;
  protected lastError: string | null = null;

  constructor(config: BaseConsumerConfig) {
    this.groupId = config.groupId;
    this.clientId = config.clientId || `consumer-${this.groupId}`;
    const rawBrokers = process.env.KAFKA_BOOTSTRAP_SERVERS || 'localhost:9092';
    this.brokers = config.brokers || rawBrokers.split(',').map((b) => b.trim()).filter(Boolean);
    this.dlqTopic = config.dlqTopic || process.env.KAFKA_DEAD_LETTER_TOPIC || 'dead-letter-events';
    this.fromBeginning = config.fromBeginning ?? true;

    // Consumers MUST default to disabled to prevent unintended backlog processing on server boot
    this.enabled = config.enabled ?? false;

    this.kafka = new Kafka({
      clientId: this.clientId,
      brokers: this.brokers,
      retry: {
        initialRetryTime: 300,
        retries: 3,
      },
      connectionTimeout: 4000,
      requestTimeout: 6000,
    });

    this.consumer = this.kafka.consumer({
      groupId: this.groupId,
      allowAutoTopicCreation: true,
      retry: {
        initialRetryTime: 300,
        retries: 5,
      },
    });

    this.dlqProducer = this.kafka.producer({
      allowAutoTopicCreation: true,
    });

    // Reuse provided PG Pool or connect to local PostgreSQL instance
    this.dbPool = config.dbPool || new pg.Pool({
      connectionString: process.env.LOCAL_DB_URL || process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
      max: 10,
      idleTimeoutMillis: 30000,
    });
  }

  /**
   * Topics to subscribe to. Defined by concrete subclasses.
   */
  abstract getSubscribedTopics(): string[];

  /**
   * Concrete message processor.
   */
  abstract processMessage(
    envelope: KafkaMessageEnvelope,
    rawPayload: EachMessagePayload
  ): Promise<{ success: boolean; duplicate?: boolean; error?: string }>;

  /**
   * Start consumer and connect to broker.
   */
  public async start(): Promise<void> {
    if (!this.enabled) {
      console.log(`[BaseConsumer] [${this.groupId}] Consumer is disabled. Skipping start.`);
      return;
    }

    if (this.isRunning) {
      return;
    }

    try {
      console.log(`[BaseConsumer] [${this.groupId}] Connecting to Kafka brokers: ${this.brokers.join(', ')}...`);
      await this.consumer.connect();
      await this.dlqProducer.connect();
      this.isConnected = true;

      const topics = this.getSubscribedTopics();
      for (const topic of topics) {
        await this.consumer.subscribe({ topic, fromBeginning: this.fromBeginning });
        console.log(`[BaseConsumer] [${this.groupId}] Subscribed to topic: ${topic}`);
      }

      this.isRunning = true;
      this.lastError = null;

      await this.consumer.run({
        autoCommit: false,
        eachMessage: async (payload: EachMessagePayload) => {
          await this.handleIncomingMessage(payload);
        },
      });

      console.log(`[BaseConsumer] [${this.groupId}] Consumer started successfully.`);
    } catch (err: any) {
      this.isConnected = false;
      this.isRunning = false;
      this.lastError = err?.message || 'Failed to start Kafka consumer';
      console.error(`[BaseConsumer] [${this.groupId}] Failed to start:`, this.lastError);
      throw err;
    }
  }

  /**
   * Stop consumer gracefully.
   */
  public async stop(): Promise<void> {
    this.isRunning = false;
    try {
      if (this.isConnected) {
        await this.consumer.disconnect();
        await this.dlqProducer.disconnect();
        console.log(`[BaseConsumer] [${this.groupId}] Consumer and DLQ producer disconnected.`);
      }
    } catch (err: any) {
      console.warn(`[BaseConsumer] [${this.groupId}] Error during shutdown:`, err?.message || err);
    } finally {
      this.isConnected = false;
    }
  }

  /**
   * Internal message lifecycle pipeline:
   * 1. Parse JSON value
   * 2. Validate envelope format
   * 3. Execute concrete processor
   * 4. Route to DLQ if unrecoverable poison message
   * 5. Commit offset manually ONLY AFTER successful processing or DLQ ACK
   */
  public async handleIncomingMessage(payload: EachMessagePayload): Promise<void> {
    const { topic, partition, message } = payload;
    const rawValue = message.value?.toString('utf8');

    console.log(`[BaseConsumer] [${this.groupId}] Received message on topic '${topic}', partition ${partition}, offset ${message.offset}`);

    if (!rawValue) {
      // Empty or tombstone message: send to DLQ and commit offset
      await this.sendToDlq(topic, null, 'Message value is empty or null');
      await this.commitMessageOffset(topic, partition, message.offset);
      return;
    }

    let parsedEnvelope: any;
    try {
      parsedEnvelope = JSON.parse(rawValue);
    } catch (parseErr: any) {
      console.error(`[BaseConsumer] [${this.groupId}] Malformed JSON on topic ${topic}:`, parseErr.message);
      await this.sendToDlq(topic, rawValue, `JSON parse error: ${parseErr.message}`);
      await this.commitMessageOffset(topic, partition, message.offset);
      return;
    }

    // Envelope validation
    const validationError = this.validateEnvelope(parsedEnvelope);
    if (validationError) {
      console.error(`[BaseConsumer] [${this.groupId}] Invalid message envelope:`, validationError);
      await this.sendToDlq(topic, rawValue, validationError, parsedEnvelope);
      await this.commitMessageOffset(topic, partition, message.offset);
      return;
    }

    const envelope: KafkaMessageEnvelope = {
      event_id: String(parsedEnvelope.event_id),
      event_type: String(parsedEnvelope.event_type),
      event_version: String(parsedEnvelope.event_version || '1.0'),
      event_timestamp: String(parsedEnvelope.event_timestamp || new Date().toISOString()),
      source: String(parsedEnvelope.source || 'unknown'),
      payload: parsedEnvelope.payload,
    };

    try {
      // Heartbeat to prevent session timeout on heavy operations
      await payload.heartbeat();

      const result = await this.processMessage(envelope, payload);

      if (result.success) {
        if (result.duplicate) {
          this.duplicateCount++;
          console.log(`[BaseConsumer] [${this.groupId}] Duplicate event ${envelope.event_id} skipped idempotently.`);
        } else {
          this.processedCount++;
          this.lastProcessedAt = new Date();
          console.log(`[BaseConsumer] [${this.groupId}] Event ${envelope.event_id} (${envelope.event_type}) processed successfully.`);
        }

        // Commit offset manually AFTER durable DB transaction succeeds
        await this.commitMessageOffset(topic, partition, message.offset);
      } else {
        // Business validation failure (poison payload)
        console.warn(`[BaseConsumer] [${this.groupId}] Message rejected: ${result.error}. Routing to DLQ.`);
        await this.sendToDlq(topic, rawValue, result.error || 'Handler validation failed', envelope);
        await this.commitMessageOffset(topic, partition, message.offset);
      }
    } catch (err: any) {
      // Transient error (DB offline, connection timeout, etc.)
      this.lastError = err?.message || 'Processing error';
      console.error(`[BaseConsumer] [${this.groupId}] Transient error processing event ${envelope.event_id}:`, this.lastError);
      // DO NOT commit offset! Allow Kafka to redeliver on next poll
      throw err;
    }
  }

  /**
   * Validate that message has required envelope fields.
   */
  public validateEnvelope(msg: any): string | null {
    if (!msg || typeof msg !== 'object') {
      return 'Message root is not a valid JSON object';
    }
    if (!msg.event_id || typeof msg.event_id !== 'string' || msg.event_id.trim().length === 0) {
      return 'Missing or invalid event_id in message envelope';
    }
    if (!msg.event_type || typeof msg.event_type !== 'string' || msg.event_type.trim().length === 0) {
      return 'Missing or invalid event_type in message envelope';
    }
    if (msg.payload === undefined || msg.payload === null || typeof msg.payload !== 'object') {
      return 'Missing or non-object payload in message envelope';
    }
    return null;
  }

  /**
   * Route unrecoverable / poison messages to Dead Letter Queue.
   * Resolves only after Kafka broker acknowledges the DLQ record.
   */
  public async sendToDlq(
    originalTopic: string,
    rawMessage: string | null,
    errorMessage: string,
    parsedEnvelope?: any
  ): Promise<void> {
    const dlqEventId = `dlq-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const dlqMessage = {
      event_id: dlqEventId,
      event_type: 'DEAD_LETTER',
      event_version: '1.0',
      event_timestamp: new Date().toISOString(),
      source: this.groupId,
      payload: {
        original_topic: originalTopic,
        original_event_id: parsedEnvelope?.event_id || 'unknown',
        event_type: parsedEnvelope?.event_type || 'unknown',
        error: errorMessage,
        failed_at: new Date().toISOString(),
        raw_message: rawMessage,
      },
    };

    try {
      if (!this.isDlqConnected) {
        await this.dlqProducer.connect();
        this.isDlqConnected = true;
      }

      await this.dlqProducer.send({
        topic: this.dlqTopic,
        messages: [
          {
            key: parsedEnvelope?.event_id || dlqEventId,
            value: JSON.stringify(dlqMessage),
            headers: {
              'original-topic': originalTopic,
              'dlq-reason': errorMessage.substring(0, 200),
            },
          },
        ],
      });

      this.dlqCount++;
      console.warn(`[BaseConsumer] [${this.groupId}] Poison message routed to DLQ topic '${this.dlqTopic}' (DLQ ID: ${dlqEventId}).`);
    } catch (dlqErr: any) {
      console.error(`[BaseConsumer] [${this.groupId}] CRITICAL: Failed to publish to DLQ:`, dlqErr?.message || dlqErr);
      throw dlqErr;
    }
  }

  /**
   * Manually commit Kafka offset for a specific message.
   */
  protected async commitMessageOffset(topic: string, partition: number, offset: string): Promise<void> {
    const nextOffset = (BigInt(offset) + 1n).toString();
    await this.consumer.commitOffsets([
      {
        topic,
        partition,
        offset: nextOffset,
      },
    ]);
  }

  /**
   * Return health and diagnostic metrics.
   */
  public getHealth(): ConsumerHealthStatus {
    return {
      groupId: this.groupId,
      clientId: this.clientId,
      brokers: this.brokers,
      enabled: this.enabled,
      isRunning: this.isRunning,
      isConnected: this.isConnected,
      processedCount: this.processedCount,
      duplicateCount: this.duplicateCount,
      dlqCount: this.dlqCount,
      lastProcessedAt: this.lastProcessedAt ? this.lastProcessedAt.toISOString() : null,
      lastError: this.lastError,
    };
  }
}

import { Kafka, Producer, RecordMetadata } from 'kafkajs';
import crypto from 'crypto';
import net from 'net';
import { supabase } from '../config/supabase';
import {
  HISTORICAL_ATOM_FIXTURE_IDS,
  selectBacklogReplayCandidates,
  isEventEligibleForControlledReplay,
} from './backlogReplaySelector';

export interface OutboxRecord {
  id: string;
  event_id: string;
  event_type: string;
  topic: string;
  payload: any;
  status: 'PENDING' | 'PUBLISHED' | 'FAILED';
  created_at: string;
  published_at?: string | null;
  retry_count: number;
  last_error?: string | null;
}

export type OutboxPublisherMode = 'PAUSED' | 'TEST_ONLY' | 'LIVE';

export interface OutboxServiceConfig {
  brokers?: string[];
  clientId?: string;
  workerId?: string;
  mode?: OutboxPublisherMode;
  pollIntervalMs?: number;
  batchSize?: number;
  maxRetries?: number;
  claimTimeoutMs?: number;
  customProducer?: any;
}

export interface OutboxPublisherHealth {
  isRunning: boolean;
  brokerReachable: boolean;
  isConnected: boolean;
  isPolling: boolean;
  mode: OutboxPublisherMode;
  workerId: string;
  brokers: string[];
  pollIntervalMs: number;
  batchSize: number;
  maxRetries: number;
  claimTimeoutMs: number;
  lastError: string | null;
  lastPollAt: string | null;
  lastDeliveredAt: string | null;
  publishedCount: number;
  failedCount: number;
}

export class OutboxPublisherService {
  public readonly workerId: string;
  public mode: OutboxPublisherMode;
  private brokers: string[];
  private clientId: string;
  private pollIntervalMs: number;
  private batchSize: number;
  private maxRetries: number;
  private claimTimeoutMs: number;

  private kafka: Kafka;
  private producer: Producer;
  private customProducerProvided: boolean = false;

  private isRunning: boolean = false;
  private isConnected: boolean = false;
  private brokerReachable: boolean = false;
  private isPolling: boolean = false;
  private pollTimer: NodeJS.Timeout | null = null;

  private lastError: string | null = null;
  private lastPollAt: Date | null = null;
  private lastDeliveredAt: Date | null = null;
  private publishedCount: number = 0;
  private failedCount: number = 0;

  constructor(config: OutboxServiceConfig = {}) {
    const rawBrokers = process.env.KAFKA_BOOTSTRAP_SERVERS || 'localhost:9092';
    this.brokers = config.brokers || rawBrokers.split(',').map((b) => b.trim()).filter(Boolean);
    this.clientId = config.clientId || process.env.KAFKA_CLIENT_ID || 'farmchain-outbox-publisher';
    this.workerId = config.workerId || `worker-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;

    // Default mode is strictly PAUSED to protect pre-existing business events.
    // Must be explicitly set to 'LIVE' or 'TEST_ONLY' to enable batch execution.
    const envMode = process.env.OUTBOX_PUBLISHER_MODE?.toUpperCase() as OutboxPublisherMode | undefined;
    this.mode = config.mode || (envMode && ['PAUSED', 'TEST_ONLY', 'LIVE'].includes(envMode) ? envMode : 'PAUSED');

    this.pollIntervalMs = config.pollIntervalMs || Number(process.env.OUTBOX_POLL_INTERVAL_MS) || 5000;
    this.batchSize = config.batchSize || Number(process.env.OUTBOX_BATCH_SIZE) || 50;
    this.maxRetries = config.maxRetries || Number(process.env.OUTBOX_MAX_RETRIES) || 5;
    this.claimTimeoutMs = config.claimTimeoutMs || Number(process.env.OUTBOX_CLAIM_TIMEOUT_MS) || 30000;

    if (config.customProducer) {
      this.customProducerProvided = true;
      this.producer = config.customProducer;
      this.kafka = {} as any;
    } else {
      this.kafka = new Kafka({
        clientId: this.clientId,
        brokers: this.brokers,
        retry: {
          initialRetryTime: 300,
          retries: 2,
        },
        connectionTimeout: 3000,
        requestTimeout: 5000,
      });
      this.producer = this.kafka.producer({
        allowAutoTopicCreation: true,
      });
    }
  }

  /**
   * Set or override producer instance (useful for unit tests or mocked publisher).
   */
  public setProducer(producer: any, markConnected = true): void {
    this.producer = producer;
    this.customProducerProvided = true;
    this.isConnected = markConnected;
    this.brokerReachable = markConnected;
    if (markConnected) {
      this.lastError = null;
    }
  }

  /**
   * Switch the publisher mode (PAUSED | TEST_ONLY | LIVE).
   */
  public setMode(mode: OutboxPublisherMode): void {
    const prev = this.mode;
    this.mode = mode;
    console.log(`[OutboxPublisher] [${this.workerId}] Mode switched from ${prev} -> ${mode}`);
  }

  /**
   * Fast probe to verify if configured Kafka broker TCP sockets are actively reachable.
   */
  public async checkBrokerReachability(timeoutMs = 1500): Promise<boolean> {
    if (this.customProducerProvided) {
      return this.isConnected;
    }

    for (const broker of this.brokers) {
      const parts = broker.split(':');
      const host = parts[0] || 'localhost';
      const port = parts[1] ? parseInt(parts[1], 10) : 9092;

      const isOpen = await new Promise<boolean>((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(timeoutMs);
        socket.connect(port, host, () => {
          socket.destroy();
          resolve(true);
        });
        socket.on('error', () => {
          socket.destroy();
          resolve(false);
        });
        socket.on('timeout', () => {
          socket.destroy();
          resolve(false);
        });
      });

      if (isOpen) {
        return true;
      }
    }

    return false;
  }

  /**
   * Synchronize broker reachability, reconnect safely when online, and update diagnostics.
   * Does NOT query, claim, or publish business events.
   */
  public async syncConnectionState(): Promise<{ brokerReachable: boolean; isConnected: boolean; error: string | null }> {
    if (this.customProducerProvided) {
      this.brokerReachable = this.isConnected;
      return {
        brokerReachable: this.brokerReachable,
        isConnected: this.isConnected,
        error: this.lastError,
      };
    }

    const reachable = await this.checkBrokerReachability();
    this.brokerReachable = reachable;

    if (reachable) {
      if (!this.isConnected) {
        const connected = await this.connect();
        if (connected) {
          this.lastError = null;
        }
      } else {
        // Connected and reachable - clear any old connection/unreachable error
        if (this.lastError && (this.lastError.includes('unreachable') || this.lastError.includes('Connection error') || this.lastError.includes('Failed to connect'))) {
          this.lastError = null;
        }
      }
    } else {
      // Broker socket unreachable
      if (this.isConnected) {
        console.warn(`[OutboxPublisher] [${this.workerId}] Kafka broker at ${this.brokers.join(', ')} is no longer reachable. Disconnecting producer.`);
        this.isConnected = false;
        try {
          await this.producer.disconnect();
        } catch (_) {}
      }
      this.lastError = `Kafka broker unreachable at ${this.brokers.join(', ')}`;
    }

    return {
      brokerReachable: this.brokerReachable,
      isConnected: this.isConnected,
      error: this.lastError,
    };
  }

  /**
   * Attempt to connect to the Kafka broker. Does not throw if connection fails.
   */
  public async connect(): Promise<boolean> {
    if (this.isConnected) {
      return true;
    }

    try {
      await this.producer.connect();
      this.isConnected = true;
      this.brokerReachable = true;
      this.lastError = null;
      console.log(`[OutboxPublisher] [${this.workerId}] Connected to Kafka brokers: ${this.brokers.join(', ')} (mode: ${this.mode})`);
      return true;
    } catch (err: any) {
      this.isConnected = false;
      this.lastError = err?.message || 'Failed to connect to Kafka broker';
      console.warn(`[OutboxPublisher] [${this.workerId}] Kafka broker unavailable at ${this.brokers.join(', ')} (${this.lastError}). Events will remain pending in outbox.`);
      return false;
    }
  }

  /**
   * Start the continuous outbox publisher background loop.
   */
  public start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    console.log(`[OutboxPublisher] [${this.workerId}] Starting outbox publisher (mode: ${this.mode}, pollInterval: ${this.pollIntervalMs}ms, batchSize: ${this.batchSize})`);

    // Probe and connect in the background so Express startup is never blocked
    this.syncConnectionState().catch(() => {});

    // Schedule regular polling and health monitoring
    this.pollTimer = setInterval(() => {
      this.processOutboxBatch().catch((err) => {
        console.error(`[OutboxPublisher] [${this.workerId}] Uncaught error in poll cycle:`, err?.message || err);
      });
    }, this.pollIntervalMs);

    // Initial immediate tick
    setTimeout(() => {
      this.processOutboxBatch().catch(() => {});
    }, 1000);
  }

  /**
   * Stop the publisher gracefully during server shutdown.
   */
  public async stop(): Promise<void> {
    this.isRunning = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.isConnected && !this.customProducerProvided) {
      try {
        await this.producer.disconnect();
        console.log(`[OutboxPublisher] [${this.workerId}] Disconnected from Kafka broker.`);
      } catch (err: any) {
        console.warn(`[OutboxPublisher] [${this.workerId}] Error disconnecting Kafka producer:`, err?.message || err);
      }
    }
    this.isConnected = false;
    this.brokerReachable = false;
  }

  /**
   * Atomically claim a pending outbox event in PostgreSQL before publication.
   *
   * Safeguards:
   * 1. In PAUSED mode: Refuses to claim any event unless explicitly permitted.
   * 2. In TEST_ONLY mode: Strictly refuses to claim any real business event (topics other than test-diagnostic-events
   *    or event_types not starting with TEST_).
   * 3. Evaluates if the event has an unexpired lease held by another worker.
   * 4. Executes an atomic conditional UPDATE matching the exact status and observed claim state.
   * 5. Row-level serialization in PostgreSQL guarantees that exactly one worker's update matches
   *    and returns the record. All competing workers receive 0 rows and abort publication.
   */
  public async claimEvent(event: OutboxRecord, forceSingleTest = false): Promise<{ claimed: boolean; claimToken?: string; record?: OutboxRecord }> {
    // 0. Historical Fixture Guard: Under NO circumstance may an identified historical fixture be claimed or leased
    if (HISTORICAL_ATOM_FIXTURE_IDS.has(event.id)) {
      console.warn(`[OutboxPublisher] [${this.workerId}] BLOCKED: Refusing to claim historical fixture ${event.id} (${event.topic} :: ${event.event_type}).`);
      return { claimed: false };
    }

    const isTestEvent = event.event_type.startsWith('TEST_') && event.topic === 'test-diagnostic-events';

    // Mode Guard: In PAUSED mode, strictly block all business events
    if (this.mode === 'PAUSED' && !isTestEvent && !forceSingleTest) {
      return { claimed: false };
    }

    // Mode Guard: In TEST_ONLY mode, strictly block all business events
    if (this.mode === 'TEST_ONLY' && !isTestEvent && !forceSingleTest) {
      console.warn(`[OutboxPublisher] [${this.workerId}] BLOCKED: Attempt to claim business event ${event.event_id} (topic: ${event.topic}) while in TEST_ONLY mode.`);
      return { claimed: false };
    }

    // Check if the event currently has an unexpired claim held by another worker
    if (event.last_error && event.last_error.startsWith('CLAIM:')) {
      const parts = event.last_error.split(':');
      const expiresAt = Number(parts[2]);
      if (!isNaN(expiresAt) && Date.now() < expiresAt) {
        // Active lease held by another worker - skip immediately
        return { claimed: false };
      }
    }

    const claimExpiresAt = Date.now() + this.claimTimeoutMs;
    const newClaimToken = `CLAIM:${this.workerId}:${claimExpiresAt}`;

    let query = supabase
      .from('event_outbox')
      .update({
        last_error: newClaimToken,
      })
      .eq('id', event.id)
      .eq('status', 'PENDING');

    // Atomic Row-Locking OCC Filter:
    // Row in PostgreSQL must STILL have the exact state we observed when querying it
    if (event.last_error === null) {
      query = query.is('last_error', null);
    } else {
      query = query.eq('last_error', event.last_error);
    }

    const { data: updatedRows, error } = await query
      .select('id, event_id, event_type, topic, payload, status, created_at, published_at, retry_count, last_error');

    if (error || !updatedRows || updatedRows.length === 0) {
      // Another worker updated or claimed this row first; we lost the race
      return { claimed: false };
    }

    const claimedRecord = updatedRows[0] as OutboxRecord;
    return { claimed: true, claimToken: newClaimToken, record: claimedRecord };
  }

  /**
   * Safely release an active claim without losing the pending event (e.g. broker offline).
   */
  public async releaseClaim(event: OutboxRecord, claimToken: string, restoredError: string | null = null): Promise<boolean> {
    const { data, error } = await supabase
      .from('event_outbox')
      .update({
        last_error: restoredError,
      })
      .eq('id', event.id)
      .eq('status', 'PENDING')
      .eq('last_error', claimToken)
      .select('id');

    return !error && !!data && data.length > 0;
  }

  /**
   * Process a single batch of PENDING events from the event_outbox table.
   */
  public async processOutboxBatch(): Promise<{ processed: number; published: number; failed: number }> {
    if (this.isPolling) {
      return { processed: 0, published: 0, failed: 0 };
    }

    // Continuously maintain broker reachability and health diagnostics
    await this.syncConnectionState();

    // Safety Guard: When PAUSED, do not touch database outbox records
    if (this.mode === 'PAUSED') {
      return { processed: 0, published: 0, failed: 0 };
    }

    this.isPolling = true;
    this.lastPollAt = new Date();

    let processed = 0;
    let published = 0;
    let failed = 0;

    try {
      // If broker is offline, try connecting first. If still unreachable, leave events untouched in PENDING state.
      if (!this.isConnected) {
        const ok = await this.connect();
        if (!ok) {
          return { processed: 0, published: 0, failed: 0 };
        }
      }

      // Base query for pending records
      let query = supabase
        .from('event_outbox')
        .select('*')
        .eq('status', 'PENDING')
        .order('created_at', { ascending: true })
        .limit(this.batchSize);

      // In TEST_ONLY mode, strictly filter out all business events!
      if (this.mode === 'TEST_ONLY') {
        query = query.like('event_type', 'TEST_%').eq('topic', 'test-diagnostic-events');
      }

      const { data: events, error } = await query;

      if (error) {
        console.error(`[OutboxPublisher] [${this.workerId}] Error querying event_outbox:`, error.message);
        this.lastError = error.message;
        return { processed: 0, published: 0, failed: 0 };
      }

      if (!events || events.length === 0) {
        return { processed: 0, published: 0, failed: 0 };
      }

      for (const event of events as OutboxRecord[]) {
        // Exclude historical fixtures so normal publishing never touches them
        if (HISTORICAL_ATOM_FIXTURE_IDS.has(event.id)) {
          continue;
        }

        // ATOMIC CLAIM: Attempt to claim the event in the database BEFORE publishing
        const claimResult = await this.claimEvent(event);
        if (!claimResult.claimed || !claimResult.claimToken) {
          // Event was claimed by another worker, active lease exists, or blocked by mode
          continue;
        }

        processed++;
        const recordToPublish = claimResult.record || event;
        const result = await this.publishSingleEvent(recordToPublish, claimResult.claimToken);

        if (result.status === 'PUBLISHED') {
          published++;
          this.publishedCount++;
          this.lastDeliveredAt = new Date();
        } else if (result.status === 'FAILED') {
          failed++;
          this.failedCount++;
        } else if (result.status === 'BROKER_OFFLINE') {
          // Broker went down mid-batch; stop processing the rest of this batch
          break;
        }
      }
    } catch (err: any) {
      this.lastError = err?.message || 'Error processing outbox batch';
      console.error(`[OutboxPublisher] [${this.workerId}] Batch error:`, this.lastError);
    } finally {
      this.isPolling = false;
    }

    return { processed, published, failed };
  }

  /**
   * Controlled Backlog Replay Batch Runner.
   *
   * PRE-CLAIM BOUNDARY ENFORCEMENT:
   * 1. Queries pending records.
   * 2. Evaluates every record against `selectBacklogReplayCandidates()`.
   * 3. Pre-filters out all 3 historical fixtures and all 19 deferred-topic events
   *    BEFORE `claimEvent()` can ever be invoked.
   * 4. Validates that ONLY the 13 approved eligible candidate records proceed to claim/publish.
   * 5. Supports dryRun mode (evaluates and plans without calling claim or Kafka).
   * 6. Supports custom claimFn for testing pre-claim boundaries with spies.
   */
  public async processControlledBacklogReplayBatch(options: {
    dryRun?: boolean;
    batchSize?: number;
    claimFn?: (event: OutboxRecord) => Promise<{ claimed: boolean; claimToken?: string; record?: OutboxRecord }>;
    publishFn?: (event: OutboxRecord, claimToken: string) => Promise<{ status: 'PUBLISHED' | 'PENDING' | 'FAILED' | 'BROKER_OFFLINE' | 'CLAIM_FAILED'; error?: string }>;
  } = {}): Promise<{
    eligibleCount: number;
    fixturesExcludedCount: number;
    deferredCount: number;
    processedCount: number;
    publishedCount: number;
    eligibleCandidates: OutboxRecord[];
    fixturesExcluded: OutboxRecord[];
    deferredEvents: OutboxRecord[];
  }> {
    const isDryRun = options.dryRun ?? false;
    const limit = options.batchSize || this.batchSize;
    const executeClaim = options.claimFn || this.claimEvent.bind(this);
    const executePublish = options.publishFn || this.publishSingleEvent.bind(this);

    // 1. Fetch pending records
    const { data: rows, error } = await supabase
      .from('event_outbox')
      .select('*')
      .eq('status', 'PENDING')
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error) {
      throw new Error(`[OutboxPublisher] Failed to query event_outbox for backlog replay: ${error.message}`);
    }

    const records = (rows || []) as OutboxRecord[];

    // 2. Pre-claim isolation & partition evaluation (fails closed if unexpected records exist)
    const partition = selectBacklogReplayCandidates(records, { failClosedOnUnexpected: true });

    // 3. Dry-run execution: return plan without claiming or publishing
    if (isDryRun) {
      return {
        eligibleCount: partition.eligible.length,
        fixturesExcludedCount: partition.fixtures.length,
        deferredCount: partition.deferred.length,
        processedCount: 0,
        publishedCount: 0,
        eligibleCandidates: partition.eligible,
        fixturesExcluded: partition.fixtures,
        deferredEvents: partition.deferred,
      };
    }

    // 4. Live execution: strictly only for verified eligible candidates
    let processedCount = 0;
    let publishedCount = 0;

    for (const event of partition.eligible) {
      // PRE-CLAIM INVARIANT CHECK: Guarantee event is in approved eligible set
      if (!isEventEligibleForControlledReplay(event)) {
        throw new Error(`[FAIL_CLOSED] Refusing to claim ineligible event ${event.id}`);
      }

      const claimResult = await executeClaim(event);
      if (!claimResult.claimed || !claimResult.claimToken) {
        continue;
      }

      processedCount++;
      const recordToPublish = claimResult.record || event;
      const pubResult = await executePublish(recordToPublish, claimResult.claimToken);
      if (pubResult.status === 'PUBLISHED') {
        publishedCount++;
      }
    }

    return {
      eligibleCount: partition.eligible.length,
      fixturesExcludedCount: partition.fixtures.length,
      deferredCount: partition.deferred.length,
      processedCount,
      publishedCount,
      eligibleCandidates: partition.eligible,
      fixturesExcluded: partition.fixtures,
      deferredEvents: partition.deferred,
    };
  }

  /**
   * Publish a single event record to Kafka and update database state upon broker acknowledgment.
   * Only the worker holding the valid database claim can mark the event as PUBLISHED.
   */
  public async publishSingleEvent(
    event: OutboxRecord,
    existingClaimToken?: string
  ): Promise<{ status: 'PUBLISHED' | 'PENDING' | 'FAILED' | 'BROKER_OFFLINE' | 'CLAIM_FAILED'; error?: string }> {
    let activeClaimToken = existingClaimToken;

    // If caller did not pre-claim, atomically claim the event now
    if (!activeClaimToken) {
      const claimResult = await this.claimEvent(event);
      if (!claimResult.claimed || !claimResult.claimToken) {
        return { status: 'CLAIM_FAILED', error: 'Could not atomically claim event in database (already claimed, unmatching state, or blocked by mode)' };
      }
      activeClaimToken = claimResult.claimToken;
      if (claimResult.record) {
        event = claimResult.record;
      }
    }

    const key = String(
      event.payload?.shipment_id ||
      event.payload?.batch_id ||
      event.payload?.order_id ||
      event.event_id ||
      event.id
    );

    const envelope = {
      event_id: event.event_id,
      event_type: event.event_type,
      event_version: '1.0',
      event_timestamp: event.created_at,
      source: 'farmchain-outbox-service',
      payload: event.payload,
    };

    try {
      // 1. Send to Kafka broker with leader/ISR acknowledgment
      await this.producer.send({
        topic: event.topic,
        messages: [
          {
            key,
            value: JSON.stringify(envelope),
            headers: {
              'event-id': String(event.event_id),
              'event-type': String(event.event_type),
              'content-type': 'application/json',
            },
          },
        ],
      });

      // 2. Mark as PUBLISHED ONLY AFTER broker acknowledgment AND matching our active claim token
      const { data: updatedRows, error: updateErr } = await supabase
        .from('event_outbox')
        .update({
          status: 'PUBLISHED',
          published_at: new Date().toISOString(),
          last_error: null,
        })
        .eq('id', event.id)
        .eq('status', 'PENDING')
        .eq('last_error', activeClaimToken)
        .select('id, status');

      if (updateErr) {
        console.error(`[OutboxPublisher] [${this.workerId}] Failed to mark event ${event.event_id} as PUBLISHED:`, updateErr.message);
        return { status: 'PENDING', error: updateErr.message };
      }

      if (!updatedRows || updatedRows.length === 0) {
        // Claim expired or was superseded before acknowledgment could be recorded
        console.warn(`[OutboxPublisher] [${this.workerId}] Event ${event.event_id} claim was superseded before PUBLISHED status could be recorded.`);
        return { status: 'PENDING', error: 'Claim expired before DB acknowledgment update' };
      }

      return { status: 'PUBLISHED' };
    } catch (publishErr: any) {
      const errMsg = publishErr?.message || String(publishErr);

      // Check if error is cluster connection/transport level
      const isConnectionError =
        errMsg.includes('ECONNREFUSED') ||
        errMsg.includes('Broker transport failure') ||
        errMsg.includes('Connection error') ||
        errMsg.includes('Not connected') ||
        errMsg.includes('Request timed out');

      if (isConnectionError) {
        this.isConnected = false;
        this.lastError = errMsg;
        console.warn(`[OutboxPublisher] [${this.workerId}] Broker disconnected publishing ${event.event_id}: ${errMsg}. Releasing claim to PENDING.`);
        // Release active claim so it can be retried immediately once broker reconnects
        await this.releaseClaim(event, activeClaimToken, null);
        return { status: 'BROKER_OFFLINE', error: errMsg };
      }

      // If specific message/schema failure, increment retry count and conditionally mark FAILED
      const newRetryCount = (event.retry_count || 0) + 1;
      const nextStatus = newRetryCount >= this.maxRetries ? 'FAILED' : 'PENDING';

      console.error(`[OutboxPublisher] [${this.workerId}] Failed to publish event ${event.event_id} (attempt ${newRetryCount}/${this.maxRetries}):`, errMsg);

      await supabase
        .from('event_outbox')
        .update({
          status: nextStatus,
          retry_count: newRetryCount,
          last_error: errMsg, // Overwrites claim token with actual failure error
        })
        .eq('id', event.id)
        .eq('status', 'PENDING')
        .eq('last_error', activeClaimToken);

      return { status: nextStatus, error: errMsg };
    }
  }

  /**
   * Safely create, claim, and publish a uniquely identified isolated test event.
   * Can be used for controlled smoke testing without exposing or publishing any business events.
   */
  public async publishIsolatedTestEvent(options: {
    testId?: string;
    topic?: string;
    payload?: any;
  } = {}): Promise<{
    eventId: string;
    outboxId: string;
    status: 'PUBLISHED' | 'PENDING' | 'FAILED' | 'BROKER_OFFLINE' | 'CLAIM_FAILED';
    error?: string;
  }> {
    const testEventId = options.testId || `test-smoke-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const topic = options.topic || 'test-diagnostic-events';
    const payload = options.payload || {
      test: true,
      purpose: 'controlled_kafka_smoke_test',
      timestamp: new Date().toISOString(),
    };

    const { data: record, error: insertErr } = await supabase
      .from('event_outbox')
      .insert({
        event_id: testEventId,
        event_type: 'TEST_SMOKE_EVENT',
        topic,
        payload,
        status: 'PENDING',
        retry_count: 0,
        last_error: null,
      })
      .select()
      .single();

    if (insertErr || !record) {
      throw new Error(`Failed to insert isolated test event: ${insertErr?.message}`);
    }

    const claimResult = await this.claimEvent(record as OutboxRecord, true);
    if (!claimResult.claimed || !claimResult.claimToken) {
      return {
        eventId: testEventId,
        outboxId: record.id,
        status: 'CLAIM_FAILED',
        error: 'Failed to atomically claim newly created test event',
      };
    }

    const pubResult = await this.publishSingleEvent(claimResult.record || (record as OutboxRecord), claimResult.claimToken);
    return {
      eventId: testEventId,
      outboxId: record.id,
      status: pubResult.status,
      error: pubResult.error,
    };
  }

  /**
   * Returns current health and diagnostic information.
   */
  public getHealth(): OutboxPublisherHealth {
    return {
      isRunning: this.isRunning,
      brokerReachable: this.brokerReachable,
      isConnected: this.isConnected,
      isPolling: this.isPolling,
      mode: this.mode,
      workerId: this.workerId,
      brokers: this.brokers,
      pollIntervalMs: this.pollIntervalMs,
      batchSize: this.batchSize,
      maxRetries: this.maxRetries,
      claimTimeoutMs: this.claimTimeoutMs,
      lastError: this.lastError,
      lastPollAt: this.lastPollAt ? this.lastPollAt.toISOString() : null,
      lastDeliveredAt: this.lastDeliveredAt ? this.lastDeliveredAt.toISOString() : null,
      publishedCount: this.publishedCount,
      failedCount: this.failedCount,
    };
  }
}

export const outboxPublisherService = new OutboxPublisherService();

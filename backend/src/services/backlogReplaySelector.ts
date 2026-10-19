/**
 * FarmChainAI — Backlog Replay Eligibility Selector & Fixture Isolation
 *
 * Dedicated, deterministic eligibility selector for the controlled backlog replay path.
 *
 * Core Guarantees:
 * 1. Exact UUID matching for historical fixtures (NEVER broad substring matching).
 * 2. Strict topic allowlist scoped EXCLUSIVELY to the controlled replay path.
 * 3. Fails closed on unknown topics, unexpected pending records, or modified fixtures.
 * 4. Ensures fixture exclusion occurs PRIOR to any claim or lease operation.
 */

import { OutboxRecord } from './outboxPublisherService';

// ============================================================================
// IMMUTABLE CONSTANTS & CLASSIFICATION SETS
// ============================================================================

/**
 * Exact UUIDs of the 3 historical atomicity test fixtures identified in Step 19 & 20.
 * These records MUST NEVER be claimed, leased, or published during business replay.
 */
export const HISTORICAL_ATOM_FIXTURE_IDS: ReadonlySet<string> = new Set<string>([
  '4232d9be-af74-4d3e-8848-32b28d446942', // traceability-events :: BATCH_CREATED (BATCH-ATOM-01-1792273692509)
  'ecef8be1-c37b-4375-a2e1-d6df5c2b30ca', // traceability-events :: BATCH_CREATED (BATCH-ATOM-01-1792273827677)
  '293f96d7-d6a7-450f-b546-4888c8ddc1e6', // shipment-events     :: DELIVERY_PROOF_SUBMITTED (BATCH-ATOM-01-1792273827677)
]);

/**
 * The 3 approved topics for the controlled backlog replay path.
 * NOTE: This allowlist is strictly scoped to backlog replay; it is NOT a global restriction
 * on normal runtime business publishing.
 */
export const CONTROLLED_REPLAY_APPROVED_TOPICS = [
  'traceability-events',
  'shipment-events',
  'inventory-events',
] as const;

export type ControlledReplayApprovedTopic = (typeof CONTROLLED_REPLAY_APPROVED_TOPICS)[number];

/**
 * Topics currently lacking downstream consumers and projection read-models.
 * Events on these topics must remain safely deferred in the outbox.
 */
export const DEFERRED_UNHANDLED_TOPICS = [
  'quality-alerts',
  'logistics-events',
] as const;

export type DeferredUnhandledTopic = (typeof DEFERRED_UNHANDLED_TOPICS)[number];

/**
 * The exact 13 consumer-backed business event UUIDs verified in Step 19 & 20.
 */
export const EXPECTED_ELIGIBLE_EVENT_IDS: ReadonlySet<string> = new Set<string>([
  'f3c6f7e0-dc64-4e89-bb65-67e3e76084ef', // traceability-events :: BATCH_CREATED (BATCH-1791655578385)
  '89759505-e86a-4a4a-881b-50f816d8fb21', // shipment-events     :: SHIPMENT_RECEIVED (BATCH-3D-1791656463293)
  '84aaf5d1-eeb3-41d6-9e96-f92463a167ca', // traceability-events :: RETAILER_RECEIVED (BATCH-3D-1791656463293)
  'b9566ee6-09f5-47d5-9acf-c86c7ce88a58', // inventory-events    :: INVENTORY_CREATED (BATCH-3D-1791656463293)
  'd0fa05cb-4d7f-4f94-b46e-82d1309bb4f3', // inventory-events    :: SALE_CREATED (INT-RETURN-1791741607611-B1)
  'd996b7bb-a34e-40fa-b4f5-6d223ec78b05', // inventory-events    :: INVENTORY_UPDATED (INT-RETURN-1791741607611-B1)
  '8baf0f08-beb0-48f5-8487-e388a4acbd3b', // traceability-events :: BATCH_CREATED (TOM-1792159666172)
  'c510405d-a782-4696-b79a-b5cc3c2bb372', // traceability-events :: BATCH_CREATED (MNG-1792159666172)
  '8ff803e7-523e-4832-a4ac-a96dee56422e', // traceability-events :: BATCH_CREATED (TOM-1792161447547)
  '0964e2f7-f166-4822-bc96-394b5e6b3896', // traceability-events :: BATCH_CREATED (MNG-1792161447547)
  '594a432c-e768-435d-98c2-78ddb109efdc', // traceability-events :: BATCH_CREATED (STR-1792161494834)
  'f44daf30-a455-4b83-8e86-20d779c3cb9c', // traceability-events :: BATCH_CREATED (STR-1792161645009)
  'ea3e8c99-a52a-4ed2-892f-46f32a359161', // traceability-events :: BATCH_CREATED (STR-1792161810719)
]);

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export type BacklogClassification =
  | 'ELIGIBLE_CANDIDATE'
  | 'EXCLUDED_FIXTURE'
  | 'DEFERRED_TOPIC'
  | 'REJECTED_UNKNOWN';

export interface BacklogClassificationResult {
  id: string;
  eventId: string;
  topic: string;
  eventType: string;
  classification: BacklogClassification;
  isEligibleForReplay: boolean;
  reason: string;
  validationError?: string | null;
}

export interface PartitionedBacklog<T = OutboxRecord> {
  eligible: T[];
  fixtures: T[];
  deferred: T[];
  rejected: T[];
  allClassifications: BacklogClassificationResult[];
}

// ============================================================================
// PAYLOAD SCHEMA CONTRACT VALIDATION
// ============================================================================

/**
 * Validates payload schema against the target consumer's expected contract.
 */
export function validateReplayPayloadContract(topic: string, eventType: string, payload: any): string | null {
  if (!payload || typeof payload !== 'object') {
    return 'Payload must be a non-null JSON object';
  }

  switch (topic) {
    case 'traceability-events': {
      if (!payload.batch_id || typeof payload.batch_id !== 'string' || payload.batch_id.trim().length === 0) {
        return 'Missing required field: batch_id';
      }
      if (eventType === 'BATCH_CREATED') {
        if (!payload.product_id || typeof payload.product_id !== 'string' || payload.product_id.trim().length === 0) {
          return 'Missing required field: product_id';
        }
        if (!payload.farmer_id || typeof payload.farmer_id !== 'string' || payload.farmer_id.trim().length === 0) {
          return 'Missing required field: farmer_id';
        }
        const qty = payload.quantity !== undefined ? payload.quantity : payload.initial_quantity;
        if (qty === undefined || qty === null || isNaN(Number(qty)) || Number(qty) <= 0) {
          return 'Missing or invalid numeric field: quantity';
        }
        const status = payload.status || payload.initial_status;
        if (!status || typeof status !== 'string' || status.trim().length === 0) {
          return 'Missing required field: status';
        }
      } else if (eventType === 'RETAILER_RECEIVED') {
        if (!payload.retailer_id || typeof payload.retailer_id !== 'string' || payload.retailer_id.trim().length === 0) {
          return 'Missing required field: retailer_id';
        }
        const qty = payload.quantity !== undefined
          ? payload.quantity
          : (payload.received_quantity !== undefined ? payload.received_quantity : payload.quantity_received);
        if (qty === undefined || qty === null || isNaN(Number(qty)) || Number(qty) <= 0) {
          return 'Missing or invalid numeric field: quantity';
        }
      } else {
        return `Unsupported event_type '${eventType}' on topic '${topic}'`;
      }
      break;
    }

    case 'shipment-events': {
      if (!payload.shipment_id || typeof payload.shipment_id !== 'string' || payload.shipment_id.trim().length === 0) {
        return 'Missing required field: shipment_id';
      }
      if (!payload.batch_id || typeof payload.batch_id !== 'string' || payload.batch_id.trim().length === 0) {
        return 'Missing required field: batch_id';
      }
      if (!payload.retailer_id || typeof payload.retailer_id !== 'string' || payload.retailer_id.trim().length === 0) {
        return 'Missing required field: retailer_id';
      }
      if (eventType === 'SHIPMENT_RECEIVED') {
        const qty = payload.quantity !== undefined
          ? payload.quantity
          : (payload.quantity_delivered !== undefined ? payload.quantity_delivered : payload.delivered_quantity);
        if (qty === undefined || qty === null || isNaN(Number(qty)) || Number(qty) <= 0) {
          return 'Missing or invalid numeric field: quantity';
        }
      } else {
        return `Unsupported event_type '${eventType}' on topic '${topic}'`;
      }
      break;
    }

    case 'inventory-events': {
      if (!payload.retailer_id || typeof payload.retailer_id !== 'string' || payload.retailer_id.trim().length === 0) {
        return 'Missing required field: retailer_id';
      }
      if (!payload.batch_id || typeof payload.batch_id !== 'string' || payload.batch_id.trim().length === 0) {
        return 'Missing required field: batch_id';
      }
      if (eventType === 'INVENTORY_CREATED') {
        const qty = payload.quantity !== undefined
          ? payload.quantity
          : (payload.quantity_delivered !== undefined ? payload.quantity_delivered : payload.delivered_quantity);
        if (qty === undefined || qty === null || isNaN(Number(qty)) || Number(qty) <= 0) {
          return 'Missing or invalid numeric field: quantity';
        }
      } else if (eventType === 'SALE_CREATED') {
        const qtySold = payload.quantity_sold !== undefined ? payload.quantity_sold : payload.quantity;
        if (qtySold === undefined || qtySold === null || isNaN(Number(qtySold)) || Number(qtySold) <= 0) {
          return 'Missing or invalid numeric field: quantity_sold';
        }
      } else if (eventType === 'INVENTORY_UPDATED') {
        const newQty = payload.new_quantity !== undefined ? payload.new_quantity : payload.quantity;
        if (newQty === undefined || newQty === null || isNaN(Number(newQty)) || Number(newQty) < 0) {
          return 'Missing or invalid numeric field: new_quantity';
        }
      } else {
        return `Unsupported event_type '${eventType}' on topic '${topic}'`;
      }
      break;
    }

    default:
      return `Topic '${topic}' is not an approved replay topic`;
  }

  return null;
}

// ============================================================================
// CORE SELECTION & CLASSIFICATION ENGINE
// ============================================================================

/**
 * Classifies an individual outbox record for controlled backlog replay.
 * Evaluates fixture exclusion first, then unhandled topics, then schema contract.
 */
export function classifyBacklogRecord(record: {
  id: string;
  event_id: string;
  topic: string;
  event_type: string;
  payload: any;
}): BacklogClassificationResult {
  // 1. EXACT FIXTURE ISOLATION: Check immutable UUID set first
  if (HISTORICAL_ATOM_FIXTURE_IDS.has(record.id)) {
    return {
      id: record.id,
      eventId: record.event_id,
      topic: record.topic,
      eventType: record.event_type,
      classification: 'EXCLUDED_FIXTURE',
      isEligibleForReplay: false,
      reason: 'Identified historical atomicity fixture (excluded prior to claim/lease boundary)',
    };
  }

  // 2. UNHANDLED TOPIC PROTECTION: Check deferred topics
  if ((DEFERRED_UNHANDLED_TOPICS as readonly string[]).includes(record.topic)) {
    return {
      id: record.id,
      eventId: record.event_id,
      topic: record.topic,
      eventType: record.event_type,
      classification: 'DEFERRED_TOPIC',
      isEligibleForReplay: false,
      reason: `Topic '${record.topic}' lacks downstream consumer and projection model`,
    };
  }

  // 3. APPROVED REPLAY TOPICS: Check against consumer-backed topics
  if ((CONTROLLED_REPLAY_APPROVED_TOPICS as readonly string[]).includes(record.topic)) {
    // Validate schema contract
    const validationError = validateReplayPayloadContract(record.topic, record.event_type, record.payload);
    if (validationError) {
      return {
        id: record.id,
        eventId: record.event_id,
        topic: record.topic,
        eventType: record.event_type,
        classification: 'REJECTED_UNKNOWN',
        isEligibleForReplay: false,
        reason: `Schema validation failed: ${validationError}`,
        validationError,
      };
    }

    // Verify it is part of the approved eligible candidates set
    if (!EXPECTED_ELIGIBLE_EVENT_IDS.has(record.id)) {
      return {
        id: record.id,
        eventId: record.event_id,
        topic: record.topic,
        eventType: record.event_type,
        classification: 'REJECTED_UNKNOWN',
        isEligibleForReplay: false,
        reason: `Record ID ${record.id} is not in the verified eligible candidates set for controlled replay`,
      };
    }

    return {
      id: record.id,
      eventId: record.event_id,
      topic: record.topic,
      eventType: record.event_type,
      classification: 'ELIGIBLE_CANDIDATE',
      isEligibleForReplay: true,
      reason: 'Verified eligible consumer-backed business event',
    };
  }

  // 4. UNKNOWN TOPIC: Reject immediately
  return {
    id: record.id,
    eventId: record.event_id,
    topic: record.topic,
    eventType: record.event_type,
    classification: 'REJECTED_UNKNOWN',
    isEligibleForReplay: false,
    reason: `Unknown or unapproved topic '${record.topic}' encountered during replay selection`,
  };
}

/**
 * Reusable selection function for partitioning outbox records for controlled backlog replay.
 *
 * @param records Array of outbox records to evaluate.
 * @param options.failClosedOnUnexpected If true, throws immediately if any rejected records,
 *                                       missing fixtures, or altered fixtures are encountered.
 */
export function selectBacklogReplayCandidates<
  T extends { id: string; event_id: string; topic: string; event_type: string; payload: any }
>(
  records: T[],
  options: { failClosedOnUnexpected?: boolean; requireAllFixtures?: boolean } = {}
): PartitionedBacklog<T> {
  const eligible: T[] = [];
  const fixtures: T[] = [];
  const deferred: T[] = [];
  const rejected: T[] = [];
  const allClassifications: BacklogClassificationResult[] = [];

  for (const record of records) {
    const res = classifyBacklogRecord(record);
    allClassifications.push(res);

    switch (res.classification) {
      case 'ELIGIBLE_CANDIDATE':
        eligible.push(record);
        break;
      case 'EXCLUDED_FIXTURE':
        fixtures.push(record);
        break;
      case 'DEFERRED_TOPIC':
        deferred.push(record);
        break;
      case 'REJECTED_UNKNOWN':
        rejected.push(record);
        break;
    }
  }

  if (options.failClosedOnUnexpected) {
    if (rejected.length > 0) {
      const details = rejected.map((r) => `${r.id} (${r.topic}::${r.event_type})`).join(', ');
      throw new Error(`[FAIL_CLOSED] Replay selection rejected ${rejected.length} unexpected or invalid record(s): ${details}`);
    }

    // Verify all 3 fixtures are accounted for when required or when full dataset is evaluated
    if (options.requireAllFixtures || records.length >= 35) {
      const foundFixtureIds = new Set(fixtures.map((f) => f.id));
      for (const expectedId of HISTORICAL_ATOM_FIXTURE_IDS) {
        if (!foundFixtureIds.has(expectedId)) {
          throw new Error(`[FAIL_CLOSED] Expected historical fixture ${expectedId} was not found or has been altered!`);
        }
      }
    }
  }

  return {
    eligible,
    fixtures,
    deferred,
    rejected,
    allClassifications,
  };
}

/**
 * Simple pre-claim predicate to verify if a single record is safe to claim and replay.
 */
export function isEventEligibleForControlledReplay(record: {
  id: string;
  event_id: string;
  topic: string;
  event_type: string;
  payload: any;
}): boolean {
  const result = classifyBacklogRecord(record);
  return result.isEligibleForReplay;
}

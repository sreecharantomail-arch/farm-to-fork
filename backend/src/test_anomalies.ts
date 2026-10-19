import './test_preload';
import { assertApprovedLocalEnvironment } from './utils/localDatabaseGuard';

assertApprovedLocalEnvironment('TestAnomalies');

import { analyzeAnomalies } from './controllers/anomalyController';

const runTests = () => {
  let passed = 0;
  let failed = 0;

  const assert = (condition: boolean, message: string) => {
    if (condition) {
      console.log(`✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${message}`);
      failed++;
    }
  };

  // A. Valid complete sequence -> no anomaly
  const validEvents = [
    { product_id: 'p1', event_type: 'REGISTERED', timestamp: '2026-01-01T10:00:00Z' },
    { product_id: 'p1', event_type: 'PROCESSOR_RECEIVED', timestamp: '2026-01-02T10:00:00Z' },
    { product_id: 'p1', event_type: 'PROCESSED', timestamp: '2026-01-03T10:00:00Z' }
  ];
  const resA = analyzeAnomalies(validEvents);
  assert(resA.anomalies.length === 0, 'A. Valid sequence should have 0 anomalies');

  // B. Traceability gap -> Impossible Event Sequence (due to missing upstream)
  const gapEvents = [
    { product_id: 'p2', event_type: 'REGISTERED', timestamp: '2026-01-01T10:00:00Z' },
    // missing PROCESSOR_RECEIVED
    { product_id: 'p2', event_type: 'PROCESSED', timestamp: '2026-01-03T10:00:00Z' }
  ];
  const resB = analyzeAnomalies(gapEvents);
  assert(resB.anomalies.some(a => a.type === 'Impossible Event Sequence' && a.severity === 'CRITICAL'), 'B. Traceability gap (missing required upstream) detected as Impossible Event Sequence');

  // D. Temporal violation -> Temporal Anomaly
  const tempEvents = [
    { product_id: 'p3', event_type: 'REGISTERED', timestamp: '2026-01-01T10:00:00Z' },
    { product_id: 'p3', event_type: 'PROCESSOR_RECEIVED', timestamp: '2026-01-04T10:00:00Z' },
    { product_id: 'p3', event_type: 'PROCESSED', timestamp: '2026-01-03T10:00:00Z' } // PROCESSED before RECEIVED
  ];
  const resD = analyzeAnomalies(tempEvents);
  assert(resD.anomalies.some(a => a.type === 'Temporal Anomaly' && a.severity === 'CRITICAL'), 'D. Temporal violation detected as Temporal Anomaly');

  // E. Duplicate lifecycle event
  const dupEvents = [
    { product_id: 'p4', event_type: 'REGISTERED', timestamp: '2026-01-01T10:00:00Z' },
    { product_id: 'p4', event_type: 'REGISTERED', timestamp: '2026-01-01T11:00:00Z' }
  ];
  const resE = analyzeAnomalies(dupEvents);
  assert(resE.anomalies.some(a => a.type === 'Duplicate Lifecycle Event' && a.severity === 'MEDIUM'), 'E. Duplicate lifecycle event detected');

  // G. Empty dataset
  const resG = analyzeAnomalies([]);
  assert(resG.anomalies.length === 0 && resG.summary.total === 0, 'G. Empty dataset yields 0 anomalies');

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
};

runTests();

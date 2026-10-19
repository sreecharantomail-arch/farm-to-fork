import { Router } from 'express';
import { 
  getIncomingShipments, 
  receiveShipment, 
  getDistributorBatches, 
  createShipment,
  getOutgoingShipments,
  submitProofOfDelivery,
  getDeliveryProof,
  getColdChainThresholds,
  saveColdChainThreshold,
  recordColdChainReading,
  getShipmentColdChain,
  getColdChainAlerts,
  acknowledgeColdChainAlert,
  resolveColdChainAlert,
  optimizeRoute,
  saveRoutePlan,
  getRoutePlans,
  getRoutePlanById,
  dispatchRoutePlan,
  getLogisticsMetrics
} from '../controllers/distributorController';
import { protect, authorize } from '../middleware/auth';

const router = Router();

// Protect all routes
router.use(protect);
router.use(authorize('distributor', 'admin'));

// Existing Shipment & Custody Routes
router.get('/shipments/incoming', getIncomingShipments);
router.get('/shipments/outgoing', getOutgoingShipments);
router.post('/shipments/:id/receive', receiveShipment);
router.post('/shipments/:id/proof-of-delivery', submitProofOfDelivery);
router.get('/shipments/:id/proof-of-delivery', getDeliveryProof);
router.get('/batches', getDistributorBatches);
router.post('/shipments', createShipment);

// Cold-Chain Monitoring & Food Safety
router.get('/cold-chain/thresholds', getColdChainThresholds);
router.post('/cold-chain/thresholds', saveColdChainThreshold);
router.post('/cold-chain/readings', recordColdChainReading);
router.get('/cold-chain/shipments/:id', getShipmentColdChain);
router.get('/cold-chain/alerts', getColdChainAlerts);
router.post('/cold-chain/alerts/:id/acknowledge', acknowledgeColdChainAlert);
router.post('/cold-chain/alerts/:id/resolve', resolveColdChainAlert);

// Intelligent Route Planning & Delivery Optimization
router.post('/routes/optimize', optimizeRoute);
router.post('/routes', saveRoutePlan);
router.get('/routes', getRoutePlans);
router.get('/routes/:id', getRoutePlanById);
router.post('/routes/:id/dispatch', dispatchRoutePlan);
router.put('/routes/:id/dispatch', dispatchRoutePlan);

// Data-Derived Logistics Metrics (No Mock Metrics)
router.get('/metrics/logistics', getLogisticsMetrics);

export default router;

import express from 'express';
import { protect, authorize } from '../middleware/auth';
import {
  getProcessorRequests,
  claimProcessorRequest,
  getProcessorBatches,
  getIncomingShipments,
  receiveShipment,
  processBatch,
  intakeProduct,
  transferBatch,
  getProcessorEvents
} from '../controllers/processorController';

const router = express.Router();

// Require authentication and processor role for all routes in this file
router.use(protect);
router.use(authorize('processor'));

router.get('/requests', getProcessorRequests);
router.post('/requests/:id/claim', claimProcessorRequest);
router.get('/batches', getProcessorBatches);
router.get('/shipments/incoming', getIncomingShipments);
router.post('/shipments/:id/receive', receiveShipment);
router.post('/batches/:id/process', processBatch);
router.post('/intake', intakeProduct);
router.post('/batches/:id/transfer', transferBatch);
router.get('/events', getProcessorEvents);

export default router;

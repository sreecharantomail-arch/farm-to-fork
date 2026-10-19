import { Router } from 'express';
import { getSupplyChainAnomalies } from '../controllers/anomalyController';
import { protect, authorize } from '../middleware/auth';

const router = Router();

// Endpoint for retrieving supply chain anomalies
// Strictly limited to admin roles via RBAC.
router.get('/anomalies', protect, authorize('admin'), getSupplyChainAnomalies);

export default router;
import { Router } from 'express';
import { getSupplyChainAnalytics } from '../controllers/analyticsController';
import { protect, authorize } from '../middleware/auth';

const router = Router();

// Endpoint for retrieving supply chain analytics
// Strictly limited to admin roles via RBAC.
router.get('/supply-chain', protect, authorize('admin'), getSupplyChainAnalytics);

export default router;

import { Router } from 'express';
import { protect, authorize } from '../middleware/auth';
import { getDecisionSupport } from '../controllers/decisionController';

const router = Router();

// Endpoint for operational decision support
// It allows all valid roles and isolates their data in the controller
router.get('/', protect, authorize('farmer', 'processor', 'distributor', 'retailer', 'admin'), getDecisionSupport);

export default router;

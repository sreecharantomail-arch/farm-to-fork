import { Router } from 'express';
import { getAiObservability, proxyPricePrediction } from '../controllers/aiController';
import { protect, authorize } from '../middleware/auth';
import { aiLimiter } from '../middleware/rateLimit';
const router = Router();

// Farmer AI proxy routes
router.post('/price-prediction', protect, authorize('farmer'), aiLimiter, proxyPricePrediction);

// Admin Observability route
router.get('/observability', protect, authorize('admin'), getAiObservability);

export default router;

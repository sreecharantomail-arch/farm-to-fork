import { Router } from 'express';
import { protect, authorize } from '../middleware/auth';
import { getFarmerDashboard, getFarmerAnalytics } from '../controllers/farmerController';

const router = Router();

// Protect all routes in this router
router.use(protect);
router.use(authorize('farmer', 'admin'));

router.get('/dashboard', getFarmerDashboard);
router.get('/analytics', getFarmerAnalytics);

export default router;

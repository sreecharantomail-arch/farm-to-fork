import { Router } from 'express';
import { register, login, updateUserStatus, getDistributors } from '../controllers/authController';
import { protect } from '../middleware/auth';
import { authLimiter } from '../middleware/rateLimit';
const router = Router();

router.post('/register', authLimiter, register);
router.post('/login', authLimiter, login);
router.put('/status', protect, updateUserStatus);
router.get('/distributors', protect, getDistributors);

export default router;

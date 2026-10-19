import { Router } from 'express';
import { protect, authorize } from '../middleware/auth';
import {
  createProductRequest,
  getMyRequests,
  getRetailerShipments,
  verifyBatch,
  receiveProduct,
  getShipmentDeliveryProof,
  acknowledgeDeliveryReceipt,
  reportDeliveryDiscrepancy,
  getRetailerInventory,
  recordSale,
  getSales,
  reportWastage,
  getWastage,
  getBatchTraceability,
  processReturn,
  getReturns,
  getDashboardData
} from '../controllers/retailerController';

const router = Router();

// Protect all routes in this router
router.use(protect);
router.use(authorize('retailer'));

router.get('/test', (req, res) => {
  res.json({ success: true, message: 'Retailer API accessible' });
});

router.post('/requests', createProductRequest);
router.get('/requests', getMyRequests);
router.get('/shipments', getRetailerShipments);
router.get('/shipments/:id/proof-of-delivery', getShipmentDeliveryProof);
router.post('/shipments/:id/acknowledge-delivery', acknowledgeDeliveryReceipt);
router.post('/shipments/:id/report-discrepancy', reportDeliveryDiscrepancy);
router.post('/verify-batch', verifyBatch);
router.post('/receive-product', receiveProduct);
router.get('/inventory', getRetailerInventory);
router.post('/sales', recordSale);
router.get('/sales', getSales);
router.post('/wastage', reportWastage);
router.get('/wastage', getWastage);
router.get('/traceability/:batch_number', getBatchTraceability);
router.post('/returns', processReturn);
router.get('/returns', getReturns);
router.get('/dashboard', getDashboardData);

export default router;

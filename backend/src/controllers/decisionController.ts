import { Request, Response } from 'express';
import { 
  getFarmerDecisions, 
  getProcessorDecisions, 
  getDistributorDecisions, 
  getRetailerDecisions, 
  getAdminDecisions 
} from '../services/decisionSupportService';

export const getDecisionSupport = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user;
    if (!user || !user.id || !user.role) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    let decisionData;

    switch (user.role) {
      case 'farmer':
        decisionData = await getFarmerDecisions(user.id);
        break;
      case 'processor':
        decisionData = await getProcessorDecisions(user.id);
        break;
      case 'distributor':
        decisionData = await getDistributorDecisions(user.id);
        break;
      case 'retailer':
        decisionData = await getRetailerDecisions(user.id);
        break;
      case 'admin':
        decisionData = await getAdminDecisions();
        break;
      default:
        decisionData = { status: 'INSUFFICIENT_DATA', signals: [] };
    }

    res.status(200).json({
      success: true,
      data: decisionData
    });
  } catch (error) {
    console.error('Decision Support Error:', error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

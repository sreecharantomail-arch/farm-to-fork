import { Request, Response } from 'express';
import { supabase } from '../config/supabase';

export const getFarmerDashboard = async (req: Request, res: Response): Promise<void> => {
  try {
    const farmerId = (req as any).user?.id;

    if (!farmerId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    // 1. Get Farmer's Products
    const { data: products, error: productError } = await supabase
      .from('products')
      .select('id, status, batch_number, created_at')
      .eq('farmer_id', farmerId)
      .limit(1000);

    if (productError) {
      console.error('error occurred');
      res.status(500).json({ success: false, message: 'Database error'});
      return;
    }

    // 2. Calculate Product Statistics
    const totalProducts = products?.length || 0;
    const activeProducts = products?.filter(p => !['Delivered', 'Sold', 'Rejected by Processor'].includes(p.status)).length || 0;
    const completedProducts = products?.filter(p => ['Delivered', 'Sold'].includes(p.status)).length || 0;

    // 3. Status Summary
    const statusSummary = {
      processing: products?.filter(p => p.status === 'Processing').length || 0,
      inTransit: products?.filter(p => p.status === 'In Transit').length || 0,
      delivered: products?.filter(p => p.status === 'Delivered').length || 0,
      harvested: products?.filter(p => p.status === 'Harvested').length || 0,
      pendingApproval: products?.filter(p => p.status === 'Pending Approval').length || 0,
    };

    // 4. Traceability / Recent Activity
    // Fetch recent traceability events associated with this farmer's products
    let recentActivity: any[] = [];
    if (products && products.length > 0) {
      const productIds = products.map(p => p.id);
      const { data: events, error: eventError } = await supabase
        .from('traceability_events')
        .select('*')
        .in('product_id', productIds)
        .order('created_at', { ascending: false })
        .limit(10);

      if (!eventError && events) {
        recentActivity = events.map(e => ({
          id: e.id,
          title: `Traceability: ${e.event_type}`,
          description: `Batch ${e.batch_number} recorded at ${e.location}`,
          date: e.created_at,
          type: 'traceability'
        }));
      }
    }

    // Add product creation events to recent activity
    products?.forEach(p => {
      recentActivity.push({
        id: p.id + '_created',
        title: `Product created`,
        description: `Batch ${p.batch_number} was created. Status: ${p.status}`,
        date: p.created_at,
        type: 'product_created'
      });
    });

    // Sort recent activity by date descending and take top 10
    recentActivity.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    recentActivity = recentActivity.slice(0, 10);

    res.status(200).json({
      success: true,
      data: {
        stats: {
          totalProducts,
          activeProducts,
          completedProducts,
          pendingRequests: 0 // No direct relationship in current schema for farmer requests
        },
        statusSummary,
        recentActivity
      }
    });

  } catch (error) {
    console.error('error occurred');
      res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const getFarmerAnalytics = async (req: Request, res: Response): Promise<void> => {
  try {
    const farmerId = (req as any).user?.id;
    if (!farmerId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const { data: products, error: productError } = await supabase
      .from('products')
      .select('*')
      .eq('farmer_id', farmerId)
      .limit(5000);

    if (productError) {
      res.status(500).json({ success: false, message: 'Database error'});
      return;
    }

    // 1. Core Metrics
    const totalProducts = products?.length || 0;
    const totalQuantity = products?.reduce((sum, p) => sum + (Number(p.quantity) || 0), 0) || 0;
    const activeQuantity = products?.filter(p => !['Delivered', 'Sold'].includes(p.status)).reduce((sum, p) => sum + (Number(p.quantity) || 0), 0) || 0;
    const deliveredQuantity = products?.filter(p => ['Delivered', 'Sold'].includes(p.status)).reduce((sum, p) => sum + (Number(p.quantity) || 0), 0) || 0;

    // 2. Status Distribution
    const statusDistribution = products?.reduce((acc: any, p) => {
      const status = p.status || 'Unknown';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});

    // 3. Quality Analytics
    let totalQualityScore = 0;
    let qualityScoreCount = 0;
    const qualityDistribution: any = {};
    
    products?.forEach(p => {
      // Average quality
      if (p.ai_quality_score && p.ai_quality_score > 0) {
        totalQualityScore += p.ai_quality_score;
        qualityScoreCount++;
      }
      
      // Distribution
      if (p.ai_quality_label && p.ai_quality_label !== 'Unknown' && p.ai_quality_label !== 'N/A') {
        qualityDistribution[p.ai_quality_label] = (qualityDistribution[p.ai_quality_label] || 0) + 1;
      } else if (p.ai_quality_score && p.ai_quality_score > 0) {
        const label = p.ai_quality_score >= 90 ? 'Grade A' : p.ai_quality_score >= 80 ? 'Grade B' : 'Standard Grade';
        qualityDistribution[label] = (qualityDistribution[label] || 0) + 1;
      }
    });
    
    const averageQuality = qualityScoreCount > 0 ? Math.round(totalQualityScore / qualityScoreCount) : null;

    // 4. Shelf-Life / Expiry Analytics
    let expiredCount = 0;
    let expiringSoonCount = 0; // <= 7 days
    let healthyShelfLifeCount = 0;
    const now = new Date();
    
    products?.forEach(p => {
      if (p.expiry_date) {
        const exp = new Date(p.expiry_date);
        const diffTime = exp.getTime() - now.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        if (diffDays < 0) expiredCount++;
        else if (diffDays <= 7) expiringSoonCount++;
        else healthyShelfLifeCount++;
      }
    });

    // 5. Production Trend (Monthly)
    const trendMap = new Map<string, number>();
    products?.forEach(p => {
      if (p.created_at) {
        const d = new Date(p.created_at);
        const monthYear = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        trendMap.set(monthYear, (trendMap.get(monthYear) || 0) + (Number(p.quantity) || 0));
      }
    });
    
    // Sort trend keys chronologically
    const sortedMonths = Array.from(trendMap.keys()).sort();
    const productionTrend = sortedMonths.map(month => ({
      period: month,
      quantity: trendMap.get(month)
    }));

    // 6. Traceability Analytics
    let totalTraceabilityEvents = 0;
    if (products && products.length > 0) {
      const productIds = products.map(p => p.id);
      const { data: events, error: eventError } = await supabase
        .from('traceability_events')
        .select('id')
        .in('product_id', productIds);
        
      if (!eventError && events) {
        totalTraceabilityEvents = events.length;
      }
    }

    res.status(200).json({
      success: true,
      data: {
        core: {
          totalProducts,
          totalQuantity,
          activeQuantity,
          deliveredQuantity
        },
        statusDistribution,
        quality: {
          averageQuality,
          qualityDistribution,
          productsWithQualityData: qualityScoreCount
        },
        shelfLife: {
          expired: expiredCount,
          expiringSoon: expiringSoonCount,
          healthy: healthyShelfLifeCount,
          totalTracked: expiredCount + expiringSoonCount + healthyShelfLifeCount
        },
        productionTrend,
        traceability: {
          totalEvents: totalTraceabilityEvents
        }
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

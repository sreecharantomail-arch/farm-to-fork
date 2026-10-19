import { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { blockchainService, BlockchainStatus } from '../services/blockchainService';

export const getDashboardStats = async (req: Request, res: Response) => {
  try {
    const { count: productCount } = await supabase.from('products').select('*', { count: 'exact', head: true });
    
    const { data: activeShipments } = await supabase
      .from('products')
      .select('id')
      .in('status', ['In Transit', 'Processing']);
      
    const { count: userCount } = await supabase.from('users').select('*', { count: 'exact', head: true });

    const { data: aiAlerts } = await supabase
      .from('products')
      .select('id, name, batch_number, status, ai_quality_label, ai_quality_score')
      .eq('ai_quality_label', 'Poor')
      .order('created_at', { ascending: false })
      .limit(5);

    const { data: pendingUsers } = await supabase
      .from('users')
      .select('id, name, email, role, created_at')
      .like('role', 'pending_%')
      .order('created_at', { ascending: false })
      .limit(5);

    const { data: pendingProducts } = await supabase
      .from('products')
      .select('id, name, batch_number, quantity, category, created_at')
      .eq('status', 'Pending Approval')
      .order('created_at', { ascending: false })
      .limit(5);

    const { data: recentActivity } = await supabase
      .from('products')
      .select('id, name, batch_number, status, created_at')
      .order('created_at', { ascending: false })
      .limit(10);

    res.status(200).json({
      success: true,
      data: {
        totalProducts: productCount || 0,
        activeShipments: activeShipments?.length || 0,
        totalUsers: userCount || 0,
        aiAlerts: aiAlerts?.length || 0,
        alertsList: aiAlerts || [],
        pendingUsers: pendingUsers || [],
        pendingProducts: pendingProducts || [],
        recentActivity: recentActivity || []
      }
    });
  } catch (error) {
    console.error('error occurred');
      res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const getAllUsers = async (req: Request, res: Response) => {
  try {
    const { data: users, error } = await supabase
      .from('users')
      .select('id, name, email, role, created_at, wallet_address')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.status(200).json({ success: true, data: users });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const updateUserRole = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { role } = req.body;
    
    if (!role) {
      res.status(400).json({ success: false, message: 'Role is required' });
      return;
    }

    const { data, error } = await supabase
      .from('users')
      .update({ role })
      .eq('id', id)
      .select('id, name, email, role')
      .single();

    if (error) throw error;
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const deleteUser = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase.from('users').delete().eq('id', id).select();

    if (error) throw error;
    res.status(200).json({ success: true, message: 'User deleted successfully', data });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const getBlockchainHealth = async (req: Request, res: Response) => {
  try {
    const health = await blockchainService.getHealth();
    
    if (health.status === 'warning') {
       res.status(200).json({ 
          success: true, 
          data: { 
             status: 'warning', 
             message: 'Blockchain env variables not configured on backend',
             walletBalance: '0.0',
             network: 'Unknown'
          }
       });
       return;
    }

    res.status(200).json({
      success: true,
      data: health
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Blockchain Connection Error' });
  }
};

export const getAnalytics = async (req: Request, res: Response) => {
  try {
    const { data: users, error: userError } = await supabase.from('users').select('id, role, created_at');
    const { data: products, error: productError } = await supabase.from('products').select('id, name, quantity, status, ai_quality_label, created_at, blockchain_hash');

    if (userError || productError) throw new Error('Database fetch failed');

    const activeUsers = users.length;
    const productsTracked = products.length;
    
    // Total Volume tracked
    const totalVolume = products.reduce((sum, p) => sum + (Number(p.quantity) || 0), 0);
    const blockchainTxs = products.filter(p => p.blockchain_hash).length;

    // Quality distribution
    const qualityMap: Record<string, number> = { 'Excellent': 0, 'Good': 0, 'Average': 0, 'Poor': 0, 'Unknown': 0 };
    products.forEach(p => {
      const label = p.ai_quality_label || 'Unknown';
      if (qualityMap[label] !== undefined) qualityMap[label]++;
      else qualityMap['Unknown']++;
    });

    const qualityData = [
      { name: "Excellent", value: qualityMap['Excellent'], color: "#22c55e" },
      { name: "Good", value: qualityMap['Good'], color: "#84cc16" },
      { name: "Average", value: qualityMap['Average'], color: "#eab308" },
      { name: "Poor", value: qualityMap['Poor'], color: "#ef4444" },
    ].filter(q => q.value > 0);

    // Status / Stage distribution
    const statusMap: Record<string, number> = {};
    products.forEach(p => {
      const status = p.status || 'Harvested';
      statusMap[status] = (statusMap[status] || 0) + 1;
    });
    
    // A nice color palette for statuses
    const statusColors: Record<string, string> = {
      'Harvested': '#3b82f6',
      'In Transit': '#f59e0b',
      'Processed': '#8b5cf6',
      'Quality Checked': '#10b981',
      'At Retailer': '#ec4899',
      'Sold': '#6b7280',
      'Pending Approval': '#94a3b8'
    };
    
    const stageData = Object.entries(statusMap).map(([status, count]) => ({
      name: status,
      value: count,
      color: statusColors[status] || '#cbd5e1'
    }));

    // Recent Transactions
    const recentTx = products
      .filter(p => p.blockchain_hash)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 5)
      .map(p => ({
        id: p.blockchain_hash.substring(0, 6) + '...' + p.blockchain_hash.slice(-4),
        product: p.name,
        type: 'Register',
        time: new Date(p.created_at).toLocaleDateString(),
        status: 'Confirmed'
      }));

    // For charts, mock last 6 months structure
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const currentMonth = new Date().getMonth();
    const last6Months = Array.from({length: 6}, (_, i) => {
      let d = new Date();
      d.setMonth(d.getMonth() - (5 - i));
      return { month: months[d.getMonth()], num: d.getMonth(), year: d.getFullYear() };
    });

    const monthlyData = last6Months.map(m => {
      const prodsInMonth = products.filter(p => {
        const d = new Date(p.created_at);
        return d.getMonth() === m.num && d.getFullYear() === m.year;
      });
      return {
        month: m.month,
        products: prodsInMonth.length,
        volume: prodsInMonth.reduce((sum, p) => sum + (Number(p.quantity) || 0), 0)
      };
    });

    const userGrowthData = last6Months.map(m => {
      const usersInMonth = users.filter(u => {
        const d = new Date(u.created_at);
        return d.getMonth() === m.num && d.getFullYear() === m.year;
      });
      return {
        month: m.month,
        farmers: usersInMonth.filter(u => u.role === 'farmer').length,
        processors: usersInMonth.filter(u => u.role === 'processor').length,
        distributors: usersInMonth.filter(u => u.role === 'distributor').length,
      };
    });

    res.status(200).json({
      success: true,
      data: {
        activeUsers,
        productsTracked,
        totalVolume,
        blockchainTxs,
        qualityData,
        stageData,
        recentTx,
        monthlyData,
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const approveProduct = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    const { data: product, error: fetchErr } = await supabase.from('products').select('*').eq('id', id).single();
    if (fetchErr || !product) {
      res.status(404).json({ success: false, message: 'Product not found' });
      return;
    }

    if (product.status !== 'Pending Approval') {
      res.status(400).json({ success: false, message: 'Product is not pending approval' });
      return;
    }

    let finalBlockchainHash = product.blockchain_hash;
    let finalProductId = product.product_id;

    if (!finalBlockchainHash) {
      const bcResult = await blockchainService.registerProduct(
        product.id,
        product.name,
        product.category,
        product.batch_number,
        product.quantity,
        'Harvested'
      );
      if (bcResult.status === BlockchainStatus.ON_CHAIN_VERIFICATION_FAILED) {
        res.status(500).json({
          success: false,
          message: (bcResult as any).error ? `Blockchain registration failed: ${(bcResult as any).error}` : 'Blockchain registration failed'
        });
        return;
      }
      finalBlockchainHash = bcResult.txHash;
    }

    const { data: updated, error: updateErr } = await supabase
      .from('products')
      .update({
        status: 'Harvested',
        blockchain_hash: finalBlockchainHash,
        product_id: finalProductId
      })
      .eq('id', id)
      .select()
      .single();

    if (updateErr) throw updateErr;

    const successMessage = finalBlockchainHash
      ? 'Product approved and registered on blockchain'
      : 'Product approved (database only - blockchain not configured)';

    res.status(200).json({ success: true, message: successMessage, data: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const getUserDetails = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    // Attempt to fetch phone and address if they exist in schema, otherwise they will be undefined
    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('id, name, email, role, wallet_address, phone, address, created_at')
      .eq('id', id)
      .single();
      
    let finalUser: any = user;

    if (userErr || !user) {
      // If phone/address columns don't exist, fallback to basic fields
      const { data: fallbackUser, error: fallbackErr } = await supabase
        .from('users')
        .select('id, name, email, role, wallet_address, created_at')
        .eq('id', id)
        .single();
        
      if (fallbackErr || !fallbackUser) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
      }
      finalUser = fallbackUser;
    }

    const { data: products, error: prodErr } = await supabase
      .from('products')
      .select('id, product_id, name, category, batch_number, quantity, status, ai_quality_label, ai_quality_score, created_at, blockchain_hash')
      .or(`farmer_id.eq.${id},current_owner_id.eq.${id}`)
      .order('created_at', { ascending: false });

    const totalBatches = products?.length || 0;
    const totalQuantity = products?.reduce((sum, p) => sum + (Number(p.quantity) || 0), 0) || 0;
    
    // Advanced stats
    let totalScore = 0;
    let scoredCount = 0;
    const statusDistribution: Record<string, number> = {};
    
    products?.forEach(p => {
      statusDistribution[p.status] = (statusDistribution[p.status] || 0) + 1;
      if (p.ai_quality_score > 0) {
        totalScore += p.ai_quality_score;
        scoredCount++;
      }
    });

    const avgQuality = scoredCount > 0 ? (totalScore / scoredCount) * 100 : 0;

    res.status(200).json({
      success: true,
      data: {
        user: finalUser,
        stats: { 
          totalBatches, 
          totalQuantity,
          avgQuality: avgQuality.toFixed(0),
          statusDistribution 
        },
        products: products || []
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const getProductDetails = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    // Attempt with join
    let { data: product, error: prodErr } = await supabase
      .from('products')
      .select('*, farmer:users!farmer_id(name, email), owner:users!current_owner_id(name, email)')
      .eq('id', id)
      .single();

    if (prodErr || !product) {
      // Fallback
      const { data: fallbackProduct, error: fallbackErr } = await supabase
        .from('products')
        .select('*')
        .eq('id', id)
        .single();
        
      if (fallbackErr || !fallbackProduct) {
        res.status(404).json({ success: false, message: 'Product not found' });
        return;
      }
      product = fallbackProduct;
    }

    res.status(200).json({ success: true, data: product });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

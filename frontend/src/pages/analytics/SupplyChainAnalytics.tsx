import { useEffect, useState } from 'react';
import axios from 'axios';
import { Activity, Clock, Box, ShieldAlert, BarChart3, TrendingUp, Search } from 'lucide-react';
import { DecisionSupportPanel } from '../../components/DecisionSupportPanel';
import { getApiBaseUrl, getAuthToken } from '../../utils';

interface SupplyChainAnalyticsData {
  journeyTimes: {
    processing: { averageHours: number | null, medianHours: number | null, minHours: number | null, maxHours: number | null, samples: number };
    transit: { averageHours: number | null, medianHours: number | null, minHours: number | null, maxHours: number | null, samples: number };
    endToEnd: { averageHours: number | null, samples: number };
  };
  bottlenecks: Array<{
    stage: string;
    average_hours: number;
    median_hours: number;
    sample_count: number;
    relative_to_median: number;
    status: string;
  }>;
  lossAnalytics: {
    totalWastageQuantity: number;
    totalReturnedQuantity: number;
    totalSalesQuantity: number;
    wastageRate: number | null;
    returnRate: number | null;
    damagedReturns: number;
    expiredWastage: number;
  };
  inventoryIntelligence: {
    totalInventoryQuantity: number;
    availableInventory: number;
    expiredInventory: number;
    inventoryByStatus: Record<string, number>;
  };
  shipmentPerformance: {
    totalShipments: number;
    completedShipments: number;
    pendingShipments: number;
    cancelledShipments: number;
    shipmentCompletionRate: number | null;
  };
  traceabilityCompleteness: {
    productsWithEvents: number;
    productsWithoutEvents: number;
    completeJourneys: number;
    partialJourneys: number;
    eventCountsByType: Record<string, number>;
  };
  lineageAnalytics: {
    totalTransformations: number;
    processedChildBatches: number;
    batchesWithLineage: boolean;
  };
}

export default function SupplyChainAnalytics() {
  const [data, setData] = useState<SupplyChainAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const fetchAnalytics = async () => {
    try {
      const token = getAuthToken();
      const apiBase = getApiBaseUrl();
      const response = await axios.get(`${apiBase}/analytics/supply-chain`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (response.data.success) {
        setData(response.data.data);
      } else {
        setError(response.data.message || 'Failed to fetch analytics');
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Server error while fetching analytics');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex justify-center items-center text-slate-500 h-full">
        <Activity className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8 w-full">
        <div className="bg-red-50 text-red-600 p-4 rounded-xl border border-red-200">
          {error || 'No data available.'}
        </div>
      </div>
    );
  }

  const formatHours = (hours: number | null) => {
    if (hours === null) return 'Insufficient data';
    return `${hours.toFixed(1)} hrs`;
  };

  const formatPercent = (rate: number | null) => {
    if (rate === null) return 'N/A';
    return `${(rate * 100).toFixed(1)}%`;
  };

  return (
    <div className="text-slate-900 dark:text-slate-100 flex flex-col font-sans h-full">
      <main className="flex-1 w-full space-y-8">
        
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Intelligent Supply-Chain Analytics</h1>
          <p className="text-slate-500 mt-2 text-lg">Real-time operational intelligence derived purely from physical database records.</p>
        </header>

        <DecisionSupportPanel />

        {/* 1. Overview KPIs */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-slate-200 dark:border-white/5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Total Shipments</h3>
              <Box className="text-blue-500 h-5 w-5" />
            </div>
            <p className="text-3xl font-bold">{data.shipmentPerformance.totalShipments === 0 ? '0' : data.shipmentPerformance.totalShipments}</p>
            <p className="text-sm text-slate-500 mt-2">{formatPercent(data.shipmentPerformance.shipmentCompletionRate)} Completion Rate</p>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-slate-200 dark:border-white/5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Total Wastage</h3>
              <ShieldAlert className="text-red-500 h-5 w-5" />
            </div>
            <p className="text-3xl font-bold">{data.lossAnalytics.totalWastageQuantity === 0 ? '0' : data.lossAnalytics.totalWastageQuantity}</p>
            <p className="text-sm text-slate-500 mt-2">{formatPercent(data.lossAnalytics.wastageRate)} of disposed items</p>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-slate-200 dark:border-white/5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Avg Transit Time</h3>
              <Clock className="text-amber-500 h-5 w-5" />
            </div>
            <p className="text-3xl font-bold">{data.journeyTimes.transit.averageHours !== null ? data.journeyTimes.transit.averageHours.toFixed(1) : '—'}</p>
            <p className="text-sm text-slate-500 mt-2">{data.journeyTimes.transit.samples === 0 ? 'Insufficient data' : 'Hours from Dist. to Retailer'}</p>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-slate-200 dark:border-white/5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Complete Journeys</h3>
              <BarChart3 className="text-green-500 h-5 w-5" />
            </div>
            <p className="text-3xl font-bold">{data.traceabilityCompleteness.completeJourneys === 0 ? '0' : data.traceabilityCompleteness.completeJourneys}</p>
            <p className="text-sm text-slate-500 mt-2">End-to-End verified products</p>
          </div>
        </div>

        {/* 2. Bottlenecks & Journey Time */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-slate-200 dark:border-white/5 shadow-sm">
            <h2 className="text-xl font-bold mb-6 flex items-center gap-2"><Search className="h-5 w-5 text-indigo-500"/> Bottleneck Detection</h2>
            {data.bottlenecks.length === 0 && <p className="text-slate-500">No data available for bottleneck analysis.</p>}
            <div className="space-y-4">
              {data.bottlenecks.map((b, i) => (
                <div key={i} className={`p-4 rounded-xl border ${b.status === 'Potential Bottleneck' ? 'bg-red-50 border-red-200 dark:bg-red-500/10 dark:border-red-500/20' : 'bg-slate-50 border-slate-200 dark:bg-slate-900/50 dark:border-white/5'}`}>
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-semibold text-sm">{b.stage}</span>
                    <span className={`text-xs px-2 py-1 rounded-full font-bold uppercase tracking-wider ${
                      b.status === 'Potential Bottleneck' ? 'bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400' :
                      b.status === 'Insufficient Data' ? 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300' :
                      'bg-green-100 text-green-600 dark:bg-green-500/20 dark:text-green-400'
                    }`}>
                      {b.status}
                    </span>
                  </div>
                  <div className="text-sm text-slate-600 dark:text-slate-400 flex gap-4">
                    <span>Avg: {formatHours(b.average_hours > 0 ? b.average_hours : null)}</span>
                    <span>Med: {formatHours(b.median_hours > 0 ? b.median_hours : null)}</span>
                    <span>Samples: {b.sample_count}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-slate-200 dark:border-white/5 shadow-sm">
            <h2 className="text-xl font-bold mb-6 flex items-center gap-2"><Clock className="h-5 w-5 text-teal-500"/> Stage Performance</h2>
            <div className="space-y-6">
              
              <div>
                <h4 className="text-sm font-semibold text-slate-500 mb-2">Average Processing Time</h4>
                <div className="text-2xl font-bold">
                  {formatHours(data.journeyTimes.processing.averageHours)}
                </div>
                <p className="text-xs text-slate-500 mt-1">Samples: {data.journeyTimes.processing.samples}</p>
              </div>

              <div>
                <h4 className="text-sm font-semibold text-slate-500 mb-2">Average Transit Time</h4>
                <div className="text-2xl font-bold">
                  {formatHours(data.journeyTimes.transit.averageHours)}
                </div>
                <p className="text-xs text-slate-500 mt-1">Samples: {data.journeyTimes.transit.samples}</p>
              </div>

              <div>
                <h4 className="text-sm font-semibold text-slate-500 mb-2">Average E2E Journey</h4>
                <div className="text-2xl font-bold">
                  {formatHours(data.journeyTimes.endToEnd.averageHours)}
                </div>
                <p className="text-xs text-slate-500 mt-1">Samples: {data.journeyTimes.endToEnd.samples} (Complete Journeys Only)</p>
              </div>

            </div>
          </div>
        </div>

        {/* 3. Loss & Inventory */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-slate-200 dark:border-white/5 shadow-sm">
            <h2 className="text-xl font-bold mb-6 flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-rose-500"/> Retailer Loss & Wastage</h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-slate-50 dark:bg-slate-900/50 rounded-xl">
                <span className="text-sm text-slate-500 block mb-1">Total Wastage</span>
                <span className="text-2xl font-bold">{data.lossAnalytics.totalWastageQuantity === 0 ? '0' : data.lossAnalytics.totalWastageQuantity}</span>
              </div>
              <div className="p-4 bg-slate-50 dark:bg-slate-900/50 rounded-xl">
                <span className="text-sm text-slate-500 block mb-1">Total Returns</span>
                <span className="text-2xl font-bold">{data.lossAnalytics.totalReturnedQuantity === 0 ? '0' : data.lossAnalytics.totalReturnedQuantity}</span>
              </div>
              <div className="p-4 bg-slate-50 dark:bg-slate-900/50 rounded-xl">
                <span className="text-sm text-slate-500 block mb-1">Expired Wastage</span>
                <span className="text-xl font-bold text-red-500">{data.lossAnalytics.expiredWastage === 0 ? '0' : data.lossAnalytics.expiredWastage}</span>
              </div>
              <div className="p-4 bg-slate-50 dark:bg-slate-900/50 rounded-xl">
                <span className="text-sm text-slate-500 block mb-1">Damaged Returns</span>
                <span className="text-xl font-bold text-red-500">{data.lossAnalytics.damagedReturns === 0 ? '0' : data.lossAnalytics.damagedReturns}</span>
              </div>
            </div>
            {data.lossAnalytics.totalSalesQuantity === 0 && data.lossAnalytics.totalWastageQuantity === 0 ? (
              <p className="text-sm text-slate-500 mt-4 italic">No disposed inventory records available.</p>
            ) : null}
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-slate-200 dark:border-white/5 shadow-sm">
            <h2 className="text-xl font-bold mb-6 flex items-center gap-2"><TrendingUp className="h-5 w-5 text-emerald-500"/> Traceability Health</h2>
            
            <div className="space-y-4">
              <div className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-900/50 rounded-lg">
                <span className="text-sm font-medium">Products with Traceability</span>
                <span className="font-bold">{data.traceabilityCompleteness.productsWithEvents === 0 ? '0' : data.traceabilityCompleteness.productsWithEvents}</span>
              </div>
              
              <div className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-900/50 rounded-lg">
                <span className="text-sm font-medium">Products without Traceability</span>
                <span className="font-bold">{data.traceabilityCompleteness.productsWithoutEvents === 0 ? '0' : data.traceabilityCompleteness.productsWithoutEvents}</span>
              </div>

              <div className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-900/50 rounded-lg">
                <span className="text-sm font-medium">Partial Journeys</span>
                <span className="font-bold">{data.traceabilityCompleteness.partialJourneys === 0 ? '0' : data.traceabilityCompleteness.partialJourneys}</span>
              </div>

              <div className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-900/50 rounded-lg">
                <span className="text-sm font-medium">Complete E2E Journeys</span>
                <span className="font-bold text-green-600 dark:text-green-400">{data.traceabilityCompleteness.completeJourneys === 0 ? '0' : data.traceabilityCompleteness.completeJourneys}</span>
              </div>
            </div>
          </div>
        </div>

      </main>
    </div>
  );
}

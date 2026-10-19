import { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../../context/AuthContext';
import { getApiBaseUrl, getAuthToken } from '../../utils';
import { AlertTriangle, AlertOctagon, ArrowRight, RefreshCw, CheckCircle2 } from 'lucide-react';
import { Link } from 'react-router-dom';

interface AlertItem {
  id: string;
  type: 'CRITICAL' | 'WARNING' | 'INFO';
  title: string;
  description: string;
  batchNumber: string;
  actionText: string;
  actionLink: string;
}

export const Alerts = () => {
  const { token } = useAuth();
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastChecked, setLastChecked] = useState<string>('');

  const fetchAlerts = async () => {
    try {
      setLoading(true);
      const apiBase = getApiBaseUrl();
      const effectiveToken = token || getAuthToken();
      const res = await axios.get(`${apiBase}/retailer/inventory`, {
        headers: effectiveToken ? { Authorization: `Bearer ${effectiveToken}` } : {}
      });

      const items = res.data?.data || [];
      const generatedAlerts: AlertItem[] = [];
      const now = new Date();

      items.forEach((item: any) => {
        if (item.status === 'DEPLETED') return;

        // 1. Expiry alerts
        if (item.expiry_date) {
          const expiryDate = new Date(item.expiry_date);
          const diffDays = Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

          if (diffDays <= 0) {
            generatedAlerts.push({
              id: `exp-${item.id}`,
              type: 'CRITICAL',
              title: `Expired Batch: ${item.batch_number}`,
              description: `Product has reached expiry date (${new Date(item.expiry_date).toLocaleDateString()}). ${item.quantity} ${item.unit || 'units'} remaining.`,
              batchNumber: item.batch_number,
              actionText: 'Process Wastage',
              actionLink: '/retailer/expiry'
            });
          } else if (diffDays <= 5) {
            generatedAlerts.push({
              id: `near-exp-${item.id}`,
              type: 'WARNING',
              title: `Expiring Soon: ${item.batch_number}`,
              description: `Batch expires in ${diffDays} day(s). Quantity: ${item.quantity} ${item.unit || 'units'}. Consider discount or priority dispatch.`,
              batchNumber: item.batch_number,
              actionText: 'Review Expiry',
              actionLink: '/retailer/expiry'
            });
          }
        }

        // 2. Low-stock alerts
        if (Number(item.quantity) > 0 && Number(item.quantity) <= 10) {
          generatedAlerts.push({
            id: `low-stock-${item.id}`,
            type: 'WARNING',
            title: `Low Stock: ${item.batch_number}`,
            description: `Only ${item.quantity} ${item.unit || 'units'} left in stock. Reorder recommended.`,
            batchNumber: item.batch_number,
            actionText: 'Request Stock',
            actionLink: '/retailer/requests'
          });
        }
      });

      setAlerts(generatedAlerts);
      setLastChecked(new Date().toLocaleTimeString());
    } catch {
      // Graceful fallback
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAlerts();
  }, [token]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Active Alerts</h1>
          <p className="text-sm text-slate-500 mt-1">Real-time inventory alerts, expiry monitors, and stock replenishment warnings.</p>
        </div>
        <div className="flex items-center gap-3">
          {lastChecked && (
            <span className="text-xs text-slate-400">Updated: {lastChecked}</span>
          )}
          <button
            onClick={fetchAlerts}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center text-slate-400">Loading alerts monitor...</div>
      ) : alerts.length === 0 ? (
        <div className="p-12 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 text-center">
          <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">All Systems Clear</h2>
          <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">No urgent inventory warnings, critical expirations, or stock depletion events detected.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all ${
                alert.type === 'CRITICAL'
                  ? 'border-rose-500/30 bg-rose-500/5'
                  : 'border-amber-500/30 bg-amber-500/5'
              }`}
            >
              <div className="flex items-start gap-3">
                {alert.type === 'CRITICAL' ? (
                  <AlertOctagon className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                )}
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                    {alert.title}
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      alert.type === 'CRITICAL'
                        ? 'bg-rose-500/20 text-rose-600 dark:text-rose-400'
                        : 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
                    }`}>
                      {alert.type}
                    </span>
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">{alert.description}</p>
                </div>
              </div>
              <Link
                to={alert.actionLink}
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 hover:border-primary text-slate-700 dark:text-slate-200 hover:text-primary transition-colors shrink-0"
              >
                {alert.actionText}
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

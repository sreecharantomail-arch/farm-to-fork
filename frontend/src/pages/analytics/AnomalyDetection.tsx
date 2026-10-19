import { useEffect, useState } from 'react';
import axios from 'axios';
import { AlertTriangle, AlertOctagon, Info, AlertCircle, Search, Box } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { Link } from 'react-router-dom';
import { getApiBaseUrl, getAuthToken } from '../../utils';

interface Anomaly {
  id: string;
  type: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  product_id: string;
  batch_number: string | null;
  explanation: string;
  evidence: any;
  detected_at: string;
}

interface AnomalyData {
  summary: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  anomalies: Anomaly[];
  methodology: {
    deterministic_rules: string[];
  };
}

export default function AnomalyDetection() {
  const { token } = useAuth();
  const [data, setData] = useState<AnomalyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterSeverity, setFilterSeverity] = useState<string>('ALL');

  useEffect(() => {
    const fetchAnomalies = async () => {
      try {
        const apiBase = getApiBaseUrl();
        const effectiveToken = token || getAuthToken();
        const res = await axios.get(`${apiBase}/analytics/anomalies`, {
          headers: effectiveToken ? { Authorization: `Bearer ${effectiveToken}` } : {}
        });
        if (res.data.success) {
          setData(res.data.data);
        } else {
          setError(res.data.message || 'Failed to fetch anomalies');
        }
      } catch (err: any) {
        setError(err.response?.data?.message || 'Error communicating with server');
      } finally {
        setLoading(false);
      }
    };
    if (token) fetchAnomalies();
  }, [token]);

  if (loading) {
    return (
      <div className="flex-1 flex justify-center items-center text-slate-500 h-full">
        <div className="animate-spin h-8 w-8 border-4 border-slate-300 border-t-slate-600 rounded-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8 w-full">
        <div className="bg-red-50 text-red-600 p-4 rounded-xl border border-red-200 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" />
          <p>{error || 'Insufficient data for anomaly analysis.'}</p>
        </div>
      </div>
    );
  }

  const filteredAnomalies = data.anomalies.filter(a => filterSeverity === 'ALL' || a.severity === filterSeverity);

  return (
    <div className="text-slate-900 dark:text-slate-100 flex flex-col font-sans h-full">
      <main className="flex-1 w-full space-y-8 p-4 md:p-8">
        
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white flex items-center gap-3">
            <AlertOctagon className="h-8 w-8 text-rose-500" />
            Supply-Chain Anomaly Intelligence
          </h1>
          <p className="text-slate-500 mt-2 text-sm max-w-3xl">
            Deterministic detection of critical data-quality issues, impossible lifecycle event sequencing, and temporal anomalies based on strict business logic. No statistical probability approximations are utilized.
          </p>
        </header>

        {/* Severity Filters & Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div 
            onClick={() => setFilterSeverity('ALL')}
            className={`cursor-pointer p-4 rounded-xl border transition-colors ${filterSeverity === 'ALL' ? 'bg-slate-800 text-white border-slate-700' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-white/10 hover:border-slate-300'}`}
          >
            <div className="text-sm font-semibold opacity-80 uppercase tracking-wider mb-1">Total</div>
            <div className="text-3xl font-bold">{data.summary.total}</div>
          </div>
          <div 
            onClick={() => setFilterSeverity('CRITICAL')}
            className={`cursor-pointer p-4 rounded-xl border transition-colors ${filterSeverity === 'CRITICAL' ? 'bg-rose-600 text-white border-rose-500' : 'bg-white dark:bg-slate-800 border-rose-200 dark:border-rose-900/30 hover:border-rose-300'}`}
          >
            <div className={`text-sm font-semibold uppercase tracking-wider mb-1 ${filterSeverity !== 'CRITICAL' && 'text-rose-600 dark:text-rose-400'}`}>Critical</div>
            <div className="text-3xl font-bold">{data.summary.critical}</div>
          </div>
          <div 
            onClick={() => setFilterSeverity('HIGH')}
            className={`cursor-pointer p-4 rounded-xl border transition-colors ${filterSeverity === 'HIGH' ? 'bg-orange-500 text-white border-orange-400' : 'bg-white dark:bg-slate-800 border-orange-200 dark:border-orange-900/30 hover:border-orange-300'}`}
          >
            <div className={`text-sm font-semibold uppercase tracking-wider mb-1 ${filterSeverity !== 'HIGH' && 'text-orange-500 dark:text-orange-400'}`}>High</div>
            <div className="text-3xl font-bold">{data.summary.high}</div>
          </div>
          <div 
            onClick={() => setFilterSeverity('MEDIUM')}
            className={`cursor-pointer p-4 rounded-xl border transition-colors ${filterSeverity === 'MEDIUM' ? 'bg-amber-500 text-white border-amber-400' : 'bg-white dark:bg-slate-800 border-amber-200 dark:border-amber-900/30 hover:border-amber-300'}`}
          >
            <div className={`text-sm font-semibold uppercase tracking-wider mb-1 ${filterSeverity !== 'MEDIUM' && 'text-amber-500 dark:text-amber-400'}`}>Medium</div>
            <div className="text-3xl font-bold">{data.summary.medium}</div>
          </div>
          <div 
            onClick={() => setFilterSeverity('LOW')}
            className={`cursor-pointer p-4 rounded-xl border transition-colors ${filterSeverity === 'LOW' ? 'bg-blue-500 text-white border-blue-400' : 'bg-white dark:bg-slate-800 border-blue-200 dark:border-blue-900/30 hover:border-blue-300'}`}
          >
            <div className={`text-sm font-semibold uppercase tracking-wider mb-1 ${filterSeverity !== 'LOW' && 'text-blue-500 dark:text-blue-400'}`}>Low</div>
            <div className="text-3xl font-bold">{data.summary.low}</div>
          </div>
        </div>

        {/* Methodology Info Box */}
        <div className="bg-slate-100 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-white/5 flex gap-3 text-sm">
          <Info className="h-5 w-5 text-slate-500 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">Deterministic Rules in Effect:</span>
            <ul className="list-disc list-inside text-slate-600 dark:text-slate-400 space-y-1">
              {data.methodology.deterministic_rules.map((rule, idx) => (
                <li key={idx}>{rule}</li>
              ))}
            </ul>
          </div>
        </div>

        {/* Anomalies List */}
        <div>
          <h2 className="text-xl font-bold mb-4">Detected Anomalies {filterSeverity !== 'ALL' && `(${filterSeverity})`}</h2>
          
          {filteredAnomalies.length === 0 ? (
            <div className="text-center p-12 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-white/5">
              <Search className="h-12 w-12 text-slate-300 mx-auto mb-4" />
              <p className="text-slate-500 font-medium">No data-quality or supply-chain anomalies were detected in the available records.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredAnomalies.map(anomaly => (
                <div key={anomaly.id} className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-white/5 shadow-sm flex flex-col md:flex-row gap-6">
                  
                  {/* Left Column: Severity & Type */}
                  <div className="md:w-1/4 shrink-0">
                    <div className="flex items-center gap-2 mb-2">
                      {anomaly.severity === 'CRITICAL' && <AlertOctagon className="h-5 w-5 text-rose-500" />}
                      {anomaly.severity === 'HIGH' && <AlertTriangle className="h-5 w-5 text-orange-500" />}
                      {anomaly.severity === 'MEDIUM' && <AlertCircle className="h-5 w-5 text-amber-500" />}
                      {anomaly.severity === 'LOW' && <Info className="h-5 w-5 text-blue-500" />}
                      <span className={`text-xs font-bold px-2 py-0.5 rounded uppercase tracking-wider ${
                        anomaly.severity === 'CRITICAL' ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/20' :
                        anomaly.severity === 'HIGH' ? 'bg-orange-100 text-orange-700 dark:bg-orange-500/20' :
                        anomaly.severity === 'MEDIUM' ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20' :
                        'bg-blue-100 text-blue-700 dark:bg-blue-500/20'
                      }`}>
                        {anomaly.severity}
                      </span>
                    </div>
                    <h3 className="font-bold text-slate-800 dark:text-slate-100 leading-tight">{anomaly.type}</h3>
                    <p className="text-xs text-slate-400 mt-2 font-mono">{new Date(anomaly.detected_at).toLocaleString()}</p>
                  </div>

                  {/* Middle Column: Details */}
                  <div className="md:w-2/4">
                    <div className="mb-3">
                      <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 block">Explanation</span>
                      <p className="text-sm text-slate-700 dark:text-slate-300">{anomaly.explanation}</p>
                    </div>
                    <div>
                      <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 block">Evidence Snapshot</span>
                      <pre className="text-[10px] bg-slate-50 dark:bg-slate-900 p-2 rounded-lg text-slate-600 dark:text-slate-400 overflow-x-auto border border-slate-100 dark:border-white/5 font-mono">
                        {JSON.stringify(anomaly.evidence, null, 2)}
                      </pre>
                    </div>
                  </div>

                  {/* Right Column: Actions */}
                  <div className="md:w-1/4 flex flex-col justify-between items-end">
                    <div className="text-right w-full">
                       <span className="text-xs text-slate-400 block mb-1">Affected Product</span>
                       <div className="flex items-center gap-1.5 justify-end font-mono text-sm mb-1 bg-slate-50 dark:bg-slate-900 px-2 py-1 rounded inline-flex">
                          <Box className="h-3 w-3 text-slate-400" />
                          <span className="truncate max-w-[120px]">{anomaly.product_id}</span>
                       </div>
                       {anomaly.batch_number && (
                         <div className="text-xs text-slate-500 block">Batch: {anomaly.batch_number}</div>
                       )}
                    </div>
                    <Link
                      to={`/track?id=${anomaly.product_id}`}
                      className="mt-4 px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-lg transition-colors inline-flex items-center gap-2"
                    >
                      <Search className="h-3 w-3" />
                      View Traceability
                    </Link>
                  </div>

                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
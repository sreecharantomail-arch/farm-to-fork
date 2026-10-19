import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { AlertCircle, CheckCircle, Info, TrendingUp, Clock, ShieldAlert } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const API = import.meta.env.VITE_API_URL || "https://farm-to-fork-tracker.onrender.com/api";

interface DecisionSignal {
  type: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  title: string;
  reason: string;
  source: string;
  entityId?: string;
  meta?: any;
}

export const DecisionSupportPanel: React.FC = () => {
  const { token } = useAuth();
  const [signals, setSignals] = useState<DecisionSignal[]>([]);
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_status, setStatus] = useState<string>('');

  useEffect(() => {
    if (!token) return;
    const fetchDecisions = async () => {
      try {
        const res = await axios.get(`${API}/decisions`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.data.success) {
          setSignals(res.data.data.signals || []);
          setStatus(res.data.data.status);
        }
      } catch (err) {
        console.error('Failed to load decision support signals:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchDecisions();
  }, [token]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5 flex items-center justify-center min-h-[100px]">
        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (signals.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5 text-center text-slate-400 text-sm">
        <CheckCircle className="h-5 w-5 mx-auto mb-2 text-emerald-500 opacity-80" />
        <p>No immediate actions required.</p>
        <p className="text-xs opacity-70 mt-1">Operational data looks good.</p>
      </div>
    );
  }

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'HIGH': return 'bg-rose-500/10 border-rose-500/30 text-rose-400';
      case 'MEDIUM': return 'bg-amber-500/10 border-amber-500/30 text-amber-400';
      case 'LOW': return 'bg-blue-500/10 border-blue-500/30 text-blue-400';
      case 'INFO': return 'bg-slate-500/10 border-slate-500/30 text-slate-300';
      default: return 'bg-white/5 border-white/10 text-slate-300';
    }
  };

  const getIcon = (type: string, priority: string) => {
    if (type === 'EXPIRY_RISK') return <Clock className="h-4 w-4" />;
    if (type === 'AI_SERVICE_UNHEALTHY') return <ShieldAlert className="h-4 w-4" />;
    if (priority === 'HIGH') return <AlertCircle className="h-4 w-4" />;
    return <Info className="h-4 w-4" />;
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-primary" /> Operational Insights & Decisions
      </h3>
      
      <div className="space-y-3">
        {signals.map((signal, idx) => (
          <div key={idx} className={`p-3 rounded-xl border flex items-start gap-3 transition-colors ${getPriorityColor(signal.priority)}`}>
            <div className="mt-0.5 shrink-0">
              {getIcon(signal.type, signal.priority)}
            </div>
            <div>
              <p className="text-sm font-bold">{signal.title}</p>
              <p className="text-xs opacity-80 mt-0.5 leading-relaxed">{signal.reason}</p>
              <div className="flex gap-2 mt-2">
                <span className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-black/20">
                  {signal.priority} PRIORITY
                </span>
                <span className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-black/20">
                  {signal.source.replace(/_/g, ' ')}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

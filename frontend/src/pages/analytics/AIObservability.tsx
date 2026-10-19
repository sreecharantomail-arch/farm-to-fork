import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Brain, Activity, Clock, Server, AlertTriangle } from 'lucide-react';
import { getApiBaseUrl, getAuthToken } from '../../utils';

interface ObservabilityData {
  overview: {
    totalRequests: number;
    successfulRequests: number;
    unavailableRequests: number;
    timeouts: number;
    validationErrors: number;
    internalErrors: number;
    availabilityRate: number;
  };
  latency: 'Insufficient Data' | {
    average: number;
    median: number;
    min: number;
    max: number;
    samples: number;
  };
  capabilityBreakdown: Record<string, {
    requests: number;
    success: number;
    unavailable: number;
    errors: number;
  }>;
  recentEvents: any[];
}

export const AIObservability: React.FC = () => {
  const [data, setData] = useState<ObservabilityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchObservability();
  }, []);

  const fetchObservability = async () => {
    try {
      const token = getAuthToken();
      const apiBase = getApiBaseUrl();
      const response = await axios.get(`${apiBase}/ai/observability`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (response.data.success) {
        if (response.data.message === 'No AI activity recorded.') {
          setData(null);
        } else {
          setData(response.data.data);
        }
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to fetch observability data');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
        <div className="flex justify-center items-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-600"></div>
        </div>
    );
  }

  if (error) {
    return (
        <div className="p-6 bg-red-50 border border-red-200 rounded-xl text-red-600 flex items-center gap-3">
          <AlertTriangle className="h-6 w-6" />
          <p>{error}</p>
        </div>
    );
  }

  if (!data) {
    return (
        <div className="p-6">
          <h1 className="text-2xl font-bold mb-4">AI Observability</h1>
          <p className="text-slate-500">No AI activity recorded.</p>
        </div>
    );
  }

  return (
    <div>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">AI Operational Observability</h1>
            <p className="text-slate-500">Aggregate operational metrics from real audit logs</p>
          </div>
        </div>

        {/* Overview Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center gap-3 text-slate-500 mb-2">
              <Brain className="h-5 w-5" />
              <h3 className="font-semibold text-sm uppercase">Total Requests</h3>
            </div>
            <p className="text-3xl font-bold text-slate-900">{data.overview.totalRequests}</p>
          </div>

          <div className="bg-white p-6 rounded-xl border border-emerald-200 shadow-sm">
            <div className="flex items-center gap-3 text-emerald-600 mb-2">
              <Activity className="h-5 w-5" />
              <h3 className="font-semibold text-sm uppercase">Availability Rate</h3>
            </div>
            <p className="text-3xl font-bold text-emerald-600">
              {(data.overview.availabilityRate * 100).toFixed(1)}%
            </p>
          </div>

          <div className="bg-white p-6 rounded-xl border border-amber-200 shadow-sm">
            <div className="flex items-center gap-3 text-amber-600 mb-2">
              <Server className="h-5 w-5" />
              <h3 className="font-semibold text-sm uppercase">Unavailable</h3>
            </div>
            <p className="text-3xl font-bold text-amber-600">{data.overview.unavailableRequests}</p>
          </div>

          <div className="bg-white p-6 rounded-xl border border-rose-200 shadow-sm">
            <div className="flex items-center gap-3 text-rose-600 mb-2">
              <AlertTriangle className="h-5 w-5" />
              <h3 className="font-semibold text-sm uppercase">Errors / Timeouts</h3>
            </div>
            <p className="text-3xl font-bold text-rose-600">
              {data.overview.validationErrors + data.overview.internalErrors + data.overview.timeouts}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Capability Breakdown */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900 mb-4">Capability Breakdown</h2>
            <div className="space-y-4">
              {Object.entries(data.capabilityBreakdown).map(([cap, stats]) => (
                <div key={cap} className="p-4 bg-slate-50 rounded-lg border border-slate-100">
                  <h3 className="font-semibold text-slate-700 mb-2">{cap.replace(/_/g, ' ')}</h3>
                  <div className="grid grid-cols-4 text-sm">
                    <div>
                      <p className="text-slate-500">Requests</p>
                      <p className="font-bold">{stats.requests}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Success</p>
                      <p className="font-bold text-emerald-600">{stats.success}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Unavailable</p>
                      <p className="font-bold text-amber-600">{stats.unavailable}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Errors</p>
                      <p className="font-bold text-rose-600">{stats.errors}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Latency Analytics */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
              <Clock className="h-5 w-5 text-slate-500" />
              Latency Analytics
            </h2>
            {data.latency === 'Insufficient Data' ? (
              <p className="text-slate-500 italic">Insufficient Data</p>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-slate-50 rounded-lg">
                  <p className="text-sm text-slate-500">Average</p>
                  <p className="text-2xl font-bold">{Math.round(data.latency.average)} ms</p>
                </div>
                <div className="p-4 bg-slate-50 rounded-lg">
                  <p className="text-sm text-slate-500">Median</p>
                  <p className="text-2xl font-bold">{Math.round(data.latency.median)} ms</p>
                </div>
                <div className="p-4 bg-slate-50 rounded-lg">
                  <p className="text-sm text-slate-500">Fastest</p>
                  <p className="text-2xl font-bold text-emerald-600">{data.latency.min} ms</p>
                </div>
                <div className="p-4 bg-slate-50 rounded-lg">
                  <p className="text-sm text-slate-500">Slowest</p>
                  <p className="text-2xl font-bold text-rose-600">{data.latency.max} ms</p>
                </div>
                <div className="col-span-2 p-3 bg-blue-50 text-blue-700 rounded-lg text-sm font-medium">
                  Based on {data.latency.samples} recorded samples
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Recent Events */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900 mb-4">Recent Events</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <th className="text-left p-3 font-medium">Time</th>
                  <th className="text-left p-3 font-medium">Capability</th>
                  <th className="text-left p-3 font-medium">Status</th>
                  <th className="text-left p-3 font-medium">Latency</th>
                  <th className="text-left p-3 font-medium">Model</th>
                </tr>
              </thead>
              <tbody>
                {data.recentEvents.map(event => (
                  <tr key={event.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="p-3 text-slate-600">
                      {new Date(event.created_at).toLocaleString()}
                    </td>
                    <td className="p-3 font-medium text-slate-900">
                      {event.capability.replace(/_/g, ' ')}
                    </td>
                    <td className="p-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-bold ${
                        event.status === 'SUCCESS' ? 'bg-emerald-100 text-emerald-700' :
                        event.status === 'UNAVAILABLE' ? 'bg-amber-100 text-amber-700' :
                        'bg-rose-100 text-rose-700'
                      }`}>
                        {event.status} {event.error_code ? `(${event.error_code})` : ''}
                      </span>
                    </td>
                    <td className="p-3 text-slate-600">
                      {event.latency_ms ? `${event.latency_ms}ms` : '-'}
                    </td>
                    <td className="p-3 text-slate-600">
                      {event.model_version || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

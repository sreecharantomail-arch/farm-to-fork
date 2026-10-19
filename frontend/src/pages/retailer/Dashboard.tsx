import { useState, useEffect } from "react"
import axios from "axios"
import { useAuth } from "../../context/AuthContext"
import { LayoutDashboard, Package, TrendingUp, AlertTriangle, ShieldAlert } from "lucide-react"
import { DecisionSupportPanel } from "../../components/DecisionSupportPanel"

const API_URL = import.meta.env.VITE_API_URL || "https://farm-to-fork-tracker.onrender.com/api"

export function Dashboard() {
  const { user, token } = useAuth()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        const res = await axios.get(`${API_URL}/retailer/dashboard`, {
          headers: { Authorization: `Bearer ${token}` }
        })
        setData(res.data.data)
      } catch (err) {
        console.error("Dashboard fetch error:", err)
      } finally {
        setLoading(false)
      }
    }
    if (token) fetchDashboard()
  }, [token])

  if (loading) {
    return <div className="p-12 text-center text-slate-500">Loading dashboard metrics...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Retailer Dashboard</h1>
          <p className="text-sm text-slate-500">Welcome back, {user?.name}. Here is your store overview.</p>
        </div>
        <LayoutDashboard className="h-8 w-8 text-emerald-600 opacity-20" />
      </div>

      <DecisionSupportPanel />

      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Total Inventory */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Active Batches</p>
                <h3 className="text-3xl font-black text-slate-900">{data.total_inventory_items}</h3>
              </div>
              <div className="h-10 w-10 bg-indigo-50 rounded-xl flex items-center justify-center">
                <Package className="h-5 w-5 text-indigo-600" />
              </div>
            </div>
          </div>

          {/* Revenue */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Total Revenue</p>
                <h3 className="text-3xl font-black text-emerald-600">${data.total_revenue.toFixed(2)}</h3>
              </div>
              <div className="h-10 w-10 bg-emerald-50 rounded-xl flex items-center justify-center">
                <TrendingUp className="h-5 w-5 text-emerald-600" />
              </div>
            </div>
            <p className="text-xs font-medium text-slate-500 mt-2">Across {data.total_sales} recorded sales</p>
          </div>

          {/* Low Stock */}
          <div className="bg-amber-50 p-6 rounded-2xl border border-amber-200 shadow-sm">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-bold text-amber-600 uppercase tracking-wider mb-1">Low Stock Alerts</p>
                <h3 className="text-3xl font-black text-amber-700">{data.low_stock_alerts}</h3>
              </div>
              <div className="h-10 w-10 bg-amber-100 rounded-xl flex items-center justify-center">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
              </div>
            </div>
            <p className="text-xs font-medium text-amber-700 mt-2">Batches with quantity &lt; 10</p>
          </div>

          {/* Expired */}
          <div className="bg-rose-50 p-6 rounded-2xl border border-rose-200 shadow-sm">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-bold text-rose-600 uppercase tracking-wider mb-1">Expired Items</p>
                <h3 className="text-3xl font-black text-rose-700">{data.expired_alerts}</h3>
              </div>
              <div className="h-10 w-10 bg-rose-100 rounded-xl flex items-center justify-center">
                <ShieldAlert className="h-5 w-5 text-rose-600" />
              </div>
            </div>
            <p className="text-xs font-medium text-rose-700 mt-2">Requires immediate wastage review</p>
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <h2 className="text-lg font-bold text-slate-900 mb-4">Quick Actions</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <a href="/retailer/receive" className="bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl p-4 text-center transition-colors">
            <div className="font-bold text-slate-700 text-sm">Scan Delivery</div>
          </a>
          <a href="/retailer/sales" className="bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl p-4 text-center transition-colors">
            <div className="font-bold text-slate-700 text-sm">Point of Sale</div>
          </a>
          <a href="/retailer/expiry" className="bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl p-4 text-center transition-colors">
            <div className="font-bold text-slate-700 text-sm">Check Expiry</div>
          </a>
          <a href="/retailer/requests" className="bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl p-4 text-center transition-colors">
            <div className="font-bold text-slate-700 text-sm">Order Stock</div>
          </a>
        </div>
      </div>
    </div>
  )
}

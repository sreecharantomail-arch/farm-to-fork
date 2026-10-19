import { useState, useEffect } from "react"
import axios from "axios"
import { useAuth } from "../../context/AuthContext"
import { ShieldAlert, AlertCircle, Trash2, CheckCircle2 } from "lucide-react"

const API_URL = import.meta.env.VITE_API_URL || "https://farm-to-fork-tracker.onrender.com/api"

export function Expiry() {
  const { token } = useAuth()
  const [inventory, setInventory] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  // Wastage Modal State
  const [showWastageModal, setShowWastageModal] = useState(false)
  const [selectedItem, setSelectedItem] = useState<any>(null)
  const [wastageQuantity, setWastageQuantity] = useState<number | "">("")
  const [wastageReason, setWastageReason] = useState("Expired")
  const [wastageNotes, setWastageNotes] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [successMsg, setSuccessMsg] = useState("")

  const fetchInventory = async () => {
    try {
      setLoading(true)
      const res = await axios.get(`${API_URL}/retailer/inventory`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      // Only keep items that have an expiry_date and are NOT DEPLETED
      const activeItems = (res.data.data || []).filter((item: any) => item.expiry_date && item.status !== 'DEPLETED')
      setInventory(activeItems)
    } catch (err: any) {
      setError(err.response?.data?.message || "Failed to load inventory")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (token) fetchInventory()
  }, [token])

  const handleWastageSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      await axios.post(`${API_URL}/retailer/wastage`, {
        inventory_id: selectedItem.id,
        quantity: Number(wastageQuantity),
        reason: wastageReason,
        notes: wastageNotes
      }, {
        headers: { Authorization: `Bearer ${token}` }
      })
      
      setSuccessMsg("Wastage reported successfully!")
      setShowWastageModal(false)
      fetchInventory()
      
      setTimeout(() => setSuccessMsg(""), 3000)
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to report wastage")
    } finally {
      setSubmitting(false)
    }
  }

  const openWastageModal = (item: any) => {
    setSelectedItem(item)
    setWastageQuantity(item.quantity) // Default to throwing away the entire batch
    setWastageReason("Expired")
    setWastageNotes("Auto-reported from Expiry Management dashboard.")
    setShowWastageModal(true)
  }

  // Categorize items
  const today = new Date().getTime()
  
  const expiredItems = inventory.filter(item => {
    return new Date(item.expiry_date).getTime() < today
  }).sort((a, b) => new Date(a.expiry_date).getTime() - new Date(b.expiry_date).getTime())

  const expiringSoon = inventory.filter(item => {
    const exp = new Date(item.expiry_date).getTime()
    const diffDays = Math.ceil((exp - today) / (1000 * 60 * 60 * 24))
    return diffDays >= 0 && diffDays <= 7
  }).sort((a, b) => new Date(a.expiry_date).getTime() - new Date(b.expiry_date).getTime())

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Expiry Management</h1>
        <p className="text-sm text-slate-500">Monitor items nearing expiration and manage expired stock.</p>
      </div>

      {successMsg && (
        <div className="p-4 bg-emerald-50 text-emerald-700 rounded-2xl border border-emerald-200 flex gap-3 animate-in fade-in">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <p className="font-medium text-sm">{successMsg}</p>
        </div>
      )}

      {loading ? (
        <div className="p-12 text-center text-slate-500 bg-white rounded-2xl border border-slate-200 shadow-sm">Loading expiry data...</div>
      ) : error ? (
        <div className="p-12 text-center text-rose-500 bg-white rounded-2xl border border-slate-200 shadow-sm">{error}</div>
      ) : (
        <div className="grid gap-8">
          {/* EXPIRED ITEMS */}
          <div className="bg-white rounded-2xl border-2 border-rose-200 overflow-hidden shadow-sm">
            <div className="p-4 border-b border-rose-100 bg-rose-50 flex items-center justify-between">
              <h2 className="font-bold text-rose-900 flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-rose-600" /> ALREADY EXPIRED
              </h2>
              <span className="bg-rose-200 text-rose-800 text-xs font-bold px-2.5 py-1 rounded-full">{expiredItems.length} Items</span>
            </div>
            
            <div className="p-0">
              {expiredItems.length === 0 ? (
                <div className="p-8 text-center text-slate-500 text-sm">No expired items in inventory.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="text-[10px] text-slate-500 bg-slate-50 uppercase tracking-wider border-b border-slate-100">
                      <tr>
                        <th className="px-6 py-3 font-semibold">Product</th>
                        <th className="px-6 py-3 font-semibold">Batch</th>
                        <th className="px-6 py-3 font-semibold">Quantity</th>
                        <th className="px-6 py-3 font-semibold">Expired On</th>
                        <th className="px-6 py-3 font-semibold text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {expiredItems.map(item => (
                        <tr key={item.id} className="hover:bg-slate-50/50 bg-rose-50/10">
                          <td className="px-6 py-4 font-bold text-slate-900">{item.product?.name}</td>
                          <td className="px-6 py-4 font-mono text-xs text-slate-500">{item.batch_number}</td>
                          <td className="px-6 py-4 font-bold text-rose-600">{item.quantity} <span className="text-xs text-slate-400 font-medium">{item.unit}</span></td>
                          <td className="px-6 py-4 font-medium text-rose-700">
                            {new Date(item.expiry_date).toLocaleDateString()}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <button 
                              onClick={() => openWastageModal(item)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-100 text-rose-700 hover:bg-rose-200 font-bold text-xs rounded-lg transition-colors"
                            >
                              <Trash2 className="h-3.5 w-3.5" /> Mark Wasted
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* EXPIRING SOON */}
          <div className="bg-white rounded-2xl border-2 border-amber-200 overflow-hidden shadow-sm">
            <div className="p-4 border-b border-amber-100 bg-amber-50 flex items-center justify-between">
              <h2 className="font-bold text-amber-900 flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-amber-600" /> EXPIRING WITHIN 7 DAYS
              </h2>
              <span className="bg-amber-200 text-amber-800 text-xs font-bold px-2.5 py-1 rounded-full">{expiringSoon.length} Items</span>
            </div>
            
            <div className="p-0">
              {expiringSoon.length === 0 ? (
                <div className="p-8 text-center text-slate-500 text-sm">No items expiring within the next 7 days.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="text-[10px] text-slate-500 bg-slate-50 uppercase tracking-wider border-b border-slate-100">
                      <tr>
                        <th className="px-6 py-3 font-semibold">Product</th>
                        <th className="px-6 py-3 font-semibold">Batch</th>
                        <th className="px-6 py-3 font-semibold">Quantity</th>
                        <th className="px-6 py-3 font-semibold">Expires On</th>
                        <th className="px-6 py-3 font-semibold text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {expiringSoon.map(item => {
                        const diffDays = Math.ceil((new Date(item.expiry_date).getTime() - today) / (1000 * 60 * 60 * 24))
                        return (
                          <tr key={item.id} className="hover:bg-slate-50/50 bg-amber-50/10">
                            <td className="px-6 py-4 font-bold text-slate-900">{item.product?.name}</td>
                            <td className="px-6 py-4 font-mono text-xs text-slate-500">{item.batch_number}</td>
                            <td className="px-6 py-4 font-bold text-slate-700">{item.quantity} <span className="text-xs text-slate-400 font-medium">{item.unit}</span></td>
                            <td className="px-6 py-4 font-medium text-amber-700">
                              {new Date(item.expiry_date).toLocaleDateString()} 
                              <span className="ml-2 text-[10px] font-bold bg-amber-100 px-1.5 py-0.5 rounded">In {diffDays}d</span>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <button 
                                onClick={() => openWastageModal(item)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 text-slate-600 hover:bg-slate-200 font-bold text-xs rounded-lg transition-colors"
                              >
                                <Trash2 className="h-3.5 w-3.5" /> Discard
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Wastage Shortcut Modal */}
      {showWastageModal && selectedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col">
            <div className="p-6 border-b border-slate-100 bg-rose-50/50">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Trash2 className="h-5 w-5 text-rose-600" /> Report Wastage
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                You are discarding <span className="font-bold text-slate-700">{selectedItem.product?.name}</span> (Batch: {selectedItem.batch_number}).
              </p>
            </div>
            
            <form onSubmit={handleWastageSubmit} className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700 flex justify-between">
                  Quantity Lost
                  <span className="text-xs text-slate-500">Max: {selectedItem.quantity}</span>
                </label>
                <input 
                  type="number" 
                  required
                  min="0.1"
                  step="0.1"
                  max={selectedItem.quantity}
                  value={wastageQuantity}
                  onChange={e => setWastageQuantity(e.target.value ? Number(e.target.value) : "")}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-rose-500/50 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">Reason</label>
                <select 
                  required
                  value={wastageReason}
                  onChange={e => setWastageReason(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-rose-500/50 text-sm bg-white"
                >
                  <option value="Expired">Expired</option>
                  <option value="Spoiled">Spoiled early</option>
                  <option value="Damaged">Damaged</option>
                </select>
              </div>

              <div className="pt-4 flex gap-3">
                <button 
                  type="button"
                  onClick={() => setShowWastageModal(false)}
                  className="flex-1 bg-white border border-slate-200 text-slate-700 px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  disabled={submitting}
                  className="flex-1 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-sm font-bold shadow-sm transition-colors"
                >
                  {submitting ? "Reporting..." : "Confirm"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

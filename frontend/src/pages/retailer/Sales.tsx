import { useState, useEffect } from "react"
import axios from "axios"
import { useAuth } from "../../context/AuthContext"
import { AlertCircle, ShoppingBag, DollarSign, CheckCircle2 } from "lucide-react"

const API_URL = import.meta.env.VITE_API_URL || "https://farm-to-fork-tracker.onrender.com/api"

export function Sales() {
  const { token } = useAuth()
  const [inventory, setInventory] = useState<any[]>([])
  const [sales, setSales] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  // Sale form state
  const [selectedItem, setSelectedItem] = useState("")
  const [quantity, setQuantity] = useState<number | "">("")
  const [price, setPrice] = useState<number | "">("")
  const [submitting, setSubmitting] = useState(false)
  const [successMsg, setSuccessMsg] = useState("")

  const fetchData = async () => {
    try {
      setLoading(true)
      const [invRes, salesRes] = await Promise.all([
        axios.get(`${API_URL}/retailer/inventory`, { headers: { Authorization: `Bearer ${token}` } }),
        axios.get(`${API_URL}/retailer/sales`, { headers: { Authorization: `Bearer ${token}` } })
      ])
      
      // Only show items that are available and not expired
      const availableItems = (invRes.data.data || []).filter((item: any) => {
        if (item.status === 'DEPLETED') return false
        if (item.expiry_date && new Date(item.expiry_date) < new Date()) return false
        return true
      })
      
      setInventory(availableItems)
      setSales(salesRes.data.data || [])
    } catch (err: any) {
      setError(err.response?.data?.message || "Failed to load data")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (token) fetchData()
  }, [token])

  const handleSale = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError("")
    setSuccessMsg("")
    try {
      await axios.post(`${API_URL}/retailer/sales`, {
        inventory_id: selectedItem,
        quantity_sold: Number(quantity),
        price_per_unit: price ? Number(price) : null
      }, {
        headers: { Authorization: `Bearer ${token}` }
      })
      
      setSuccessMsg("Sale recorded successfully!")
      setSelectedItem("")
      setQuantity("")
      setPrice("")
      fetchData() // Refresh inventory and sales lists
      
      setTimeout(() => setSuccessMsg(""), 3000)
    } catch (err: any) {
      setError(err.response?.data?.message || "Failed to record sale")
    } finally {
      setSubmitting(false)
    }
  }

  const selectedItemData = inventory.find(i => i.id === selectedItem)

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Point of Sale</h1>
          <p className="text-sm text-slate-500">Record consumer sales and automatically update your inventory.</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* POS Panel */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-100 bg-slate-50">
              <h2 className="font-bold text-slate-900 flex items-center gap-2">
                <ShoppingBag className="h-5 w-5 text-emerald-600" /> New Sale
              </h2>
            </div>
            
            <form onSubmit={handleSale} className="p-6 space-y-4">
              {error && (
                <div className="p-3 bg-rose-50 text-rose-600 rounded-xl text-sm border border-rose-200 flex gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <p>{error}</p>
                </div>
              )}
              {successMsg && (
                <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl text-sm border border-emerald-200 flex gap-2 animate-in fade-in">
                  <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                  <p>{successMsg}</p>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">Select Product</label>
                <select 
                  required
                  value={selectedItem}
                  onChange={e => setSelectedItem(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500/50 text-sm bg-white"
                >
                  <option value="">-- Choose from inventory --</option>
                  {inventory.map(item => (
                    <option key={item.id} value={item.id}>
                      {item.product?.name} ({item.quantity} {item.unit} left) - {item.batch_number}
                    </option>
                  ))}
                </select>
              </div>

              {selectedItemData && (
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-1">
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>Batch:</span>
                    <span className="font-mono text-slate-700 font-medium">{selectedItemData.batch_number}</span>
                  </div>
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>Available Stock:</span>
                    <span className="font-bold text-emerald-600">{selectedItemData.quantity} {selectedItemData.unit}</span>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">Quantity</label>
                  <input 
                    type="number" 
                    required
                    min="0.1"
                    step="0.1"
                    max={selectedItemData ? selectedItemData.quantity : undefined}
                    value={quantity}
                    onChange={e => setQuantity(e.target.value ? Number(e.target.value) : "")}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500/50 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">Price (Opt)</label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <input 
                      type="number" 
                      min="0"
                      step="0.01"
                      value={price}
                      onChange={e => setPrice(e.target.value ? Number(e.target.value) : "")}
                      className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500/50 text-sm"
                      placeholder="0.00"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-2">
                <button 
                  type="submit"
                  disabled={!selectedItem || submitting}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-sm font-bold shadow-sm transition-colors"
                >
                  {submitting ? "Recording..." : "Record Sale"}
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Sales Log */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden h-full flex flex-col">
            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h2 className="font-bold text-slate-900">Recent Sales Ledger</h2>
              <span className="text-xs font-semibold text-slate-500 bg-slate-200 px-2 py-1 rounded-full">{sales.length} records</span>
            </div>
            
            <div className="flex-1 overflow-auto">
              {loading ? (
                <div className="p-12 text-center text-slate-500">Loading ledger...</div>
              ) : sales.length === 0 ? (
                <div className="p-12 text-center text-slate-500 flex flex-col items-center">
                  <ShoppingBag className="h-10 w-10 text-slate-300 mb-2" />
                  <p>No sales recorded yet.</p>
                </div>
              ) : (
                <table className="w-full text-sm text-left">
                  <thead className="text-[10px] text-slate-500 bg-slate-50 uppercase tracking-wider sticky top-0 border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-3 font-semibold">Time</th>
                      <th className="px-6 py-3 font-semibold">Product</th>
                      <th className="px-6 py-3 font-semibold text-right">Quantity</th>
                      <th className="px-6 py-3 font-semibold text-right">Total Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sales.map(sale => (
                      <tr key={sale.id} className="hover:bg-slate-50/50">
                        <td className="px-6 py-3 text-slate-500 text-xs">
                          {new Date(sale.sale_date).toLocaleString()}
                        </td>
                        <td className="px-6 py-3">
                          <div className="font-medium text-slate-900">{sale.inventory?.product?.name}</div>
                          <div className="text-[10px] text-slate-500 font-mono mt-0.5">{sale.inventory?.batch_number}</div>
                        </td>
                        <td className="px-6 py-3 text-right">
                          <span className="font-bold text-slate-700">{sale.quantity_sold}</span> <span className="text-xs text-slate-500">{sale.inventory?.unit}</span>
                        </td>
                        <td className="px-6 py-3 text-right">
                          {sale.price_per_unit ? (
                            <span className="font-medium text-emerald-600">${(sale.quantity_sold * sale.price_per_unit).toFixed(2)}</span>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

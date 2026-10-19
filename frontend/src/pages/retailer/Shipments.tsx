import { useState, useEffect } from "react"
import axios from "axios"
import { useAuth } from "../../context/AuthContext"
import { Truck, Factory, Calendar, QrCode } from "lucide-react"

const API_URL = import.meta.env.VITE_API_URL || "https://farm-to-fork-tracker.onrender.com/api"

export function Shipments() {
  const { token } = useAuth()
  const [shipments, setShipments] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const fetchShipments = async () => {
    try {
      setLoading(true)
      const res = await axios.get(`${API_URL}/retailer/shipments`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setShipments(res.data.data || [])
    } catch {
      // Failed to load shipments
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (token) fetchShipments()
  }, [token])

  const getStatusColor = (status: string) => {
    switch(status) {
      case 'CREATED': return 'bg-slate-100 text-slate-800 border-slate-200'
      case 'ASSIGNED': return 'bg-blue-100 text-blue-800 border-blue-200'
      case 'PICKED_UP': return 'bg-indigo-100 text-indigo-800 border-indigo-200'
      case 'IN_TRANSIT': return 'bg-amber-100 text-amber-800 border-amber-200'
      case 'ARRIVED': return 'bg-fuchsia-100 text-fuchsia-800 border-fuchsia-200'
      case 'DELIVERED': return 'bg-emerald-100 text-emerald-800 border-emerald-200'
      case 'RECEIVED': return 'bg-green-100 text-green-800 border-green-200'
      case 'CANCELLED': return 'bg-rose-100 text-rose-800 border-rose-200'
      default: return 'bg-slate-100 text-slate-800 border-slate-200'
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Incoming Shipments</h1>
          <p className="text-sm text-slate-500">Track and receive your incoming product deliveries.</p>
        </div>
      </div>

      <div className="grid gap-6">
        {loading ? (
          <div className="p-12 text-center text-slate-500 bg-white rounded-2xl border border-slate-200 shadow-sm">Loading shipments...</div>
        ) : shipments.length === 0 ? (
          <div className="p-12 text-center flex flex-col items-center bg-white rounded-2xl border border-slate-200 shadow-sm">
            <Truck className="h-12 w-12 text-slate-300 mb-3" />
            <h3 className="text-lg font-medium text-slate-900">No incoming shipments</h3>
            <p className="text-sm text-slate-500 max-w-sm mt-1">When processors dispatch your requested products, they will appear here.</p>
          </div>
        ) : (
          shipments.map(shipment => (
            <div key={shipment.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm flex flex-col sm:flex-row">
              {/* Left Column: Status & IDs */}
              <div className="bg-slate-50 border-r border-slate-100 p-6 sm:w-1/3 flex flex-col justify-between">
                <div>
                  <span className={`inline-flex items-center px-3 py-1 rounded-full text-[11px] font-bold tracking-wider uppercase border mb-4 ${getStatusColor(shipment.status)}`}>
                    {shipment.status.replace('_', ' ')}
                  </span>
                  <h3 className="text-xl font-bold text-slate-900">{shipment.request?.product_name || "Unknown Product"}</h3>
                  <p className="text-sm font-medium text-slate-500 mt-1">{shipment.quantity} {shipment.unit}</p>
                </div>

                <div className="mt-6 space-y-3">
                  <div>
                    <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">Tracking ID</span>
                    <span className="font-mono text-sm font-medium text-slate-700">{shipment.shipment_tracking_id}</span>
                  </div>
                  <div>
                    <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">Batch Number</span>
                    <span className="font-mono text-sm font-medium text-slate-700">{shipment.batch_number}</span>
                  </div>
                </div>
              </div>

              {/* Right Column: Logistics */}
              <div className="p-6 sm:w-2/3 flex flex-col justify-between">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <div className="h-8 w-8 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                        <Factory className="h-4 w-4" />
                      </div>
                      <div>
                        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">Processor</span>
                        <span className="text-sm font-medium text-slate-900 block">{shipment.processor?.name}</span>
                        <span className="text-xs text-slate-500">{shipment.processor?.phone || "No phone provided"}</span>
                      </div>
                    </div>
                    
                    <div className="flex items-start gap-3">
                      <div className="h-8 w-8 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
                        <Truck className="h-4 w-4" />
                      </div>
                      <div>
                        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">Distributor</span>
                        <span className="text-sm font-medium text-slate-900 block">{shipment.distributor?.name || "Unassigned"}</span>
                        <span className="text-xs text-slate-500">{shipment.distributor?.phone || "Pending dispatch"}</span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block flex items-center gap-1">
                        <Calendar className="h-3 w-3" /> Expected Delivery
                      </span>
                      <span className="text-sm font-medium text-slate-900 mt-0.5 block">
                        {shipment.expected_delivery ? new Date(shipment.expected_delivery).toLocaleDateString() : "Not scheduled"}
                      </span>
                    </div>

                    {(shipment.status === 'DELIVERED' || shipment.status === 'ARRIVED') && (
                      <div className="pt-2">
                        <button className="w-full inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl text-sm font-bold shadow-sm transition-colors">
                          <QrCode className="h-4 w-4" /> Scan to Receive
                        </button>
                      </div>
                    )}
                    
                    {shipment.status === 'RECEIVED' && (
                      <div className="pt-2">
                        <div className="w-full inline-flex items-center justify-center gap-2 bg-slate-100 text-slate-500 px-4 py-2.5 rounded-xl text-sm font-bold">
                          Already Received
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

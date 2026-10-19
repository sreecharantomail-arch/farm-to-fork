import { useState, useEffect } from "react"
import axios from "axios"
import { Package, Truck, CheckCircle, Zap, AlertTriangle, QrCode, SplitSquareHorizontal, Clock, ShieldCheck, FileCheck, X, AlertCircle, Thermometer, Navigation } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/Card"
import { Button } from "../components/ui/Button"
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts"
import { useAuth } from "../context/AuthContext"
import { DecisionSupportPanel } from "../components/DecisionSupportPanel"
import { ColdChainMonitoring } from "../components/distributor/ColdChainMonitoring"
import { RouteOptimizationPanel } from "../components/distributor/RouteOptimizationPanel"

const API_URL = import.meta.env.VITE_API_URL || "https://farm-to-fork-tracker.onrender.com/api"

const routeData = [
  { day: "Mon", deliveries: 8, onTime: 7 },
  { day: "Tue", deliveries: 12, onTime: 11 },
  { day: "Wed", deliveries: 9, onTime: 9 },
  { day: "Thu", deliveries: 15, onTime: 13 },
  { day: "Fri", deliveries: 18, onTime: 16 },
  { day: "Sat", deliveries: 11, onTime: 10 },
]

export function DistributorDashboard() {
  const { user, token, updateUser } = useAuth()
  const [activeTab, setActiveTab] = useState("overview")
  const [inventory, setInventory] = useState<any[]>([])
  const [incomingShipments, setIncomingShipments] = useState<any[]>([])
  const [outgoingShipments, setOutgoingShipments] = useState<any[]>([])
  const [logisticsMetrics, setLogisticsMetrics] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  // Handoff state
  const [handoffId, setHandoffId] = useState("")
  const [handoffLoading, setHandoffLoading] = useState(false)
  const [handoffSuccess, setHandoffSuccess] = useState("")
  const [handoffError, setHandoffError] = useState("")

  // Proof of Delivery state
  const [podModalShipment, setPodModalShipment] = useState<any>(null)
  const [viewPodModalShipment, setViewPodModalShipment] = useState<any>(null)
  const [podRecipientName, setPodRecipientName] = useState("")
  const [podDeliveredQty, setPodDeliveredQty] = useState<string | number>("")
  const [podNotes, setPodNotes] = useState("")
  const [podPhotoUrl, setPodPhotoUrl] = useState("")
  const [submittingPod, setSubmittingPod] = useState(false)
  const [podSuccess, setPodSuccess] = useState("")
  const [podError, setPodError] = useState("")

  const fetchInventory = async () => {
    try {
      const headers = { Authorization: `Bearer ${token}` }
      const [invRes, shipRes, outRes, metricsRes] = await Promise.all([
        axios.get(`${API_URL}/distributor/batches`, { headers }),
        axios.get(`${API_URL}/distributor/shipments/incoming`, { headers }),
        axios.get(`${API_URL}/distributor/shipments/outgoing`, { headers }).catch(() => ({ data: { data: [] } })),
        axios.get(`${API_URL}/distributor/metrics/logistics`, { headers }).catch(() => ({ data: { data: null } }))
      ])
      setInventory(invRes.data.data || [])
      setIncomingShipments(shipRes.data.data || [])
      setOutgoingShipments(outRes.data?.data || [])
      setLogisticsMetrics(metricsRes.data?.data || null)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const openPodModal = (shipment: any) => {
    setPodModalShipment(shipment)
    setPodRecipientName("")
    setPodDeliveredQty(shipment.quantity)
    setPodNotes("")
    setPodPhotoUrl("")
    setPodError("")
    setPodSuccess("")
  }

  const handleSubmitPod = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!podModalShipment) return
    setSubmittingPod(true)
    setPodError("")
    setPodSuccess("")

    try {
      await axios.post(
        `${API_URL}/distributor/shipments/${podModalShipment.id}/proof-of-delivery`,
        {
          recipient_name: podRecipientName,
          quantity_delivered: Number(podDeliveredQty),
          delivery_notes: podNotes,
          photo_url: podPhotoUrl
        },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      setPodSuccess("Proof of delivery submitted successfully!")
      setTimeout(() => {
        setPodModalShipment(null)
        setPodSuccess("")
        fetchInventory()
      }, 1200)
    } catch (err: any) {
      setPodError(err.response?.data?.message || "Failed to submit proof of delivery.")
    } finally {
      setSubmittingPod(false)
    }
  }

  useEffect(() => {
    if (token) {
      fetchInventory()
    }
  }, [token])

  const handleTakeCustody = async () => {
    if (!handoffId) return;
    setHandoffLoading(true)
    setHandoffError("")
    setHandoffSuccess("")

    try {
      // Find the shipment in incoming shipments
      const shipment = incomingShipments.find(s =>
        s.batch_number === handoffId || s.id === handoffId
      )

      if (!shipment) {
        setHandoffError("Shipment not found in your incoming queue.")
        setHandoffLoading(false)
        return
      }

      await axios.post(`${API_URL}/distributor/shipments/${shipment.id}/receive`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      })

      setHandoffSuccess(`Successfully received batch: ${shipment.batch_number}`)
      setHandoffId("")
      fetchInventory() // Refresh inventory
    } catch (err: any) {
      setHandoffError(err.response?.data?.message || "Failed to receive shipment.")
    } finally {
      setHandoffLoading(false)
    }
  }

  // Calculate dynamic stats based on inventory
  const activeShipmentsCount = inventory.filter(p => p.status === 'In Transit').length;
  const deliveredCount = inventory.filter(p => p.status === 'Delivered').length;

  const stats = [
    { title: "Active Shipments", value: activeShipmentsCount, icon: Truck, color: "text-blue-500" },
    { title: "Delivered Today", value: deliveredCount, icon: CheckCircle, color: "text-green-500" },
    {
      title: "Avg Distance Saved",
      value: logisticsMetrics?.average_distance_saved_pct !== null && logisticsMetrics?.average_distance_saved_pct !== undefined
        ? `${logisticsMetrics.average_distance_saved_pct}%`
        : "Insufficient data",
      icon: Navigation,
      color: "text-amber-500"
    },
    { title: "Delay Alerts", value: "0", icon: AlertTriangle, color: "text-red-500" },
    { title: "Total Products", value: inventory.length, icon: Package, color: "text-purple-500" },
    {
      title: "Cold-Chain Compliance",
      value: logisticsMetrics?.cold_chain_compliance_rate_pct !== null && logisticsMetrics?.cold_chain_compliance_rate_pct !== undefined
        ? `${logisticsMetrics.cold_chain_compliance_rate_pct}%`
        : "100%",
      icon: Thermometer,
      color: "text-emerald-500"
    },
  ]

  const OverviewTab = () => (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
        {stats.map((s) => (
          <Card key={s.title} className="col-span-1 border-border/50 shadow-sm">
            <CardHeader className="pb-2">
              <s.icon className={`h-5 w-5 ${s.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{s.value}</div>
              <p className="text-xs text-muted-foreground mt-1">{s.title}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="col-span-2 border-border/50 shadow-sm">
          <CardHeader>
            <CardTitle>Delivery Performance</CardTitle>
            <CardDescription>AI-predicted vs actual delivery success rate.</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={routeData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" />
                <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Area type="monotone" dataKey="deliveries" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.15} strokeWidth={2} name="Total Deliveries" />
                <Area type="monotone" dataKey="onTime" stroke="#10b981" fill="#10b981" fillOpacity={0.15} strokeWidth={2} name="On Time" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-border/50 shadow-sm">
          <CardHeader>
            <CardTitle>Logistics Alerts</CardTitle>
            <CardDescription>Actionable intelligence</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-3 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
              <Zap className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-blue-700 dark:text-blue-400">Smart Consolidation</p>
                <p className="text-xs text-blue-600/80 dark:text-blue-400/80 mt-1">2 active shipments can be grouped to save fuel.</p>
              </div>
            </div>
            {inventory.filter(i => i.expiry_date && new Date(i.expiry_date).getTime() < Date.now() + 2 * 24 * 60 * 60 * 1000).map((item, idx) => (
              <div key={idx} className="flex gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                <Clock className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-red-700 dark:text-red-400">FEFO Expiry Alert</p>
                  <p className="text-xs text-red-600/80 dark:text-red-400/80 mt-1">{item.name} (Batch {item.batch_number}) expires soon.</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )

  const FleetTab = () => (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="col-span-2 border-border/50 shadow-sm">
          <CardHeader>
            <CardTitle>Active Shipments & Live Tracking</CardTitle>
            <CardDescription>Monitor outgoing retailer deliveries and submit Digital Proof of Delivery.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-3 px-2">Tracking / Batch</th>
                    <th className="text-left py-3 px-2">Product & Retailer</th>
                    <th className="text-left py-3 px-2">Cold-Chain</th>
                    <th className="text-left py-3 px-2">Dispatched Qty</th>
                    <th className="text-left py-3 px-2">Status</th>
                    <th className="text-right py-3 px-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {outgoingShipments.length === 0 ? (
                     <tr>
                       <td colSpan={6} className="py-8 text-center text-muted-foreground">No outgoing retailer shipments found.</td>
                     </tr>
                  ) : (
                    outgoingShipments.map((s) => (
                      <tr key={s.id} className="border-b border-muted/30 hover:bg-muted/10 transition-colors">
                        <td className="py-3 px-2">
                          <div className="font-mono text-xs font-semibold">{s.shipment_tracking_id}</div>
                          <div className="text-[11px] text-muted-foreground font-mono">{s.batch_number}</div>
                        </td>
                        <td className="py-3 px-2">
                          <div className="font-medium">{s.request?.product_name || "Batch Product"}</div>
                          <div className="text-xs text-muted-foreground">To: {s.receiver?.name || s.receiver?.email || "Retailer"}</div>
                        </td>
                        <td className="py-3 px-2">
                          <button
                            onClick={() => setActiveTab("coldchain")}
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider inline-flex items-center gap-1 hover:opacity-80 transition-opacity ${
                              s.cold_chain_status === 'NORMAL' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                              s.cold_chain_status === 'WARNING' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                              s.cold_chain_status === 'CRITICAL' ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400' :
                              'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                            }`}
                          >
                            <Thermometer className="h-3 w-3" />
                            {s.cold_chain_status || 'UNAVAILABLE'}
                          </button>
                          {s.latest_reading && (
                            <div className="text-[10px] font-mono text-muted-foreground mt-0.5">
                              {s.latest_reading.temperature_celsius}°C
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-2 font-medium">{s.quantity} {s.unit || 'units'}</td>
                        <td className="py-3 px-2">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                            s.status === 'DELIVERED' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                            s.status === 'RECEIVED' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                            s.status === 'DELIVERY_DISPUTED' ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400' :
                            'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                          }`}>
                            {s.status}
                          </span>
                        </td>
                        <td className="py-3 px-2 text-right">
                          {s.status === 'IN_TRANSIT' ? (
                            <Button
                              size="sm"
                              className="text-xs h-7 bg-emerald-600 hover:bg-emerald-700 text-white"
                              onClick={() => openPodModal(s)}
                            >
                              <FileCheck className="h-3.5 w-3.5 mr-1" /> Submit POD
                            </Button>
                          ) : s.proof_of_delivery ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-xs h-7"
                              onClick={() => setViewPodModalShipment(s)}
                            >
                              View Proof ({s.proof_of_delivery.status})
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">Completed</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Navigation className="h-4 w-4 text-emerald-600" />
              Intelligent Delivery Routing
            </CardTitle>
            <CardDescription className="text-xs">Constrained TSP delivery sequence optimization</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="p-4 border rounded-xl bg-slate-50 dark:bg-slate-900/50 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  Active Dispatched Plans: {logisticsMetrics?.active_plans_count || 0}
                </span>
                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 dark:bg-emerald-950 dark:text-emerald-400 px-2 py-0.5 rounded-full">
                  TSP 2-Opt
                </span>
              </div>
              <p className="text-muted-foreground text-[11px]">
                Deliveries sequenced via constrained nearest-neighbor and 2-Opt local search considering perishable produce expiry.
              </p>
              <Button
                size="sm"
                className="w-full text-xs h-8 bg-slate-900 hover:bg-slate-800 text-white mt-1"
                onClick={() => setActiveTab("route")}
              >
                Open Route Planner
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )

  const InventoryTab = () => (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-border/50 shadow-sm">
          <CardHeader>
            <CardTitle>Warehouse Inventory</CardTitle>
            <CardDescription>Manage batches and storage zones.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="py-8 text-center text-muted-foreground">Loading inventory...</div>
            ) : inventory.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">Your inventory is empty.</div>
            ) : (
             <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 px-2">Batch / ID</th>
                    <th className="text-left py-2 px-2">Product</th>
                    <th className="text-left py-2 px-2">Expiry</th>
                    <th className="text-right py-2 px-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {inventory.map((item) => (
                    <tr key={item.id} className="border-b border-muted/30">
                      <td className="py-3 px-2">
                        <div className="font-mono text-xs">{item.batch_number}</div>
                        <div className="text-[10px] text-muted-foreground">ID: {item.product_id}</div>
                      </td>
                      <td className="py-3 px-2">
                        <div className="font-medium">{item.name}</div>
                        <div className="text-xs text-muted-foreground">{item.quantity} units</div>
                      </td>
                      <td className="py-3 px-2">
                        <div className="text-xs">
                          {item.expiry_date ? new Date(item.expiry_date).toLocaleDateString() : 'N/A'}
                        </div>
                      </td>
                      <td className="py-3 px-2 text-right">
                        <span className="text-xs font-medium text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full">{item.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/50 shadow-sm">
          <CardHeader>
            <CardTitle>Batch Splitting</CardTitle>
            <CardDescription>Split a large batch for multiple retail deliveries.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
              <div className="space-y-2">
                <label className="text-sm font-medium">Select Parent Batch</label>
                <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                  {inventory.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.batch_number} ({item.name}) - {item.quantity}
                    </option>
                  ))}
                  {inventory.length === 0 && <option>No inventory available</option>}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Number of Child Pallets</label>
                <input type="number" defaultValue={2} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
              </div>
              <Button className="w-full mt-4" disabled={inventory.length === 0}>
                <SplitSquareHorizontal className="mr-2 h-4 w-4" />
                Generate New QR Codes & Split
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )

  const BlockchainTab = () => (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
      <Card className="max-w-2xl mx-auto border-border/50 shadow-sm">
        <CardHeader className="text-center pb-8">
          <ShieldCheck className="mx-auto h-12 w-12 text-primary mb-4" />
          <CardTitle className="text-2xl">Take Custody</CardTitle>
          <CardDescription>
            Scan a QR code from a Farmer or Processor to officially record the transfer of ownership on the blockchain.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-8">
          <div className="border-2 border-dashed border-muted-foreground/25 rounded-2xl p-12 flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-900/20">
            <QrCode className="h-16 w-16 text-muted-foreground mb-4 opacity-50" />
            <Button variant="outline" className="relative">
              Open Camera to Scan
              <input type="file" accept="image/*" capture="environment" className="absolute inset-0 opacity-0 cursor-pointer" />
            </Button>
            <p className="text-xs text-muted-foreground mt-4 text-center max-w-xs">
              Point your camera at the batch QR code to securely verify and log custody transfer.
            </p>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                Or enter manually
              </span>
            </div>
          </div>

          {handoffSuccess && (
            <div className="p-3 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md text-sm">
              {handoffSuccess}
            </div>
          )}
          {handoffError && (
            <div className="p-3 bg-red-50 text-red-700 border border-red-200 rounded-md text-sm">
              {handoffError}
            </div>
          )}

          <div className="flex gap-3">
            <input
              type="text"
              value={handoffId}
              onChange={(e) => setHandoffId(e.target.value)}
              placeholder="e.g. 100008 or BATCH-XYZ"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
            <Button onClick={handleTakeCustody} disabled={!handoffId || handoffLoading}>
              {handoffLoading ? "Verifying..." : "Verify & Take Custody"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )


  const [statusLoading, setStatusLoading] = useState(false)
  const [statusError, setStatusError] = useState("")
  const [statusSuccess, setStatusSuccess] = useState(false)

  const updateStatus = async (status: string) => {
    setStatusLoading(true)
    setStatusError("")
    setStatusSuccess(false)
    try {
      await axios.put(`${API_URL}/auth/status`, { availability_status: status }, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (user) {
        updateUser({ availability_status: status })
      }
      setStatusSuccess(true)
      setTimeout(() => setStatusSuccess(false), 3000)
    } catch (err: any) {
      console.error(err)
      setStatusError("DB Error: Column 'availability_status' is missing in Supabase.")
    } finally {
      setStatusLoading(false)
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Distributor Operations</h1>
          <p className="text-muted-foreground mt-1">Manage logistics, smart routing, inventory, and blockchain handoffs.</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center bg-white dark:bg-slate-900 px-1 py-1 rounded-full border shadow-sm transition-all hover:shadow-md">
            <div className={`h-2.5 w-2.5 rounded-full ml-3 mr-2 ${
              user?.availability_status === 'Unavailable' ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]' :
              user?.availability_status === 'On Route' ? 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]' :
              'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]'
            }`} />
            <span className="text-sm font-medium text-muted-foreground mr-1">Status:</span>
            <select
              className="text-sm bg-transparent border-0 focus:ring-0 py-1.5 pl-1 pr-7 m-0 outline-none font-semibold text-slate-900 dark:text-white cursor-pointer appearance-none"
              defaultValue={user?.availability_status || "Available for Trip"}
              onChange={(e) => updateStatus(e.target.value)}
              disabled={statusLoading}
              style={{ backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`, backgroundPosition: 'right 0.25rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.2em 1.2em' }}
            >
              <option value="Available for Trip">Available for Trip</option>
              <option value="On Route">On Route</option>
              <option value="Unavailable">Unavailable</option>
            </select>
          </div>
          {statusLoading && <span className="text-xs text-blue-500 animate-pulse">Updating...</span>}
          {statusSuccess && <span className="text-xs text-emerald-500">Status updated!</span>}
          {statusError && <span className="text-xs text-red-500 font-medium bg-red-50 p-1 rounded max-w-xs text-right">{statusError}</span>}
        </div>
      </div>

      <DecisionSupportPanel />

      <div className="flex overflow-x-auto pb-2 -mb-2 scrollbar-none gap-2">
        <Button
          variant={activeTab === "overview" ? "default" : "outline"}
          onClick={() => setActiveTab("overview")}
          className="rounded-full px-6"
        >
          Overview
        </Button>
        <Button
          variant={activeTab === "fleet" ? "default" : "outline"}
          onClick={() => setActiveTab("fleet")}
          className="rounded-full px-6"
        >
          <Truck className="mr-2 h-4 w-4" />
          Fleet & Tracking
        </Button>
        <Button
          variant={activeTab === "coldchain" ? "default" : "outline"}
          onClick={() => setActiveTab("coldchain")}
          className="rounded-full px-6"
        >
          <Thermometer className="mr-2 h-4 w-4" />
          Cold-Chain
        </Button>
        <Button
          variant={activeTab === "route" ? "default" : "outline"}
          onClick={() => setActiveTab("route")}
          className="rounded-full px-6"
        >
          <Navigation className="mr-2 h-4 w-4" />
          Route Planning
        </Button>
        <Button
          variant={activeTab === "inventory" ? "default" : "outline"}
          onClick={() => setActiveTab("inventory")}
          className="rounded-full px-6"
        >
          <Package className="mr-2 h-4 w-4" />
          Inventory
        </Button>
        <Button
          variant={activeTab === "blockchain" ? "default" : "outline"}
          onClick={() => setActiveTab("blockchain")}
          className="rounded-full px-6"
        >
          <QrCode className="mr-2 h-4 w-4" />
          Receive (Handoff)
        </Button>
      </div>

      <div className="mt-6">
        {activeTab === "overview" && <OverviewTab />}
        {activeTab === "fleet" && <FleetTab />}
        {activeTab === "coldchain" && (
          <ColdChainMonitoring
            token={token}
            outgoingShipments={outgoingShipments}
            onRefreshRequired={fetchInventory}
          />
        )}
        {activeTab === "route" && (
          <RouteOptimizationPanel
            token={token}
            outgoingShipments={outgoingShipments}
            onPlanDispatched={fetchInventory}
          />
        )}
        {activeTab === "inventory" && <InventoryTab />}
        {activeTab === "blockchain" && <BlockchainTab />}
      </div>

      {/* Proof of Delivery Submission Modal */}
      {podModalShipment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-lg w-full overflow-hidden p-6 space-y-4">
            <div className="flex justify-between items-center pb-2 border-b">
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <FileCheck className="h-5 w-5 text-emerald-600" /> Submit Proof of Delivery
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">Two-party delivery confirmation record</p>
              </div>
              <button onClick={() => setPodModalShipment(null)} className="text-muted-foreground hover:text-slate-900 dark:hover:text-white p-1 rounded-lg">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Shipment summary card */}
            <div className="bg-slate-50 dark:bg-slate-800/60 p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-700 text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tracking ID:</span>
                <span className="font-mono font-semibold">{podModalShipment.shipment_tracking_id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Batch Number:</span>
                <span className="font-mono">{podModalShipment.batch_number}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Product:</span>
                <span className="font-medium">{podModalShipment.request?.product_name || "Batch Product"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Retailer:</span>
                <span className="font-medium">{podModalShipment.receiver?.name || podModalShipment.receiver?.email || "Assigned Retailer"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Dispatched Qty:</span>
                <span className="font-semibold text-blue-600 dark:text-blue-400">{podModalShipment.quantity} {podModalShipment.unit || 'units'}</span>
              </div>
            </div>

            {podError && (
              <div className="p-3 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-xl text-xs flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{podError}</span>
              </div>
            )}

            {podSuccess && (
              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 rounded-xl text-xs flex items-center gap-2">
                <CheckCircle className="h-4 w-4 shrink-0" />
                <span>{podSuccess}</span>
              </div>
            )}

            <form onSubmit={handleSubmitPod} className="space-y-3.5">
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Recipient Name *</label>
                <input
                  type="text"
                  required
                  value={podRecipientName}
                  onChange={(e) => setPodRecipientName(e.target.value)}
                  placeholder="e.g. John Doe (Store Manager)"
                  className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-input bg-background focus:ring-2 focus:ring-emerald-500/50 outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Quantity Delivered *</label>
                <div className="flex gap-2 items-center mt-1">
                  <input
                    type="number"
                    step="any"
                    min="0.01"
                    max={podModalShipment.quantity}
                    required
                    value={podDeliveredQty}
                    onChange={(e) => setPodDeliveredQty(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-background focus:ring-2 focus:ring-emerald-500/50 outline-none"
                  />
                  <span className="text-xs font-medium text-muted-foreground px-2 py-2 bg-slate-100 dark:bg-slate-800 rounded-lg shrink-0">
                    {podModalShipment.unit || 'units'}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">Cannot exceed dispatched quantity ({podModalShipment.quantity} {podModalShipment.unit || 'units'}).</p>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Delivery Notes (Optional)</label>
                <textarea
                  rows={2}
                  value={podNotes}
                  onChange={(e) => setPodNotes(e.target.value)}
                  placeholder="e.g. Delivered to receiving bay 3, cold chain temperature verified 4°C"
                  className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-input bg-background focus:ring-2 focus:ring-emerald-500/50 outline-none resize-none"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Photo Evidence URL (Optional)</label>
                <input
                  type="text"
                  value={podPhotoUrl}
                  onChange={(e) => setPodPhotoUrl(e.target.value)}
                  placeholder="Photo reference URL or paste image link"
                  className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-input bg-background focus:ring-2 focus:ring-emerald-500/50 outline-none"
                />
              </div>

              <div className="pt-2 flex gap-2">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setPodModalShipment(null)} disabled={submittingPod}>
                  Cancel
                </Button>
                <Button type="submit" className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white" disabled={submittingPod}>
                  {submittingPod ? "Submitting..." : "Submit Proof"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* View Proof of Delivery Modal */}
      {viewPodModalShipment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-lg w-full overflow-hidden p-6 space-y-4">
            <div className="flex justify-between items-center pb-2 border-b">
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-emerald-600" /> Proof of Delivery Record
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">Shipment {viewPodModalShipment.shipment_tracking_id}</p>
              </div>
              <button onClick={() => setViewPodModalShipment(null)} className="text-muted-foreground hover:text-slate-900 dark:hover:text-white p-1 rounded-lg">
                <X className="h-5 w-5" />
              </button>
            </div>

            {viewPodModalShipment.proof_of_delivery ? (
              <div className="space-y-3 text-xs">
                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">Confirmation Status:</span>
                  <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider ${
                    viewPodModalShipment.proof_of_delivery.status === 'ACKNOWLEDGED' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400' :
                    viewPodModalShipment.proof_of_delivery.status === 'DISPUTED' ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400' :
                    'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400'
                  }`}>
                    {viewPodModalShipment.proof_of_delivery.status}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border">
                  <div>
                    <span className="text-muted-foreground block text-[10px] uppercase font-bold">Recipient</span>
                    <span className="font-semibold text-slate-900 dark:text-white">{viewPodModalShipment.proof_of_delivery.recipient_name}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[10px] uppercase font-bold">Delivered Quantity</span>
                    <span className="font-semibold text-emerald-600">{viewPodModalShipment.proof_of_delivery.quantity_delivered} {viewPodModalShipment.proof_of_delivery.unit}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[10px] uppercase font-bold">Submitted At</span>
                    <span>{viewPodModalShipment.proof_of_delivery.submitted_at ? new Date(viewPodModalShipment.proof_of_delivery.submitted_at).toLocaleString() : 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[10px] uppercase font-bold">Acknowledged At</span>
                    <span>{viewPodModalShipment.proof_of_delivery.acknowledged_at ? new Date(viewPodModalShipment.proof_of_delivery.acknowledged_at).toLocaleString() : 'Pending Retailer'}</span>
                  </div>
                </div>

                {viewPodModalShipment.proof_of_delivery.delivery_notes && (
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border">
                    <span className="text-muted-foreground block text-[10px] uppercase font-bold mb-1">Distributor Delivery Notes</span>
                    <p className="text-slate-800 dark:text-slate-200">{viewPodModalShipment.proof_of_delivery.delivery_notes}</p>
                  </div>
                )}

                {viewPodModalShipment.proof_of_delivery.discrepancy_reason && (
                  <div className="p-3 bg-rose-50 dark:bg-rose-950/30 rounded-xl border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300">
                    <span className="font-bold block text-[10px] uppercase mb-1">Retailer Discrepancy Reason</span>
                    <p className="font-semibold">{viewPodModalShipment.proof_of_delivery.discrepancy_reason}</p>
                    {viewPodModalShipment.proof_of_delivery.discrepancy_notes && (
                      <p className="text-[11px] mt-1 text-rose-700 dark:text-rose-400">{viewPodModalShipment.proof_of_delivery.discrepancy_notes}</p>
                    )}
                  </div>
                )}

                {viewPodModalShipment.proof_of_delivery.photo_url && (
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border">
                    <span className="text-muted-foreground block text-[10px] uppercase font-bold mb-1">Photo Evidence</span>
                    <img src={viewPodModalShipment.proof_of_delivery.photo_url} alt="Proof" className="max-h-40 rounded-lg object-cover border" />
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-6 text-muted-foreground text-xs">
                No proof of delivery record on file for this shipment.
              </div>
            )}

            <Button variant="outline" className="w-full" onClick={() => setViewPodModalShipment(null)}>
              Close
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

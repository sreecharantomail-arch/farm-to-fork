import { useState, useEffect, useCallback } from "react"
import { Button } from "../components/ui/Button"
import {
  Leaf, Plus, X, CheckCircle2, Clock, Truck, Factory,
  ShoppingBag, AlertCircle, RefreshCw, Wheat, CalendarDays, Wand2, QrCode, Printer, Download,
  Bell, BarChart3, Info
} from "lucide-react"
import { QRCodeSVG, QRCodeCanvas } from "qrcode.react"
import { useNavigate } from "react-router-dom"
import axios from "axios"
import { useAuth } from "../context/AuthContext"
import { DecisionSupportPanel } from "../components/DecisionSupportPanel"

const API = import.meta.env.VITE_API_URL || "https://farm-to-fork-tracker.onrender.com/api"

export interface FarmerNotification {
  id: string
  type: "processor_interest" | "processor_accepted" | "processor_rejected"
  productId: string
  batchNumber: string
  productName: string
  quantity: number
  processorName: string
  date: string
  time: string
  timestamp: number
  read: boolean
  message: string
}



// Status config
const STATUS_CONFIG: Record<string, { color: string; bg: string; icon: React.ElementType; label: string }> = {
  Harvested:          { color: "text-green-400",  bg: "bg-green-400/10 border-green-400/30",   icon: Leaf,        label: "Harvested"   },
  Processing:         { color: "text-blue-400",   bg: "bg-blue-400/10 border-blue-400/30",     icon: Factory,     label: "Processing"  },
  "In Transit":       { color: "text-yellow-400", bg: "bg-yellow-400/10 border-yellow-400/30", icon: Truck,       label: "In Transit"  },
  Delivered:          { color: "text-purple-400", bg: "bg-purple-400/10 border-purple-400/30", icon: ShoppingBag, label: "Delivered"   },
  Sold:               { color: "text-pink-400",   bg: "bg-pink-400/10 border-pink-400/30",     icon: CheckCircle2, label: "Sold"       },
  "Pending Approval": { color: "text-slate-400",  bg: "bg-slate-400/10 border-slate-400/30",   icon: Clock,       label: "Pending Approval" },
}

const QUALITY_COLOR: Record<string, string> = {
  Excellent: "text-green-400",
  Good:      "text-lime-400",
  Average:   "text-yellow-400",
  Poor:      "text-red-400",
  Unknown:   "text-slate-400",
}

interface Product {
  _id: string
  name: string
  category: string
  batchNumber: string
  quantity: number
  status: string
  aiQualityLabel: string
  aiQualityScore: number
  organicStatus: boolean
  expiryDate?: string
  productImageUrl?: string
  createdAt: string
}

const normaliseProduct = (product: any): Product => ({
  _id: product._id || product.id,
  name: product.name,
  category: product.category,
  batchNumber: product.batchNumber || product.batch_number || "",
  quantity: Number(product.quantity || 0),
  status: product.status,
  aiQualityLabel: product.aiQualityLabel || product.ai_quality_label || "Unknown",
  aiQualityScore: Number(product.aiQualityScore ?? product.ai_quality_score ?? 0),
  organicStatus: Boolean(product.organicStatus ?? product.organic_status),
  expiryDate: product.expiryDate || product.expiry_date || undefined,
  productImageUrl: product.productImageUrl || product.product_image_url || undefined,
  createdAt: product.createdAt || product.created_at,
})

export function FarmerDashboard() {
  const { token } = useAuth()



  // Products state
  const [products, setProducts] = useState<Product[]>([])
  const [selectedQrProduct, setSelectedQrProduct] = useState<Product | null>(null)
  const [loadingProducts, setLoadingProducts] = useState(true)
  const [productError, setProductError] = useState("")

  // Notification state
  const [unreadCount, setUnreadCount] = useState(0)

  // Dashboard API state
  const [dashboardData, setDashboardData] = useState<any>(null)
  const [loadingDashboard, setLoadingDashboard] = useState(true)
  const [dashboardError, setDashboardError] = useState("")

  const navigate = useNavigate()


  const headers = { Authorization: `Bearer ${token}` }

  // Load Farmer Notifications unread count from API
  const loadNotifications = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/notifications/unread-count`, { headers: { Authorization: `Bearer ${token}` } })
      if (res.data.success) {
        setUnreadCount(res.data.count)
      }
    } catch {
      setUnreadCount(0)
    }
  }, [token])

  useEffect(() => {
    loadNotifications()
    const handleUpdate = () => {
      loadNotifications()
      fetchProducts()
      fetchDashboard()
    }
    window.addEventListener("farmer_notifications_updated", handleUpdate)
    return () => {
      window.removeEventListener("farmer_notifications_updated", handleUpdate)
    }
  }, [loadNotifications])


  // Fetch farmer's own products
  const fetchProducts = useCallback(async () => {
    setLoadingProducts(true)
    setProductError("")
    try {
      const res = await axios.get(`${API}/products/my`, { headers })
      const rawProducts: Product[] = (res.data.data || []).map(normaliseProduct)
      
      // Filter out permanently deleted products
      let deletedIds: string[] = []
      try {
        deletedIds = JSON.parse(localStorage.getItem("farmer_deleted_products") || "[]")
      } catch {
        deletedIds = []
      }
      const deletedSet = new Set(deletedIds.map(String))
      
      // Automatic Expiry Filter:
      // If a product has no processor interest (status is Harvested / Pending Approval)
      // and its expiry date is in the past, it automatically disappears from active listings.
      const isUnclaimedAndExpired = (p: Product) => {
        if (!p.expiryDate) return false
        if (p.status !== "Harvested" && p.status !== "Pending Approval") return false
        const expiryTime = new Date(`${p.expiryDate}T23:59:59`).getTime()
        return !isNaN(expiryTime) && expiryTime < Date.now()
      }

      const activeProducts = rawProducts.filter(p => 
        !deletedSet.has(String(p._id)) && 
        !deletedSet.has(String(p.batchNumber)) &&
        !isUnclaimedAndExpired(p)
      )
      setProducts(activeProducts)
    } catch {
      setProductError("Could not load products. Make sure the backend is running.")
    } finally {
      setLoadingProducts(false)
    }
  }, [token])

  const fetchDashboard = useCallback(async () => {
    setLoadingDashboard(true)
    setDashboardError("")
    try {
      const res = await axios.get(`${API}/farmer/dashboard`, { headers: { Authorization: `Bearer ${token}` } })
      setDashboardData(res.data.data)
    } catch {
      setDashboardError("Unable to load dashboard data. Please try again.")
    } finally {
      setLoadingDashboard(false)
    }
  }, [token])

  useEffect(() => { 
    fetchProducts()
    fetchDashboard()
  }, [fetchProducts, fetchDashboard])





  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Farmer Portal</h1>
          <p className="text-slate-400 mt-1">Manage your harvest, track processor interests, and monitor your produce through the supply chain.</p>
        </div>

        <div className="flex items-center gap-3 relative">
          <div className="relative">
            <button
              onClick={() => navigate('/farmer/notifications')}
              className="relative flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 text-foreground transition-all hover:border-green-500/40 focus:outline-none"
              title="Notifications"
              aria-label="View notifications"
            >
              <Bell className="h-5 w-5 text-slate-300" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-500 px-1.5 text-[11px] font-bold text-white shadow-lg animate-pulse ring-2 ring-slate-900">
                  {unreadCount}
                </span>
              )}
            </button>
          </div>

          <Button onClick={() => navigate('/farmer/products?action=add')} className="gap-2">
            <Plus className="h-4 w-4" />
            Register New Harvest
          </Button>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => navigate('/farmer/products?action=add')} className="gap-2 shrink-0">
          <Plus className="h-4 w-4" /> Add Product
        </Button>
        <Button variant="outline" onClick={() => document.getElementById('my-products-section')?.scrollIntoView({ behavior: 'smooth' })} className="gap-2 shrink-0 border-white/10">
          <Wheat className="h-4 w-4" /> View Products
        </Button>
        <Button variant="outline" onClick={() => navigate('/farmer/ai-services')} className="gap-2 shrink-0 border-white/10">
          <Wand2 className="h-4 w-4" /> AI Services
        </Button>
        <Button variant="outline" onClick={() => navigate('/tracker')} className="gap-2 shrink-0 border-white/10">
          <QrCode className="h-4 w-4" /> Traceability
        </Button>
        <Button variant="outline" onClick={() => navigate('/farmer/analytics')} className="gap-2 shrink-0 border-white/10">
          <BarChart3 className="h-4 w-4" /> Analytics
        </Button>
      </div>

      {/* Stats */}
      {loadingDashboard ? (
        <div className="flex items-center gap-3 p-4 rounded-xl border border-white/10 bg-white/5 text-slate-300">
          <RefreshCw className="h-4 w-4 animate-spin text-green-400" />
          Loading dashboard...
        </div>
      ) : dashboardError ? (
        <div className="p-4 rounded-xl border border-red-500/20 bg-red-500/10 text-red-400 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 shrink-0" />
          {dashboardError}
        </div>
      ) : dashboardData ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: "Total Products", value: dashboardData.stats.totalProducts, icon: Wheat, color: "text-blue-400" },
              { label: "Active Products", value: dashboardData.stats.activeProducts, icon: Leaf, color: "text-green-400" },
              { label: "Completed Products", value: dashboardData.stats.completedProducts, icon: CheckCircle2, color: "text-emerald-400" },
              { label: "Pending Requests", value: dashboardData.stats.pendingRequests, icon: Bell, color: "text-amber-400" },
            ].map(s => (
              <div key={s.label} className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md p-5 flex items-center gap-4">
                <div className={`p-3 rounded-xl bg-white/5 ${s.color}`}>
                  <s.icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{s.value}</p>
                  <p className="text-xs text-slate-400">{s.label}</p>
                </div>
              </div>
            ))}
          </div>

          <DecisionSupportPanel />

          <div className="grid lg:grid-cols-2 gap-6">
            {/* Batch / Supply Status */}
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
                <Truck className="h-4 w-4 text-primary" /> Supply Chain Status
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Active/Harvested", value: dashboardData.statusSummary.harvested, icon: Leaf, color: "text-lime-400" },
                  { label: "Processing", value: dashboardData.statusSummary.processing, icon: Factory, color: "text-blue-400" },
                  { label: "In Transit", value: dashboardData.statusSummary.inTransit, icon: Truck, color: "text-yellow-400" },
                  { label: "Delivered", value: dashboardData.statusSummary.delivered, icon: ShoppingBag, color: "text-purple-400" },
                ].map(status => (
                  <div key={status.label} className="p-3 rounded-xl bg-white/5 border border-white/5 flex items-center gap-3">
                    <div className={`p-2 rounded-lg bg-white/5 ${status.color}`}>
                      <status.icon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-lg font-bold text-foreground">{status.value}</p>
                      <p className="text-[11px] text-slate-400">{status.label}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Recent Activity */}
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5 flex flex-col max-h-72">
              <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2 shrink-0">
                <Clock className="h-4 w-4 text-primary" /> Recent Activity
              </h3>
              <div className="flex-1 overflow-y-auto pr-2 space-y-3 custom-scrollbar">
                {dashboardData.recentActivity.length === 0 ? (
                  <div className="py-8 text-center text-slate-400 text-xs">
                    No recent activity
                  </div>
                ) : (
                  dashboardData.recentActivity.map((activity: any) => {
                    const activityDate = new Date(activity.date);
                    const isToday = activityDate.toDateString() === new Date().toDateString();
                    const isYesterday = activityDate.toDateString() === new Date(Date.now() - 86400000).toDateString();
                    const dateStr = isToday ? "Today" : isYesterday ? "Yesterday" : activityDate.toLocaleDateString();
                    const timeStr = activityDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    
                    return (
                      <div key={activity.id} className="flex gap-3 text-sm border-b border-white/5 pb-3 last:border-0 last:pb-0">
                        <div className="w-16 shrink-0 text-right">
                          <p className="text-xs font-medium text-slate-300">{dateStr}</p>
                          <p className="text-[10px] text-slate-500">{timeStr}</p>
                        </div>
                        <div className="w-2 shrink-0 flex flex-col items-center">
                          <div className="h-2 w-2 rounded-full bg-primary mt-1.5" />
                          <div className="flex-1 w-px bg-white/10 mt-1" />
                        </div>
                        <div className="flex-1 pb-1">
                          <p className="text-foreground font-medium text-xs">{activity.title}</p>
                          <p className="text-slate-400 text-[11px] mt-0.5 leading-relaxed">{activity.description}</p>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}




      {/* My Products */}
      <div id="my-products-section" className="pt-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-foreground">My Products</h2>
          <button
            onClick={fetchProducts}
            className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-primary transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>

        {loadingProducts ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-500" />
          </div>
        ) : productError ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center rounded-2xl border border-red-500/20 bg-red-500/5">
            <AlertCircle className="h-8 w-8 text-red-400" />
            <p className="text-red-400 text-sm">{productError}</p>
            <Button variant="outline" onClick={fetchProducts} className="mt-1 text-sm">Retry</Button>
          </div>
        ) : products.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-4 rounded-2xl border border-white/10 bg-white/5">
            <div className="p-4 rounded-2xl bg-green-500/10">
              <Leaf className="h-8 w-8 text-green-400" />
            </div>
            <div className="text-center">
              <p className="text-foreground font-medium">No products yet</p>
              <p className="text-slate-400 text-sm mt-1">Register your first harvest to get started.</p>
            </div>
            <Button onClick={() => navigate('/farmer/products?action=add')} className="gap-2">
              <Plus className="h-4 w-4" /> Register Now
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {products.map(p => {
              const sc = STATUS_CONFIG[p.status] || STATUS_CONFIG["Harvested"]
              const StatusIcon = sc.icon
              const qColor = QUALITY_COLOR[p.aiQualityLabel] || QUALITY_COLOR["Unknown"]
              const date = new Date(p.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })

              return (
                <div key={p._id} className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md p-5 space-y-4 hover:border-green-500/30 transition-all duration-200 group">
                  {/* Top row */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-foreground truncate group-hover:text-primary transition-colors">{p.name}</h3>
                      <p className="text-xs text-slate-400 mt-0.5">{p.category} · {p.batchNumber}</p>
                    </div>
                    {p.organicStatus && (
                      <span className="shrink-0 text-xs px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/20 font-medium">
                        Organic
                      </span>
                    )}
                  </div>

                  {p.productImageUrl && <img src={p.productImageUrl} alt={p.name} className="h-28 w-full rounded-xl border border-emerald-100 object-cover" />}

                  {/* Status */}
                  <div className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border font-medium ${sc.bg} ${sc.color}`}>
                    <StatusIcon className="h-3.5 w-3.5" />
                    {sc.label}
                  </div>

                  {/* Interactive Processor Deal Handshake & Intake Outcome */}
                  {/* Supply Chain Integration Placeholder */}
                  <div className="rounded-xl border border-white/5 bg-white/5 p-3 text-xs text-slate-300 flex items-center gap-2.5 shadow-sm">
                    <Info className="h-4 w-4 text-slate-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-slate-200">No active processor deals yet.</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">Processor engagement will appear here when supported by the supply-chain workflow.</p>
                    </div>
                  </div>


                  {/* AI Quality */}
                  <div className="flex items-center justify-between pt-1 border-t border-white/5">
                    <div>
                      <p className="text-xs text-slate-500">AI Quality</p>
                      <p className={`text-sm font-semibold ${qColor}`}>
                        {p.aiQualityLabel}
                        {p.aiQualityScore > 0 && (
                          <span className="text-xs font-normal text-slate-400 ml-1">
                            ({(p.aiQualityScore * 100).toFixed(0)}%)
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-slate-500">Quantity</p>
                      <p className="text-sm font-semibold text-foreground">{p.quantity} kg</p>
                    </div>
                  </div>

                  {/* Date */}
                  <div className="flex items-center gap-1.5 text-xs text-slate-500">
                    <Clock className="h-3 w-3" />
                    Registered on {date}
                  </div>
                  {p.expiryDate && (
                    <div className="flex items-center gap-1.5 text-xs text-primary">
                      <CalendarDays className="h-3 w-3" />
                      Expires {new Date(`${p.expiryDate}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                    </div>
                  )}

                  {/* Card Actions: QR Code Certificate */}
                  <div className="pt-3 border-t border-white/10 flex items-center">
                    {p.status !== "Pending Approval" && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full text-xs gap-1.5 rounded-xl border-green-500/30 text-green-400 hover:bg-green-500/10 hover:border-green-500"
                        onClick={() => setSelectedQrProduct(p)}
                      >
                        <QrCode className="h-3.5 w-3.5" />
                        View QR Certificate
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* QR Code Certificate Modal */}
      {selectedQrProduct && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/10 rounded-3xl p-6 max-w-sm w-full space-y-5 text-center shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center border-b border-white/10 pb-3">
              <h3 className="font-bold text-lg text-foreground flex items-center gap-2">
                <QrCode className="h-5 w-5 text-primary" />
                Product QR Certificate
              </h3>
              <button
                onClick={() => setSelectedQrProduct(null)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Offscreen Canvas used for high-res crisp PNG export */}
            <div style={{ position: "fixed", left: "-9999px", top: "-9999px", pointerEvents: "none" }}>
              <QRCodeCanvas
                id="farmer-qr-canvas"
                value={`${window.location.origin}/tracker?id=${selectedQrProduct._id}`}
                size={400}
                level="M"
                bgColor="#ffffff"
                fgColor="#000000"
                includeMargin={true}
                marginSize={4}
              />
            </div>

            <div className="p-4 bg-white rounded-2xl flex flex-col items-center justify-center shadow-inner mx-auto w-fit">
              <QRCodeSVG
                value={`${window.location.origin}/tracker?id=${selectedQrProduct._id}`}
                size={180}
                level="H"
                includeMargin={true}
              />
            </div>

            <div className="space-y-1 text-xs">
              <p className="font-bold text-base text-foreground">{selectedQrProduct.name}</p>
              <p className="text-slate-400 font-mono">Batch: {selectedQrProduct.batchNumber}</p>
              <p className="text-slate-400">Qty: {selectedQrProduct.quantity} kg • {selectedQrProduct.category}</p>
              <p className="text-emerald-400 font-semibold pt-1">
                Scan with camera or upload image to trace on blockchain
              </p>
            </div>

            <div className="flex flex-col gap-2 pt-2">
              <Button
                className="w-full rounded-xl text-xs gap-1.5 bg-primary hover:bg-primary/95 text-white font-semibold"
                onClick={() => {
                  const canvas = document.getElementById("farmer-qr-canvas") as HTMLCanvasElement
                  if (!canvas) return
                  const pngUrl = canvas.toDataURL("image/png")
                  const downloadLink = document.createElement("a")
                  downloadLink.href = pngUrl
                  downloadLink.download = `${selectedQrProduct.name.replace(/\s+/g, '_')}_${selectedQrProduct.batchNumber}_QR.png`
                  document.body.appendChild(downloadLink)
                  downloadLink.click()
                  document.body.removeChild(downloadLink)
                }}
              >
                <Download className="h-3.5 w-3.5" /> Download QR Image (PNG)
              </Button>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1 rounded-xl text-xs gap-1.5"
                  onClick={() => window.print()}
                >
                  <Printer className="h-3.5 w-3.5" /> Print
                </Button>
                <Button
                  variant="ghost"
                  className="flex-1 rounded-xl text-xs text-slate-400 hover:text-white"
                  onClick={() => setSelectedQrProduct(null)}
                >
                  Close
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

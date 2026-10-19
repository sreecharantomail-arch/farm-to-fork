import { useState, useEffect, useCallback, useRef } from "react"
import { Button } from "../components/ui/Button"
import {
  Leaf, Truck, Factory, ShoppingBag, CheckCircle2,
  AlertCircle, RefreshCw, Star, Filter, Search, QrCode, X,
  Plus, ImagePlus, Trash2, CalendarDays, Wand2
} from "lucide-react"
import { QRCodeSVG } from "qrcode.react"
import axios from "axios"
import { useAuth } from "../context/AuthContext"
import { useSearchParams } from "react-router-dom"

const API = import.meta.env.VITE_API_URL || "https://farm-to-fork-tracker.onrender.com/api"

const generateBatchNumber = () => {
  const date = new Date()
  const datePart = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`
  const randomPart = crypto.randomUUID().split('-')[0].toUpperCase()
  return `BCH-${datePart}-${randomPart}`
}

const createProductForm = () => ({
  name: "",
  category: "",
  quantity: "",
  batchNumber: generateBatchNumber(),
  expiryDate: "",
  organicStatus: true,
})

const STATUS_CONFIG: Record<string, { color: string; bg: string; icon: React.ElementType }> = {
  Harvested: { color: "text-green-400", bg: "bg-green-400/10 border-green-400/30", icon: Leaf },
  Processing: { color: "text-blue-400", bg: "bg-blue-400/10 border-blue-400/30", icon: Factory },
  "In Transit": { color: "text-yellow-400", bg: "bg-yellow-400/10 border-yellow-400/30", icon: Truck },
  Delivered: { color: "text-purple-400", bg: "bg-purple-400/10 border-purple-400/30", icon: ShoppingBag },
  Sold: { color: "text-pink-400", bg: "bg-pink-400/10 border-pink-400/30", icon: CheckCircle2 },
  "Pending Approval": { color: "text-slate-400", bg: "bg-slate-400/10 border-slate-400/30", icon: AlertCircle },
}

const QUALITY_COLOR: Record<string, string> = {
  Excellent: "text-green-400", Good: "text-lime-400",
  Average: "text-yellow-400", Poor: "text-red-400", Unknown: "text-slate-400",
}

interface Product {
  id: string; _id?: string; name: string; category: string; batch_number: string; batchNumber?: string;
  quantity: number; status: string; ai_quality_label: string; aiQualityLabel?: string;
  ai_quality_score: number; aiQualityScore?: number; organic_status: boolean; organicStatus?: boolean; created_at: string; createdAt?: string;
  product_id: number; expiry_date?: string; expiryDate?: string;
  product_image_url?: string; productImageUrl?: string;
  ai_shelf_life?: any;
}

const format6DigitId = (id: number | string) => {
  const num = Number(id)
  if (!num || num <= 0) return "100000"
  if (num >= 100000 && num <= 999999) return String(num)
  return String(100000 + (Math.abs(num) % 899999))
}

export function MyProductsPage() {
  const { token } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState("All")
  const [selectedProductQR, setSelectedProductQR] = useState<Product | null>(null)
  const [productToDelete, setProductToDelete] = useState<Product | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // Registration Form State
  const [showForm, setShowForm] = useState(searchParams.get("action") === "add")
  const [form, setForm] = useState(createProductForm())
  const [imageData, setImageData] = useState("")
  const [imagePreview, setImagePreview] = useState("")
  const photoInputRef = useRef<HTMLInputElement>(null)
  const [submitting, setSubmitting] = useState(false)
  const [formMsg, setFormMsg] = useState<{ type: "success" | "error"; text: string } | null>(null)

  const headers = { Authorization: `Bearer ${token}` }

  const fetchProducts = useCallback(async () => {
    setLoading(true); setError("")
    try {
      const res = await axios.get(`${API}/products/my`, { headers })
      setProducts(res.data.data || [])
    } catch {
      setError("Could not load products. Make sure the backend is running.")
    } finally { setLoading(false) }
  }, [token])

  useEffect(() => { fetchProducts() }, [fetchProducts])

  useEffect(() => {
    if (searchParams.get("action") === "add") {
      openRegistrationForm()
    }
  }, [searchParams])

  const openRegistrationForm = () => {
    setForm(createProductForm())
    setImageData("")
    setImagePreview("")
    setFormMsg(null)
    setShowForm(true)
    setSearchParams({})
  }

  const closeRegistrationForm = () => {
    setShowForm(false)
    setSearchParams({})
  }

  const handleFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, type, value } = e.target
    if (type === "checkbox") {
      const checked = (e.target as HTMLInputElement).checked
      setForm(f => ({ ...f, [name]: checked }))
    } else if (name === "quantity") {
      if (value === "" || Number(value) >= 0) {
        setForm(f => ({ ...f, [name]: value }))
      }
    } else {
      setForm(f => ({ ...f, [name]: value }))
    }
  }

  const handlePhotoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setFormMsg({ type: "error", text: "Upload a JPEG, PNG, or WebP product photo." })
      event.target.value = ""
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setFormMsg({ type: "error", text: "Product photos must be 5 MB or smaller." })
      event.target.value = ""
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : ""
      setImageData(dataUrl)
      setImagePreview(dataUrl)
      setFormMsg(null)
    }
    reader.readAsDataURL(file)
  }

  const removePhoto = () => {
    setImageData("")
    setImagePreview("")
    if (photoInputRef.current) photoInputRef.current.value = ""
    setFormMsg(null)
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name || !form.category || !form.quantity || !form.expiryDate) {
      setFormMsg({ type: "error", text: "Please fill in all required fields." })
      return
    }

    setSubmitting(true)
    try {
      const randomArr = new Uint32Array(1)
      window.crypto.getRandomValues(randomArr)
      const product_id = (randomArr[0] % 900000) + 100000

      await axios.post(
        `${API}/products`,
        { ...form, quantity: Number(form.quantity), imageData, blockchainHash: null, product_id },
        { headers }
      )

      setFormMsg({ type: "success", text: "✅ Product submitted! Awaiting admin approval." })
      setTimeout(() => {
        closeRegistrationForm()
        fetchProducts()
      }, 2000)
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 413) {
        setFormMsg({ type: "error", text: "The active backend has a smaller upload limit. Deploy the latest backend update, or remove the photo and try again." })
      } else {
        const message = axios.isAxiosError(error) && error.response?.data?.message
          ? error.response.data.message
          : "Registration failed. Check backend is running."
        setFormMsg({ type: "error", text: message })
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteProduct = async () => {
    if (!productToDelete) return
    setIsDeleting(true)
    try {
      const idToUse = productToDelete.id || productToDelete._id || productToDelete.product_id
      await axios.delete(`${API}/products/${idToUse}`, { headers })
      setProducts(prev => prev.filter(p => (p.id || p._id || p.product_id) !== idToUse))
      setProductToDelete(null)
    } catch (err) {
      console.error("Failed to delete product", err)
      alert("Failed to delete product. Ensure you have the right permissions.")
    } finally {
      setIsDeleting(false)
    }
  }

  const statuses = ["All", ...Object.keys(STATUS_CONFIG)]
  const filtered = products.filter(p => {
    const matchSearch = p.name?.toLowerCase().includes(search.toLowerCase()) ||
      (p.batch_number || p.batchNumber || "").toLowerCase().includes(search.toLowerCase()) ||
      format6DigitId(p.product_id).includes(search)
    const matchFilter = filter === "All" || p.status === filter
    return matchSearch && matchFilter
  })

  // Sort by newest first
  filtered.sort((a, b) => new Date(b.created_at || b.createdAt || 0).getTime() - new Date(a.created_at || a.createdAt || 0).getTime())

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">My Products</h1>
          <p className="text-slate-400 mt-1">Manage all your registered harvests and track their status.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchProducts} className="gap-1.5 border-white/10 shrink-0">
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
          <Button onClick={openRegistrationForm} className="gap-2 shrink-0">
            <Plus className="h-4 w-4" /> Add Product
          </Button>
        </div>
      </div>

      {/* Search & Filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text" placeholder="Search by name, batch, or 6-digit ID..." value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 h-10 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-green-500/50"
          />
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 custom-scrollbar">
          <Filter className="h-4 w-4 text-slate-400 shrink-0" />
          <div className="flex gap-1 flex-nowrap">
            {statuses.map(s => (
              <button key={s} onClick={() => setFilter(s)}
                className={`text-xs whitespace-nowrap px-3 py-1.5 rounded-lg border transition-all ${filter === s
                  ? "bg-green-500 border-green-500 text-white font-medium"
                  : "border-white/10 bg-white/5 text-slate-400 hover:text-primary"
                  }`}
              >{s}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Table-style list */}
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-500" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 rounded-2xl border border-red-500/20 bg-red-500/10">
          <AlertCircle className="h-8 w-8 text-red-400" />
          <p className="text-red-400 text-sm">{error}</p>
          <Button variant="outline" onClick={fetchProducts} className="border-red-500/30 text-red-400 hover:bg-red-500/20">Retry</Button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 rounded-2xl border border-white/10 bg-white/5 text-center shadow-sm">
          <Leaf className="h-8 w-8 text-slate-400" />
          <p className="text-slate-300 font-medium">No products found</p>
          <p className="text-slate-500 text-sm">{search || filter !== "All" ? "Try a different search or filter." : "Register your first harvest to get started."}</p>
          {!(search || filter !== "All") && (
             <Button onClick={openRegistrationForm} className="mt-2 gap-2">
               <Plus className="h-4 w-4" /> Register Harvest
             </Button>
          )}
        </div>
      ) : (
        <div className="rounded-2xl border border-white/10 bg-slate-900 overflow-hidden shadow-xl">
          <div className="hidden lg:grid grid-cols-12 gap-4 px-5 py-4 border-b border-white/10 bg-white/5 text-xs font-semibold text-slate-400 uppercase tracking-wider items-center">
            <div className="col-span-2">Product ID & Batch</div>
            <div className="col-span-3">Product Details</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-3">AI Analysis</div>
            <div className="col-span-1 text-right">Qty</div>
            <div className="col-span-1 text-center">Verify</div>
          </div>
          
          <div className="divide-y divide-white/5">
            {filtered.map((p, idx) => {
              const sc = STATUS_CONFIG[p.status] || STATUS_CONFIG["Harvested"]
              const Icon = sc.icon
              const qLabel = p.ai_quality_label || p.aiQualityLabel || "Unknown"
              const qScore = p.ai_quality_score ?? p.aiQualityScore ?? 0
              const qColor = QUALITY_COLOR[qLabel] || QUALITY_COLOR["Unknown"]
              const displayId = format6DigitId(p.product_id)
              const batchNo = p.batch_number || p.batchNumber
              const isOrg = p.organic_status ?? p.organicStatus
              const pImg = p.product_image_url || p.productImageUrl
              const shelfLifeStr = p.ai_shelf_life?.predicted_shelf_life_days 
                ? `${Math.round(p.ai_shelf_life.predicted_shelf_life_days)} days left` 
                : "Unknown"

              return (
                <div key={p.id || p._id || idx} className="grid grid-cols-1 lg:grid-cols-12 gap-4 px-5 py-5 items-center hover:bg-white/5 transition-colors group">
                  
                  {/* Column 1: Product ID & Batch */}
                  <div className="lg:col-span-2 flex lg:flex-col items-center lg:items-start justify-between min-w-0">
                    <span className="font-mono text-xs font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-md border border-emerald-500/20 inline-block mb-1">
                      ID: {displayId}
                    </span>
                    <p className="text-xs font-mono text-slate-500 truncate" title={batchNo}>{batchNo}</p>
                  </div>

                  {/* Column 2: Product Details */}
                  <div className="lg:col-span-3 flex items-center gap-3 min-w-0">
                    {pImg ? (
                       <img src={pImg} alt={p.name} className="h-10 w-10 rounded-lg object-cover border border-white/10 shrink-0" />
                    ) : (
                       <div className="h-10 w-10 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                         <Leaf className="h-4 w-4 text-slate-500" />
                       </div>
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-slate-200 truncate">{p.name}</p>
                        {isOrg && (
                          <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 uppercase tracking-wider font-bold">Org</span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">{p.category}</p>
                    </div>
                  </div>

                  {/* Column 3: Status */}
                  <div className="lg:col-span-2">
                    <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border font-medium ${sc.bg} ${sc.color}`}>
                      <Icon className="h-3.5 w-3.5" />
                      {p.status}
                    </span>
                  </div>

                  {/* Column 4: AI Analysis */}
                  <div className="lg:col-span-3 flex flex-col gap-1">
                    <div className="flex items-center gap-1.5">
                      <Star className={`h-3.5 w-3.5 ${qColor}`} />
                      <span className={`text-sm font-semibold ${qColor}`}>{qLabel}</span>
                      {qScore > 0 && (
                        <span className="text-xs text-slate-500">({(qScore * 100).toFixed(0)}%)</span>
                      )}
                    </div>
                    {p.status !== "Pending Approval" && (
                       <p className="text-xs text-slate-500 flex items-center gap-1">
                         <CalendarDays className="h-3 w-3" /> Shelf Life: <span className="text-slate-300">{shelfLifeStr}</span>
                       </p>
                    )}
                  </div>

                  {/* Column 5: Qty */}
                  <div className="lg:col-span-1 lg:text-right flex items-center lg:block justify-between border-t border-white/5 pt-3 lg:border-0 lg:pt-0">
                    <span className="lg:hidden text-xs text-slate-500">Quantity</span>
                    <div>
                      <p className="text-sm font-semibold text-slate-200">{p.quantity}</p>
                      <p className="text-[10px] text-slate-500 uppercase">kg</p>
                    </div>
                  </div>

                  {/* Column 6: Verify & Delete */}
                  <div className="lg:col-span-1 lg:text-center flex items-center justify-end gap-2">
                    {p.status !== "Pending Approval" ? (
                      <button
                        onClick={() => setSelectedProductQR(p)}
                        className="p-2 rounded-xl bg-primary/10 text-primary hover:bg-primary/20 transition-colors border border-primary/20 shrink-0 cursor-pointer"
                        title="Verify Product Traceability"
                      >
                        <QrCode className="h-4 w-4" />
                      </button>
                    ) : (
                      <span className="text-[10px] text-slate-600 uppercase text-center block w-full">Awaiting<br/>Approval</span>
                    )}
                    <button
                      onClick={() => setProductToDelete(p)}
                      className="p-2 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors border border-red-500/20 shrink-0 cursor-pointer"
                      title="Delete Product"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Summary footer */}
      {filtered.length > 0 && (
        <p className="text-center text-xs text-slate-500">
          Showing {filtered.length} of {products.length} products
        </p>
      )}

      {/* QR Code Modal */}
      {selectedProductQR && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center p-4 border-b border-white/10 bg-white/5">
              <h3 className="font-semibold text-foreground">Traceability QR Code</h3>
              <button
                onClick={() => setSelectedProductQR(null)}
                className="text-slate-400 hover:text-white transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-8 flex flex-col items-center justify-center space-y-4">
              <div className="bg-white p-4 rounded-xl shadow-lg ring-4 ring-white/10">
                <QRCodeSVG
                  value={`${window.location.origin}/track?id=${format6DigitId(selectedProductQR.product_id)}`}
                  size={200}
                  level="H"
                  includeMargin={false}
                />
              </div>
              <div className="text-center mt-4">
                <p className="font-bold text-lg text-white">{selectedProductQR.name}</p>
                <p className="text-sm font-mono text-primary font-bold mt-1">ID: {format6DigitId(selectedProductQR.product_id)}</p>
                <p className="text-xs text-slate-400 font-mono mt-0.5">Batch: {selectedProductQR.batch_number || selectedProductQR.batchNumber}</p>
              </div>
            </div>
            <div className="p-4 border-t border-white/10 flex gap-3 bg-white/5">
              <Button
                variant="outline"
                className="flex-1 border-white/10 bg-transparent text-slate-300"
                onClick={() => setSelectedProductQR(null)}
              >
                Close
              </Button>
              <Button
                className="flex-1"
                onClick={() => window.open(`/track?id=${format6DigitId(selectedProductQR.product_id)}`, "_blank")}
              >
                Open Tracker
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Register Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-6">
          <div className="w-full max-w-2xl max-h-[calc(100dvh-1.5rem)] overflow-y-auto custom-scrollbar rounded-2xl border border-white/10 bg-slate-900 p-5 sm:p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between border-b border-primary/20 pb-4 sm:mb-6">
              <div>
                <h2 className="text-xl font-bold text-foreground">Register New Product</h2>
                <p className="text-sm text-slate-400 mt-0.5">Enter details to register a new harvest batch.</p>
              </div>
              <button onClick={closeRegistrationForm} className="text-slate-400 hover:text-primary transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleRegister} className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                {[
                  { label: "Product Name *", name: "name", placeholder: "e.g. Organic Tomatoes" },
                  { label: "Category *", name: "category", placeholder: "e.g. Vegetables" },
                  { label: "Quantity (kg) *", name: "quantity", placeholder: "500", type: "number" },
                  { label: "Expiry Date *", name: "expiryDate", placeholder: "", type: "date" },
                  { label: "Batch Number (Auto-generated)", name: "batchNumber", placeholder: "", readOnly: true },
                ].map(f => (
                  <div key={f.name} className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-300">{f.label}</label>
                    <input
                      type={f.type || "text"}
                      name={f.name}
                      min={f.type === "number" ? "0" : undefined}
                      step={f.type === "number" ? "any" : undefined}
                      onKeyDown={f.type === "number" ? (e) => { if (e.key === "-" || e.key === "e") e.preventDefault() } : undefined}
                      value={(form as any)[f.name]}
                      onChange={handleFormChange}
                      placeholder={f.placeholder}
                      readOnly={f.readOnly}
                      required={!f.readOnly}
                      className="flex h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div>
                    <label htmlFor="productPhoto" className="text-sm font-medium text-foreground">Product Photo</label>
                    <p className="text-xs text-slate-400 mt-0.5">Required for AI Quality Analysis. JPEG, PNG, WebP up to 5 MB.</p>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-xs text-primary border border-primary/20 font-medium">
                    <Wand2 className="h-3 w-3" /> AI Analysis
                  </span>
                </div>
                <div className="flex flex-col sm:flex-row gap-4 items-start">
                  <label htmlFor="productPhoto" className="flex min-h-[5rem] w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-primary/40 bg-white/5 px-4 py-4 text-sm font-medium text-slate-300 hover:bg-white/10 hover:text-white transition-colors">
                    <ImagePlus className="h-5 w-5" />
                    {imagePreview ? "Choose another photo" : "Upload product photo"}
                  </label>
                  <input ref={photoInputRef} id="productPhoto" type="file" accept="image/jpeg,image/png,image/webp" onChange={handlePhotoChange} className="sr-only" />
                  {imagePreview && (
                    <div className="relative h-20 w-full sm:w-28 shrink-0">
                      <img src={imagePreview} alt="Product preview" className="h-20 w-full rounded-xl border border-primary/20 object-cover" />
                      <button type="button" onClick={removePhoto} className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border border-primary/20 bg-slate-800 text-red-400 shadow-sm hover:bg-slate-700" aria-label="Remove uploaded photo">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10">
                <input
                  type="checkbox"
                  id="organicStatus"
                  name="organicStatus"
                  checked={form.organicStatus}
                  onChange={handleFormChange}
                  className="h-4 w-4 rounded border-white/20 bg-white/10 accent-primary"
                />
                <label htmlFor="organicStatus" className="text-sm font-medium text-slate-200 cursor-pointer">
                  Certified Organic Product
                </label>
              </div>

              {formMsg && (
                <div className={`p-4 rounded-xl text-sm font-medium flex items-start gap-2 ${formMsg.type === "success" ? "bg-green-500/20 text-green-400 border border-green-500/30" : "bg-red-500/20 text-red-400 border border-red-500/30"}`}>
                  <AlertCircle className="h-5 w-5 shrink-0" />
                  {formMsg.text}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <Button type="button" variant="outline" onClick={closeRegistrationForm} className="flex-1 border-white/10 bg-transparent text-slate-300 hover:text-white">
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting} className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground shadow-[0_0_20px_rgba(34,197,94,0.3)]">
                  {submitting ? "Registering & Analyzing..." : "Register Harvest"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {productToDelete && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-red-500/20 rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl p-6">
            <div className="flex flex-col items-center text-center">
              <div className="p-3 bg-red-500/10 rounded-full mb-4">
                <AlertCircle className="h-8 w-8 text-red-500" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Delete Product?</h3>
              <p className="text-slate-400 text-sm mb-6">
                Are you sure you want to delete <span className="font-semibold text-white">{productToDelete.name}</span>? This action cannot be undone and will remove it from the traceability system.
              </p>
            </div>
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1 border-white/10 bg-transparent text-slate-300"
                onClick={() => setProductToDelete(null)}
                disabled={isDeleting}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-red-500 hover:bg-red-600 text-white"
                onClick={handleDeleteProduct}
                disabled={isDeleting}
              >
                {isDeleting ? "Deleting..." : "Delete"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

import { useState, useEffect, useRef } from "react"
import { useSearchParams } from "react-router-dom"
import { ethers } from "ethers"
import { Card } from "../components/ui/Card"
import {
  CheckCircle2, Factory, Truck, Store, Search, AlertCircle, Loader2,
  ShieldCheck, Clock, Leaf, Brain, QrCode, Upload, Database,
  AlertTriangle, GitFork, Thermometer, FileCheck, ShieldAlert, X
} from "lucide-react"
import { Button } from "../components/ui/Button"
import axios from "axios"
import { Html5Qrcode } from "html5-qrcode"
import jsQR from "jsqr"
import { getApiBaseUrl, getAuthToken } from "../utils"

const API = getApiBaseUrl()
const RPC_URL = import.meta.env.VITE_RPC_URL || "http://127.0.0.1:8545"
const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS || "0x5FbDB2315678afecb367f032d93F642f64180aa3"

const FARMCHAIN_ABI = [
  "function products(string) public view returns (string id, string name, string category, string batchNumber, uint256 quantity, address farmer, address currentOwner, string status, uint256 timestamp, bool exists)",
  "function getProductHistory(string _productId) public view returns (tuple(string status, address owner, uint256 timestamp, string extraInfo)[])"
]

// Safely map ID to 6 digits
const format6DigitId = (id: number | string) => {
  const num = Number(id)
  if (num >= 100000 && num <= 999999) return String(num)
  if (num > 0) return String(100000 + num)
  return "100000"
}

// Format event type names nicely
const formatEventType = (type: string) => {
  const map: Record<string, string> = {
    "HARVEST_REGISTERED": "Harvest Registered",
    "PROCESSOR_RECEIVED": "Received by Processor",
    "PROCESSED": "Processing Completed",
    "DISTRIBUTOR_RECEIVED": "Received by Distributor",
    "DISTRIBUTOR_SHIPPED": "Shipped by Distributor",
    "RETAILER_RECEIVED": "Received by Retailer",
    "RETAILER_SOLD": "Sold by Retailer",
    "RETAILER_WASTED": "Recorded as Wastage",
    "RETAILER_RETURNED": "Product Returned",
    "SHIPMENT_RECEIVED": "Shipment Received"
  };
  return map[type] || type.replace(/_/g, ' ');
}

// Format actor nicely
const formatActor = (actor: any) => {
  if (!actor) return "Verified Supply Chain Actor";
  const roleName = actor.role ? actor.role.charAt(0).toUpperCase() + actor.role.slice(1) : "";
  return `${actor.name || "Authorized Member"} ${roleName ? `(${roleName})` : ""}`;
}

export function Tracker() {
  const [searchParams] = useSearchParams()
  const initialId = searchParams.get("id") || ""
  const [productIdInput, setProductIdInput] = useState(initialId)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const [dbProduct, setDbProduct] = useState<any>(null)
  const [chainProduct, setChainProduct] = useState<any>(null)
  const [blockchainInfo, setBlockchainInfo] = useState<any>(null)

  // Scanner modal / state on Tracker page
  const [showScanner, setShowScanner] = useState(false)
  const [cameraActive, setCameraActive] = useState(false)
  const [scannerError, setScannerError] = useState("")
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const isProcessingScan = useRef(false)

  // Cleanup camera scanner on unmount
  useEffect(() => {
    return () => {
      if (html5QrCodeRef.current) {
        try {
          if (html5QrCodeRef.current.isScanning) {
            html5QrCodeRef.current.stop()
          }
          html5QrCodeRef.current.clear()
        } catch {}
      }
    }
  }, [])

  const fetchProductData = async (id: string) => {
    if (!id) return
    setLoading(true)
    setError("")
    setDbProduct(null)
    setChainProduct(null)
    setBlockchainInfo(null)

    // Normalize and clean incoming identifier
    let cleanId = id.trim()
    if (cleanId.includes("?id=")) {
      cleanId = cleanId.split("?id=")[1].split("&")[0]
    } else if (cleanId.includes("/track/")) {
      cleanId = cleanId.split("/track/")[1].split("?")[0]
    } else if (cleanId.includes("/tracker/")) {
      cleanId = cleanId.split("/tracker/")[1].split("?")[0]
    } else if (cleanId.includes("/verify/")) {
      cleanId = cleanId.split("/verify/")[1].split("?")[0]
    }

    try {
      cleanId = decodeURIComponent(cleanId).trim()
    } catch {}

    if (cleanId.toUpperCase().startsWith("FP-")) {
      cleanId = cleanId.substring(3).trim()
    }

    let foundDb: any = null
    let foundChain: any = null

    // 1. Direct public route /api/products/blockchain/:id
    try {
      const dbRes = await axios.get(`${API}/products/blockchain/${encodeURIComponent(cleanId)}`)
      if (dbRes.data?.data) {
        foundDb = dbRes.data.data
        if (foundDb.blockchain_verification) {
          setBlockchainInfo(foundDb.blockchain_verification)
        }
      }
    } catch {
      // Continue to client-side checks
    }

    // 2. Client-side Fallback: Match from authenticated products list if user is logged in
    if (!foundDb) {
      const token = getAuthToken()
      if (token) {
        try {
          const listRes = await axios.get(`${API}/products`, {
            headers: { Authorization: `Bearer ${token}` }
          })
          const allList = listRes.data?.data || []
          if (allList.length > 0) {
            foundDb = allList.find((p: any) => {
              const pId = p.product_id || p.id
              const mapped = format6DigitId(pId)
              const numId = Number(cleanId)
              return (
                String(pId) === String(cleanId) ||
                mapped === String(cleanId) ||
                (numId >= 100000 && Number(pId) === numId - 100000) ||
                p.batch_number === cleanId ||
                p.batchNumber === cleanId ||
                String(p.id) === String(cleanId)
              )
            })
          }
        } catch {}
      }
    }

    if (foundDb) {
      setDbProduct(foundDb)
    }

    // 3. Query on-chain data directly via client ethers provider if configured
    if (CONTRACT_ADDRESS) {
      try {
        const provider = new ethers.JsonRpcProvider(RPC_URL)
        const contract = new ethers.Contract(CONTRACT_ADDRESS, FARMCHAIN_ABI, provider)

        const searchIdOnChain = foundDb?.id ? foundDb.id : cleanId
        const productData = await contract.products(searchIdOnChain)
        if (productData && productData.exists) {
          foundChain = {
            id: productData.id,
            name: productData.name,
            batchNumber: productData.batchNumber,
            status: productData.status,
            quantity: Number(productData.quantity),
            farmer: productData.farmer,
            currentOwner: productData.currentOwner,
            timestamp: Number(productData.timestamp)
          }
          setChainProduct(foundChain)

          // If backend didn't supply blockchainInfo or reported mismatch, sync with client read
          if (!foundDb?.blockchain_verification) {
            setBlockchainInfo({
              status: "VERIFIED_ON_CHAIN",
              contractAddress: CONTRACT_ADDRESS,
              network: "Local Hardhat Testnet",
              chainData: foundChain,
              discrepancies: [],
              message: "Verified against available on-chain smart contract records."
            })
          }
        }
      } catch (err) {
        console.warn("Client blockchain read skipped/offline:", err)
      }
    }

    if (!foundDb && !foundChain) {
      setError(`No agricultural product found for "${id}". Please verify the Product ID, Batch Number, or scan a valid QR code.`)
    }

    setLoading(false)
  }

  useEffect(() => {
    const queryId = searchParams.get("id")
    if (queryId) {
      setProductIdInput(queryId)
      fetchProductData(queryId)
    }
  }, [searchParams])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (productIdInput) {
      window.history.pushState({}, '', `?id=${encodeURIComponent(productIdInput.trim())}`)
      fetchProductData(productIdInput)
    }
  }

  // Camera QR Scanner methods
  const startLiveCamera = async () => {
    setScannerError("")
    setCameraActive(true)
    isProcessingScan.current = false
    try {
      if (html5QrCodeRef.current && html5QrCodeRef.current.isScanning) {
        await html5QrCodeRef.current.stop()
      }
      const html5QrCode = new Html5Qrcode("tracker-qr-reader")
      html5QrCodeRef.current = html5QrCode

      await html5QrCode.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 220, height: 220 } },
        (decodedText) => {
          handleScannedResult(decodedText)
        },
        () => {}
      )
    } catch (err: any) {
      setScannerError(err?.message || "Could not access camera. Please verify camera permissions or upload an image.")
      setCameraActive(false)
    }
  }

  const stopLiveCamera = async () => {
    if (html5QrCodeRef.current) {
      try {
        if (html5QrCodeRef.current.isScanning) {
          await html5QrCodeRef.current.stop()
        }
        html5QrCodeRef.current.clear()
      } catch {}
    }
    setCameraActive(false)
  }

  const handleScannedResult = (decodedText: string) => {
    if (isProcessingScan.current) return
    isProcessingScan.current = true

    stopLiveCamera()
    setShowScanner(false)

    let extractedId = decodedText.trim()
    if (extractedId.includes("?id=")) {
      extractedId = extractedId.split("?id=")[1].split("&")[0]
    } else if (extractedId.includes("/track/")) {
      extractedId = extractedId.split("/track/")[1].split("?")[0]
    } else if (extractedId.includes("/tracker/")) {
      extractedId = extractedId.split("/tracker/")[1].split("?")[0]
    } else if (extractedId.includes("/verify/")) {
      extractedId = extractedId.split("/verify/")[1].split("?")[0]
    }

    try {
      extractedId = decodeURIComponent(extractedId).trim()
    } catch {}

    setProductIdInput(extractedId)
    window.history.pushState({}, '', `?id=${encodeURIComponent(extractedId)}`)
    fetchProductData(extractedId)
  }

  const handleQrFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setScannerError("")

    // Validate supported image file types
    if (!file.type.startsWith("image/")) {
      setScannerError("Unsupported file type. Please upload a valid image file (PNG, JPG, WebP).")
      return
    }

    const img = new Image()
    const objectUrl = URL.createObjectURL(file)

    img.onload = async () => {
      URL.revokeObjectURL(objectUrl)

      // Layer 1: Native BarcodeDetector (fastest browser API where available)
      if ("BarcodeDetector" in window) {
        try {
          const barcodeDetector = new (window as any).BarcodeDetector({ formats: ["qr_code"] })
          const barcodes = await barcodeDetector.detect(img)
          if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
            handleScannedResult(barcodes[0].rawValue)
            return
          }
        } catch {}
      }

      // Layer 2: jsQR Canvas direct pixel scan
      try {
        const canvas = document.createElement("canvas")
        canvas.width = img.naturalWidth || img.width
        canvas.height = img.naturalHeight || img.height
        const ctx = canvas.getContext("2d", { willReadFrequently: true })
        if (ctx) {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: "attemptBoth",
          })
          if (code && code.data) {
            handleScannedResult(code.data)
            return
          }
        }
      } catch {}

      // Layer 3: Html5Qrcode buffer scan
      try {
        const html5QrCode = new Html5Qrcode("tracker-qr-reader")
        const result = await html5QrCode.scanFile(file, false)
        if (result) {
          handleScannedResult(result)
          return
        }
      } catch {}

      setScannerError("Could not detect a readable QR code in this image. Please upload a clear QR photograph.")
    }

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      setScannerError("Invalid or corrupted image file.")
    }

    img.src = objectUrl
  }

  // Supply Chain Stage Verification Logic
  const currentStatus = dbProduct?.status || chainProduct?.status || "Harvested"
  const mappedDisplayId = dbProduct ? format6DigitId(dbProduct.product_id || dbProduct.id) : (productIdInput || "100000")

  // Quality data
  const qualityScore = dbProduct?.ai_quality_score
  const qualityGrade = dbProduct?.ai_quality_label

  // Compute Freshness if expiry date exists
  let freshnessState = null
  let freshnessColor = ""
  if (dbProduct?.expiry_date) {
    const today = new Date()
    const expiry = new Date(dbProduct.expiry_date)
    const diffDays = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

    if (diffDays < 0) {
      freshnessState = "Expired"
      freshnessColor = "text-red-500 bg-red-500/10 border-red-500/20"
    } else if (diffDays <= 3) {
      freshnessState = "Expiring Soon"
      freshnessColor = "text-orange-400 bg-orange-400/10 border-orange-400/20"
    } else {
      freshnessState = "Fresh"
      freshnessColor = "text-emerald-500 bg-emerald-500/10 border-emerald-500/20"
    }
  }

  // Derive stage index from real events
  let currentStageIndex = 0;
  if (dbProduct?.events && dbProduct.events.length > 0) {
    dbProduct.events.forEach((evt: any) => {
      if (!evt || !evt.event_type) return;
      if (["PROCESSOR_RECEIVED", "PROCESSED"].includes(evt.event_type)) {
        currentStageIndex = Math.max(currentStageIndex, 1);
      }
      if (["DISTRIBUTOR_RECEIVED", "DISTRIBUTOR_SHIPPED"].includes(evt.event_type)) {
        currentStageIndex = Math.max(currentStageIndex, 2);
      }
      if (["RETAILER_RECEIVED", "RETAILER_SOLD", "RETAILER_WASTED", "RETAILER_RETURNED", "SHIPMENT_RECEIVED"].includes(evt.event_type)) {
        currentStageIndex = Math.max(currentStageIndex, 3);
      }
    });
  }

  const stages = ["FARMER", "PROCESSOR", "DISTRIBUTOR", "RETAILER"];

  // Effective blockchain verification outcome
  const effectiveVerificationStatus = blockchainInfo?.status || (chainProduct ? "VERIFIED_ON_CHAIN" : "NOT_ON_CHAIN");

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-24 pt-8 px-4">
      {/* Header Search & QR Trigger */}
      <div className="text-center space-y-3">
        <div className="inline-flex p-3 rounded-full bg-primary/10 text-primary border border-primary/20 mb-1">
          <ShieldCheck className="h-8 w-8" />
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground">
          Track & Verify Produce Authenticity
        </h1>
        <p className="text-muted-foreground text-sm max-w-xl mx-auto">
          Public consumer verification portal. Trace complete farm-to-fork journeys, verify smart contract records, and inspect cold-chain safety.
        </p>

        {/* Search Bar & QR Scan Controls */}
        <div className="max-w-md mx-auto space-y-3 pt-2">
          <form onSubmit={handleSearch} className="flex items-center gap-2">
            <input
              id="tracker-search-input"
              type="text"
              placeholder="Enter Product ID, Batch, UUID, or Tracking ID"
              value={productIdInput}
              onChange={(e) => setProductIdInput(e.target.value)}
              className="flex h-12 w-full rounded-2xl border border-input bg-card/60 px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary shadow-sm text-foreground"
            />
            <Button id="tracker-search-button" type="submit" size="lg" className="h-12 px-6 rounded-2xl bg-primary hover:bg-primary/95 text-white font-semibold shrink-0" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Search className="h-4 w-4 mr-1.5" />}
              Track & Verify
            </Button>
          </form>

          <div className="flex gap-2">
            <Button
              id="tracker-camera-button"
              type="button"
              variant="outline"
              onClick={() => {
                setShowScanner(true)
                startLiveCamera()
              }}
              className="flex-1 rounded-xl text-xs gap-1.5 border-dashed border-primary/40 text-primary hover:bg-primary/10"
            >
              <QrCode className="h-3.5 w-3.5" />
              Scan with Camera
            </Button>
            <input
              id="tracker-file-input"
              type="file"
              ref={fileInputRef}
              accept="image/*"
              className="hidden"
              onChange={handleQrFileUpload}
            />
            <Button
              id="tracker-upload-button"
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 rounded-xl text-xs gap-1.5 border-dashed text-muted-foreground hover:text-foreground"
            >
              <Upload className="h-3.5 w-3.5" />
              Upload QR Image
            </Button>
          </div>
        </div>
      </div>

      {/* QR CAMERA SCANNER POPUP MODAL */}
      {showScanner && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="max-w-sm w-full rounded-3xl border shadow-2xl p-6 bg-zinc-900 border-zinc-800 text-white space-y-4 text-center">
            <div className="flex justify-between items-center border-b border-zinc-800 pb-3">
              <h3 className="font-bold text-lg flex items-center gap-2 text-primary">
                <QrCode className="h-5 w-5" />
                Scan Product QR Code
              </h3>
              <button
                onClick={() => { stopLiveCamera(); setShowScanner(false); }}
                className="text-zinc-400 hover:text-white"
                aria-label="Close scanner"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="relative w-full aspect-square rounded-2xl border-2 border-dashed border-zinc-700 bg-black overflow-hidden flex items-center justify-center">
              <div id="tracker-qr-reader" className="w-full h-full" />
              {cameraActive && (
                <div className="absolute inset-x-0 h-1 bg-gradient-to-r from-transparent via-emerald-400 to-transparent animate-pulse top-1/2 z-20" />
              )}
            </div>

            {scannerError && (
              <p className="text-xs text-red-400 bg-red-500/10 p-2 rounded-xl border border-red-500/20">{scannerError}</p>
            )}

            <Button
              onClick={() => { stopLiveCamera(); setShowScanner(false); }}
              variant="outline"
              className="w-full rounded-xl text-xs border-zinc-700 text-zinc-300"
            >
              Close Scanner
            </Button>
          </Card>
        </div>
      )}

      {/* ERROR ALERT */}
      {error && (
        <div className="flex items-center gap-3 text-red-500 bg-red-500/10 p-5 rounded-2xl border border-red-500/20 text-sm animate-in fade-in">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* LOADING STATE */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground animate-in fade-in zoom-in duration-300">
          <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
          <h3 className="text-lg font-bold text-foreground">Verifying Product</h3>
          <p className="text-sm">Retrieving farm-to-fork records and checking blockchain ledger...</p>
        </div>
      )}

      {/* MAIN UNIFIED VERIFICATION & JOURNEY REPORT */}
      {(dbProduct || chainProduct) && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">

          {/* SECTION 1: PRODUCT HEADER & ATTRIBUTES */}
          <Card className="overflow-hidden rounded-3xl border shadow-md bg-card/60">
            <div className="bg-gradient-to-r from-emerald-500/15 via-primary/10 to-transparent p-6 sm:p-8 border-b">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="text-2xl">
                      {dbProduct?.name?.includes("Tomato") ? "🍅" :
                       dbProduct?.name?.includes("Mango") ? "🥭" :
                       dbProduct?.name?.includes("Grape") ? "🍇" :
                       dbProduct?.name?.includes("Apple") ? "🍎" : "🌱"}
                    </span>
                    <h2 className="text-2xl sm:text-3xl font-bold text-foreground">
                      {dbProduct?.name || chainProduct?.name}
                    </h2>
                    <span className="bg-emerald-500/10 text-emerald-500 border border-emerald-500/30 font-mono font-bold text-xs px-3 py-1 rounded-full">
                      FP-{mappedDisplayId}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground font-mono mt-1.5">
                    Batch: <span className="font-semibold text-foreground">{dbProduct?.batch_number || chainProduct?.batchNumber || "BCH-2026"}</span>
                    {" • "}Category: <span className="font-semibold text-foreground">{dbProduct?.category || chainProduct?.category || "Produce"}</span>
                    {" • "}Quantity: <span className="font-semibold text-foreground">{dbProduct?.quantity || chainProduct?.quantity || 10} kg</span>
                  </p>
                </div>

                <div className="flex gap-2 flex-wrap">
                  {dbProduct?.organic_status && (
                    <span className="inline-flex items-center rounded-full bg-emerald-500/15 border border-emerald-500/30 px-3 py-1 text-xs font-semibold text-emerald-500">
                      <Leaf className="h-3 w-3 mr-1" /> Certified Organic
                    </span>
                  )}
                  {qualityGrade && qualityGrade !== "Unknown" && qualityGrade !== "N/A" && (
                    <span className="inline-flex items-center rounded-full bg-blue-500/15 border border-blue-500/30 px-3 py-1 text-xs font-semibold text-blue-400">
                      <Brain className="h-3 w-3 mr-1" /> Quality: {qualityGrade} {qualityScore ? `(${qualityScore}%)` : ''}
                    </span>
                  )}
                  {freshnessState && (
                    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${freshnessColor}`}>
                      <Clock className="h-3 w-3 mr-1" /> {freshnessState}
                    </span>
                  )}
                  <span className="inline-flex items-center rounded-full bg-primary/20 border border-primary/30 px-3 py-1 text-xs font-semibold text-primary">
                    Status: {currentStatus}
                  </span>
                </div>
              </div>
            </div>
          </Card>

          {/* SECTION 2: BLOCKCHAIN AUTHENTICITY SEAL (HONEST VERIFICATION OUTCOMES) */}
          <Card className="rounded-3xl border shadow-sm p-6 sm:p-8 space-y-4 bg-card/60">
            <div className="border-b pb-3 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
              <div>
                <h3 className="font-bold text-lg text-foreground flex items-center gap-2">
                  <ShieldCheck className={`h-5 w-5 ${effectiveVerificationStatus === 'VERIFIED_ON_CHAIN' ? 'text-emerald-500' : 'text-blue-500'}`} />
                  Blockchain Authenticity Verification
                </h3>
                <p className="text-xs text-muted-foreground">Smart contract verification outcome from the distributed ledger.</p>
              </div>

              {/* OUTCOME BADGE */}
              {effectiveVerificationStatus === 'VERIFIED_ON_CHAIN' && (
                <span className="text-xs font-bold px-3 py-1 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shrink-0">
                  🟢 Verified Against On-Chain Records
                </span>
              )}
              {effectiveVerificationStatus === 'NOT_ON_CHAIN' && (
                <span className="text-xs font-bold px-3 py-1 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/30 shrink-0">
                  🟡 Product Not Found on Configured Chain
                </span>
              )}
              {effectiveVerificationStatus === 'RECORD_MISMATCH' && (
                <span className="text-xs font-bold px-3 py-1 rounded-full bg-red-500/15 text-red-400 border border-red-500/30 shrink-0">
                  🔴 Database and Blockchain Information Mismatch
                </span>
              )}
              {effectiveVerificationStatus === 'BLOCKCHAIN_UNAVAILABLE' && (
                <span className="text-xs font-bold px-3 py-1 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30 shrink-0">
                  🟠 Blockchain Service Unavailable
                </span>
              )}
            </div>

            {/* DETAILED VERIFICATION PANEL */}
            <div className="p-4 rounded-2xl bg-zinc-950/80 border space-y-3">
              {effectiveVerificationStatus === 'VERIFIED_ON_CHAIN' && (
                <div className="space-y-2">
                  <p className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4" /> Cryptographically Anchored Smart Contract Record
                  </p>
                  <p className="text-xs text-zinc-300">
                    This product's batch identity and physical parameters are confirmed on the Ethereum smart contract (<span className="font-mono text-zinc-400">{CONTRACT_ADDRESS}</span>).
                  </p>
                  {chainProduct && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 font-mono text-[11px] text-zinc-400">
                      <div>On-Chain Name: <span className="text-zinc-200">{chainProduct.name}</span></div>
                      <div>On-Chain Batch: <span className="text-zinc-200">{chainProduct.batchNumber}</span></div>
                      <div>On-Chain Status: <span className="text-zinc-200">{chainProduct.status}</span></div>
                      <div>On-Chain Owner: <span className="text-zinc-200">{chainProduct.currentOwner?.substring(0, 10)}...</span></div>
                    </div>
                  )}
                </div>
              )}

              {effectiveVerificationStatus === 'NOT_ON_CHAIN' && (
                <div className="space-y-1.5">
                  <p className="text-xs font-bold text-blue-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Database className="h-4 w-4" /> Local Database Traceability Record
                  </p>
                  <p className="text-xs text-zinc-400">
                    Product is verified within the local Farm-to-Fork database. It has not yet been anchored to the smart contract ledger.
                  </p>
                </div>
              )}

              {effectiveVerificationStatus === 'RECORD_MISMATCH' && (
                <div className="space-y-2">
                  <p className="text-xs font-bold text-red-400 uppercase tracking-wider flex items-center gap-1.5">
                    <ShieldAlert className="h-4 w-4" /> Discrepancy Alert
                  </p>
                  <p className="text-xs text-red-300">
                    Discrepancy detected between database and smart contract ledger fields:
                  </p>
                  {blockchainInfo?.discrepancies?.map((d: string, i: number) => (
                    <p key={i} className="text-xs font-mono text-red-400 bg-red-500/10 p-2 rounded-lg border border-red-500/20">
                      {d}
                    </p>
                  ))}
                </div>
              )}

              {effectiveVerificationStatus === 'BLOCKCHAIN_UNAVAILABLE' && (
                <div className="space-y-1.5">
                  <p className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                    <AlertTriangle className="h-4 w-4" /> Smart Contract Offline
                  </p>
                  <p className="text-xs text-zinc-400">
                    The local blockchain provider ({RPC_URL}) is currently unreachable. Displaying certified database traceability trail.
                  </p>
                </div>
              )}

              <p className="text-[11px] text-zinc-500 pt-2 border-t border-zinc-800">
                <strong>Record Distinction:</strong> Blockchain verification guarantees ledger immutability and tamper-evident history; physical goods safety and quality grades are determined through agricultural inspection.
              </p>
            </div>
          </Card>

          {/* SECTION 3: INCOMPLETE HISTORY WARNING (HONEST ASSESSMENT) */}
          {dbProduct?.history_completeness && !dbProduct.history_completeness.is_complete && (
            <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-500 text-sm animate-in fade-in">
              <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Traceability Completeness Notice</p>
                <p className="text-xs text-amber-400/90 mt-0.5">{dbProduct.history_completeness.notice}</p>
              </div>
            </div>
          )}

          {/* SECTION 4: PARENT-CHILD BATCH LINEAGE (FOR PROCESSED PRODUCTS) */}
          {dbProduct?.lineage && dbProduct.lineage.length > 0 && (
            <Card className="rounded-3xl border shadow-sm p-6 sm:p-8 space-y-4 bg-card/60">
              <div className="border-b pb-3 flex justify-between items-center">
                <div>
                  <h3 className="font-bold text-lg text-foreground flex items-center gap-2">
                    <GitFork className="h-5 w-5 text-purple-400" />
                    Parent-Child Batch Lineage
                  </h3>
                  <p className="text-xs text-muted-foreground">Trace processed product ingredients back to their agricultural origin batch.</p>
                </div>
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">
                  Processed Goods
                </span>
              </div>
              <div className="space-y-3">
                {dbProduct.lineage.map((item: any, idx: number) => (
                  <div key={idx} className="p-4 rounded-2xl border bg-purple-500/5 border-purple-500/20 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <Leaf className="h-4 w-4 text-emerald-400" />
                        <span className="font-bold text-sm text-foreground">Ingredient: {item.parent?.name || 'Raw Produce'}</span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400">
                          Batch: {item.parent?.batch_number || 'Parent Batch'}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Action: <strong>{item.processing_action}</strong> • Quantity Used: <strong>{item.quantity_used || 'N/A'} kg</strong> • Date: {new Date(item.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const pId = item.parent?.product_id || item.parent?.id
                        if (pId) {
                          setProductIdInput(String(pId))
                          window.history.pushState({}, '', `?id=${encodeURIComponent(String(pId))}`)
                          fetchProductData(String(pId))
                        }
                      }}
                      className="text-xs rounded-xl border-purple-500/30 text-purple-400 hover:bg-purple-500/10 shrink-0"
                    >
                      Trace Raw Ingredient ➔
                    </Button>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* SECTION 5: LOGISTICS, COLD-CHAIN & PROOF OF DELIVERY */}
          {(dbProduct?.cold_chain_summary?.monitored || dbProduct?.delivery_receipt) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Cold Chain Card */}
              {dbProduct?.cold_chain_summary?.monitored && (
                <Card className="rounded-3xl border shadow-sm p-5 space-y-3 bg-card/60">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-sm text-foreground flex items-center gap-2">
                      <Thermometer className="h-4 w-4 text-blue-400" />
                      Cold-Chain Transport Conditions
                    </h4>
                    <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${
                      dbProduct.cold_chain_summary.condition_status === 'COMPLIANT'
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : 'bg-red-500/10 text-red-400 border border-red-500/20'
                    }`}>
                      {dbProduct.cold_chain_summary.condition_status === 'COMPLIANT' ? 'Compliant ✓' : 'Temperature Excursion'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="p-3 rounded-xl bg-muted/40 border">
                      <p className="text-muted-foreground">Latest Reading</p>
                      <p className="font-bold text-foreground text-sm mt-0.5">
                        {dbProduct.cold_chain_summary.latest_temperature}{dbProduct.cold_chain_summary.temperature_unit}
                      </p>
                    </div>
                    <div className="p-3 rounded-xl bg-muted/40 border">
                      <p className="text-muted-foreground">Humidity</p>
                      <p className="font-bold text-foreground text-sm mt-0.5">
                        {dbProduct.cold_chain_summary.latest_humidity ? `${dbProduct.cold_chain_summary.latest_humidity}%` : 'Standard'}
                      </p>
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {dbProduct.cold_chain_summary.readings_count} individual sensor reading(s) recorded during shipment.
                  </p>
                </Card>
              )}

              {/* Digital Proof of Delivery Card */}
              {dbProduct?.delivery_receipt && (
                <Card className="rounded-3xl border shadow-sm p-5 space-y-3 bg-card/60">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-sm text-foreground flex items-center gap-2">
                      <FileCheck className="h-4 w-4 text-emerald-400" />
                      Retailer Delivery Confirmation
                    </h4>
                    <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      {dbProduct.delivery_receipt.status} ✓
                    </span>
                  </div>
                  <div className="space-y-1 text-xs">
                    <p className="text-muted-foreground">
                      Received by: <strong className="text-foreground">{dbProduct.delivery_receipt.recipient_name}</strong>
                    </p>
                    <p className="text-muted-foreground">
                      Delivered Quantity: <strong className="text-foreground">{dbProduct.delivery_receipt.quantity_delivered} {dbProduct.delivery_receipt.unit}</strong>
                    </p>
                    {dbProduct.delivery_receipt.acknowledged_at && (
                      <p className="text-muted-foreground">
                        Confirmed on: <strong className="text-foreground">{new Date(dbProduct.delivery_receipt.acknowledged_at).toLocaleString()}</strong>
                      </p>
                    )}
                  </div>
                  <p className="text-[11px] text-emerald-400/90 font-medium">
                    Two-party cryptographic delivery handshake confirmed between distributor and retailer.
                  </p>
                </Card>
              )}
            </div>
          )}

          {/* SECTION 6: CHRONOLOGICAL FARM-TO-FORK SUPPLY CHAIN JOURNEY */}
          <Card className="rounded-3xl border shadow-sm p-6 sm:p-8 space-y-6 bg-card/60">
            <div className="border-b pb-6">
              <h3 className="font-bold text-lg text-foreground flex items-center gap-2 mb-2">
                <Clock className="h-5 w-5 text-primary" />
                Farm-to-Fork Supply Chain Journey
              </h3>
              <p className="text-xs text-muted-foreground mb-6">Audited chronological timeline of custody transfers and physical milestones.</p>

              {/* Dynamic Stage Visualizer */}
              <div className="flex items-center justify-between relative px-2">
                <div className="absolute left-6 right-6 top-1/2 -translate-y-1/2 h-1 bg-muted/50 rounded-full z-0" />
                {stages.map((stageName, idx) => {
                  const isCompleted = currentStageIndex >= idx;
                  const isCurrent = currentStageIndex === idx;
                  return (
                    <div key={stageName} className="relative z-10 flex flex-col items-center gap-2">
                      <div className={`h-8 w-8 rounded-full border-2 flex items-center justify-center bg-card transition-colors ${isCompleted ? 'border-emerald-500 bg-emerald-500/10 text-emerald-500' : 'border-muted text-muted-foreground'}`}>
                        {isCompleted ? <CheckCircle2 className="h-4 w-4" /> : <div className="h-2 w-2 rounded-full bg-muted-foreground/30" />}
                      </div>
                      <span className={`text-[10px] sm:text-xs font-bold tracking-wider ${isCurrent ? 'text-foreground' : isCompleted ? 'text-muted-foreground' : 'text-muted-foreground/50'}`}>
                        {stageName}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-6 relative before:absolute before:inset-0 before:left-5 before:top-4 before:w-0.5 before:bg-gradient-to-b before:from-emerald-500 before:via-blue-500 before:to-muted-foreground/30">

              {/* Dynamic Real Events */}
              {dbProduct?.events?.length > 0 ? dbProduct.events.map((evt: any, i: number) => {
                return (
                  <div key={i} className="relative flex items-start gap-4 pl-12 mb-6">
                    <div className="absolute left-3 -translate-x-1/2 p-2 rounded-full bg-blue-500 text-white shadow-md ring-4 ring-background z-10">
                      {evt.event_type.toLowerCase().includes("harvest") ? <Leaf className="h-4 w-4" /> :
                       evt.event_type.toLowerCase().includes("processing") || evt.event_type.toLowerCase().includes("quality") ? <Factory className="h-4 w-4" /> :
                       evt.event_type.toLowerCase().includes("shipped") || evt.event_type.toLowerCase().includes("transit") || evt.event_type.toLowerCase().includes("transfer") ? <Truck className="h-4 w-4" /> :
                       evt.event_type.toLowerCase().includes("receive") || evt.event_type.toLowerCase().includes("retail") ? <Store className="h-4 w-4" /> :
                       <CheckCircle2 className="h-4 w-4" />}
                    </div>
                    <div className="p-4 rounded-2xl border bg-card/80 w-full space-y-2 border-blue-500/20">
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-sm text-foreground">{formatEventType(evt.event_type)}</span>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400">Recorded</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Actor: <strong>{formatActor(evt.actor)}</strong> • Location: {evt.location || "Supply Chain Location"} • Date: {new Date(evt.created_at).toLocaleString()}
                      </p>

                      {evt.metadata && Object.keys(evt.metadata).length > 0 && (
                        <div className="bg-muted/30 p-2.5 rounded-xl border mt-2 space-y-1">
                          {Object.entries(evt.metadata).map(([k, v]: [string, any]) => (
                            <p key={k} className="text-[11px] text-muted-foreground">
                              <span className="font-semibold capitalize">{k.replace(/_/g, ' ')}:</span> {String(v)}
                            </p>
                          ))}
                        </div>
                      )}

                      {evt.blockchain_hash && (
                        <div className="mt-2 text-[10px] bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 p-2 rounded-lg font-mono break-all flex items-center gap-1.5">
                          <ShieldCheck className="h-3 w-3 shrink-0" />
                          Tx: {evt.blockchain_hash}
                        </div>
                      )}
                    </div>
                  </div>
                )
              }) : (
                <div className="pl-12 text-sm text-muted-foreground italic font-medium">Traceability history is not available yet for this product.</div>
              )}
            </div>
          </Card>

        </div>
      )}
    </div>
  )
}

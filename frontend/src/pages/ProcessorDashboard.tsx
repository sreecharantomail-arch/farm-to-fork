import { useState, useEffect, useRef } from "react"
import axios from "axios"
import { useAuth } from "../context/AuthContext"
import { Button } from "../components/ui/Button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/Card"
import {
  Factory, AlertCircle, Search, ShieldCheck, Camera, Brain, Clock, User, MapPin,
  Star, Package, Truck, Loader2, QrCode, Upload, Printer, Video, VideoOff, Download, X,
  Trash2, Scale, Lock, CheckCircle
} from "lucide-react"
import { Html5Qrcode } from "html5-qrcode"
import { QRCodeSVG, QRCodeCanvas } from "qrcode.react"
import jsQR from "jsqr"
import { getFarmerLocation } from "../utils"
import { DecisionSupportPanel } from "../components/DecisionSupportPanel"

const API = import.meta.env.VITE_API_URL || "https://farm-to-fork-tracker.onrender.com/api"

interface Product {
  id: string
  product_id: number
  name: string
  category: string
  batch_number: string
  quantity: number
  status: string
  current_owner_id?: string
  farmer_id?: string
  organic_status: boolean
  ai_quality_score?: number
  ai_quality_label?: string
  ai_shelf_life?: any
  expiry_date?: string
  product_image_url?: string
  created_at: string
  blockchain_hash?: string
  farm_location?: string
  farmer?: {
    name: string
    email: string
    address?: string
    location?: string
  }
}

interface ReceiptDetails {
  productId: string
  receivedQty: number
  arrivalDate: string
  arrivalTime: string
  receivedBy: string
}

interface VerificationDetails {
  productId: string
  status: "Verified" | "Mismatch"
  remarks: string
  date: string
  time: string
}

interface InspectionDetails {
  productId: string
  appearance: string
  freshness: string
  damage: string
  cleanliness: string
  grade: "A" | "B" | "C"
  remarks: string
  inspectorName: string
  facilityLocation?: string
  date: string
  time: string
}

interface ProcessingBatch {
  batchId: string
  productId: string
  originalProduct: Product
  processorName?: string
  facilityLocation?: string
  stage: "Accepted" | "Processing Started" | "Processing In Progress" | "Quality Check" | "Processing Completed" | "Transferred"
  stageLogs: {
    stage: string
    date: string
    time: string
    remarks: string
  }[]
  createdDate: string
  createdTime: string
  processedQuantity?: number
  estimatedShelfLifeDays?: number
  expiryDate?: string
  completionDate?: string
  completionTime?: string
  distributor?: string
  destinationHub?: string
  packagingFormat?: string
  storageTemp?: string
  logisticsMode?: string
  transferDate?: string
  transferTime?: string
}

interface AuditLog {
  id: string
  date: string
  time: string
  user: string
  action: string
  status: string
  productId?: string
  batchId?: string
}

import { useSearchParams } from "react-router-dom"

export function ProcessorDashboard() {
  const { token, user } = useAuth()
  const processorName = user?.name || "Processor Admin"
  const processorAddress = user?.address || localStorage.getItem("processor_address") || "Processing Facility"

  // Tabs state
  const [searchParams] = useSearchParams()
  const tabParam = (searchParams.get("tab") as "browse" | "pipeline" | "history") || "browse"
  const [activeTab, setActiveTab] = useState<"browse" | "pipeline" | "history">(tabParam)

  useEffect(() => {
    if (tabParam) {
      setActiveTab(tabParam)
    }
  }, [tabParam])

  const [pipelineStep, setPipelineStep] = useState<"incoming" | "interested" | "received" | "inspecting" | "processing" | "completed">("interested")
  const [historySubTab, setHistorySubTab] = useState<"audit" | "transferred">("audit")

  // API Products State
  const [products, setProducts] = useState<Product[]>([])
  const [loadingProducts, setLoadingProducts] = useState(false)

  // Search/Filter/Sort state
  const [searchTerm, setSearchTerm] = useState("")
  const [filterCategory, setFilterCategory] = useState("all")
  const [sortBy, setSortBy] = useState("newest")

  const [apiShipments, setApiShipments] = useState<any[]>([])
  const [, setApiBatches] = useState<any[]>([])

  // Local storage / synchronized workflow states
  const [interests, setInterests] = useState<string[]>([])
  const [deals, setDeals] = useState<Record<string, "requested" | "accepted" | "dispatched" | "declined">>({})
  const [declinedProducts, setDeclinedProducts] = useState<Record<string, boolean>>({})
  const [receipts, setReceipts] = useState<Record<string, ReceiptDetails>>({})
  const [verifications, setVerifications] = useState<Record<string, VerificationDetails>>({})
  const [inspections, setInspections] = useState<Record<string, InspectionDetails>>({})
  const [decisions, setDecisions] = useState<Record<string, { decision: "Accepted" | "Rejected"; reason?: string; date: string; time: string }>>({})
  const [batches, setBatches] = useState<Record<string, ProcessingBatch>>({})
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])

  const syncBackendBatches = (backendBatches: any[], incomingShipments: any[]) => {
    if (!backendBatches) return

    setBatches(prev => {
      const nextBatches: Record<string, ProcessingBatch> = { ...prev }

      for (const b of backendBatches) {
        const isProcessed = b.status === "PROCESSED" || b.status === "Transferred" || b.status === "In Transit"
        const isTransferred = b.status === "Transferred" || b.status === "In Transit"
        const createdDateStr = b.created_at
          ? new Date(b.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
          : new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
        const createdTimeStr = b.created_at
          ? new Date(b.created_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
          : new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })

        if (isProcessed) {
          const parent = b.parent_lineage?.[0]?.parent || b
          const batchKey = b.batch_number || `PB-${String(b.product_id || b.id).substring(0, 8).toUpperCase()}`
          const stage: ProcessingBatch["stage"] = isTransferred ? "Transferred" : "Processing Completed"

          const logs = [
            {
              stage: "Accepted",
              date: createdDateStr,
              time: createdTimeStr,
              remarks: `Intake verified and accepted at facility`
            },
            {
              stage: "Processing Completed",
              date: createdDateStr,
              time: createdTimeStr,
              remarks: `Processing completed. Processed Quantity: ${b.quantity} kg.`
            },
            ...(isTransferred ? [{
              stage: "Transferred",
              date: createdDateStr,
              time: createdTimeStr,
              remarks: `Certified batch transferred to distribution pipeline.`
            }] : [])
          ]

          nextBatches[batchKey] = {
            batchId: batchKey,
            productId: b.id,
            originalProduct: {
              ...parent,
              farmer: parent.farmer || b.farmer
            },
            processorName: processorName,
            facilityLocation: processorAddress,
            stage,
            stageLogs: logs,
            createdDate: createdDateStr,
            createdTime: createdTimeStr,
            processedQuantity: b.quantity,
            completionDate: createdDateStr,
            completionTime: createdTimeStr,
            transferDate: isTransferred ? createdDateStr : undefined,
            transferTime: isTransferred ? createdTimeStr : undefined,
            distributor: "XYZ Logistics Partner"
          }
        } else if (b.status !== "DEPLETED") {
          const batchKey = b.batch_number || `PB-${String(b.product_id || b.id).substring(0, 8).toUpperCase()}`
          if (!nextBatches[batchKey] || nextBatches[batchKey].stage === "Accepted") {
            nextBatches[batchKey] = {
              batchId: batchKey,
              productId: b.id,
              originalProduct: b,
              processorName: processorName,
              facilityLocation: processorAddress,
              stage: "Accepted",
              stageLogs: [{
                stage: "Accepted",
                date: createdDateStr,
                time: createdTimeStr,
                remarks: `Batch verified & accepted at gate. Scale Weight: ${b.quantity} kg. Quality: ${b.ai_quality_score || 90}% (${b.ai_quality_label || "Grade A"})`
              }],
              createdDate: createdDateStr,
              createdTime: createdTimeStr
            }
          }
        }
      }

      return nextBatches
    })

    setReceipts(prev => {
      const nextReceipts = { ...prev }
      for (const b of backendBatches) {
        const dateStr = b.created_at ? new Date(b.created_at).toISOString().split("T")[0] : new Date().toISOString().split("T")[0]
        const timeStr = b.created_at ? new Date(b.created_at).toTimeString().split(" ")[0].slice(0, 5) : "12:00"
        nextReceipts[b.id] = nextReceipts[b.id] || {
          productId: b.id,
          receivedQty: Number(b.quantity),
          arrivalDate: dateStr,
          arrivalTime: timeStr,
          receivedBy: processorName
        }
        nextReceipts[String(b.id)] = nextReceipts[b.id]
      }
      for (const s of (incomingShipments || [])) {
        if (s.status === "RECEIVED") {
          const dateStr = s.created_at ? new Date(s.created_at).toISOString().split("T")[0] : new Date().toISOString().split("T")[0]
          const timeStr = s.created_at ? new Date(s.created_at).toTimeString().split(" ")[0].slice(0, 5) : "12:00"
          nextReceipts[s.product_id] = nextReceipts[s.product_id] || {
            productId: s.product_id,
            receivedQty: Number(s.quantity),
            arrivalDate: dateStr,
            arrivalTime: timeStr,
            receivedBy: processorName
          }
          nextReceipts[String(s.product_id)] = nextReceipts[s.product_id]
        }
      }
      return nextReceipts
    })

    setDecisions(prev => {
      const nextDecisions = { ...prev }
      for (const b of backendBatches) {
        const dateStr = b.created_at ? new Date(b.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
        const timeStr = b.created_at ? new Date(b.created_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
        nextDecisions[b.id] = nextDecisions[b.id] || {
          decision: "Accepted",
          date: dateStr,
          time: timeStr
        }
        nextDecisions[String(b.id)] = nextDecisions[b.id]
      }
      for (const s of (incomingShipments || [])) {
        if (s.status === "RECEIVED") {
          const dateStr = s.created_at ? new Date(s.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
          const timeStr = s.created_at ? new Date(s.created_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
          nextDecisions[s.product_id] = nextDecisions[s.product_id] || {
            decision: "Accepted",
            date: dateStr,
            time: timeStr
          }
          nextDecisions[String(s.product_id)] = nextDecisions[s.product_id]
        }
      }
      return nextDecisions
    })
  }

  const syncBackendAuditLogs = (events: any[]) => {
    if (!events || events.length === 0) return

    const logs: AuditLog[] = events.map(ev => {
      const dateObj = new Date(ev.created_at)
      const dateStr = dateObj.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
      const timeStr = dateObj.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
      let action = `${ev.event_type} on batch ${ev.batch_number}`
      let status = ev.event_type

      if (ev.event_type === "PROCESSOR_RECEIVED") {
        action = `Accepted product (Batch: ${ev.batch_number}) - Scale Weight: ${ev.metadata?.received_quantity || ''} kg`
        status = "Accepted - Ready for Processing"
      } else if (ev.event_type === "PROCESSED") {
        action = `Completed Processing for Batch ${ev.batch_number} (${ev.metadata?.quantity_processed || ''} kg)`
        status = "Processing Completed"
      } else if (ev.event_type === "DISPATCHED_TO_DISTRIBUTOR") {
        action = `Transferred batch ${ev.batch_number} to distributor (${ev.metadata?.distributor || 'Logistics Partner'})`
        status = "Transferred"
      }

      return {
        id: ev.id,
        date: dateStr,
        time: timeStr,
        user: ev.actor?.name || processorName,
        action,
        status,
        productId: ev.product_id,
        batchId: ev.batch_number
      }
    })

    setAuditLogs(prev => {
      const existingIds = new Set(logs.map(l => l.id))
      return [...logs, ...prev.filter(p => !existingIds.has(p.id))]
    })
  }

  const fetchApiData = async () => {
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : {}
      const [shipmentsRes, batchesRes, eventsRes] = await Promise.all([
        axios.get(`${API}/processor/shipments/incoming`, { headers }),
        axios.get(`${API}/processor/batches`, { headers }),
        axios.get(`${API}/processor/events`, { headers })
      ])
      let shipments: any[] = []
      let backendBatches: any[] = []
      if (shipmentsRes.data?.success) {
        shipments = shipmentsRes.data.data
        setApiShipments(shipments)
      }
      if (batchesRes.data?.success) {
        backendBatches = batchesRes.data.data
        setApiBatches(backendBatches)
        syncBackendBatches(backendBatches, shipments)
      }
      if (eventsRes.data?.success) {
        syncBackendAuditLogs(eventsRes.data.data)
      }
    } catch (err) {
      console.error('Failed to load API data', err)
    }
  }

  // Modal / Form states
  // const [selectedShipment, setSelectedShipment] = useState<any | null>(null)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)

  // Receive Modal
  const [isReceiveModalOpen, setIsReceiveModalOpen] = useState(false)
  const [receivedQtyInput, setReceivedQtyInput] = useState("")
  const [arrivalDateInput, setArrivalDateInput] = useState(new Date().toISOString().split("T")[0])
  const [arrivalTimeInput, setArrivalTimeInput] = useState(new Date().toTimeString().split(" ")[0].slice(0, 5))
  const [transitLossReasonInput, setTransitLossReasonInput] = useState("Transit Spoilage / Physical Damage on Route")

  // Inspect Modal / Form
  const [isVerifyModalOpen, setIsVerifyModalOpen] = useState(false)
  const [qrScanning, setQrScanning] = useState(false)
  const [qrScanned, setQrScanned] = useState(false)
  const [cameraActive, setCameraActive] = useState(false)
  const [cameraError, setCameraError] = useState("")
  const [scannedRawText, setScannedRawText] = useState("")
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Batch QR View Modal
  const [qrViewBatch, setQrViewBatch] = useState<ProcessingBatch | null>(null)

  // Verification Checks
  const [infoVerified, setInfoVerified] = useState<"Verified" | "Mismatch" | "">("")
  const [remarksInput, setRemarksInput] = useState("")
  const [isInspectionConfirmed, setIsInspectionConfirmed] = useState(false)

  // Physical Inspection
  const [appearanceInput, setAppearanceInput] = useState("Good")
  const [freshnessInput, setFreshnessInput] = useState("Excellent")
  const [damageInput, setDamageInput] = useState("Low")
  const [cleanlinessInput, setCleanlinessInput] = useState("Good")
  const [qualityGradeInput, setQualityGradeInput] = useState<"A" | "B" | "C">("A")

  const computePhysicalQualityScore = (appearance: string, freshness: string, cleanliness: string, damage: string) => {
    let score = 0
    if (appearance === "Excellent") score += 25
    else if (appearance === "Good") score += 20
    else if (appearance === "Average") score += 15
    else score += 8

    if (freshness === "Excellent") score += 25
    else if (freshness === "Good") score += 20
    else if (freshness === "Average") score += 15
    else score += 8

    if (cleanliness === "Excellent") score += 25
    else if (cleanliness === "Good") score += 20
    else if (cleanliness === "Average") score += 15
    else score += 8

    if (damage === "Low") score += 25
    else if (damage === "Medium") score += 15
    else score += 5

    return Math.min(100, Math.max(10, score))
  }

  const handlePhysicalParamChange = (type: "appearance" | "freshness" | "cleanliness" | "damage", value: string) => {
    const nextApp = type === "appearance" ? value : appearanceInput
    const nextFresh = type === "freshness" ? value : freshnessInput
    const nextClean = type === "cleanliness" ? value : cleanlinessInput
    const nextDam = type === "damage" ? value : damageInput

    if (type === "appearance") setAppearanceInput(value)
    if (type === "freshness") setFreshnessInput(value)
    if (type === "cleanliness") setCleanlinessInput(value)
    if (type === "damage") setDamageInput(value)

    const score = computePhysicalQualityScore(nextApp, nextFresh, nextClean, nextDam)
    if (score >= 85) setQualityGradeInput("A")
    else if (score >= 60) setQualityGradeInput("B")
    else setQualityGradeInput("C")
  }

  // Decision Reject Reason
  const [rejectionReasonInput, setRejectionReasonInput] = useState("")
  const [showRejectionForm, setShowRejectionForm] = useState(false)




  // Processing Completion Modal state
  const [processingModalBatch, setProcessingModalBatch] = useState<ProcessingBatch | null>(null)
  const [processedQtyInput, setProcessedQtyInput] = useState("")
  const [estimatedShelfLifeInput, setEstimatedShelfLifeInput] = useState("")

  const formatToDdMmYyyy = (dateStr: string) => {
    if (!dateStr) return ""
    if (dateStr.includes("-") && dateStr.split("-")[0].length === 4) {
      const [y, m, d] = dateStr.split("-")
      return `${d}-${m}-${y}`
    }
    return dateStr
  }

  const computeShelfLifeDays = (dateStr: string) => {
    if (!dateStr) return 14
    const target = new Date(dateStr)
    const now = new Date()
    const diffTime = target.getTime() - new Date(now.toISOString().split("T")[0]).getTime()
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    return Math.max(1, diffDays)
  }

  const openProcessingModal = (b: ProcessingBatch) => {
    setProcessingModalBatch(b)
    const qty = receipts[b.originalProduct.id]?.receivedQty || b.originalProduct.quantity || 100
    setProcessedQtyInput(String(qty))
    const defaultExpiry = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
    setEstimatedShelfLifeInput(defaultExpiry.toISOString().split("T")[0])
  }

  // Fetch Products
  const fetchProducts = async () => {
    setLoadingProducts(true)
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : {}
      const res = await axios.get(`${API}/products`, { headers })
      const raw: Product[] = res.data?.data || []

      // Filter out permanently deleted products
      let deletedIds: string[] = []
      try {
        deletedIds = JSON.parse(localStorage.getItem("farmer_deleted_products") || "[]")
      } catch {
        deletedIds = []
      }
      const deletedSet = new Set(deletedIds.map(String))

      // Automatic Expiry Filter:
      // If a product has no processor interest and its expiry date has passed,
      // it should automatically disappear from the available browse catalog.
      const isUnclaimedAndExpired = (p: Product) => {
        const exp = p.expiry_date || (p as any).expiryDate
        if (!exp) return false
        if (p.status !== "Harvested" && p.status !== "Pending Approval") return false
        const expiryTime = new Date(`${exp}T23:59:59`).getTime()
        return !isNaN(expiryTime) && expiryTime < Date.now()
      }

      const active = raw.filter(p =>
        !deletedSet.has(String(p.id)) &&
        !deletedSet.has(String(p.batch_number)) &&
        !isUnclaimedAndExpired(p)
      )
      setProducts(active)
    } catch (err) {
      console.error("Failed to load products", err)
    } finally {
      setLoadingProducts(false)
    }
  }

  // Load local storage keys
  useEffect(() => {
    fetchProducts()
    fetchApiData()

    // Interests
    const storedInterests = localStorage.getItem("processor_interests")
    if (storedInterests) setInterests(JSON.parse(storedInterests))

    // Receipts
    const storedReceipts = localStorage.getItem("processor_receipts")
    if (storedReceipts) setReceipts(JSON.parse(storedReceipts))

    // Verifications
    const storedVerifications = localStorage.getItem("processor_verifications")
    if (storedVerifications) setVerifications(JSON.parse(storedVerifications))

    // Inspections
    const storedInspections = localStorage.getItem("processor_inspections")
    if (storedInspections) setInspections(JSON.parse(storedInspections))

    // Decisions
    const storedDecisions = localStorage.getItem("processor_decisions")
    if (storedDecisions) setDecisions(JSON.parse(storedDecisions))

    // Batches
    const storedBatches = localStorage.getItem("processor_batches")
    if (storedBatches) setBatches(JSON.parse(storedBatches))

    // Logs
    const storedLogs = localStorage.getItem("processor_logs")
    if (storedLogs) setAuditLogs(JSON.parse(storedLogs))

    // Deals & Declined Status
    const loadDealsAndDeclined = () => {
      try {
        const stored = JSON.parse(localStorage.getItem("farmer_deals") || "{}")
        setDeals(stored)
      } catch {
        setDeals({})
      }
      try {
        const storedDeclined = JSON.parse(localStorage.getItem("processor_declined_products") || "{}")
        setDeclinedProducts(storedDeclined)
      } catch {
        setDeclinedProducts({})
      }
    }
    loadDealsAndDeclined()
    window.addEventListener("farmer_deals_updated", loadDealsAndDeclined)
    window.addEventListener("storage", loadDealsAndDeclined)

    return () => {
      window.removeEventListener("farmer_deals_updated", loadDealsAndDeclined)
      window.removeEventListener("storage", loadDealsAndDeclined)
    }
  }, [token])

  // Helper: Add log
  const addLog = (action: string, status: string, productId?: string, batchId?: string) => {
    const now = new Date()
    const newLog: AuditLog = {
      id: crypto.randomUUID(),
      date: now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
      time: now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
      user: processorName,
      action,
      status,
      productId,
      batchId
    }
    const updated = [newLog, ...auditLogs]
    setAuditLogs(updated)
    localStorage.setItem("processor_logs", JSON.stringify(updated))
  }

  // DB update helper
  const updateDbStatus = async (id: string, status: string) => {
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : {}
      await axios.put(`${API}/products/${id}/status`, { status }, { headers })
      // Update local products state
      setProducts(prev => prev.map(p => p.id === id ? { ...p, status } : p))
    } catch (err) {
      console.error("Could not update product status in database", err)
    }
  }

  // Action: Mark Interest (Permanent, cannot be undone)
  const markInterest = async (product: Product) => {
    const prodId = String(product.id)

    // Clear any past test receipt/decision for this fresh product
    const updatedReceipts = { ...receipts }
    delete updatedReceipts[prodId]
    delete updatedReceipts[product.id]
    setReceipts(updatedReceipts)
    localStorage.setItem("processor_receipts", JSON.stringify(updatedReceipts))

    const updatedDecisions = { ...decisions }
    delete updatedDecisions[prodId]
    delete updatedDecisions[product.id]
    setDecisions(updatedDecisions)
    localStorage.setItem("processor_decisions", JSON.stringify(updatedDecisions))

    const updated = Array.from(new Set([...interests, prodId, product.id]))
    setInterests(updated)
    localStorage.setItem("processor_interests", JSON.stringify(updated))
    addLog(`Marked interest in ${product.name}`, "Interested", prodId)

    // Generate & save Farmer Notification and Deal State
    try {
      const now = new Date()
      const newNotif = {
        id: "notif-" + crypto.randomUUID(),
        type: "processor_interest",
        productId: prodId,
        batchNumber: product.batch_number || (product as any).batchNumber || "",
        productName: product.name,
        quantity: product.quantity,
        processorName: processorName || "Processing Facility",
        date: now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
        time: now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
        timestamp: Date.now(),
        read: false,
        message: `${processorName || "Processing Facility"} has expressed interest in your harvest batch "${product.name}" (${product.batch_number || (product as any).batchNumber || ""}).`
      }
      const existingNotifs = JSON.parse(localStorage.getItem("farmer_notifications") || "[]")
      const filteredNotifs = existingNotifs.filter((n: any) => n.productId !== prodId && n.batchNumber !== (product.batch_number || (product as any).batchNumber))
      const updatedNotifs = [newNotif, ...filteredNotifs]
      localStorage.setItem("farmer_notifications", JSON.stringify(updatedNotifs))
      window.dispatchEvent(new Event("farmer_notifications_updated"))

      // Record requested status in farmer_deals
      const storedDeals = JSON.parse(localStorage.getItem("farmer_deals") || "{}")
      storedDeals[prodId] = "requested"
      if (product.batch_number) storedDeals[product.batch_number] = "requested"
      if ((product as any).batchNumber) storedDeals[(product as any).batchNumber] = "requested"
      localStorage.setItem("farmer_deals", JSON.stringify(storedDeals))
      setDeals(storedDeals)
      window.dispatchEvent(new Event("farmer_deals_updated"))
    } catch (e) {
      console.warn("Could not save farmer notification/deal", e)
    }

    await updateDbStatus(product.id, "Processing")
    if (prodId !== product.id) {
      await updateDbStatus(prodId, "Processing")
    }
    await fetchApiData()
    await fetchProducts()
  }

  // Action: Dismiss Declined Product from Pipeline
  const handleDismissDeclined = (productId: string, batchNumber?: string) => {
    const updated = interests.filter(
      id => id !== productId && id !== String(productId) && (!batchNumber || id !== batchNumber)
    )
    setInterests(updated)
    localStorage.setItem("processor_interests", JSON.stringify(updated))
    addLog(`Dismissed declined product from pipeline`, "Dismissed", productId)
  }

  // Action: Receive Product Form Submit
  const handleReceiveProduct = async () => {
    if (!selectedProduct || !receivedQtyInput) return

    const receivedQtyNum = Number(receivedQtyInput)
    const registeredQty = selectedProduct.quantity
    const hasShortage = receivedQtyNum < registeredQty
    const shortageAmount = registeredQty - receivedQtyNum
    const shortagePercent = registeredQty > 0 ? ((shortageAmount / registeredQty) * 100).toFixed(0) : "0"

    const headers = token ? { Authorization: `Bearer ${token}` } : {}

    // Check if matching incoming shipment exists
    const shipment = apiShipments.find(s => s.product_id === selectedProduct.id || s.batch_number === selectedProduct.batch_number)
    if (shipment && shipment.status !== 'RECEIVED') {
      try {
        await axios.post(`${API}/processor/shipments/${shipment.id}/receive`, { received_quantity: receivedQtyNum }, { headers })
      } catch (err) {
        console.error("API Receive failed:", err)
      }
    } else {
      // Direct gate intake
      try {
        await axios.post(`${API}/processor/intake`, {
          product_id: selectedProduct.id,
          received_quantity: receivedQtyNum,
          remarks: transitLossReasonInput
        }, { headers })
      } catch (err) {
        console.error("API Intake failed:", err)
      }
    }

    const receipt: ReceiptDetails = {
      productId: selectedProduct.id,
      receivedQty: receivedQtyNum,
      arrivalDate: arrivalDateInput,
      arrivalTime: arrivalTimeInput,
      receivedBy: processorName
    }

    const updatedReceipts = {
      ...receipts,
      [selectedProduct.id]: receipt,
      [String(selectedProduct.id)]: receipt
    }
    setReceipts(updatedReceipts)
    localStorage.setItem("processor_receipts", JSON.stringify(updatedReceipts))

    const logMessage = hasShortage
      ? `Received product ${selectedProduct.name} (${receivedQtyNum} kg vs ${registeredQty} kg registered - ${shortageAmount} kg Shortage [${shortagePercent}%], Reason: ${transitLossReasonInput})`
      : `Received product ${selectedProduct.name} (${receivedQtyNum} kg) at facility`

    addLog(logMessage, "Received", selectedProduct.id)
    await updateDbStatus(selectedProduct.id, "Processing")
    await fetchApiData()
    await fetchProducts()

    setIsReceiveModalOpen(false)
    setReceivedQtyInput("")
    setSelectedProduct(null)
    setPipelineStep("received")
  }

  // Live Camera QR Scanner Methods
  const startLiveCamera = async () => {
    setCameraError("")
    setQrScanning(true)
    setCameraActive(true)

    try {
      if (html5QrCodeRef.current && html5QrCodeRef.current.isScanning) {
        await html5QrCodeRef.current.stop()
      }
      const html5QrCode = new Html5Qrcode("live-qr-reader")
      html5QrCodeRef.current = html5QrCode

      await html5QrCode.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: { width: 220, height: 220 }
        },
        (decodedText) => {
          handleQrSuccess(decodedText)
        },
        () => { }
      )
    } catch (err: any) {
      console.error("Camera error", err)
      setCameraError(err?.message || "Could not access camera. Please allow camera permissions or upload a QR image.")
      setCameraActive(false)
      setQrScanning(false)
    }
  }

  const stopLiveCamera = async () => {
    if (html5QrCodeRef.current) {
      try {
        if (html5QrCodeRef.current.isScanning) {
          await html5QrCodeRef.current.stop()
        }
        html5QrCodeRef.current.clear()
      } catch (e) {
        console.error("Error stopping scanner", e)
      }
    }
    setCameraActive(false)
    setQrScanning(false)
  }

  const format6DigitId = (id: number | string) => {
    const num = Number(id)
    if (num >= 100000 && num <= 999999) return String(num)
    if (num > 0) return String(100000 + num)
    return "100000"
  }

  const handleQrSuccess = async (decodedText: string) => {
    await stopLiveCamera()
    setScannedRawText(decodedText)

    // Extract ID from scanned QR URL or raw payload
    let scannedId = decodedText.trim()
    if (scannedId.includes("?id=")) {
      scannedId = scannedId.split("?id=")[1].split("&")[0].trim()
    }
    scannedId = scannedId.replace("FP-", "").trim().toLowerCase()

    const pId = String(selectedProduct?.id || "").toLowerCase()
    const pProdId = String(selectedProduct?.product_id || "").toLowerCase()
    const pBatch = String(selectedProduct?.batch_number || "").toLowerCase()
    const p6Digit = format6DigitId(selectedProduct?.product_id || selectedProduct?.id || 0).toLowerCase()
    const cleanDecoded = decodedText.toLowerCase()

    // Strict validation: Must match the selected product's ID, DB ID, 6-digit mapped ID, or Batch Number
    const isMatch = Boolean(
      (pId && scannedId === pId) ||
      (pProdId && scannedId === pProdId) ||
      (p6Digit && scannedId === p6Digit) ||
      (pBatch && (scannedId === pBatch || cleanDecoded.includes(pBatch))) ||
      (pId && cleanDecoded.includes(`id=${pId}`)) ||
      (pProdId && cleanDecoded.includes(`id=${pProdId}`))
    )

    if (isMatch) {
      setCameraError("")
      setInfoVerified("Verified")
      setRemarksInput("")
      setIsInspectionConfirmed(false)
      // ONLY advance to the physical inspection grading page on successful verification!
      setQrScanned(true)
    } else {
      setInfoVerified("Mismatch")
      // DO NOT advance on mismatch: keep user on the scanner view with clear error
      setQrScanned(false)

      // Dynamic cross-catalog search across all products
      const otherProduct = products.find(p => {
        if (p.id === selectedProduct?.id) return false
        const otherId = String(p.id).toLowerCase()
        const otherProdId = String(p.product_id || "").toLowerCase()
        const otherBatch = String(p.batch_number || "").toLowerCase()
        const other6Digit = format6DigitId(p.product_id || p.id).toLowerCase()
        return (
          (otherId && scannedId === otherId) ||
          (otherProdId && scannedId === otherProdId) ||
          (other6Digit && scannedId === other6Digit) ||
          (otherBatch && (scannedId === otherBatch || cleanDecoded.includes(otherBatch))) ||
          (otherId && cleanDecoded.includes(`id=${otherId}`)) ||
          (otherProdId && cleanDecoded.includes(`id=${otherProdId}`))
        )
      })

      if (otherProduct) {
        setCameraError(`❌ QR Mismatch! You scanned the QR code for "${otherProduct.name}" (Batch: ${otherProduct.batch_number || format6DigitId(otherProduct.product_id || otherProduct.id)}), but this verification is for "${selectedProduct?.name}" (Batch: ${selectedProduct?.batch_number || p6Digit}). Please scan the correct QR code.`)
      } else {
        setCameraError(`❌ QR Mismatch / Unrecognized Code! Scanned payload does not match this batch (${selectedProduct?.batch_number || p6Digit}). Please scan the authentic QR code.`)
      }
    }
  }

  const handleQrFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setCameraError("")

    // Helper: read file as Image
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)

    img.onload = async () => {
      URL.revokeObjectURL(objectUrl)

      // Layer 1: Native BarcodeDetector (Modern Hardware-Accelerated Detection)
      if ("BarcodeDetector" in window) {
        try {
          const barcodeDetector = new (window as any).BarcodeDetector({ formats: ["qr_code"] })
          const barcodes = await barcodeDetector.detect(img)
          if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
            handleQrSuccess(barcodes[0].rawValue)
            return
          }
        } catch (err) {
          console.warn("BarcodeDetector fallback", err)
        }
      }

      // Layer 2: jsQR Direct Pixel Decoding on Canvas
      try {
        const canvas = document.createElement("canvas")
        canvas.width = img.naturalWidth || img.width
        canvas.height = img.naturalHeight || img.height
        const ctx = canvas.getContext("2d", { willReadFrequently: true })
        if (ctx) {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: "dontInvert",
          }) || jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: "attemptBoth",
          })

          if (code && code.data) {
            handleQrSuccess(code.data)
            return
          }
        }
      } catch (err) {
        console.warn("jsQR canvas scan fallback", err)
      }

      // Layer 3: Html5Qrcode fallback
      try {
        const html5QrCode = new Html5Qrcode("live-qr-reader")
        const result = await html5QrCode.scanFile(file, false)
        if (result) {
          handleQrSuccess(result)
          return
        }
      } catch (err) {
        console.warn("Html5Qrcode scanFile fallback", err)
      }

      setCameraError("Could not detect a valid QR code in this image. Please upload a clear QR photo or use the Camera Scanner.")
    }

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      setCameraError("Invalid image file format. Please select a PNG or JPEG photo.")
    }

    img.src = objectUrl
  }

  const closeVerifyModal = async () => {
    await stopLiveCamera()
    setIsVerifyModalOpen(false)
    setSelectedProduct(null)
    setQrScanned(false)
    setCameraError("")
    setScannedRawText("")
    setIsInspectionConfirmed(false)
    setInfoVerified("")
    setRemarksInput("")
  }

  // Submit Inspection and Accept/Reject Decision
  const handleInspectionDecision = async (decision: "Accepted" | "Rejected") => {
    if (!selectedProduct) return

    const now = new Date()
    const formattedDate = now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    const formattedTime = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })

    // Save QR Verify info
    const verification: VerificationDetails = {
      productId: selectedProduct.id,
      status: infoVerified === "Verified" ? "Verified" : "Mismatch",
      remarks: remarksInput || "Blockchain batch cryptographic match confirmed",
      date: formattedDate,
      time: formattedTime
    }
    const updatedVerifications = { ...verifications, [selectedProduct.id]: verification }
    setVerifications(updatedVerifications)
    localStorage.setItem("processor_verifications", JSON.stringify(updatedVerifications))

    // Save Quality inspection details
    const computedScore = computePhysicalQualityScore(appearanceInput, freshnessInput, cleanlinessInput, damageInput)
    const autoGrade: "A" | "B" | "C" = computedScore >= 85 ? "A" : computedScore >= 60 ? "B" : "C"
    const inspection: InspectionDetails = {
      productId: selectedProduct.id,
      appearance: appearanceInput,
      freshness: freshnessInput,
      damage: damageInput,
      cleanliness: cleanlinessInput,
      grade: qualityGradeInput,
      remarks: remarksInput || `Quality Score: ${computedScore}% (Grade ${autoGrade})`,
      inspectorName: processorName,
      facilityLocation: processorAddress,
      date: formattedDate,
      time: formattedTime
    }
    const updatedInspections = { ...inspections, [selectedProduct.id]: inspection }
    setInspections(updatedInspections)
    localStorage.setItem("processor_inspections", JSON.stringify(updatedInspections))

    // Save Decision details
    const decisionRecord = {
      decision,
      reason: decision === "Rejected" ? rejectionReasonInput : undefined,
      date: formattedDate,
      time: formattedTime
    }
    const updatedDecisions = {
      ...decisions,
      [selectedProduct.id]: decisionRecord,
      [String(selectedProduct.id)]: decisionRecord
    }
    setDecisions(updatedDecisions)
    localStorage.setItem("processor_decisions", JSON.stringify(updatedDecisions))

    if (decision === "Accepted") {
      const verifiedQty = (receivedQtyInput && Number(receivedQtyInput) > 0)
        ? Number(receivedQtyInput)
        : selectedProduct.quantity
      const hasShortage = verifiedQty < selectedProduct.quantity
      const shortageAmount = selectedProduct.quantity - verifiedQty
      const shortagePercent = selectedProduct.quantity > 0 ? ((shortageAmount / selectedProduct.quantity) * 100).toFixed(0) : "0"

      const remarksText = hasShortage
        ? `Batch verified & accepted at gate. Scale Weight: ${verifiedQty} kg (${shortageAmount} kg Shortage [${shortagePercent}%], Reason: ${transitLossReasonInput}). Quality Score: ${computedScore}% (Grade ${autoGrade}). Remarks: ${remarksInput || "Standard Intake"}`
        : `Batch verified & accepted at gate. Scale Weight: ${verifiedQty} kg. Quality Score: ${computedScore}% (Grade ${autoGrade}). Remarks: ${remarksInput || "Standard Intake"}`

      // API Call for Phase 3B - either via incoming shipment or direct gate intake
      const headers = token ? { Authorization: `Bearer ${token}` } : {}
      const shipment = apiShipments.find(s => s.product_id === selectedProduct.id || s.batch_number === selectedProduct.batch_number)
      if (shipment && shipment.status !== 'RECEIVED') {
        try {
          await axios.post(`${API}/processor/shipments/${shipment.id}/receive`, { received_quantity: verifiedQty }, { headers })
        } catch (err) {
          console.error("API Receive failed:", err)
        }
      } else {
        try {
          await axios.post(`${API}/processor/intake`, {
            product_id: selectedProduct.id,
            received_quantity: verifiedQty,
            ai_quality_score: computedScore,
            ai_quality_label: `Grade ${autoGrade}`,
            remarks: remarksText
          }, { headers })
        } catch (err) {
          console.error("API Intake failed:", err)
        }
      }

      // Save/update receipt details with weighed scale quantity
      const receipt: ReceiptDetails = {
        productId: selectedProduct.id,
        receivedQty: verifiedQty,
        arrivalDate: arrivalDateInput,
        arrivalTime: arrivalTimeInput,
        receivedBy: processorName
      }
      const updatedReceipts = {
        ...receipts,
        [selectedProduct.id]: receipt,
        [String(selectedProduct.id)]: receipt
      }
      setReceipts(updatedReceipts)
      localStorage.setItem("processor_receipts", JSON.stringify(updatedReceipts))

      const verifiedProduct: Product = {
        ...selectedProduct,
        quantity: verifiedQty,
        ai_quality_score: computedScore,
        ai_quality_label: `Grade ${autoGrade}`
      }

      // Create batch ID: PB-XXXXXX mapped randomly
      const randomBatchId = selectedProduct.batch_number || `PB-${crypto.randomUUID().split('-')[0].toUpperCase()}`

      const newBatch: ProcessingBatch = {
        batchId: randomBatchId,
        productId: selectedProduct.id,
        originalProduct: verifiedProduct,
        processorName: processorName,
        facilityLocation: processorAddress,
        stage: "Accepted",
        stageLogs: [{ stage: "Accepted", date: formattedDate, time: formattedTime, remarks: remarksText }],
        createdDate: formattedDate,
        createdTime: formattedTime
      }
      const updatedBatches = { ...batches, [randomBatchId]: newBatch }
      setBatches(updatedBatches)
      localStorage.setItem("processor_batches", JSON.stringify(updatedBatches))

      addLog(`Accepted product ${selectedProduct.name} (Batch: ${randomBatchId}) - Scale Weight: ${verifiedQty} kg, Quality: ${computedScore}% (Grade ${autoGrade})`, "Accepted - Ready for Processing", selectedProduct.id, randomBatchId)

      // Notify Farmer of Acceptance
      try {
        const acceptNotif = {
          id: "notif-" + crypto.randomUUID(),
          type: "processor_accepted",
          productId: String(selectedProduct.id),
          batchNumber: selectedProduct.batch_number || (selectedProduct as any).batchNumber || "",
          productName: selectedProduct.name,
          quantity: verifiedQty,
          processorName: processorName || "Processing Facility",
          date: formattedDate,
          time: formattedTime,
          timestamp: Date.now(),
          read: false,
          message: `${processorName || "Processing Facility"} has verified and accepted batch "${selectedProduct.name}" (${verifiedQty} kg, Grade ${autoGrade}) on blockchain.`
        }
        const existingNotifs = JSON.parse(localStorage.getItem("farmer_notifications") || "[]")
        localStorage.setItem("farmer_notifications", JSON.stringify([acceptNotif, ...existingNotifs]))
        window.dispatchEvent(new Event("farmer_notifications_updated"))
      } catch (e) {
        console.warn("Could not save farmer notification", e)
      }

      await updateDbStatus(selectedProduct.id, "Processing")
      await fetchApiData()
      await fetchProducts()
      setPipelineStep("processing")
    } else {
      addLog(`Rejected product ${selectedProduct.name}: ${rejectionReasonInput}`, "Rejected by Processor", selectedProduct.id)

      // Notify Farmer of Rejection
      try {
        const rejectNotif = {
          id: "notif-" + crypto.randomUUID(),
          type: "processor_rejected",
          productId: String(selectedProduct.id),
          batchNumber: selectedProduct.batch_number || (selectedProduct as any).batchNumber || "",
          productName: selectedProduct.name,
          quantity: selectedProduct.quantity,
          processorName: processorName || "Processing Facility",
          date: formattedDate,
          time: formattedTime,
          timestamp: Date.now(),
          read: false,
          message: `${processorName || "Processing Facility"} rejected batch "${selectedProduct.name}" (${selectedProduct.quantity} kg) — Reason: ${rejectionReasonInput || "Intake verification discrepancy"}.`
        }
        const existingNotifs = JSON.parse(localStorage.getItem("farmer_notifications") || "[]")
        localStorage.setItem("farmer_notifications", JSON.stringify([rejectNotif, ...existingNotifs]))
        window.dispatchEvent(new Event("farmer_notifications_updated"))
      } catch (e) {
        console.warn("Could not save farmer notification", e)
      }

      await updateDbStatus(selectedProduct.id, "Rejected by Processor")
      await fetchApiData()
      await fetchProducts()
      setPipelineStep("interested")
    }

    // Reset Form
    setIsVerifyModalOpen(false)
    setQrScanned(false)
    setInfoVerified("")
    setRemarksInput("")
    setIsInspectionConfirmed(false)
    setRejectionReasonInput("")
    setShowRejectionForm(false)
    setSelectedProduct(null)
  }

  // Complete Processing Action (Manual Processed Quantity + Manual Estimated Shelf Life Date + Auto Completion Date & Time)
  const handleCompleteProcessing = async (
    batchId: string,
    processedQty: number,
    expiryDateInput: string
  ) => {
    const batch = batches[batchId]
    if (!batch) return

    // API Call for Phase 3B
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : {}
      const procRes = await axios.post(`${API}/processor/batches/${batch.originalProduct.id}/process`, {
        quantity_used: processedQty,
        new_product_name: `Processed ${batch.originalProduct.name}`,
        new_category: 'Processed Food'
      }, { headers })

      if (procRes.data?.data?.id) {
        const childProduct = procRes.data.data
        try {
          await axios.post(`${API}/processor/batches/${childProduct.id}/transfer`, {
            distributor: 'XYZ Logistics Partner',
            destination_hub: 'Central Distribution Hub',
            remarks: 'Certified batch ready and transferred to distribution pipeline.'
          }, { headers })
        } catch (tErr) {
          console.warn("Transfer record warning:", tErr)
        }
      }

      await updateDbStatus(batch.originalProduct.id, "In Transit")
      await fetchApiData()
      await fetchProducts()
    } catch (err) {
      console.error("API Processing failed:", err)
    }

    const now = new Date()
    const formattedDate = now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    const formattedTime = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
    const formattedExpiry = formatToDdMmYyyy(expiryDateInput)
    const shelfLifeDays = computeShelfLifeDays(expiryDateInput)

    const updatedLogs = [
      ...batch.stageLogs,
      {
        stage: "Processing Completed",
        date: formattedDate,
        time: formattedTime,
        remarks: `Processing completed. Processed Quantity: ${processedQty} kg. Estimated Shelf Life: ${formattedExpiry} (${shelfLifeDays} Days).`
      },
      {
        stage: "Transferred",
        date: formattedDate,
        time: formattedTime,
        remarks: `Certified batch ready and transferred to distribution pipeline.`
      }
    ]

    const updatedBatch: ProcessingBatch = {
      ...batch,
      stage: "Transferred",
      stageLogs: updatedLogs,
      processedQuantity: processedQty,
      estimatedShelfLifeDays: shelfLifeDays,
      expiryDate: formattedExpiry,
      completionDate: formattedDate,
      completionTime: formattedTime,
      transferDate: formattedDate,
      transferTime: formattedTime,
      distributor: "XYZ Logistics Partner"
    }

    const updatedBatches = { ...batches, [batchId]: updatedBatch }
    setBatches(updatedBatches)
    localStorage.setItem("processor_batches", JSON.stringify(updatedBatches))

    addLog(`Completed Processing for Batch ${batchId} (${processedQty} kg, Est. Shelf Life: ${formattedExpiry})`, "Processing Completed", batch.productId, batchId)
    await updateDbStatus(batch.originalProduct.id, "In Transit")
    setProcessingModalBatch(null)
    setPipelineStep("completed")
  }






  // Filter and Sort logic
  const filteredProducts = products
    .filter(p => {
      // 1. Search filter
      const term = searchTerm.trim().toLowerCase()
      const cleanTerm = term.replace(/^fp-?/i, '')
      const mappedId = (p.product_id && p.product_id >= 100000 && p.product_id <= 999999)
        ? p.product_id
        : 100000 + (Math.abs(Number(p.product_id || 0)) % 899999)
      const fullProductIdStr = `fp-${mappedId}`.toLowerCase()

      const productName = (p.name || "").toLowerCase()
      const farmerName = (p.farmer?.name || "Ravi").toLowerCase()
      const farmerEmail = (p.farmer?.email || "").toLowerCase()
      const categoryName = (p.category || "").toLowerCase()
      const batchNo = (p.batch_number || "").toLowerCase()

      const matchesSearch = !term ||
        productName.includes(term) ||
        fullProductIdStr.includes(term) ||
        String(mappedId).includes(cleanTerm || term) ||
        String(p.product_id || "").includes(cleanTerm || term) ||
        farmerName.includes(term) ||
        farmerEmail.includes(term) ||
        categoryName.includes(term) ||
        batchNo.includes(term)

      // 2. Category filter (case-insensitive & matches singular/plural roots)
      const matchesCategory = filterCategory === "all" || (() => {
        const cat = (p.category || "").toLowerCase().trim()
        const target = filterCategory.toLowerCase().trim()
        if (target === "fruits") return cat.startsWith("fruit")
        if (target === "vegetables") return cat.startsWith("veg")
        if (target === "grains") return cat.startsWith("grain")
        return cat === target
      })()

      // 3. Status filter
      // Only available/harvested farmer products appear in the browse marketplace.
      const statusLower = (p.status || "").toLowerCase().trim()
      const matchesStatus = statusLower === "harvested" || statusLower === "available"

      // 4. Exclude products declined by farmer for this processor
      const isDeclined = Boolean(
        declinedProducts[p.id] ||
        declinedProducts[String(p.id)] ||
        (p.batch_number && declinedProducts[p.batch_number]) ||
        ((p as any).batchNumber && declinedProducts[(p as any).batchNumber])
      )

      return matchesSearch && matchesCategory && matchesStatus && !isDeclined
    })
    .sort((a, b) => {
      if (sortBy === "newest") return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      if (sortBy === "oldest") return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      if (sortBy === "quantity") return b.quantity - a.quantity
      return 0
    })



  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 pb-20 pt-6">
      {/* Header bar */}
      <div className="border-b pb-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Factory className="h-8 w-8 text-primary" />
            {activeTab === "browse" && "Dashboard"}
            {activeTab === "pipeline" && "Processing Pipeline"}
            {activeTab === "history" && "Operational History"}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {activeTab === "browse" && "Manage farmer products and processing operations."}
            {activeTab === "pipeline" && "Track, receive, inspect, process, and transfer agricultural yields."}
            {activeTab === "history" && "Chronological audit logs and history of all processor facility events."}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            fetchApiData()
            fetchProducts()
          }}
          className="rounded-xl border-white/10 hover:border-primary/50 text-foreground gap-1.5 text-xs font-semibold shadow-sm"
        >
          <Clock className="h-3.5 w-3.5 text-primary" />
          Sync with Database
        </Button>
      </div>

      <DecisionSupportPanel />

      {/* Tabs rendering */}
      {activeTab === "browse" && (
        <Card className="rounded-3xl border shadow-sm overflow-hidden">
          <CardHeader className="bg-card border-b py-5">
            <CardTitle className="text-xl font-bold text-foreground">Available Farmer Products</CardTitle>
            <CardDescription>Browse, search and express interest in products registered by farmers.</CardDescription>

            {/* Search, Filter, Sort Controls - Clean 3 Columns */}
            <div className="grid gap-4 md:grid-cols-3 mt-5">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search name, ID, farmer..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 h-10 w-full rounded-xl border bg-background/50 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                />
              </div>

              <div>
                <select
                  value={filterCategory}
                  onChange={(e) => setFilterCategory(e.target.value)}
                  className="h-10 w-full rounded-xl border bg-background/50 text-sm px-3 focus-visible:outline-none"
                >
                  <option value="all">All Categories</option>
                  <option value="Vegetables">Vegetables</option>
                  <option value="Fruits">Fruits</option>
                  <option value="Grains">Grains</option>
                </select>
              </div>

              <div>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="h-10 w-full rounded-xl border bg-background/50 text-sm px-3 focus-visible:outline-none"
                >
                  <option value="newest">Newest First</option>
                  <option value="oldest">Oldest First</option>
                  <option value="quantity">Largest Quantity</option>
                </select>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-6">
            {loadingProducts ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
                <p className="text-muted-foreground text-sm font-medium">Fetching real farm data...</p>
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="text-center py-20 text-muted-foreground space-y-2">
                <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto" />
                <p className="text-lg font-semibold">No products found</p>
                <p className="text-sm">Try broadening your search or check back later.</p>
              </div>
            ) : (
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {filteredProducts.map((p) => {
                  const prodId = String(p.id)
                  const isInterested = interests.includes(prodId) || interests.includes(p.id)
                  const mappedId = (p.product_id && p.product_id >= 100000 && p.product_id <= 999999)
                    ? p.product_id
                    : 100000 + (Math.abs(Number(p.product_id || 0)) % 899999)

                  return (
                    <div key={p.id} className="rounded-3xl border bg-card/40 hover:bg-card/90 transition-all p-6 space-y-4 shadow-sm hover:shadow-md flex flex-col justify-between">
                      <div className="space-y-3">
                        <div className="flex items-start justify-between">
                          <div>
                            <span className="text-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary font-semibold">{p.category}</span>
                          </div>
                          {isInterested && (
                            <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/20 font-semibold flex items-center gap-1">
                              <Star className="h-3 w-3 fill-amber-500" /> Interested
                            </span>
                          )}
                        </div>

                        <div>
                          <h3 className="font-bold text-xl text-foreground flex items-center gap-1.5">
                            {p.name.includes("Tomato") ? "🍅" : p.name.includes("Mango") ? "🥭" : p.name.includes("Avocado") ? "🥑" : p.name.includes("Wheat") ? "🌾" : "🌱"}
                            {p.name}
                          </h3>
                          <p className="text-xs text-muted-foreground font-mono mt-1">Product ID: FP-{mappedId}</p>
                        </div>

                        <div className="border-t pt-3 space-y-2 text-sm text-foreground">
                          <div className="flex items-center gap-2">
                            <User className="h-4 w-4 text-muted-foreground" />
                            <span>Farmer: <strong>{p.farmer?.name || "Ravi"}</strong></span>
                          </div>
                          <div className="flex items-center gap-2">
                            <MapPin className="h-4 w-4 text-muted-foreground" />
                            <span>Location: <span className="text-muted-foreground">{getFarmerLocation(p)}</span></span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Package className="h-4 w-4 text-muted-foreground" />
                            <span>Quantity: <strong>{p.quantity} kg</strong></span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Clock className="h-4 w-4 text-muted-foreground" />
                            <span>Harvested: <span className="text-muted-foreground">{new Date(p.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</span></span>
                          </div>
                        </div>
                      </div>

                      <div className="flex gap-2 pt-4 border-t">
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 rounded-xl"
                          onClick={() => setSelectedProduct(p)}
                        >
                          View Details
                        </Button>
                        <Button
                          size="sm"
                          disabled={isInterested}
                          className={`flex-1 rounded-xl text-white ${isInterested
                              ? "bg-amber-600/90 text-white cursor-not-allowed opacity-90 font-medium"
                              : "bg-primary hover:bg-primary/95 font-medium"
                            }`}
                          onClick={() => markInterest(p)}
                        >
                          {isInterested ? "Interested ✓" : "Express Interest"}
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === "pipeline" && (
        <div className="grid gap-6 lg:grid-cols-4">
          {/* Pipeline Sidebar Step controls */}
          <Card className="col-span-1 rounded-3xl border shadow-sm p-4 h-fit space-y-2">
            <h3 className="font-bold text-lg px-2 mb-3">Pipeline Status</h3>
            {[
              { id: "incoming", label: "📦 Incoming Shipments", count: apiShipments.filter(s => s.status !== "RECEIVED" && s.status !== "DELIVERED").length },
              { id: "interested", label: "★ Interested Products", count: products.filter(p => (interests.includes(String(p.id)) || interests.includes(p.id) || (p.status === "Processing" && p.current_owner_id !== user?.id)) && !receipts[String(p.id)] && !receipts[p.id] && p.current_owner_id !== user?.id).length },
              { id: "received", label: "📥 Received / Verify QR", count: products.filter(p => (receipts[String(p.id)] || receipts[p.id]) && !decisions[String(p.id)] && !decisions[p.id] && p.current_owner_id !== user?.id).length },
              { id: "processing", label: "🏭 Active Processing", count: Object.values(batches).filter(b => b.stage !== "Processing Completed" && b.stage !== "Transferred").length },
              { id: "completed", label: "🚚 Transferred to Distributor", count: Object.values(batches).filter(b => b.stage === "Transferred" || b.stageLogs.some(l => l.stage === "Transferred")).length }
            ].map((step) => (
              <button
                key={step.id}
                onClick={() => setPipelineStep(step.id as any)}
                className={`w-full text-left px-4 py-3 rounded-2xl flex items-center justify-between text-sm transition-all ${pipelineStep === step.id
                    ? "bg-primary text-white font-medium"
                    : "text-muted-foreground hover:bg-muted/50"
                  }`}
              >
                <span>{step.label}</span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${pipelineStep === step.id ? "bg-white/20 text-white" : "bg-muted text-muted-foreground"
                  }`}>{step.count}</span>
              </button>
            ))}
          </Card>

          {/* Pipeline Main Window */}
          <Card className="col-span-3 rounded-3xl border shadow-sm p-6 min-h-[500px]">
            {pipelineStep === "incoming" && (
              <div className="space-y-4">
                <div className="border-b pb-4">
                  <h3 className="text-xl font-bold">Incoming Shipments</h3>
                  <p className="text-muted-foreground text-sm">Real backend shipments assigned to your processing facility.</p>
                </div>
                {apiShipments.filter(s => s.status !== "RECEIVED" && s.status !== "DELIVERED").length === 0 ? (
                  <div className="text-center py-20 text-muted-foreground">
                    <Package className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                    <p className="font-semibold text-lg">No incoming shipments</p>
                  </div>
                ) : (
                  <div className="grid gap-4">
                    {apiShipments.filter(s => s.status !== "RECEIVED" && s.status !== "DELIVERED").map(s => (
                      <div key={s.id} className="p-5 rounded-2xl border bg-muted/20 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                        <div>
                          <h4 className="font-bold text-lg text-foreground">Shipment {s.shipment_tracking_id}</h4>
                          <p className="text-xs text-muted-foreground mt-1">From: {s.sender?.name} • Quantity: {s.quantity} {s.unit}</p>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => {
                            // Find product matching this shipment in our API products or use attached product
                            const p = products.find(prod => prod.id === s.product_id || prod.batch_number === s.batch_number) || s.product
                            if (p) {
                              setSelectedProduct(p)
                              setReceivedQtyInput(String(s.quantity))
                              setIsVerifyModalOpen(true)
                            } else {
                              alert('Product details could not be found for this shipment.')
                            }
                          }}
                          className="rounded-xl text-white bg-primary hover:bg-primary/95 flex-1 md:flex-initial gap-1.5 font-semibold shadow-md cursor-pointer"
                        >
                          Scan QR & Verify
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {pipelineStep === "interested" && (
              <div className="space-y-4">
                <div className="border-b pb-4">
                  <h3 className="text-xl font-bold">Interested Farmer Yields</h3>
                  <p className="text-muted-foreground text-sm">Farmer registered products you marked interest in. Once they arrive physically, record their receipt.</p>
                </div>

                {products.filter(p => (interests.includes(String(p.id)) || interests.includes(p.id) || (p.status === "Processing" && p.current_owner_id !== user?.id)) && !receipts[String(p.id)] && !receipts[p.id] && p.current_owner_id !== user?.id).length === 0 ? (
                  <div className="text-center py-20 text-muted-foreground">
                    <Star className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                    <p className="font-semibold text-lg">No interested products</p>
                    <p className="text-sm">Browse available products and click "Express Interest" to add them here.</p>
                  </div>
                ) : (
                  <div className="grid gap-4">
                    {products.filter(p => (interests.includes(String(p.id)) || interests.includes(p.id) || (p.status === "Processing" && p.current_owner_id !== user?.id)) && !receipts[String(p.id)] && !receipts[p.id] && p.current_owner_id !== user?.id).map(p => {
                      const isDeclined = Boolean(
                        deals[String(p.id)] === "declined" ||
                        deals[p.batch_number || ""] === "declined" ||
                        deals[p.id] === "declined" ||
                        declinedProducts[p.id] ||
                        declinedProducts[String(p.id)] ||
                        (p.batch_number && declinedProducts[p.batch_number]) ||
                        ((p as any).batchNumber && declinedProducts[(p as any).batchNumber])
                      )
                      const dealStatus = isDeclined ? "declined" : (deals[String(p.id)] || deals[p.batch_number || ""] || deals[p.id] || "requested")
                      const isDispatched = dealStatus === "dispatched"

                      if (isDeclined || dealStatus === "declined") {
                        return (
                          <div key={p.id} className="p-5 rounded-2xl border border-red-500/30 bg-red-500/5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <h4 className="font-bold text-lg text-foreground flex items-center gap-1.5">
                                  {p.name.includes("Tomato") ? "🍅" : p.name.includes("Mango") ? "🥭" : "🌱"}
                                  {p.name}
                                </h4>
                                <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/30 flex items-center gap-1">
                                  ❌ Declined by Farmer
                                </span>
                              </div>
                              <p className="text-xs text-muted-foreground mt-1">
                                Farmer: {p.farmer?.name || "Ravi"} • Quantity: {p.quantity} kg • Batch: {p.batch_number || p.id}
                              </p>
                              <p className="text-xs text-red-400/90 mt-1">
                                Farmer declined your procurement request. This yield has been released back to the open market.
                              </p>
                            </div>
                            <div className="flex gap-2 w-full md:w-auto items-center">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setSelectedProduct(p)}
                                className="rounded-xl flex-1 md:flex-initial"
                              >
                                Details
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleDismissDeclined(String(p.id), p.batch_number)}
                                className="rounded-xl border-red-500/30 text-red-400 hover:bg-red-500/10 hover:border-red-500 flex-1 md:flex-initial gap-1.5 font-medium"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Dismiss from Pipeline
                              </Button>
                            </div>
                          </div>
                        )
                      }

                      return (
                        <div key={p.id} className="p-5 rounded-2xl border bg-muted/20 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <h4 className="font-bold text-lg text-foreground flex items-center gap-1.5">
                                {p.name.includes("Tomato") ? "🍅" : p.name.includes("Mango") ? "🥭" : "🌱"}
                                {p.name}
                              </h4>
                              {/* Dynamic Deal Progress Tag */}
                              {dealStatus === "requested" && (
                                <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-500 border border-amber-500/30 flex items-center gap-1">
                                  ⏳ Awaiting Farmer Acceptance
                                </span>
                              )}
                              {dealStatus === "accepted" && (
                                <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/30 flex items-center gap-1">
                                  📦 Farmer Preparing Batch
                                </span>
                              )}
                              {dealStatus === "dispatched" && (
                                <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                                  🚚 In Transit / Gate Intake Ready
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">Farmer: {p.farmer?.name || "Ravi"} • Quantity: {p.quantity} kg • Batch: {p.batch_number || p.id}</p>
                          </div>
                          <div className="flex gap-2 w-full md:w-auto items-center">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setSelectedProduct(p)}
                              className="rounded-xl flex-1 md:flex-initial"
                            >
                              Details
                            </Button>
                            {isDispatched ? (
                              <Button
                                size="sm"
                                onClick={() => {
                                  setSelectedProduct(p)
                                  setReceivedQtyInput(String(p.quantity))
                                  setRemarksInput("")
                                  setIsInspectionConfirmed(false)
                                  setIsVerifyModalOpen(true)
                                }}
                                className="rounded-xl text-white bg-primary hover:bg-primary/95 flex-1 md:flex-initial gap-1.5 font-semibold shadow-md cursor-pointer"
                              >
                                <QrCode className="h-4 w-4" />
                                Scan QR & Verify
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                disabled
                                title={dealStatus === "requested" ? "Waiting for farmer to accept your interest request." : "Waiting for farmer to mark batch ready for dispatch."}
                                className="rounded-xl text-slate-400 bg-slate-800/60 border border-slate-700/50 flex-1 md:flex-initial gap-1.5 font-medium cursor-not-allowed opacity-80"
                              >
                                <Lock className="h-3.5 w-3.5" />
                                {dealStatus === "requested" ? "Awaiting Acceptance" : "Awaiting Dispatch"}
                              </Button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {pipelineStep === "received" && (
              <div className="space-y-4">
                <div className="border-b pb-4">
                  <h3 className="text-xl font-bold">Received Products & Verification</h3>
                  <p className="text-muted-foreground text-sm">Physically received products awaiting QR code authenticity verification and quality grading.</p>
                </div>

                {products.filter(p => (receipts[String(p.id)] || receipts[p.id]) && !decisions[String(p.id)] && !decisions[p.id] && p.current_owner_id !== user?.id).length === 0 ? (
                  <div className="text-center py-20 text-muted-foreground">
                    <Package className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                    <p className="font-semibold text-lg">No received items awaiting check</p>
                    <p className="text-sm">Receive a product from the "Interested" tab to start verification.</p>
                  </div>
                ) : (
                  <div className="grid gap-4">
                    {products.filter(p => (receipts[String(p.id)] || receipts[p.id]) && !decisions[String(p.id)] && !decisions[p.id] && p.current_owner_id !== user?.id).map(p => (
                      <div key={p.id} className="p-5 rounded-2xl border bg-muted/20 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                        <div>
                          <h4 className="font-bold text-lg text-foreground flex items-center gap-1.5">
                            {p.name.includes("Tomato") ? "🍅" : p.name.includes("Mango") ? "🥭" : "🌱"}
                            {p.name}
                          </h4>
                          <p className="text-xs text-muted-foreground">Registered: {p.quantity} kg • Received: {receipts[p.id]?.receivedQty} kg</p>
                          <p className="text-xs text-muted-foreground mt-1">Arrival: {receipts[p.id]?.arrivalDate} • {receipts[p.id]?.arrivalTime}</p>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => {
                            setSelectedProduct(p)
                            setReceivedQtyInput(String(receipts[p.id]?.receivedQty || p.quantity))
                            setRemarksInput("")
                            setIsInspectionConfirmed(false)
                            setIsVerifyModalOpen(true)
                          }}
                          className="rounded-xl text-white bg-primary hover:bg-primary/95 w-full md:w-auto cursor-pointer"
                        >
                          Scan QR & Verify
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {pipelineStep === "processing" && (
              <div className="space-y-6">
                <div className="border-b pb-4">
                  <h3 className="text-xl font-bold">Active Processing Batches</h3>
                  <p className="text-muted-foreground text-sm">Accepted batches currently undergoing sorting, processing, packaging or final verification.</p>
                </div>

                {Object.values(batches).filter(b => b.stage !== "Processing Completed" && b.stage !== "Transferred").length === 0 ? (
                  <div className="text-center py-20 text-muted-foreground">
                    <Factory className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                    <p className="font-semibold text-lg">No active batches in processing</p>
                    <p className="text-sm">Accept a received product to create a processing batch.</p>
                  </div>
                ) : (
                  <div className="grid gap-6">
                    {Object.values(batches).filter(b => b.stage !== "Processing Completed" && b.stage !== "Transferred").map(b => (
                      <div key={b.batchId} className="p-6 rounded-3xl border bg-card/50 space-y-5">
                        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
                          <div>
                            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-400">
                              Batch: {b.batchId}
                            </span>
                            <h4 className="font-bold text-xl mt-2 text-foreground">
                              {b.originalProduct.name} Processing Pipeline
                            </h4>
                            <p className="text-xs text-muted-foreground">Original ID: FP-{(b.originalProduct.product_id && b.originalProduct.product_id >= 100000 && b.originalProduct.product_id <= 999999) ? b.originalProduct.product_id : 100000 + (Math.abs(Number(b.originalProduct.product_id || 0)) % 899999)} • Farmer: {b.originalProduct.farmer?.name || "Ravi"}</p>
                          </div>
                          <span className="text-xs font-medium px-3 py-1 rounded-full bg-primary/20 text-primary border border-primary/30">
                            {b.stage}
                          </span>
                        </div>

                        <div className="p-4 bg-emerald-500/5 border border-emerald-500/20 rounded-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                          <div className="space-y-1">
                            <span className="text-xs font-bold text-emerald-400 uppercase flex items-center gap-1.5">
                              <Package className="h-4 w-4" />
                              Batch Status: Intake Verified & Ready for Processing
                            </span>
                            <p className="text-xs text-zinc-300">
                              Produce verified at scale with <strong className="text-emerald-400 font-semibold">{b.originalProduct.ai_quality_score || 90}% ({b.originalProduct.ai_quality_label || "Grade A"})</strong> quality score.
                            </p>
                          </div>
                          <Button
                            onClick={() => openProcessingModal(b)}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs gap-2 shrink-0 shadow-md py-2.5 px-4 cursor-pointer"
                          >
                            <Package className="h-4 w-4" />
                            📦 Complete Processing
                          </Button>
                        </div>

                        {/* AI Quality & Intake Details */}
                        <div className="p-4 bg-blue-500/5 border border-blue-500/10 rounded-2xl grid gap-4 md:grid-cols-2">
                          <div className="flex items-center gap-2">
                            <Brain className="h-5 w-5 text-blue-500" />
                            <div>
                              <p className="text-[10px] text-muted-foreground uppercase font-bold">AI Quality Score</p>
                              <p className="text-sm font-semibold text-emerald-400">{b.originalProduct.ai_quality_score || 90}% ({b.originalProduct.ai_quality_label || "Grade A"})</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Scale className="h-5 w-5 text-emerald-500" />
                            <div>
                              <p className="text-[10px] text-muted-foreground uppercase font-bold">Intake Scale Weight</p>
                              <p className="text-sm font-semibold text-white">{receipts[b.originalProduct.id]?.receivedQty || b.originalProduct.quantity} kg</p>
                            </div>
                          </div>
                        </div>

                        <div className="flex justify-end gap-2 flex-wrap">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setQrViewBatch(b)}
                            className="rounded-xl text-xs gap-1.5 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 hover:border-emerald-500"
                          >
                            <QrCode className="h-3.5 w-3.5" />
                            Batch QR Sticker
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {pipelineStep === "completed" && (
              <div className="space-y-6">
                <div className="border-b pb-4">
                  <h3 className="text-xl font-bold flex items-center gap-2 text-foreground">
                    <Truck className="h-6 w-6 text-primary" />
                    Transferred to Distributor (Dispatch Manifest)
                  </h3>
                  <p className="text-muted-foreground text-sm">
                    Verified agricultural yields packaged, quality-certified, and handed over to logistics partners with complete chain-of-custody tracking.
                  </p>
                </div>

                {Object.values(batches).filter(b => b.stage === "Transferred" || b.stageLogs.some(l => l.stage === "Transferred")).length === 0 ? (
                  <div className="text-center py-20 text-muted-foreground space-y-2">
                    <Truck className="h-12 w-12 mx-auto text-muted-foreground/60 mb-2" />
                    <p className="font-semibold text-lg text-foreground">No batches transferred yet</p>
                    <p className="text-sm text-muted-foreground">Package and transfer an active processing batch to generate its dispatch manifest here.</p>
                  </div>
                ) : (
                  <div className="grid gap-6">
                    {Object.values(batches).filter(b => b.stage === "Transferred" || b.stageLogs.some(l => l.stage === "Transferred")).map(b => {
                      const originalId = (b.originalProduct.product_id && b.originalProduct.product_id >= 100000 && b.originalProduct.product_id <= 999999)
                        ? b.originalProduct.product_id
                        : 100000 + (Math.abs(Number(b.originalProduct.product_id || 0)) % 899999)
                      const receivedWeight = receipts[b.originalProduct.id]?.receivedQty || b.originalProduct.quantity

                      return (
                        <div key={b.batchId} className="p-6 rounded-3xl border bg-card/60 hover:bg-card/90 transition-all space-y-5 shadow-sm">
                          {/* Top Row: Batch Identity & Status */}
                          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 border-b pb-4">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-mono font-bold px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                  Batch {b.batchId}
                                </span>
                                <span className="text-xs font-mono px-2.5 py-1 rounded-full bg-muted text-muted-foreground">
                                  Farm Origin: FP-{originalId}
                                </span>
                              </div>
                              <h4 className="font-bold text-xl text-foreground flex items-center gap-2 pt-1">
                                {b.originalProduct.name.includes("Tomato") ? "🍅" : b.originalProduct.name.includes("Mango") ? "🥭" : b.originalProduct.name.includes("Wheat") ? "🌾" : "🌱"}
                                {b.originalProduct.name}
                              </h4>
                            </div>
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                              <Truck className="h-3.5 w-3.5" />
                              Dispatched to Distributor (In Transit)
                            </span>
                          </div>

                          {/* 4-Grid Key Logistics Details */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                            {/* Processed Quantity */}
                            <div className="p-3.5 rounded-2xl bg-muted/30 border space-y-1">
                              <span className="text-[10px] text-muted-foreground uppercase font-bold flex items-center gap-1">
                                📦 Processed Quantity
                              </span>
                              <p className="font-bold text-sm text-foreground">{b.processedQuantity || receivedWeight} kg</p>
                              <p className="text-[11px] text-emerald-400 font-medium">Output Packaged Produce</p>
                            </div>

                            {/* Estimated Shelf Life */}
                            <div className="p-3.5 rounded-2xl bg-muted/30 border space-y-1">
                              <span className="text-[10px] text-muted-foreground uppercase font-bold flex items-center gap-1">
                                ⏳ Estimated Shelf Life
                              </span>
                              <p className="font-bold text-sm text-foreground">{b.expiryDate || (b.estimatedShelfLifeDays ? `${b.estimatedShelfLifeDays} Days` : "14 Days")}</p>
                              <p className="text-[11px] text-muted-foreground">{b.expiryDate ? `~${b.estimatedShelfLifeDays || 14} Days Certified` : "Certified Shelf Life"}</p>
                            </div>

                            {/* Certified Quality & Grade */}
                            <div className="p-3.5 rounded-2xl bg-muted/30 border space-y-1">
                              <span className="text-[10px] text-muted-foreground uppercase font-bold flex items-center gap-1">
                                🏅 Certified Quality & Grade
                              </span>
                              <p className="font-semibold text-emerald-400">
                                {b.originalProduct.ai_quality_label || "Grade A"} ({b.originalProduct.ai_quality_score || 90}% Score)
                              </p>
                              <p className="text-[11px] text-muted-foreground">Gate Physical Inspection</p>
                            </div>

                            {/* Processing Completion Timestamp */}
                            <div className="p-3.5 rounded-2xl bg-muted/30 border space-y-1">
                              <span className="text-[10px] text-muted-foreground uppercase font-bold flex items-center gap-1">
                                🕒 Processing Completed
                              </span>
                              <p className="font-semibold text-foreground">
                                {b.completionDate || b.transferDate || b.createdDate} • {b.completionTime || b.transferTime || b.createdTime}
                              </p>
                              <p className="text-[11px] text-emerald-400 font-medium">Recorded on Blockchain</p>
                            </div>
                          </div>

                          {/* Footer Actions & Blockchain Verification */}
                          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pt-2 border-t text-xs">
                            <div className="flex items-center gap-2 text-emerald-400 font-medium">
                              <ShieldCheck className="h-4 w-4 shrink-0" />
                              <span>Chain-of-custody transfer signed and verified on blockchain ledger.</span>
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setQrViewBatch(b)}
                              className="rounded-xl text-xs gap-1.5 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 hover:border-emerald-500"
                            >
                              <QrCode className="h-3.5 w-3.5" />
                              View Batch QR Sticker
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>
      )}

      {activeTab === "history" && (
        <div className="grid gap-6 lg:grid-cols-4">
          {/* History categories side bar */}
          <Card className="col-span-1 rounded-3xl border shadow-sm p-4 h-fit space-y-2">
            <h3 className="font-bold text-lg px-2 mb-3">Logs & Audit</h3>
            <p className="text-xs text-muted-foreground px-2 pb-4 border-b">Track chronological processor logs and blockchain timestamps.</p>
            <div className="flex flex-col gap-2 pt-2">
              <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider px-2">Operational Categories</span>
              <div className="text-xs text-foreground space-y-2.5 px-2 mt-2">
                <div className="flex justify-between"><span>★ Interested:</span> <strong className="text-primary">{interests.length}</strong></div>
                <div className="flex justify-between"><span>📥 Received:</span> <strong className="text-primary">{Object.keys(receipts).length}</strong></div>
                <div className="flex justify-between"><span>✅ Accepted:</span> <strong className="text-primary">{Object.values(decisions).filter(d => d.decision === "Accepted").length}</strong></div>
                <div className="flex justify-between"><span>❌ Rejected:</span> <strong className="text-red-500">{Object.values(decisions).filter(d => d.decision === "Rejected").length}</strong></div>
                <div className="flex justify-between"><span>🏭 Processing:</span> <strong className="text-primary">{Object.keys(batches).length}</strong></div>
                <div className="flex justify-between"><span>🚚 Transferred:</span> <strong className="text-primary">{Object.values(batches).filter(b => b.stageLogs.some(log => log.stage === "Transferred")).length}</strong></div>
              </div>
            </div>
          </Card>

          {/* Audit trail list */}
          <Card className="col-span-3 rounded-3xl border shadow-sm p-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between border-b pb-4 mb-6 gap-3">
              <div>
                <h3 className="text-xl font-bold text-foreground">
                  {historySubTab === "audit" ? "Chronological Audit Trail" : "Transfer & History Records"}
                </h3>
                <p className="text-muted-foreground text-sm">
                  {historySubTab === "audit"
                    ? "Immutable operations trace recording Date, Time, User, Action and status updates."
                    : "Listing of all finalized agricultural batches transferred to cold chain distributors."}
                </p>
              </div>
              <div className="flex gap-1.5 bg-muted p-1 rounded-xl w-fit">
                <button
                  onClick={() => setHistorySubTab("audit")}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${historySubTab === "audit"
                      ? "bg-white text-primary shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                    }`}
                >
                  Audit Trail
                </button>
                <button
                  onClick={() => setHistorySubTab("transferred")}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${historySubTab === "transferred"
                      ? "bg-white text-primary shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                    }`}
                >
                  Transferred Batches
                </button>
              </div>
            </div>

            {historySubTab === "audit" ? (
              auditLogs.length === 0 ? (
                <div className="text-center py-20 text-muted-foreground">
                  <Clock className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                  <p className="font-semibold text-lg">No operational logs recorded</p>
                  <p className="text-sm">Perform actions in browse or pipeline tabs to view audit logs.</p>
                </div>
              ) : (
                <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2">
                  {auditLogs.map((log) => (
                    <div key={log.id} className="p-4 rounded-2xl border bg-card/60 flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
                      <div className="space-y-1">
                        <p className="font-bold text-foreground text-sm flex items-center gap-1.5">
                          {log.action.includes("Received") ? "📥" : log.action.includes("Accepted") ? "✅" : log.action.includes("Rejected") ? "❌" : log.action.includes("Transferred") ? "🚚" : "★"}
                          {log.action}
                        </p>
                        <p className="text-xs text-muted-foreground">By: {log.user} {log.productId && `• Product ID: ${log.productId.slice(0, 8)}...`} {log.batchId && `• Batch ID: ${log.batchId}`}</p>
                      </div>
                      <div className="text-right">
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">{log.status}</span>
                        <p className="text-[10px] text-muted-foreground mt-1">{log.date} • {log.time}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : (
              Object.values(batches).filter(b => b.stage === "Transferred").length === 0 ? (
                <div className="text-center py-20 text-muted-foreground">
                  <Truck className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                  <p className="font-semibold text-lg">No transferred batches found</p>
                  <p className="text-sm">Distributor transfer records will appear here after shipment dispatch.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-muted text-muted-foreground font-bold">
                        <th className="py-3 px-2">Product Name</th>
                        <th className="py-3 px-2">Product ID</th>
                        <th className="py-3 px-2">Batch ID</th>
                        <th className="py-3 px-2">Distributor</th>
                        <th className="py-3 px-2">Transfer Status</th>
                        <th className="py-3 px-2 text-right">Date & Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-muted text-foreground">
                      {Object.values(batches).filter(b => b.stage === "Transferred").map(b => {
                        const originalId = (b.originalProduct.product_id && b.originalProduct.product_id >= 100000 && b.originalProduct.product_id <= 999999)
                          ? b.originalProduct.product_id
                          : 100000 + (Math.abs(Number(b.originalProduct.product_id || 0)) % 899999)
                        return (
                          <tr key={b.batchId} className="hover:bg-muted/10">
                            <td className="py-3.5 px-2 font-semibold flex items-center gap-1.5">
                              {b.originalProduct.name.includes("Tomato") ? "🍅" : b.originalProduct.name.includes("Mango") ? "🥭" : "🌱"}
                              {b.originalProduct.name}
                            </td>
                            <td className="py-3.5 px-2 font-mono text-muted-foreground">FP-{originalId}</td>
                            <td className="py-3.5 px-2 font-mono text-blue-600 font-semibold">{b.batchId}</td>
                            <td className="py-3.5 px-2 font-medium">{b.distributor || "XYZ Logistics"}</td>
                            <td className="py-3.5 px-2">
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 border border-emerald-500/25">
                                In Transit
                              </span>
                            </td>
                            <td className="py-3.5 px-2 text-right text-muted-foreground">
                              <div>{b.transferDate || b.createdDate}</div>
                              <div className="text-[10px]">{b.transferTime || b.createdTime}</div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </Card>
        </div>
      )}

      {/* MODAL: Receive Product Form */}
      {isReceiveModalOpen && selectedProduct && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="max-w-md w-full rounded-3xl border shadow-xl p-6 space-y-4 bg-zinc-900 border-zinc-800 text-white">
            <div className="flex justify-between items-start border-b border-zinc-800 pb-3">
              <h3 className="font-bold text-xl">Confirm Product Receipt</h3>
              <button onClick={() => { setIsReceiveModalOpen(false); setSelectedProduct(null); }} className="text-zinc-400 hover:text-white">✕</button>
            </div>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-zinc-400 uppercase font-bold">Product</p>
                <p className="text-base font-semibold">{selectedProduct.name}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-zinc-400 uppercase font-bold">Registered Qty</p>
                  <p className="text-base font-semibold text-emerald-400">{selectedProduct.quantity} kg</p>
                </div>
                <div>
                  <label className="text-xs text-zinc-400 uppercase font-bold">Received Qty (kg)</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={receivedQtyInput}
                    onChange={(e) => {
                      const val = e.target.value
                      if (val === "" || Number(val) >= 0) {
                        setReceivedQtyInput(val)
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "-" || e.key === "e") {
                        e.preventDefault()
                      }
                    }}
                    className="w-full bg-zinc-850 border border-zinc-700 rounded-xl px-3 py-2 mt-1 text-sm text-white focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    placeholder="Enter physical scale quantity"
                  />
                </div>
              </div>

              {/* Weight Shortage / Discrepancy Alert */}
              {Number(receivedQtyInput) > 0 && Number(receivedQtyInput) < selectedProduct.quantity && (
                <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-2xl space-y-2.5 text-xs">
                  <div className="flex items-start gap-2 text-amber-400 font-semibold">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>Weight Discrepancy Detected: {selectedProduct.quantity - Number(receivedQtyInput)} kg Shortage ({(((selectedProduct.quantity - Number(receivedQtyInput)) / selectedProduct.quantity) * 100).toFixed(0)}% vs Farm Origin)</span>
                  </div>
                  <div>
                    <label className="text-zinc-400 uppercase text-[10px] font-bold">Observed Transit Loss Reason</label>
                    <select
                      value={transitLossReasonInput}
                      onChange={(e) => setTransitLossReasonInput(e.target.value)}
                      className="w-full bg-zinc-850 border border-zinc-700 rounded-xl px-3 py-2 mt-1 text-xs text-white focus:outline-none"
                    >
                      <option value="Transit Spoilage / Physical Damage on Route">Transit Spoilage / Physical Damage on Route</option>
                      <option value="Partial / Split Truck Delivery">Partial / Split Truck Delivery</option>
                      <option value="Natural Moisture Evaporation / Shrinkage">Natural Moisture Evaporation / Shrinkage</option>
                      <option value="Short Shipment / Missing Crates">Short Shipment / Missing Crates</option>
                      <option value="Weighbridge Scale Recalibration">Weighbridge Scale Recalibration</option>
                    </select>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-zinc-400 uppercase font-bold">Arrival Date</label>
                  <input
                    type="date"
                    value={arrivalDateInput}
                    onChange={(e) => setArrivalDateInput(e.target.value)}
                    className="w-full bg-zinc-850 border border-zinc-700 rounded-xl px-3 py-2 mt-1 text-xs text-white focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs text-zinc-400 uppercase font-bold">Arrival Time</label>
                  <input
                    type="time"
                    value={arrivalTimeInput}
                    onChange={(e) => setArrivalTimeInput(e.target.value)}
                    className="w-full bg-zinc-850 border border-zinc-700 rounded-xl px-3 py-2 mt-1 text-xs text-white focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <p className="text-xs text-zinc-400 uppercase font-bold">Received By</p>
                <p className="text-sm font-semibold">{processorName}</p>
              </div>
            </div>
            <div className="flex gap-2 pt-4">
              <Button
                variant="outline"
                onClick={() => { setIsReceiveModalOpen(false); setSelectedProduct(null); }}
                className="flex-1 rounded-xl border-zinc-700 text-zinc-300 hover:text-white"
              >
                Cancel
              </Button>
              <Button
                onClick={handleReceiveProduct}
                className="flex-1 rounded-xl bg-primary hover:bg-primary/95 text-white"
              >
                Confirm Receipt
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* MODAL: Verify QR & Physical Quality Inspection Form */}
      {isVerifyModalOpen && selectedProduct && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <Card className="max-w-2xl w-full max-h-[92vh] flex flex-col rounded-3xl border shadow-2xl p-0 bg-zinc-900 border-zinc-800 text-white my-auto overflow-hidden">
            <div className="flex justify-between items-start border-b border-zinc-800 p-6 pb-4 shrink-0 bg-zinc-900 z-10">
              <div>
                <h3 className="font-bold text-xl text-white">Scan QR & Verify Yield</h3>
                <p className="text-xs text-zinc-400">Product: <span className="text-white font-semibold">{selectedProduct.name}</span> • Registered: <span className="text-white font-semibold">{selectedProduct.quantity} kg</span></p>
              </div>
              <button
                onClick={closeVerifyModal}
                className="flex items-center justify-center p-2 rounded-full bg-zinc-800 text-zinc-200 hover:text-white hover:bg-zinc-700 border border-zinc-700 transition-all shadow-md shrink-0 cursor-pointer"
                title="Close / Cancel"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-6 overflow-y-auto flex-1">
              {/* CAMERA / QR SCANNER VIEW */}
              {!qrScanned ? (
                <div className="space-y-4">
                  <div className="relative w-full max-w-sm aspect-square mx-auto rounded-3xl border-2 border-dashed border-zinc-700 bg-black overflow-hidden flex flex-col items-center justify-center shadow-inner">
                    {/* Container for html5-qrcode video element */}
                    <div id="live-qr-reader" className="w-full h-full" />

                    {!cameraActive && !qrScanning && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center space-y-3 bg-zinc-950/90 z-10">
                        <div className="p-4 rounded-full bg-primary/10 border border-primary/20 text-primary">
                          <Camera className="h-8 w-8" />
                        </div>
                        <div>
                          <p className="font-bold text-sm text-foreground">Live Optical QR Scanner</p>
                          <p className="text-xs text-zinc-400 mt-1 max-w-[240px]">
                            Hold up the printed product QR sticker or display it on a phone.
                          </p>
                        </div>
                      </div>
                    )}

                    {qrScanning && (
                      <div className="absolute inset-x-0 h-1 bg-gradient-to-r from-transparent via-emerald-400 to-transparent animate-pulse top-1/2 shadow-lg shadow-emerald-500/50 z-20" />
                    )}
                  </div>

                  {cameraError && (
                    <div className="p-3.5 bg-red-500/15 border border-red-500/30 rounded-2xl flex items-start gap-2.5 text-xs text-red-400">
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>{cameraError}</span>
                    </div>
                  )}

                  {/* SCAN CONTROLS */}
                  <div className="flex flex-col gap-2 pt-1 max-w-sm mx-auto">
                    {cameraActive ? (
                      <Button
                        onClick={stopLiveCamera}
                        variant="outline"
                        className="w-full rounded-xl border-red-500/40 text-red-400 hover:bg-red-500/10 gap-2"
                      >
                        <VideoOff className="h-4 w-4" />
                        Stop Camera Scanner
                      </Button>
                    ) : (
                      <Button
                        onClick={startLiveCamera}
                        className="w-full rounded-xl bg-primary hover:bg-primary/95 text-white font-semibold gap-2 shadow-md"
                      >
                        <Video className="h-4 w-4" />
                        📷 Open Live Camera Scanner
                      </Button>
                    )}

                    <div>
                      <input
                        type="file"
                        ref={fileInputRef}
                        accept="image/*"
                        className="hidden"
                        onChange={handleQrFileUpload}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full rounded-xl text-xs gap-2 border-zinc-700 hover:bg-zinc-800 text-zinc-200 py-2.5"
                      >
                        <Upload className="h-4 w-4 text-primary" />
                        📁 Upload & Verify QR Image File
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* QR VERIFICATION DETAILS */}
                  <div className="p-4 rounded-2xl bg-zinc-950 border border-zinc-800 space-y-3">
                    <div className="flex justify-between items-center pb-2 border-b border-zinc-900">
                      <span className="text-xs font-bold text-zinc-400 uppercase">QR Verification Metadata</span>
                      <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 flex items-center gap-1">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        Blockchain: Verified
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-4 text-xs">
                      <div><span className="text-zinc-400">Product:</span> <strong className="text-emerald-400 font-semibold ml-1">{selectedProduct.name}</strong></div>
                      <div><span className="text-zinc-400">Product ID:</span> <strong className="text-emerald-400 font-mono font-semibold ml-1">FP-{(selectedProduct.product_id && selectedProduct.product_id >= 100000 && selectedProduct.product_id <= 999999) ? selectedProduct.product_id : 100000 + (Math.abs(Number(selectedProduct.product_id || 0)) % 899999)}</strong></div>
                      <div><span className="text-zinc-400">Farmer:</span> <strong className="text-emerald-400 font-semibold ml-1">{selectedProduct.farmer?.name || "Ravi"}</strong></div>
                      <div><span className="text-zinc-400">Location:</span> <strong className="text-emerald-400 font-semibold ml-1">{getFarmerLocation(selectedProduct)}</strong></div>
                      <div><span className="text-zinc-400">Quantity:</span> <strong className="text-emerald-400 font-semibold ml-1">{selectedProduct.quantity} kg</strong></div>
                      <div><span className="text-zinc-400">Harvest Date:</span> <strong className="text-emerald-400 font-semibold ml-1">{new Date(selectedProduct.created_at).toLocaleDateString()}</strong></div>
                    </div>
                    {scannedRawText && (
                      <div className="pt-2 border-t border-zinc-900 text-[11px] text-zinc-300 break-all font-mono">
                        <span className="text-emerald-400 font-bold">Decoded Optical QR:</span> {scannedRawText}
                      </div>
                    )}
                  </div>

                  {/* AUTOMATIC BLOCKCHAIN VERIFICATION CONFIRMATION */}
                  <div className="space-y-3">
                    <h4 className="font-bold text-sm text-zinc-300">1. Verification Status</h4>
                    <div className="p-3.5 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <ShieldCheck className="h-5 w-5 text-emerald-400 shrink-0" />
                        <div>
                          <p className="text-xs font-bold text-emerald-400">Blockchain Cryptographic Match Confirmed</p>
                          <p className="text-[11px] text-zinc-300">Produce batch authenticity verified against farmer on-chain record.</p>
                        </div>
                      </div>
                      <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 font-bold text-xs border border-emerald-500/40 shrink-0">
                        Verified ✓
                      </span>
                    </div>
                  </div>

                  {/* 2. PHYSICAL DOCK SCALE WEIGHING & SHORTAGE VERIFICATION */}
                  <div className="space-y-3 border-t border-zinc-800 pt-4">
                    <div className="flex justify-between items-center">
                      <h4 className="font-bold text-sm text-zinc-300 flex items-center gap-1.5">
                        <Scale className="h-4 w-4 text-emerald-400" />
                        2. Physical Scale Weight Verification
                      </h4>
                      <span className="text-[11px] text-zinc-400">
                        Origin Farm Weight: <strong className="text-emerald-400">{selectedProduct.quantity} kg</strong>
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs text-zinc-400 uppercase font-bold">Origin Registered Qty</label>
                        <div className="p-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm font-semibold text-emerald-400 mt-1">
                          {selectedProduct.quantity} kg
                        </div>
                      </div>
                      <div>
                        <label className="text-xs text-zinc-400 uppercase font-bold">Actual Scale Weighed (kg)</label>
                        <input
                          type="number"
                          min="0"
                          max={selectedProduct.quantity}
                          step="any"
                          value={receivedQtyInput}
                          onChange={(e) => {
                            const val = e.target.value
                            if (val === "") {
                              setReceivedQtyInput("")
                            } else {
                              const num = Number(val)
                              if (num >= 0 && num <= selectedProduct.quantity) {
                                setReceivedQtyInput(val)
                              } else if (num > selectedProduct.quantity) {
                                setReceivedQtyInput(String(selectedProduct.quantity))
                              }
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "-" || e.key === "e") {
                              e.preventDefault()
                            }
                          }}
                          placeholder={`Enter scale weight (e.g. ${selectedProduct.quantity})`}
                          className="w-full bg-zinc-850 border border-zinc-700 rounded-xl px-3 py-2 mt-1 text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                      </div>
                    </div>

                    {/* Weight Shortage Live Notice (Produce can still be accepted) */}
                    {(() => {
                      const scaleWeight = Number(receivedQtyInput)
                      const originWeight = selectedProduct.quantity
                      const hasShortage = scaleWeight > 0 && scaleWeight < originWeight
                      if (!hasShortage) return null

                      const diffAmount = Math.abs(originWeight - scaleWeight)
                      const diffPercent = originWeight > 0 ? ((diffAmount / originWeight) * 100).toFixed(0) : "0"

                      return (
                        <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-2xl space-y-1.5 text-xs">
                          <div className="flex items-start gap-2.5 text-amber-400 font-semibold">
                            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-400" />
                            <div>
                              <p className="font-bold text-sm text-amber-300">
                                ⚠️ Scale Weight Shortage: {diffAmount} kg Shortage ({diffPercent}% vs Registered {originWeight} kg)
                              </p>
                              <p className="text-zinc-300 font-normal mt-0.5 text-[11px]">
                                Actual scale weight ({scaleWeight} kg) is less than origin registered quantity ({originWeight} kg). Produce can still be inspected and accepted with actual weighed quantity.
                              </p>
                            </div>
                          </div>
                        </div>
                      )
                    })()}
                  </div>

                  {/* 3. PHYSICAL QUALITY INSPECTION FORM */}
                  <div className="space-y-4 border-t border-zinc-800 pt-4">
                    <h4 className="font-bold text-sm text-zinc-300">3. Physical Quality Inspection</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs text-zinc-400">Appearance</label>
                        <select value={appearanceInput} onChange={(e) => handlePhysicalParamChange("appearance", e.target.value)} className="w-full bg-zinc-850 border border-zinc-700 rounded-xl px-3 py-2 text-sm mt-1 focus:outline-none text-white">
                          <option>Good</option>
                          <option>Excellent</option>
                          <option>Average</option>
                          <option>Poor</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-zinc-400">Freshness</label>
                        <select value={freshnessInput} onChange={(e) => handlePhysicalParamChange("freshness", e.target.value)} className="w-full bg-zinc-850 border border-zinc-700 rounded-xl px-3 py-2 text-sm mt-1 focus:outline-none text-white">
                          <option>Excellent</option>
                          <option>Good</option>
                          <option>Average</option>
                          <option>Stale</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-zinc-400">Damage</label>
                        <select value={damageInput} onChange={(e) => handlePhysicalParamChange("damage", e.target.value)} className="w-full bg-zinc-850 border border-zinc-700 rounded-xl px-3 py-2 text-sm mt-1 focus:outline-none text-white">
                          <option>Low</option>
                          <option>Medium</option>
                          <option>High</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-zinc-400">Cleanliness</label>
                        <select value={cleanlinessInput} onChange={(e) => handlePhysicalParamChange("cleanliness", e.target.value)} className="w-full bg-zinc-850 border border-zinc-700 rounded-xl px-3 py-2 text-sm mt-1 focus:outline-none text-white">
                          <option>Good</option>
                          <option>Excellent</option>
                          <option>Average</option>
                          <option>Poor</option>
                        </select>
                      </div>
                    </div>

                    {/* Live in-hand calculated score */}
                    <div className="p-3.5 bg-zinc-950 border border-zinc-800 rounded-2xl flex items-center justify-between">
                      <div>
                        <p className="text-xs text-zinc-400 font-medium">In-Hand Verified Quality Score</p>
                        <p className="text-[11px] text-zinc-500">Calculated from physical appearance, freshness, damage & cleanliness</p>
                      </div>
                      {(() => {
                        const score = computePhysicalQualityScore(appearanceInput, freshnessInput, cleanlinessInput, damageInput)
                        const grade = score >= 85 ? "A" : score >= 60 ? "B" : "C"
                        return (
                          <span className={`text-base font-bold px-3 py-1 rounded-xl border ${grade === "C"
                              ? "text-red-400 bg-red-500/10 border-red-500/30"
                              : "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                            }`}>
                            {score}% (Grade {grade})
                          </span>
                        )
                      })()}
                    </div>

                    {/* Quality Failure Alert Banner if Grade C (<60%) */}
                    {computePhysicalQualityScore(appearanceInput, freshnessInput, cleanlinessInput, damageInput) < 60 && (
                      <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-2xl space-y-1.5 text-xs">
                        <div className="flex items-start gap-2.5 text-red-400 font-semibold">
                          <AlertCircle className="h-5 w-5 shrink-0 mt-0.5 text-red-400" />
                          <div>
                            <p className="font-bold text-sm text-red-300">
                              Quality Standards Failed (Grade C · {computePhysicalQualityScore(appearanceInput, freshnessInput, cleanlinessInput, damageInput)}%)
                            </p>
                            <p className="text-zinc-300 font-normal mt-0.5 text-[11px]">
                              Physical quality parameters do not meet minimum processor intake specifications (60% / Grade B required). Accepting this batch on blockchain is restricted and produce delivery must be rejected.
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs text-zinc-400">Certified Quality Grade</label>
                        <div className="flex gap-2 mt-1">
                          {(["A", "B", "C"] as const).map(g => {
                            const computedScore = computePhysicalQualityScore(appearanceInput, freshnessInput, cleanlinessInput, damageInput)
                            const autoGrade = computedScore >= 85 ? "A" : computedScore >= 60 ? "B" : "C"
                            const isCurrentGrade = autoGrade === g
                            return (
                              <button
                                key={g}
                                type="button"
                                disabled={!isCurrentGrade}
                                className={`flex-1 py-2 rounded-xl font-bold border transition-all ${isCurrentGrade
                                    ? autoGrade === "C"
                                      ? "bg-red-500 border-red-500 text-white shadow-md cursor-default ring-2 ring-red-400/50"
                                      : "bg-emerald-500 border-emerald-500 text-white shadow-md cursor-default ring-2 ring-emerald-400/50"
                                    : "border-zinc-800/50 text-zinc-600 opacity-40 cursor-not-allowed bg-zinc-900"
                                  }`}
                              >
                                Grade {g}
                              </button>
                            )
                          })}
                        </div>
                        <p className="text-[10px] text-zinc-400 mt-1">
                          Auto-locked: Grade A (85-100%), Grade B (60-84%), Grade C (&lt;60%)
                        </p>
                      </div>
                      <div>
                        <label className="text-xs text-zinc-400 font-medium">
                          Remarks <span className="text-zinc-500 font-normal">(Optional)</span>
                        </label>
                        <input
                          type="text"
                          value={remarksInput}
                          onChange={(e) => setRemarksInput(e.target.value)}
                          placeholder="Enter remarks (optional) e.g. Batch verified, produce in good condition"
                          className="w-full bg-zinc-850 border border-zinc-700 rounded-xl px-3 py-2 text-sm mt-1 focus:outline-none text-white focus:ring-1 focus:ring-emerald-400"
                        />
                      </div>
                    </div>

                    {/* Physical Inspection Confirmation - Only displayed for Grade A or B (score >= 60) */}
                    {computePhysicalQualityScore(appearanceInput, freshnessInput, cleanlinessInput, damageInput) >= 60 && (
                      <label className={`flex items-center gap-3 p-3.5 rounded-2xl border transition-all cursor-pointer ${isInspectionConfirmed
                          ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-300"
                          : "bg-zinc-950 border-zinc-800 hover:border-zinc-700 text-zinc-400"
                        }`}>
                        <input
                          type="checkbox"
                          checked={isInspectionConfirmed}
                          onChange={(e) => setIsInspectionConfirmed(e.target.checked)}
                          className="h-4 w-4 rounded accent-primary cursor-pointer"
                        />
                        <span className="text-xs font-semibold">
                          I have physically inspected this produce and certify the verified Quality Score & Grade.
                        </span>
                      </label>
                    )}
                  </div>

                  {/* DECISION ACTION SUBMIT */}
                  <div className="flex flex-col gap-3 border-t border-zinc-800 pt-4">
                    {showRejectionForm ? (
                      <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-2xl space-y-3">
                        <label className="text-xs text-red-400 font-bold uppercase">Rejection Reason</label>
                        <select
                          value={rejectionReasonInput}
                          onChange={(e) => setRejectionReasonInput(e.target.value)}
                          className="w-full bg-zinc-850 border border-zinc-700 rounded-xl px-3 py-2 text-sm focus:outline-none text-white"
                        >
                          <option value="">Select reason</option>
                          <option value="Quality Standards Failed (Grade C / Spoiled)">Quality Standards Failed (Grade C / Spoiled)</option>
                          <option value="Severe Physical Damage">Severe Physical Damage</option>
                          <option value="Information mismatch">Information Mismatch</option>
                          <option value="Poor quality">Poor Quality</option>
                          <option value="Product not suitable for processing">Product not suitable for processing</option>
                        </select>
                        <div className="flex gap-2">
                          <Button
                            disabled={!rejectionReasonInput}
                            onClick={() => handleInspectionDecision("Rejected")}
                            className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl shadow-md cursor-pointer"
                          >
                            Confirm Rejection on Chain
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => setShowRejectionForm(false)}
                            className="rounded-xl text-zinc-400 cursor-pointer"
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : computePhysicalQualityScore(appearanceInput, freshnessInput, cleanlinessInput, damageInput) < 60 ? (
                      /* ONLY DISPLAY REJECT PRODUCT WHEN QUALITY STANDARDS FAIL (GRADE C) */
                      <div className="space-y-2">
                        <Button
                          onClick={() => {
                            const score = computePhysicalQualityScore(appearanceInput, freshnessInput, cleanlinessInput, damageInput)
                            setRejectionReasonInput(`Quality Standards Failed: Grade C produce (${score}%) does not meet intake quality specifications`)
                            setShowRejectionForm(true)
                          }}
                          className="w-full bg-red-600 hover:bg-red-700 text-white font-bold rounded-2xl py-3 text-sm shadow-lg gap-2 cursor-pointer"
                        >
                          ❌ Reject Product (Quality Standards Failed)
                        </Button>
                      </div>
                    ) : (
                      /* NORMAL VIEW: ACCEPT OR REJECT */
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          onClick={() => setShowRejectionForm(true)}
                          className="flex-1 rounded-xl border-red-500/30 text-red-500 hover:bg-red-500/10 hover:border-red-500 cursor-pointer"
                        >
                          ❌ Reject Product
                        </Button>
                        <Button
                          disabled={infoVerified !== "Verified" || !isInspectionConfirmed}
                          onClick={() => handleInspectionDecision("Accepted")}
                          className={`flex-1 rounded-xl text-white ${infoVerified === "Verified" && isInspectionConfirmed
                              ? "bg-emerald-600 hover:bg-emerald-700 font-bold shadow-md cursor-pointer"
                              : "bg-zinc-800 text-zinc-500 cursor-not-allowed opacity-50 font-medium"
                            }`}
                        >
                          ✅ Accept & Record on Chain
                        </Button>
                      </div>
                    )}

                    <Button
                      type="button"
                      variant="ghost"
                      onClick={closeVerifyModal}
                      className="w-full text-xs text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-xl mt-1 cursor-pointer"
                    >
                      Cancel & Close Verification
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* MODAL: View Details / AI Insights Modal */}
      {selectedProduct && !isReceiveModalOpen && !isVerifyModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <Card className="max-w-xl w-full rounded-3xl border shadow-xl p-6 bg-zinc-900 border-zinc-800 text-white space-y-5">
            <div className="flex justify-between items-start border-b border-zinc-800 pb-3">
              <div>
                <h3 className="font-bold text-xl">{selectedProduct.name} Detail Analysis</h3>
                <p className="text-xs text-zinc-400">Product Mapped ID: FP-{(selectedProduct.product_id && selectedProduct.product_id >= 100000 && selectedProduct.product_id <= 999999) ? selectedProduct.product_id : 100000 + (Math.abs(Number(selectedProduct.product_id || 0)) % 899999)}</p>
              </div>
              <button onClick={() => setSelectedProduct(null)} className="text-zinc-400 hover:text-white">✕</button>
            </div>

            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-xs text-zinc-400 uppercase font-bold">Category</span>
                  <p className="font-semibold text-emerald-400">{selectedProduct.category || "Produce"}</p>
                </div>
                <div>
                  <span className="text-xs text-zinc-400 uppercase font-bold">Quantity</span>
                  <p className="font-semibold text-emerald-400">{receipts[selectedProduct.id]?.receivedQty || selectedProduct.quantity} kg</p>
                </div>
                <div>
                  <span className="text-xs text-zinc-400 uppercase font-bold">Harvest Batch</span>
                  <p className="font-semibold font-mono text-xs text-emerald-400">{selectedProduct.batch_number || (selectedProduct as any).batchNumber || "BCH-20260903-RH59"}</p>
                </div>
                <div>
                  <span className="text-xs text-zinc-400 uppercase font-bold">Current Status</span>
                  <p className="font-semibold text-primary">{selectedProduct.status}</p>
                </div>
              </div>

              {/* Quality & Processing Status Box */}
              {(() => {
                const inspection = inspections[selectedProduct.id]
                const isInspected = Boolean(inspection || receipts[selectedProduct.id] || (selectedProduct.status !== "Harvested" && (selectedProduct.ai_quality_score || 0) > 0))
                const score = inspection ? computePhysicalQualityScore(inspection.appearance, inspection.freshness, inspection.cleanliness, inspection.damage) : (selectedProduct.ai_quality_score || 90)
                const grade = inspection?.grade || (score >= 85 ? "A" : score >= 60 ? "B" : "C")

                return (
                  <div className="p-4 bg-emerald-500/5 border border-emerald-500/15 rounded-2xl space-y-3">
                    <h4 className="font-bold text-sm flex items-center gap-1.5 text-emerald-400">
                      <Brain className="h-4 w-4" />
                      Quality & Processing Status
                    </h4>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <span className="text-zinc-400">Quality Assessment:</span>{" "}
                        {isInspected ? (
                          <strong className="text-emerald-400 font-semibold">{score}% (Grade {grade}) - Verified ✓</strong>
                        ) : (
                          <strong className="text-amber-400">Pending Physical Inspection</strong>
                        )}
                      </div>
                      <div>
                        <span className="text-zinc-400">Grading Facility:</span>{" "}
                        <strong className="text-emerald-400 font-semibold">{processorName}</strong>
                      </div>
                      <div>
                        <span className="text-zinc-400">Inspection Method:</span>{" "}
                        <strong className="text-emerald-400 font-semibold">In-Hand Physical Verification</strong>
                      </div>
                      <div>
                        <span className="text-zinc-400">Grade Ranges:</span>{" "}
                        <strong className="text-emerald-400 font-semibold">Grade A (85-100%), B (60-84%), C (&lt;60%)</strong>
                      </div>
                    </div>

                    {isInspected && inspection && (
                      <div className="border-t border-zinc-800 pt-2.5 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                        <div><span className="text-zinc-400">Appearance:</span> <strong className="text-emerald-400 ml-1">{inspection.appearance}</strong></div>
                        <div><span className="text-zinc-400">Freshness:</span> <strong className="text-emerald-400 ml-1">{inspection.freshness}</strong></div>
                        <div><span className="text-zinc-400">Damage:</span> <strong className="text-emerald-400 ml-1">{inspection.damage}</strong></div>
                        <div><span className="text-zinc-400">Cleanliness:</span> <strong className="text-emerald-400 ml-1">{inspection.cleanliness}</strong></div>
                      </div>
                    )}

                    <div className="border-t border-zinc-800 pt-2 text-xs text-zinc-400">
                      <span className="text-emerald-400 font-bold">Processor workflow:</span> {isInspected ? "Physical quality parameters verified and registered on blockchain." : "Physical quality score and certified grade are verified upon QR scan and batch receipt."}
                    </div>
                  </div>
                )
              })()}

              {/* Blockchain Transaction Hash */}
              <div>
                <span className="text-xs text-zinc-400 uppercase font-bold">Blockchain Authenticity Certificate</span>
                <p className="font-mono text-xs text-emerald-400 break-all p-3 bg-zinc-950 border border-zinc-850 rounded-2xl mt-1">
                  {selectedProduct.blockchain_hash || "0x6f3e5c9b74d28a10e75a3429bc0194857dfbc8e0d9b41a73cf82a0b12cd504fa"}
                </p>
              </div>
            </div>

            <div className="flex pt-4">
              <Button onClick={() => setSelectedProduct(null)} className="w-full rounded-xl bg-zinc-800 text-white hover:bg-zinc-700">
                Close Report
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* MODAL: Batch QR Code View / Print Sticker */}
      {qrViewBatch && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="max-w-sm w-full rounded-3xl border shadow-2xl p-6 bg-zinc-900 border-zinc-800 text-white space-y-5 text-center">
            <div className="flex justify-between items-center border-b border-zinc-800 pb-3">
              <h3 className="font-bold text-lg flex items-center gap-2 text-primary">
                <QrCode className="h-5 w-5" />
                Batch QR Certificate
              </h3>
              <button onClick={() => setQrViewBatch(null)} className="text-zinc-400 hover:text-white">✕</button>
            </div>

            {/* Offscreen Canvas used for high-res crisp PNG export */}
            <div style={{ position: "fixed", left: "-9999px", top: "-9999px", pointerEvents: "none" }}>
              <QRCodeCanvas
                id="processor-batch-qr-canvas"
                value={`${window.location.origin}/tracker?id=${qrViewBatch.originalProduct.id}`}
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
                value={`${window.location.origin}/tracker?id=${qrViewBatch.originalProduct.id}`}
                size={180}
                level="H"
                includeMargin={true}
              />
            </div>

            <div className="space-y-1 text-xs text-left bg-zinc-950 p-3.5 rounded-2xl border border-zinc-850">
              <p className="font-bold text-sm text-foreground">{qrViewBatch.originalProduct.name}</p>
              <p className="text-zinc-400 font-mono">Batch ID: <span className="text-blue-400 font-semibold">{qrViewBatch.batchId}</span></p>
              <p className="text-zinc-400">Certified Grade: <span className="text-emerald-400 font-bold">{qrViewBatch.originalProduct.ai_quality_label || "Grade A"} ({qrViewBatch.originalProduct.ai_quality_score || 90}%)</span></p>
              <p className="text-zinc-400">Processor: <span className="text-zinc-200">{processorName} • {processorAddress}</span></p>
            </div>

            <div className="flex flex-col gap-2 pt-1">
              <Button
                className="w-full rounded-xl text-xs gap-1.5 bg-primary hover:bg-primary/95 text-white font-semibold"
                onClick={() => {
                  const canvas = document.getElementById("processor-batch-qr-canvas") as HTMLCanvasElement
                  if (!canvas) return
                  const pngUrl = canvas.toDataURL("image/png")
                  const downloadLink = document.createElement("a")
                  downloadLink.href = pngUrl
                  downloadLink.download = `Batch_${qrViewBatch.batchId}_${qrViewBatch.originalProduct.name.replace(/\s+/g, '_')}_QR.png`
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
                  className="flex-1 rounded-xl text-xs gap-1.5 border-zinc-700 hover:bg-zinc-800"
                  onClick={() => window.print()}
                >
                  <Printer className="h-3.5 w-3.5" /> Print
                </Button>
                <Button
                  variant="ghost"
                  className="flex-1 rounded-xl text-xs text-zinc-400 hover:text-white"
                  onClick={() => setQrViewBatch(null)}
                >
                  Close
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* MODAL: Processing Completion & Certification Modal */}
      {processingModalBatch && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <Card className="max-w-lg w-full rounded-3xl border shadow-2xl p-6 bg-zinc-900 border-zinc-800 text-white space-y-5 my-auto">
            <div className="flex justify-between items-start border-b border-zinc-800 pb-3">
              <div>
                <h3 className="font-bold text-xl text-white flex items-center gap-2">
                  <Package className="h-5 w-5 text-emerald-400" />
                  Processing Completion & Certification
                </h3>
                <p className="text-xs text-zinc-400">
                  Batch: <span className="text-emerald-400 font-mono font-semibold">{processingModalBatch.batchId}</span> • Product: <span className="text-emerald-400 font-semibold">{processingModalBatch.originalProduct.name}</span>
                </p>
              </div>
              <button
                onClick={() => setProcessingModalBatch(null)}
                className="flex items-center justify-center p-2 rounded-full bg-zinc-800 text-zinc-200 hover:text-white hover:bg-zinc-700 border border-zinc-700 transition-all shadow-md shrink-0 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {(() => {
              const verifiedQty = receipts[processingModalBatch.originalProduct.id]?.receivedQty || processingModalBatch.originalProduct.quantity || 100
              const now = new Date()
              const formattedDate = now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
              const formattedTime = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })

              return (
                <>
                  <div className="p-4 rounded-2xl bg-zinc-950 border border-zinc-800 grid grid-cols-2 gap-3 text-xs">
                    <div><span className="text-zinc-400">Produce:</span> <strong className="text-emerald-400 font-semibold ml-1">{processingModalBatch.originalProduct.name}</strong></div>
                    <div><span className="text-zinc-400">Intake Scale Weight:</span> <strong className="text-emerald-400 font-semibold ml-1">{verifiedQty} kg</strong></div>
                    <div><span className="text-zinc-400">Certified Quality:</span> <strong className="text-emerald-400 font-semibold ml-1">{processingModalBatch.originalProduct.ai_quality_score || 90}% ({processingModalBatch.originalProduct.ai_quality_label || "Grade A"})</strong></div>
                    <div><span className="text-zinc-400">Farmer Origin:</span> <strong className="text-emerald-400 font-semibold ml-1">{processingModalBatch.originalProduct.farmer?.name || "Ravi"}</strong></div>
                  </div>

                  <div className="space-y-4 text-sm">
                    {/* 1. PROCESSED QUANTITY (KG) */}
                    <div>
                      <label className="text-xs text-zinc-400 uppercase font-bold">Processed Quantity (kg)</label>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={processedQtyInput}
                        onChange={(e) => {
                          const val = e.target.value
                          if (val === "" || Number(val) >= 0) {
                            setProcessedQtyInput(val)
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "-" || e.key === "e") e.preventDefault()
                        }}
                        placeholder={`e.g. ${verifiedQty}`}
                        className="w-full bg-zinc-850 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm mt-1 text-white focus:outline-none focus:ring-1 focus:ring-emerald-400 font-medium [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                    </div>

                    {/* 2. ESTIMATED SHELF LIFE (DD-MM-YYYY) */}
                    <div>
                      <div className="flex items-center justify-between">
                        <label className="text-xs text-zinc-400 uppercase font-bold">Estimated shelf life</label>
                        <span className="text-xs font-mono font-bold text-emerald-400">
                          {formatToDdMmYyyy(estimatedShelfLifeInput) || "dd-mm-yyyy"}
                        </span>
                      </div>
                      <input
                        type="date"
                        min={new Date().toISOString().split("T")[0]}
                        value={estimatedShelfLifeInput}
                        onChange={(e) => setEstimatedShelfLifeInput(e.target.value)}
                        className="w-full bg-zinc-850 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm mt-1 text-white focus:outline-none focus:ring-1 focus:ring-emerald-400 font-medium cursor-pointer"
                      />
                      <div className="flex justify-between items-center mt-1 text-[11px] text-zinc-400">
                        <span>Format: <strong className="text-zinc-300 font-mono">dd-mm-yyyy</strong></span>
                        {estimatedShelfLifeInput && (
                          <span className="text-emerald-400 font-medium">
                            (~{computeShelfLifeDays(estimatedShelfLifeInput)} days shelf life)
                          </span>
                        )}
                      </div>
                    </div>

                    {/* 3. PROCESSING COMPLETION DATE & TIME (AUTOMATIC) */}
                    <div className="p-3.5 bg-zinc-950 border border-zinc-800 rounded-2xl flex items-center justify-between">
                      <div className="flex items-center gap-2.5 text-zinc-300">
                        <Clock className="h-4 w-4 text-emerald-400 shrink-0" />
                        <div>
                          <p className="text-[11px] text-zinc-400 uppercase font-bold">Processing Completion Timestamp</p>
                          <p className="text-xs font-semibold text-emerald-400">{formattedDate} • {formattedTime} (Auto-recorded)</p>
                        </div>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        Live Clock ✓
                      </span>
                    </div>

                    <div className="flex gap-2 pt-2">
                      <Button
                        variant="outline"
                        onClick={() => setProcessingModalBatch(null)}
                        className="flex-1 rounded-xl border-zinc-700 text-zinc-300 hover:text-white"
                      >
                        Cancel
                      </Button>
                      <Button
                        disabled={!processedQtyInput || Number(processedQtyInput) <= 0 || !estimatedShelfLifeInput}
                        onClick={async () => {
                          await handleCompleteProcessing(
                            processingModalBatch.batchId,
                            Number(processedQtyInput),
                            estimatedShelfLifeInput
                          )
                        }}
                        className="flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold gap-1.5 shadow-md disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                      >
                        <CheckCircle className="h-4 w-4" />
                        Complete Processing & Record on Chain
                      </Button>
                    </div>
                  </div>
                </>
              )
            })()}
          </Card>
        </div>
      )}
    </div>
  )
}
import { useState, useEffect, type FormEvent } from "react"
import axios from "axios"
import {
  Thermometer,
  AlertTriangle,
  CheckCircle,
  Clock,
  ShieldAlert,
  History,
  Sliders,
  Plus,
  X,
  RefreshCw,
  Check,
  AlertCircle
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../ui/Card"
import { Button } from "../ui/Button"

const API_URL = import.meta.env.VITE_API_URL || "https://farm-to-fork-tracker.onrender.com/api"

interface ColdChainMonitoringProps {
  token: string | null
  outgoingShipments: any[]
  onRefreshRequired?: () => void
}

export function ColdChainMonitoring({ token, outgoingShipments, onRefreshRequired }: ColdChainMonitoringProps) {
  const [alerts, setAlerts] = useState<any[]>([])
  const [thresholds, setThresholds] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  // Active filter
  const [statusFilter, setStatusFilter] = useState<string>("ALL")

  // Record Reading Modal State
  const [showRecordModal, setShowRecordModal] = useState(false)
  const [selectedShipmentId, setSelectedShipmentId] = useState("")
  const [tempInput, setTempInput] = useState("")
  const [humidityInput, setHumidityInput] = useState("")
  const [sourceInput, setSourceInput] = useState("MANUAL_ENTRY")
  const [notesInput, setNotesInput] = useState("")
  const [measuredAtInput, setMeasuredAtInput] = useState("")
  const [submittingReading, setSubmittingReading] = useState(false)
  const [recordError, setRecordError] = useState("")
  const [recordSuccess, setRecordSuccess] = useState("")

  // History Modal State
  const [historyModalShipment, setHistoryModalShipment] = useState<any>(null)
  const [historyData, setHistoryData] = useState<any>(null)
  const [loadingHistory, setLoadingHistory] = useState(false)

  // Thresholds Config Modal State
  const [showThresholdsModal, setShowThresholdsModal] = useState(false)
  const [editingCategory, setEditingCategory] = useState<string | null>(null)
  const [editMinTemp, setEditMinTemp] = useState("")
  const [editMaxTemp, setEditMaxTemp] = useState("")
  const [editMinHumidity, setEditMinHumidity] = useState("")
  const [editMaxHumidity, setEditMaxHumidity] = useState("")
  const [savingThreshold, setSavingThreshold] = useState(false)
  const [thresholdError, setThresholdError] = useState("")
  const [thresholdSuccess, setThresholdSuccess] = useState("")

  // Alert Action State
  const [actionAlert, setActionAlert] = useState<any>(null)
  const [actionType, setActionType] = useState<"ACKNOWLEDGE" | "RESOLVE" | null>(null)
  const [actionNotes, setActionNotes] = useState("")
  const [actionSubmitting, setActionSubmitting] = useState(false)
  const [actionError, setActionError] = useState("")

  const headers = { Authorization: `Bearer ${token}` }

  const fetchData = async () => {
    if (!token) return
    setLoading(true)
    setError("")
    try {
      const [alertsRes, thresholdsRes] = await Promise.all([
        axios.get(`${API_URL}/distributor/cold-chain/alerts`, { headers }).catch(() => ({ data: { data: [] } })),
        axios.get(`${API_URL}/distributor/cold-chain/thresholds`, { headers }).catch(() => ({ data: { data: [] } }))
      ])
      setAlerts(alertsRes.data?.data || [])
      setThresholds(thresholdsRes.data?.data || [])
    } catch (err: any) {
      setError(err.response?.data?.message || "Failed to load cold chain data")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [token])

  // Open Record Modal for specific shipment
  const handleOpenRecord = (shipment?: any) => {
    setSelectedShipmentId(shipment ? shipment.id : (outgoingShipments[0]?.id || ""))
    setTempInput("")
    setHumidityInput("")
    setSourceInput("MANUAL_ENTRY")
    setNotesInput("")
    // Default to current local time in ISO minute format: YYYY-MM-DDTHH:mm
    const now = new Date()
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
    setMeasuredAtInput(now.toISOString().slice(0, 16))
    setRecordError("")
    setRecordSuccess("")
    setShowRecordModal(true)
  }

  const handleSubmitReading = async (e: FormEvent) => {
    e.preventDefault()
    if (!selectedShipmentId) {
      setRecordError("Please select a shipment.")
      return
    }

    const tempNum = parseFloat(tempInput)
    if (isNaN(tempNum)) {
      setRecordError("Please provide a valid numeric temperature value in Celsius.")
      return
    }

    let humNum: number | undefined = undefined
    if (humidityInput.trim()) {
      humNum = parseFloat(humidityInput)
      if (isNaN(humNum) || humNum < 0 || humNum > 100) {
        setRecordError("Relative humidity must be a percentage between 0 and 100%.")
        return
      }
    }

    const measuredDate = measuredAtInput ? new Date(measuredAtInput) : new Date()
    if (measuredDate.getTime() > Date.now() + 60000) {
      setRecordError("Measurement timestamp cannot be in the future.")
      return
    }

    setSubmittingReading(true)
    setRecordError("")
    setRecordSuccess("")

    try {
      const res = await axios.post(`${API_URL}/distributor/cold-chain/readings`, {
        shipment_id: selectedShipmentId,
        temperature: tempNum,
        temperature_unit: 'C',
        relative_humidity_pct: humNum,
        reading_source: sourceInput,
        notes: notesInput,
        measured_at: measuredDate.toISOString()
      }, { headers })

      const alertGenerated = res.data?.data?.alert
      if (alertGenerated) {
        setRecordSuccess(`Reading recorded: ${tempNum}°C. Warning/Alert generated (${alertGenerated.severity})!`)
      } else {
        setRecordSuccess(`Reading recorded successfully (${tempNum}°C, status: NORMAL).`)
      }

      setTimeout(() => {
        setShowRecordModal(false)
        fetchData()
        if (onRefreshRequired) onRefreshRequired()
      }, 1400)
    } catch (err: any) {
      setRecordError(err.response?.data?.message || "Failed to record measurement.")
    } finally {
      setSubmittingReading(false)
    }
  }

  // Open History Modal
  const handleOpenHistory = async (shipment: any) => {
    setHistoryModalShipment(shipment)
    setLoadingHistory(true)
    setHistoryData(null)
    try {
      const res = await axios.get(`${API_URL}/distributor/shipments/${shipment.id}/cold-chain`, { headers })
      setHistoryData(res.data?.data)
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingHistory(false)
    }
  }

  // Alert Action (Acknowledge / Resolve)
  const handleOpenAlertAction = (alert: any, type: "ACKNOWLEDGE" | "RESOLVE") => {
    setActionAlert(alert)
    setActionType(type)
    setActionNotes("")
    setActionError("")
  }

  const handleSubmitAlertAction = async () => {
    if (!actionAlert || !actionType) return
    if (actionType === "RESOLVE" && !actionNotes.trim()) {
      setActionError("Resolution notes are required when closing an alert.")
      return
    }

    setActionSubmitting(true)
    setActionError("")
    try {
      if (actionType === "ACKNOWLEDGE") {
        await axios.put(`${API_URL}/distributor/cold-chain/alerts/${actionAlert.id}/acknowledge`, {
          notes: actionNotes
        }, { headers })
      } else {
        await axios.put(`${API_URL}/distributor/cold-chain/alerts/${actionAlert.id}/resolve`, {
          resolution_notes: actionNotes
        }, { headers })
      }
      setActionAlert(null)
      setActionType(null)
      fetchData()
      if (onRefreshRequired) onRefreshRequired()
    } catch (err: any) {
      setActionError(err.response?.data?.message || "Failed to update alert.")
    } finally {
      setActionSubmitting(false)
    }
  }

  // Edit Threshold
  const handleStartEditThreshold = (t: any) => {
    setEditingCategory(t.product_category)
    setEditMinTemp(t.min_temperature_celsius?.toString() || "")
    setEditMaxTemp(t.max_temperature_celsius?.toString() || "")
    setEditMinHumidity(t.min_relative_humidity_pct?.toString() || "")
    setEditMaxHumidity(t.max_relative_humidity_pct?.toString() || "")
    setThresholdError("")
    setThresholdSuccess("")
  }

  const handleSaveThreshold = async (e: FormEvent) => {
    e.preventDefault()
    if (!editingCategory) return

    const maxT = parseFloat(editMaxTemp)
    if (isNaN(maxT)) {
      setThresholdError("Maximum acceptable temperature is required.")
      return
    }

    const minT = editMinTemp.trim() ? parseFloat(editMinTemp) : undefined
    if (minT !== undefined && minT > maxT) {
      setThresholdError("Minimum temperature cannot exceed maximum temperature.")
      return
    }

    setSavingThreshold(true)
    setThresholdError("")
    try {
      await axios.post(`${API_URL}/distributor/cold-chain/thresholds`, {
        product_category: editingCategory,
        min_temperature_celsius: minT,
        max_temperature_celsius: maxT,
        min_relative_humidity_pct: editMinHumidity ? parseFloat(editMinHumidity) : undefined,
        max_relative_humidity_pct: editMaxHumidity ? parseFloat(editMaxHumidity) : undefined,
        temperature_unit: 'C'
      }, { headers })

      setThresholdSuccess(`Thresholds updated for ${editingCategory}`)
      setEditingCategory(null)
      fetchData()
    } catch (err: any) {
      setThresholdError(err.response?.data?.message || "Failed to save threshold.")
    } finally {
      setSavingThreshold(false)
    }
  }

  // Derived counts
  const criticalCount = alerts.filter(a => a.status !== 'RESOLVED' && a.severity === 'CRITICAL').length
  const warningCount = alerts.filter(a => a.status !== 'RESOLVED' && a.severity === 'WARNING').length
  const normalCount = outgoingShipments.filter(s => s.cold_chain_status === 'NORMAL').length
  const activeAlerts = alerts.filter(a => a.status !== 'RESOLVED')

  const filteredShipments = outgoingShipments.filter(s => {
    if (statusFilter === "ALL") return true
    return (s.cold_chain_status || 'UNAVAILABLE') === statusFilter
  })

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs font-semibold">
          {error}
        </div>
      )}
      {/* Overview Stat Badges */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-border/50 shadow-sm bg-gradient-to-br from-slate-50 to-white dark:from-slate-900/50 dark:to-slate-900">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase">Monitored Shipments</span>
              <Thermometer className="h-4 w-4 text-blue-500" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{outgoingShipments.length}</div>
            <p className="text-xs text-muted-foreground mt-0.5">Active retail routes</p>
          </CardContent>
        </Card>

        <Card className="border-border/50 shadow-sm bg-gradient-to-br from-emerald-50/40 to-white dark:from-emerald-950/20 dark:to-slate-900">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase">Normal Range</span>
              <CheckCircle className="h-4 w-4 text-emerald-500" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{normalCount}</div>
            <p className="text-xs text-muted-foreground mt-0.5">Compliant readings</p>
          </CardContent>
        </Card>

        <Card className="border-border/50 shadow-sm bg-gradient-to-br from-amber-50/40 to-white dark:from-amber-950/20 dark:to-slate-900">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase">Warnings</span>
              <AlertTriangle className="h-4 w-4 text-amber-500" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">{warningCount}</div>
            <p className="text-xs text-muted-foreground mt-0.5">Minor excursions</p>
          </CardContent>
        </Card>

        <Card className="border-border/50 shadow-sm bg-gradient-to-br from-rose-50/40 to-white dark:from-rose-950/20 dark:to-slate-900">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-rose-700 dark:text-rose-400 uppercase">Critical Excursions</span>
              <ShieldAlert className="h-4 w-4 text-rose-500" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-rose-600 dark:text-rose-400">{criticalCount}</div>
            <p className="text-xs text-muted-foreground mt-0.5">Safety breach alerts</p>
          </CardContent>
        </Card>
      </div>

      {/* Action Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-4 rounded-xl border border-border/50 shadow-sm">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Thermometer className="h-5 w-5 text-blue-600" />
            Cold-Chain Monitoring & Food Safety
          </h2>
          <p className="text-xs text-muted-foreground">
            Real-time transit temperature evaluation against configured category standards.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowThresholdsModal(true)}
            className="text-xs"
          >
            <Sliders className="h-3.5 w-3.5 mr-1.5" />
            Category Thresholds ({thresholds.length})
          </Button>
          <Button
            size="sm"
            onClick={() => handleOpenRecord()}
            className="text-xs bg-blue-600 hover:bg-blue-700 text-white"
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Record Reading
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchData}
            disabled={loading}
            className="text-xs"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Active Food Safety Alerts Panel */}
      {activeAlerts.length > 0 && (
        <Card className="border-rose-200 dark:border-rose-900/50 bg-rose-50/40 dark:bg-rose-950/10 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-rose-600" />
                <CardTitle className="text-base text-rose-950 dark:text-rose-200">
                  Active Food Safety Temperature Alerts ({activeAlerts.length})
                </CardTitle>
              </div>
              <span className="text-xs text-rose-700 dark:text-rose-400 font-medium">Requires distributor review</span>
            </div>
            <CardDescription className="text-xs text-rose-800/80 dark:text-rose-300/80">
              Readings exceeded acceptable safety ranges. Retailers are informed of these alerts during delivery receipt.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {activeAlerts.map((alert) => (
              <div
                key={alert.id}
                className="bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900/60 p-4 rounded-xl shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                      alert.severity === 'CRITICAL'
                        ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400'
                        : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'
                    }`}>
                      {alert.severity}
                    </span>
                    <span className="font-mono text-xs font-semibold">{alert.shipments?.shipment_tracking_id || alert.shipment_id}</span>
                    <span className="text-xs text-muted-foreground">• Category: <strong>{alert.product_category || 'Produce'}</strong></span>
                    <span className="text-xs text-muted-foreground">• Status: <strong>{alert.status}</strong></span>
                  </div>
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                    {alert.alert_message || `Temperature ${alert.observed_reading}°C violated threshold (${alert.expected_range})`}
                  </p>
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Detected: {new Date(alert.detected_at).toLocaleString()}
                    {alert.acknowledged_at && (
                      <span className="ml-2 text-blue-600">
                        • Acknowledged: {new Date(alert.acknowledged_at).toLocaleTimeString()}
                      </span>
                    )}
                  </p>
                </div>

                <div className="flex items-center gap-2 self-end md:self-center shrink-0">
                  {alert.status === 'ACTIVE' && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs h-8 border-amber-300 text-amber-800 hover:bg-amber-50"
                      onClick={() => handleOpenAlertAction(alert, "ACKNOWLEDGE")}
                    >
                      Acknowledge
                    </Button>
                  )}
                  <Button
                    size="sm"
                    className="text-xs h-8 bg-emerald-600 hover:bg-emerald-700 text-white"
                    onClick={() => handleOpenAlertAction(alert, "RESOLVE")}
                  >
                    Resolve & Log Action
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Shipment Condition Table */}
      <Card className="border-border/50 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Shipment Condition Status</CardTitle>
              <CardDescription>Continuous cold-chain monitoring across all dispatched shipments</CardDescription>
            </div>
            {/* Filter buttons */}
            <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg text-xs">
              {(["ALL", "CRITICAL", "WARNING", "NORMAL", "UNAVAILABLE"] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setStatusFilter(f)}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                    statusFilter === f
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                      : 'text-muted-foreground hover:text-slate-900'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground text-xs">
                  <th className="text-left py-3 px-2">Tracking / Batch</th>
                  <th className="text-left py-3 px-2">Product & Retailer</th>
                  <th className="text-left py-3 px-2">Latest Temp</th>
                  <th className="text-left py-3 px-2">Humidity</th>
                  <th className="text-left py-3 px-2">Last Measured</th>
                  <th className="text-left py-3 px-2">Condition Status</th>
                  <th className="text-right py-3 px-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredShipments.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-muted-foreground text-xs">
                      No shipments matching filter '{statusFilter}'.
                    </td>
                  </tr>
                ) : (
                  filteredShipments.map((s) => {
                    const status = s.cold_chain_status || 'UNAVAILABLE'
                    const latest = s.latest_reading

                    return (
                      <tr key={s.id} className="border-b border-muted/30 hover:bg-muted/10 transition-colors">
                        <td className="py-3 px-2">
                          <div className="font-mono text-xs font-semibold">{s.shipment_tracking_id}</div>
                          <div className="text-[11px] text-muted-foreground font-mono">{s.batch_number}</div>
                        </td>
                        <td className="py-3 px-2">
                          <div className="font-medium text-xs">{s.request?.product_name || "Perishable Produce"}</div>
                          <div className="text-[11px] text-muted-foreground">To: {s.receiver?.name || "Retail Store"}</div>
                        </td>
                        <td className="py-3 px-2">
                          {latest ? (
                            <span className="font-bold text-xs text-slate-900 dark:text-white font-mono">
                              {latest.temperature_celsius}°C
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground italic">No readings</span>
                          )}
                        </td>
                        <td className="py-3 px-2">
                          {latest?.relative_humidity_pct !== null && latest?.relative_humidity_pct !== undefined ? (
                            <span className="text-xs font-mono">{latest.relative_humidity_pct}% RH</span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-3 px-2 text-xs text-muted-foreground">
                          {latest ? (
                            <div>
                              <div>{new Date(latest.measured_at).toLocaleDateString()}</div>
                              <div className="text-[10px]">{new Date(latest.measured_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                            </div>
                          ) : '—'}
                        </td>
                        <td className="py-3 px-2">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider inline-flex items-center gap-1 ${
                            status === 'NORMAL' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                            status === 'WARNING' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                            status === 'CRITICAL' ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400' :
                            'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                          }`}>
                            {status === 'NORMAL' && <Check className="h-3 w-3" />}
                            {status === 'CRITICAL' && <AlertTriangle className="h-3 w-3" />}
                            {status}
                          </span>
                        </td>
                        <td className="py-3 px-2 text-right space-x-1 whitespace-nowrap">
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs h-7 px-2"
                            onClick={() => handleOpenRecord(s)}
                          >
                            <Plus className="h-3 w-3 mr-1" /> Log Temp
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-xs h-7 px-2"
                            onClick={() => handleOpenHistory(s)}
                          >
                            <History className="h-3 w-3 mr-1" /> History
                          </Button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ============================================================== */}
      {/* RECORD READING MODAL */}
      {/* ============================================================== */}
      {showRecordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-md w-full overflow-hidden p-6 space-y-4">
            <div className="flex justify-between items-center pb-2 border-b">
              <div className="flex items-center gap-2">
                <Thermometer className="h-5 w-5 text-blue-600" />
                <h3 className="text-base font-bold text-slate-900 dark:text-white">Record Condition Reading</h3>
              </div>
              <button
                onClick={() => setShowRecordModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitReading} className="space-y-4 text-xs">
              <div>
                <label className="font-semibold block mb-1 text-slate-700 dark:text-slate-300">Target Shipment *</label>
                <select
                  value={selectedShipmentId}
                  onChange={(e) => setSelectedShipmentId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border rounded-lg text-xs font-mono"
                  required
                >
                  <option value="">-- Select shipment --</option>
                  {outgoingShipments.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.shipment_tracking_id} - {s.request?.product_name || "Produce"} ({s.batch_number})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold block mb-1 text-slate-700 dark:text-slate-300">
                    Temperature (°C) *
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    placeholder="e.g. 4.5"
                    value={tempInput}
                    onChange={(e) => setTempInput(e.target.value)}
                    required
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border rounded-lg text-xs"
                  />
                </div>
                <div>
                  <label className="font-semibold block mb-1 text-slate-700 dark:text-slate-300">
                    Relative Humidity (% RH)
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    max="100"
                    placeholder="e.g. 85"
                    value={humidityInput}
                    onChange={(e) => setHumidityInput(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border rounded-lg text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="font-semibold block mb-1 text-slate-700 dark:text-slate-300">Measurement Timestamp *</label>
                <input
                  type="datetime-local"
                  value={measuredAtInput}
                  onChange={(e) => setMeasuredAtInput(e.target.value)}
                  required
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border rounded-lg text-xs"
                />
              </div>

              <div>
                <label className="font-semibold block mb-1 text-slate-700 dark:text-slate-300">Reading Source</label>
                <select
                  value={sourceInput}
                  onChange={(e) => setSourceInput(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border rounded-lg text-xs"
                >
                  <option value="MANUAL_ENTRY">Manual Entry (Distributor Handheld Probe)</option>
                  <option value="IOT_GATEWAY">IoT Gateway Telemetry</option>
                  <option value="EXTERNAL_SENSOR">External Data Logger</option>
                </select>
              </div>

              <div>
                <label className="font-semibold block mb-1 text-slate-700 dark:text-slate-300">Notes / Inspection Comments</label>
                <textarea
                  rows={2}
                  value={notesInput}
                  onChange={(e) => setNotesInput(e.target.value)}
                  placeholder="e.g. Inspected reef container door seal; cargo stable."
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border rounded-lg text-xs"
                />
              </div>

              <div className="p-2.5 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/40 rounded-lg text-[11px] text-blue-800 dark:text-blue-300">
                <span className="font-semibold">Food Safety Policy:</span> Readings are automatically evaluated against the product's food safety category threshold. Server recording timestamp is generated upon commit.
              </div>

              {recordError && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs">
                  {recordError}
                </div>
              )}
              {recordSuccess && (
                <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-700 text-xs font-semibold">
                  {recordSuccess}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowRecordModal(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={submittingReading}
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                >
                  {submittingReading ? "Validating & Logging..." : "Save Reading"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* SHIPMENT CONDITION HISTORY MODAL */}
      {/* ============================================================== */}
      {historyModalShipment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto p-6 space-y-4">
            <div className="flex justify-between items-center pb-2 border-b">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <History className="h-5 w-5 text-blue-600" />
                  Condition History: {historyModalShipment.shipment_tracking_id}
                </h3>
                <p className="text-xs text-muted-foreground">
                  Batch: {historyModalShipment.batch_number} • Product: {historyModalShipment.request?.product_name || 'Produce'}
                </p>
              </div>
              <button
                onClick={() => setHistoryModalShipment(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {loadingHistory ? (
              <div className="py-12 text-center text-xs text-muted-foreground">
                <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-blue-500" />
                Loading condition audit trail...
              </div>
            ) : !historyData ? (
              <div className="py-8 text-center text-xs text-muted-foreground">
                Failed to load history data.
              </div>
            ) : (
              <div className="space-y-4 text-xs">
                {/* Threshold Info */}
                <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-border/50 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <span className="font-semibold block text-slate-900 dark:text-white">
                      Category Threshold: {historyData.threshold?.product_category || 'Produce'}
                    </span>
                    <span className="text-muted-foreground text-[11px]">
                      Required Temp: {historyData.threshold?.min_temperature_celsius ?? '—'}°C to {historyData.threshold?.max_temperature_celsius}°C
                      {historyData.threshold?.min_relative_humidity_pct && ` • RH: ${historyData.threshold.min_relative_humidity_pct}% - ${historyData.threshold.max_relative_humidity_pct}%`}
                    </span>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                    historyData.status === 'NORMAL' ? 'bg-emerald-100 text-emerald-700' :
                    historyData.status === 'WARNING' ? 'bg-amber-100 text-amber-700' :
                    historyData.status === 'CRITICAL' ? 'bg-rose-100 text-rose-700' :
                    'bg-slate-100 text-slate-600'
                  }`}>
                    Current Status: {historyData.status}
                  </span>
                </div>

                {/* Readings Timeline */}
                <div>
                  <h4 className="font-semibold mb-2 text-slate-900 dark:text-white">
                    Logged Readings ({historyData.readings?.length || 0})
                  </h4>
                  {(!historyData.readings || historyData.readings.length === 0) ? (
                    <div className="p-6 text-center text-muted-foreground border rounded-xl bg-slate-50/50">
                      No temperature readings have been recorded yet for this journey.
                    </div>
                  ) : (
                    <div className="border rounded-xl overflow-hidden">
                      <table className="w-full text-left">
                        <thead className="bg-slate-50 dark:bg-slate-800 text-[11px] text-muted-foreground border-b">
                          <tr>
                            <th className="py-2 px-3">Measured Time</th>
                            <th className="py-2 px-3">Temp</th>
                            <th className="py-2 px-3">Humidity</th>
                            <th className="py-2 px-3">Source</th>
                            <th className="py-2 px-3">Evaluation</th>
                            <th className="py-2 px-3">Notes</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/50">
                          {historyData.readings.map((r: any) => (
                            <tr key={r.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                              <td className="py-2 px-3 font-mono text-[11px]">
                                {new Date(r.measured_at).toLocaleString()}
                              </td>
                              <td className="py-2 px-3 font-bold font-mono">
                                {r.temperature_celsius}°C
                              </td>
                              <td className="py-2 px-3 font-mono">
                                {r.relative_humidity_pct !== null ? `${r.relative_humidity_pct}%` : '—'}
                              </td>
                              <td className="py-2 px-3 text-[11px] text-muted-foreground">
                                {r.reading_source}
                              </td>
                              <td className="py-2 px-3">
                                <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${
                                  r.condition_status === 'NORMAL' ? 'bg-emerald-100 text-emerald-800' :
                                  r.condition_status === 'CRITICAL' ? 'bg-rose-100 text-rose-800' :
                                  r.condition_status === 'WARNING' ? 'bg-amber-100 text-amber-800' :
                                  'bg-slate-100 text-slate-700'
                                }`}>
                                  {r.condition_status}
                                </span>
                              </td>
                              <td className="py-2 px-3 text-muted-foreground max-w-[150px] truncate">
                                {r.notes || '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Historical Violations / Alerts */}
                {historyData.alerts && historyData.alerts.length > 0 && (
                  <div>
                    <h4 className="font-semibold mb-2 text-rose-800 dark:text-rose-400">
                      Condition Excursion Log ({historyData.alerts.length})
                    </h4>
                    <div className="space-y-2">
                      {historyData.alerts.map((al: any) => (
                        <div key={al.id} className="p-3 border border-rose-200 dark:border-rose-900 rounded-xl bg-rose-50/30 dark:bg-rose-950/20 flex justify-between items-center text-xs">
                          <div>
                            <div className="flex items-center gap-1.5 font-semibold text-rose-900 dark:text-rose-200">
                              <span className="uppercase text-[9px] px-1.5 py-0.5 rounded bg-rose-200 text-rose-800 font-bold">
                                {al.severity}
                              </span>
                              <span>Observed {al.observed_reading}°C (Expected: {al.expected_range})</span>
                            </div>
                            <div className="text-[11px] text-muted-foreground mt-0.5">
                              Detected: {new Date(al.detected_at).toLocaleString()} • Status: <strong>{al.status}</strong>
                              {al.resolution_notes && ` • Resolution: "${al.resolution_notes}"`}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end pt-2 border-t">
              <Button size="sm" variant="outline" onClick={() => setHistoryModalShipment(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* THRESHOLDS CONFIGURATION MODAL */}
      {/* ============================================================== */}
      {showThresholdsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto p-6 space-y-4">
            <div className="flex justify-between items-center pb-2 border-b">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Sliders className="h-5 w-5 text-blue-600" />
                  Product Category Food Safety Thresholds
                </h3>
                <p className="text-xs text-muted-foreground">
                  Configured safe transport temperature & humidity ranges per produce category.
                </p>
              </div>
              <button
                onClick={() => setShowThresholdsModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {editingCategory ? (
              <form onSubmit={handleSaveThreshold} className="p-4 bg-slate-50 dark:bg-slate-800 rounded-xl space-y-3 text-xs border">
                <h4 className="font-bold text-slate-900 dark:text-white">
                  Editing Threshold for: <span className="text-blue-600">{editingCategory}</span>
                </h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block mb-1 font-semibold">Min Temperature (°C)</label>
                    <input
                      type="number"
                      step="0.5"
                      value={editMinTemp}
                      onChange={(e) => setEditMinTemp(e.target.value)}
                      placeholder="e.g. 2.0"
                      className="w-full px-3 py-2 bg-white dark:bg-slate-900 border rounded-lg text-xs"
                    />
                  </div>
                  <div>
                    <label className="block mb-1 font-semibold">Max Temperature (°C) *</label>
                    <input
                      type="number"
                      step="0.5"
                      value={editMaxTemp}
                      onChange={(e) => setEditMaxTemp(e.target.value)}
                      required
                      placeholder="e.g. 8.0"
                      className="w-full px-3 py-2 bg-white dark:bg-slate-900 border rounded-lg text-xs"
                    />
                  </div>
                  <div>
                    <label className="block mb-1 font-semibold">Min Relative Humidity (%)</label>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      max="100"
                      value={editMinHumidity}
                      onChange={(e) => setEditMinHumidity(e.target.value)}
                      placeholder="e.g. 85"
                      className="w-full px-3 py-2 bg-white dark:bg-slate-900 border rounded-lg text-xs"
                    />
                  </div>
                  <div>
                    <label className="block mb-1 font-semibold">Max Relative Humidity (%)</label>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      max="100"
                      value={editMaxHumidity}
                      onChange={(e) => setEditMaxHumidity(e.target.value)}
                      placeholder="e.g. 95"
                      className="w-full px-3 py-2 bg-white dark:bg-slate-900 border rounded-lg text-xs"
                    />
                  </div>
                </div>

                {thresholdError && (
                  <p className="text-rose-600 text-xs font-semibold">{thresholdError}</p>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => setEditingCategory(null)}>
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" disabled={savingThreshold} className="bg-blue-600 hover:bg-blue-700 text-white">
                    {savingThreshold ? "Saving..." : "Save Limits"}
                  </Button>
                </div>
              </form>
            ) : null}

            {thresholdSuccess && (
              <div className="p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs font-medium">
                {thresholdSuccess}
              </div>
            )}

            <div className="border rounded-xl overflow-hidden text-xs">
              <table className="w-full text-left">
                <thead className="bg-slate-50 dark:bg-slate-800 text-[11px] text-muted-foreground border-b">
                  <tr>
                    <th className="py-2.5 px-3">Product Category</th>
                    <th className="py-2.5 px-3">Safe Temperature Range</th>
                    <th className="py-2.5 px-3">Relative Humidity Range</th>
                    <th className="py-2.5 px-3">Effective Date</th>
                    <th className="py-2.5 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {thresholds.map((t) => (
                    <tr key={t.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                      <td className="py-2.5 px-3 font-semibold">{t.product_category}</td>
                      <td className="py-2.5 px-3 font-mono">
                        {t.min_temperature_celsius ?? '—'}°C to {t.max_temperature_celsius}°C
                      </td>
                      <td className="py-2.5 px-3 font-mono">
                        {t.min_relative_humidity_pct !== null && t.max_relative_humidity_pct !== null
                          ? `${t.min_relative_humidity_pct}% - ${t.max_relative_humidity_pct}% RH`
                          : 'Not specified'}
                      </td>
                      <td className="py-2.5 px-3 text-muted-foreground text-[11px]">
                        {new Date(t.created_at).toLocaleDateString()}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs h-7 px-2"
                          onClick={() => handleStartEditThreshold(t)}
                        >
                          Edit
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end pt-2 border-t">
              <Button size="sm" variant="outline" onClick={() => setShowThresholdsModal(false)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* ALERT ACKNOWLEDGE / RESOLVE MODAL */}
      {/* ============================================================== */}
      {actionAlert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between items-center pb-2 border-b">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {actionType === "ACKNOWLEDGE" ? "Acknowledge Safety Alert" : "Resolve & Close Safety Alert"}
              </h3>
              <button onClick={() => setActionAlert(null)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl space-y-1 text-xs">
              <div className="font-semibold text-slate-900 dark:text-white">
                {actionAlert.shipments?.shipment_tracking_id || actionAlert.shipment_id}
              </div>
              <p className="text-muted-foreground">
                Violation: {actionAlert.observed_reading}°C (Limit: {actionAlert.expected_range})
              </p>
            </div>

            <div className="space-y-1 text-xs">
              <label className="font-semibold block text-slate-700 dark:text-slate-300">
                {actionType === "ACKNOWLEDGE" ? "Acknowledgement Notes (Optional)" : "Resolution Notes (Required) *"}
              </label>
              <textarea
                rows={3}
                value={actionNotes}
                onChange={(e) => setActionNotes(e.target.value)}
                placeholder={
                  actionType === "ACKNOWLEDGE"
                    ? "e.g. Notified driver to inspect refrigeration thermostat."
                    : "e.g. Refrigeration compressor reset; cargo re-inspected and confirmed intact; temperature restored to 4.0°C."
                }
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border rounded-lg text-xs"
              />
            </div>

            {actionError && (
              <p className="text-rose-600 text-xs font-semibold">{actionError}</p>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button size="sm" variant="outline" onClick={() => setActionAlert(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={actionSubmitting}
                onClick={handleSubmitAlertAction}
                className={actionType === "RESOLVE" ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "bg-blue-600 hover:bg-blue-700 text-white"}
              >
                {actionSubmitting ? "Submitting..." : actionType === "ACKNOWLEDGE" ? "Confirm Acknowledged" : "Resolve Alert"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

import { useState, useEffect } from "react"
import axios from "axios"
import {
  Navigation,
  MapPin,
  Truck,
  AlertTriangle,
  CheckCircle,
  Save,
  Send,
  ExternalLink,
  RefreshCw,
  Compass,
  Info,
  Calendar
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../ui/Card"
import { Button } from "../ui/Button"

const API_URL = import.meta.env.VITE_API_URL || "https://farm-to-fork-tracker.onrender.com/api"

interface RouteOptimizationPanelProps {
  token: string | null
  outgoingShipments: any[]
  onPlanDispatched?: () => void
}

export function RouteOptimizationPanel({ token, outgoingShipments, onPlanDispatched }: RouteOptimizationPanelProps) {
  // Selected shipment IDs for routing
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [vehicleCapacity, setVehicleCapacity] = useState<number>(500)

  // Optimization result
  const [optimizing, setOptimizing] = useState(false)
  const [routePlan, setRoutePlan] = useState<any>(null)
  const [optimizeError, setOptimizeError] = useState("")

  // Saved plans
  const [savedPlans, setSavedPlans] = useState<any[]>([])
  const [loadingPlans, setLoadingPlans] = useState(false)

  // Save Plan state
  const [savingPlan, setSavingPlan] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState("")
  const [saveError, setSaveError] = useState("")

  // Dispatch state
  const [dispatchingId, setDispatchingId] = useState<string | null>(null)
  const [dispatchSuccess, setDispatchSuccess] = useState("")
  const [dispatchError, setDispatchError] = useState("")

  const headers = { Authorization: `Bearer ${token}` }

  // Fetch saved plans on mount
  const fetchPlans = async () => {
    if (!token) return
    setLoadingPlans(true)
    try {
      const res = await axios.get(`${API_URL}/distributor/routes/plans`, { headers })
      setSavedPlans(res.data?.data || [])
    } catch (err) {
      console.error("Failed to load route plans:", err)
    } finally {
      setLoadingPlans(false)
    }
  }

  useEffect(() => {
    fetchPlans()
  }, [token])

  // Select all eligible shipments by default if none selected
  useEffect(() => {
    if (outgoingShipments.length > 0 && selectedIds.length === 0) {
      // Default select all IN_TRANSIT or eligible shipments
      setSelectedIds(outgoingShipments.map(s => s.id))
    }
  }, [outgoingShipments])

  const toggleShipmentSelection = (id: string) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
    setRoutePlan(null) // Reset plan when selection changes
  }

  const selectAll = () => {
    setSelectedIds(outgoingShipments.map(s => s.id))
    setRoutePlan(null)
  }

  const clearSelection = () => {
    setSelectedIds([])
    setRoutePlan(null)
  }

  // Calculate current selected total quantity
  const totalSelectedCargo = outgoingShipments
    .filter(s => selectedIds.includes(s.id))
    .reduce((sum, s) => sum + (Number(s.quantity) || 0), 0)

  const capacityPct = vehicleCapacity > 0 ? Math.min(100, Math.round((totalSelectedCargo / vehicleCapacity) * 100)) : 0
  const isOverCapacity = totalSelectedCargo > vehicleCapacity

  // Execute Route Optimization
  const handleOptimizeRoute = async () => {
    if (selectedIds.length === 0) {
      setOptimizeError("Please select at least one shipment to route.")
      return
    }

    setOptimizing(true)
    setOptimizeError("")
    setSaveSuccess("")
    setSaveError("")

    try {
      const res = await axios.post(`${API_URL}/distributor/routes/optimize`, {
        shipment_ids: selectedIds,
        vehicle_capacity: vehicleCapacity,
        origin_address: "Bangalore Central Distribution Depot, Rajajinagar, Bangalore",
        origin_latitude: 12.9716,
        origin_longitude: 77.5946
      }, { headers })

      setRoutePlan(res.data?.data)
    } catch (err: any) {
      setOptimizeError(err.response?.data?.message || "Failed to generate optimized route.")
    } finally {
      setOptimizing(false)
    }
  }

  // Save Route Plan
  const handleSavePlan = async () => {
    if (!routePlan) return
    setSavingPlan(true)
    setSaveSuccess("")
    setSaveError("")

    try {
      await axios.post(`${API_URL}/distributor/routes/plans`, {
        name: `Bangalore Route Delivery - ${new Date().toLocaleDateString()}`,
        shipment_ids: selectedIds,
        vehicle_capacity: vehicleCapacity,
        origin_address: routePlan.origin?.address || "Bangalore Central Depot",
        origin_latitude: routePlan.origin?.latitude || 12.9716,
        origin_longitude: routePlan.origin?.longitude || 77.5946
      }, { headers })

      setSaveSuccess("Route plan saved successfully!")
      fetchPlans()
      setTimeout(() => setSaveSuccess(""), 4000)
    } catch (err: any) {
      setSaveError(err.response?.data?.message || "Failed to save route plan.")
    } finally {
      setSavingPlan(false)
    }
  }

  // Dispatch Route Plan
  const handleDispatchPlan = async (planId: string) => {
    setDispatchingId(planId)
    setDispatchSuccess("")
    setDispatchError("")

    try {
      await axios.post(`${API_URL}/distributor/routes/plans/${planId}/dispatch`, {}, { headers })
      setDispatchSuccess(`Route plan dispatched. Operational route is active.`)
      fetchPlans()
      if (onPlanDispatched) onPlanDispatched()
      setTimeout(() => setDispatchSuccess(""), 4000)
    } catch (err: any) {
      setDispatchError(err.response?.data?.message || "Failed to dispatch route plan.")
    } finally {
      setDispatchingId(null)
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-4 rounded-xl border border-border/50 shadow-sm">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Navigation className="h-5 w-5 text-emerald-600" />
            Intelligent Route Planning & Delivery Optimization
          </h2>
          <p className="text-xs text-muted-foreground">
            Constrained Traveling Salesperson TSP optimization (Nearest-Neighbor + 2-Opt) considering vehicle capacity & FEFO produce expiry.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchPlans}
            disabled={loadingPlans}
            className="text-xs"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loadingPlans ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Main Grid: Left = Selection & Config; Right = Plan Results */}
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left Column: Shipment Selection and Constraints (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <Card className="border-border/50 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                  <Truck className="h-4 w-4 text-primary" />
                  1. Select Shipments to Deliver
                </CardTitle>
                <div className="flex items-center gap-2 text-xs">
                  <button
                    onClick={selectAll}
                    className="text-primary hover:underline font-medium"
                  >
                    Select All
                  </button>
                  <span className="text-muted-foreground">•</span>
                  <button
                    onClick={clearSelection}
                    className="text-muted-foreground hover:underline"
                  >
                    Clear
                  </button>
                </div>
              </div>
              <CardDescription className="text-xs">
                Select outgoing orders for today's delivery run ({selectedIds.length} of {outgoingShipments.length} selected).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {outgoingShipments.length === 0 ? (
                <div className="py-6 text-center text-xs text-muted-foreground">
                  No outgoing shipments found to route.
                </div>
              ) : (
                <div className="max-h-[320px] overflow-y-auto space-y-2 pr-1">
                  {outgoingShipments.map((s) => {
                    const isSelected = selectedIds.includes(s.id)
                    const receiver = s.receiver || {}
                    const hasCoords = Boolean(receiver.latitude && receiver.longitude)
                    const isPerishableExpiring = s.product?.expiry_date &&
                      (new Date(s.product.expiry_date).getTime() - Date.now() < 3 * 24 * 60 * 60 * 1000)

                    return (
                      <div
                        key={s.id}
                        onClick={() => toggleShipmentSelection(s.id)}
                        className={`p-3 rounded-xl border text-xs cursor-pointer transition-all ${
                          isSelected
                            ? 'border-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/20 shadow-sm'
                            : 'border-border/60 hover:border-border bg-slate-50/50 dark:bg-slate-900/30'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {}} // handled by parent div click
                              className="mt-0.5 rounded text-emerald-600 focus:ring-emerald-500"
                            />
                            <div>
                              <div className="font-semibold text-slate-900 dark:text-white">
                                {s.request?.product_name || "Produce Order"}
                              </div>
                              <div className="text-[11px] text-muted-foreground font-mono">
                                {s.shipment_tracking_id} • Batch: {s.batch_number}
                              </div>
                              <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-1 flex items-center gap-1">
                                <MapPin className="h-3 w-3 shrink-0 text-muted-foreground" />
                                <span className="truncate max-w-[200px]">{receiver.address || receiver.name || "Retailer"}</span>
                              </div>
                            </div>
                          </div>

                          <div className="text-right shrink-0">
                            <span className="font-bold text-slate-900 dark:text-white block">
                              {s.quantity} {s.unit || 'units'}
                            </span>
                            {isPerishableExpiring && (
                              <span className="inline-block mt-1 px-1.5 py-0.2 rounded text-[9px] font-bold uppercase bg-rose-100 text-rose-700">
                                FEFO Priority
                              </span>
                            )}
                            {!hasCoords && (
                              <span className="inline-block mt-1 px-1.5 py-0.2 rounded text-[9px] font-semibold bg-amber-100 text-amber-700">
                                Default Geo
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Vehicle Capacity Settings */}
              <div className="pt-3 border-t space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <label className="font-semibold text-slate-700 dark:text-slate-300">
                    Vehicle Cargo Capacity (Units / kg)
                  </label>
                  <input
                    type="number"
                    min="10"
                    step="50"
                    value={vehicleCapacity}
                    onChange={(e) => {
                      setVehicleCapacity(Math.max(1, Number(e.target.value)))
                      setRoutePlan(null)
                    }}
                    className="w-24 px-2 py-1 bg-slate-50 dark:bg-slate-800 border rounded text-xs font-mono text-right"
                  />
                </div>

                {/* Capacity Progress Bar */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-muted-foreground">Payload Utilization:</span>
                    <span className={`font-mono font-semibold ${isOverCapacity ? 'text-rose-600' : 'text-slate-700 dark:text-slate-300'}`}>
                      {totalSelectedCargo} / {vehicleCapacity} units ({capacityPct}%)
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
                        isOverCapacity ? 'bg-rose-500' : capacityPct > 85 ? 'bg-amber-500' : 'bg-emerald-500'
                      }`}
                      style={{ width: `${Math.min(100, capacityPct)}%` }}
                    />
                  </div>
                  {isOverCapacity && (
                    <p className="text-[11px] text-rose-600 font-medium flex items-center gap-1 mt-1">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      Cargo exceeds vehicle capacity by {totalSelectedCargo - vehicleCapacity} units.
                    </p>
                  )}
                </div>

                {/* Origin Depot Details */}
                <div className="p-2.5 bg-slate-50 dark:bg-slate-800/60 rounded-lg text-[11px] text-slate-600 dark:text-slate-400 space-y-0.5">
                  <div className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1">
                    <Compass className="h-3 w-3 text-blue-500" />
                    Hub Origin: Bangalore Central Distribution Depot
                  </div>
                  <div>Coords: 12.9716° N, 77.5946° E • Standard Depot Departure</div>
                </div>

                {optimizeError && (
                  <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs font-medium">
                    {optimizeError}
                  </div>
                )}

                <Button
                  onClick={handleOptimizeRoute}
                  disabled={optimizing || selectedIds.length === 0}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs h-9"
                >
                  <Navigation className={`h-4 w-4 mr-1.5 ${optimizing ? 'animate-spin' : ''}`} />
                  {optimizing ? "Calculating 2-Opt Optimal Route..." : "Optimize Delivery Sequence"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Route Optimization Results (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          {!routePlan ? (
            <Card className="border-border/50 shadow-sm border-dashed p-8 text-center bg-slate-50/50 dark:bg-slate-900/20">
              <Compass className="h-12 w-12 text-slate-300 dark:text-slate-700 mx-auto mb-3" />
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                Ready to Compute Optimized Route
              </h3>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                Select outgoing shipments on the left and click "Optimize Delivery Sequence". The algorithm orders stops to minimize fuel and transit distance while respecting perishable expiry deadlines.
              </p>
            </Card>
          ) : (
            <div className="space-y-4">
              {/* Real Metrics Summary Card */}
              <Card className="border-emerald-200 dark:border-emerald-900/60 shadow-sm bg-gradient-to-br from-emerald-50/30 to-white dark:from-emerald-950/20 dark:to-slate-900">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                      <CheckCircle className="h-4 w-4 text-emerald-500" />
                      Optimized Route Recommendation
                    </CardTitle>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300 font-bold uppercase">
                      TSP 2-Opt Heuristic
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 text-xs">
                  {/* Metric Chips */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-3 bg-white dark:bg-slate-800 rounded-xl border shadow-2xs">
                      <span className="text-[10px] text-muted-foreground uppercase font-semibold block">Optimized Distance</span>
                      <span className="text-base font-bold text-emerald-600 font-mono">
                        {routePlan.metrics?.estimated_distance_km} km
                      </span>
                    </div>

                    <div className="p-3 bg-white dark:bg-slate-800 rounded-xl border shadow-2xs">
                      <span className="text-[10px] text-muted-foreground uppercase font-semibold block">Baseline Distance</span>
                      <span className="text-base font-bold text-slate-600 dark:text-slate-400 font-mono">
                        {routePlan.metrics?.baseline_distance_km} km
                      </span>
                    </div>

                    <div className="p-3 bg-white dark:bg-slate-800 rounded-xl border shadow-2xs">
                      <span className="text-[10px] text-muted-foreground uppercase font-semibold block">Distance Saved</span>
                      <span className="text-base font-bold text-blue-600 font-mono">
                        {routePlan.metrics?.distance_saved_km} km ({routePlan.metrics?.distance_saved_pct}%)
                      </span>
                    </div>

                    <div className="p-3 bg-white dark:bg-slate-800 rounded-xl border shadow-2xs">
                      <span className="text-[10px] text-muted-foreground uppercase font-semibold block">Est. Duration</span>
                      <span className="text-base font-bold text-slate-900 dark:text-white font-mono">
                        {Math.floor((routePlan.metrics?.estimated_duration_minutes || 0) / 60)}h {(routePlan.metrics?.estimated_duration_minutes || 0) % 60}m
                      </span>
                    </div>
                  </div>

                  {/* Estimation Methodology & Constraint Disclaimers */}
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border text-[11px] space-y-1 text-slate-600 dark:text-slate-400">
                    <div className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1">
                      <Info className="h-3 w-3 text-blue-500" />
                      Estimation Model & Transparency Note:
                    </div>
                    <p>
                      {routePlan.data_source_limitation ||
                       "Road estimates computed via Haversine great-circle distance with 1.30 urban circuity multiplier and 40 km/h commercial transit speed + 15 min dwell time per stop. No fabricated AI traffic metrics."}
                    </p>
                  </div>

                  {/* Constraint Warnings if any */}
                  {routePlan.constraint_violations && routePlan.constraint_violations.length > 0 && (
                    <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl space-y-1">
                      <div className="font-bold text-rose-800 text-xs flex items-center gap-1">
                        <AlertTriangle className="h-3.5 w-3.5" /> Constraint Warnings:
                      </div>
                      <ul className="list-disc pl-4 text-[11px] text-rose-700 space-y-0.5">
                        {routePlan.constraint_violations.map((v: string, i: number) => (
                          <li key={i}>{v}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Expiry Warnings */}
                  {routePlan.expiry_warnings && routePlan.expiry_warnings.length > 0 && (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-1">
                      <div className="font-bold text-amber-800 text-xs flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5" /> FEFO Expiry Priorities Applied:
                      </div>
                      <ul className="list-disc pl-4 text-[11px] text-amber-700 space-y-0.5">
                        {routePlan.expiry_warnings.map((w: string, i: number) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Ordered Stops Timeline */}
                  <div>
                    <h4 className="font-semibold text-slate-900 dark:text-white mb-2">
                      Planned Delivery Stop Sequence ({routePlan.stops?.length || 0} stops):
                    </h4>
                    <div className="border rounded-xl divide-y overflow-hidden">
                      {routePlan.stops?.map((stop: any, idx: number) => (
                        <div
                          key={idx}
                          className={`p-3 text-xs flex items-center justify-between gap-3 ${
                            stop.is_origin ? 'bg-slate-50 dark:bg-slate-800/40 font-semibold' : 'bg-white dark:bg-slate-900'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                              stop.is_origin
                                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
                                : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300'
                            }`}>
                              {stop.stop_number}
                            </span>
                            <div>
                              <div className="font-medium text-slate-900 dark:text-white">
                                {stop.retailer_name || stop.address}
                              </div>
                              <div className="text-[11px] text-muted-foreground">
                                {stop.is_origin ? "Depot Location" : `${stop.product_name || 'Produce'} (${stop.quantity_to_deliver} units)`}
                                {!stop.is_origin && stop.batch_number && ` • Batch: ${stop.batch_number}`}
                              </div>
                            </div>
                          </div>

                          <div className="text-right shrink-0 text-[11px] font-mono text-muted-foreground">
                            <div>+{stop.distance_from_previous_km} km</div>
                            <div className="text-[10px] text-slate-500">ETA: {stop.estimated_arrival}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Action Buttons: Google Maps Navigation & Save Plan */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t">
                    {routePlan.google_maps_url ? (
                      <a
                        href={routePlan.google_maps_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-900 font-semibold text-xs hover:bg-blue-100 transition-colors"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Open Multi-Stop in Google Maps
                      </a>
                    ) : <div />}

                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        onClick={handleSavePlan}
                        disabled={savingPlan}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-8"
                      >
                        <Save className="h-3.5 w-3.5 mr-1" />
                        {savingPlan ? "Saving Plan..." : "Save Route Plan"}
                      </Button>
                    </div>
                  </div>

                  {saveSuccess && (
                    <div className="p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs font-semibold">
                      {saveSuccess}
                    </div>
                  )}
                  {saveError && (
                    <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg text-xs font-semibold">
                      {saveError}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>

      {/* Dispatched / Saved Route Plans Table */}
      <Card className="border-border/50 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Saved & Dispatched Route Plans</CardTitle>
              <CardDescription>
                Auditable historical route plans with stop sequences and dispatch records
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {dispatchSuccess && (
            <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs font-semibold">
              {dispatchSuccess}
            </div>
          )}
          {dispatchError && (
            <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg text-xs font-semibold">
              {dispatchError}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground text-xs">
                  <th className="text-left py-3 px-2">Plan Name / ID</th>
                  <th className="text-left py-3 px-2">Created Date</th>
                  <th className="text-left py-3 px-2">Stops</th>
                  <th className="text-left py-3 px-2">Est. Distance</th>
                  <th className="text-left py-3 px-2">Est. Duration</th>
                  <th className="text-left py-3 px-2">Status</th>
                  <th className="text-right py-3 px-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {savedPlans.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-muted-foreground text-xs">
                      No saved route plans found. Optimize shipments above and click "Save Route Plan".
                    </td>
                  </tr>
                ) : (
                  savedPlans.map((p) => {
                    const stops = p.ordered_stops || []
                    const isDispatched = p.status === 'DISPATCHED'

                    return (
                      <tr key={p.id} className="border-b border-muted/30 hover:bg-muted/10 transition-colors">
                        <td className="py-3 px-2">
                          <div className="font-semibold text-xs text-slate-900 dark:text-white">{p.name || 'Delivery Route'}</div>
                          <div className="text-[10px] text-muted-foreground font-mono">{p.id}</div>
                        </td>
                        <td className="py-3 px-2 text-xs text-muted-foreground">
                          {new Date(p.created_at).toLocaleString()}
                        </td>
                        <td className="py-3 px-2 text-xs font-semibold">
                          {stops.length} stops
                        </td>
                        <td className="py-3 px-2 text-xs font-mono">
                          {p.total_distance_km} km
                        </td>
                        <td className="py-3 px-2 text-xs font-mono">
                          {Math.floor((p.estimated_duration_minutes || 0) / 60)}h {(p.estimated_duration_minutes || 0) % 60}m
                        </td>
                        <td className="py-3 px-2">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                            p.status === 'DISPATCHED' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                            p.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                            'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                          }`}>
                            {p.status}
                          </span>
                        </td>
                        <td className="py-3 px-2 text-right space-x-1 whitespace-nowrap">
                          {p.google_maps_url && (
                            <a
                              href={p.google_maps_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center text-xs h-7 px-2.5 rounded border border-input hover:bg-muted font-medium transition-colors"
                            >
                              <ExternalLink className="h-3 w-3 mr-1" /> Maps
                            </a>
                          )}
                          {!isDispatched && p.status !== 'COMPLETED' && (
                            <Button
                              size="sm"
                              className="text-xs h-7 px-2.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                              disabled={dispatchingId === p.id}
                              onClick={() => handleDispatchPlan(p.id)}
                            >
                              <Send className="h-3 w-3 mr-1" />
                              {dispatchingId === p.id ? "Dispatching..." : "Dispatch"}
                            </Button>
                          )}
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
    </div>
  )
}

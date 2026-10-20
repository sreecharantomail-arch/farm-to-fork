import { useState } from "react"
import { Button } from "./ui/Button"
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Info,
  Calendar,
  MapPin,
  Package,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  Sparkles
} from "lucide-react"
import axios from "axios"
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  ReferenceLine
} from "recharts"
import { getApiBaseUrl, getAuthToken } from "../utils"


const RUPEE = "\u20B9"

interface PredictionItem {
  date: string
  predicted_price: number
  predicted_retail_price?: number
  is_expired?: boolean
  status?: string
}

interface HistoricalItem {
  date: string
  price: number
  retail_price?: number
}

interface PricePredictionResponse {
  commodity: string
  market: string
  current_price: number
  current_retail_price?: number
  historical_data?: HistoricalItem[]
  predictions: PredictionItem[]
  expired_projections?: PredictionItem[]
  forecast_available?: boolean
  forecast_status?: string
  trend: "INCREASING" | "DECREASING" | "STABLE"
  data_source: string
  data_as_of: string
  data_age_days: number
  model_version: string
  is_stale?: boolean
  warning?: string | null
  forecast_policy?: string
  forecast_base_date?: string
  staleness_threshold_days?: number
}

const formatAsOf = (dateStr?: string) => {
  if (!dateStr) return ""
  try {
    const parts = dateStr.split("T")[0].split("-").map(Number)
    if (parts.length === 3) {
      const d = new Date(parts[0], parts[1] - 1, parts[2])
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    }
    return dateStr
  } catch {
    return dateStr
  }
}

export function FarmerAIAssistant() {
  const [commodity, setCommodity] = useState("Tomato")
  const [market, setMarket] = useState("Bangalore")
  const [forecastDays, setForecastDays] = useState<number>(7)
  const [priceMode, setPriceMode] = useState<"wholesale" | "retail">("wholesale")
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<PricePredictionResponse | null>(null)
  const [error, setError] = useState("")
  const [showExpiredProjections, setShowExpiredProjections] = useState(false)

  const handlePredict = async () => {
    setLoading(true)
    setError("")

    try {
      const apiBase = getApiBaseUrl();
      const token = getAuthToken();

      let response;
      try {
        response = await axios.post(`${apiBase}/ai/price-prediction`, {
          commodity,
          market,
          forecast_days: forecastDays
        }, {
          timeout: 10000,
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
      } catch (backendErr: any) {
        // If primary backend is unreachable, times out, or returns unavailable
        // (common when using the cloud backend which doesn't host the local Python AI process, or when running port 8000 directly),
        // seamlessly fall back to the direct local AI microservice at http://127.0.0.1:8000
        try {
          response = await axios.post(`http://127.0.0.1:8000/api/farmer/price-prediction`, {
            commodity,
            market,
            forecast_days: forecastDays
          }, {
            timeout: 8000
          });
        } catch {
          throw backendErr;
        }
      }

      if (response.data.error || response.data.error_code) {
        setError(response.data.message || "Failed to fetch prediction")
        setResult(null)
      } else {
        setResult(response.data)
      }
    } catch (err: any) {
      setError(err.response?.data?.message || "AI Service is currently offline. Please ensure the backend and AI service are running.")
      setResult(null)
    } finally {
      setLoading(false)
    }
  }

  // Active baseline price based on mode
  const activeCurrentPrice = result
    ? (priceMode === 'retail'
        ? (result.current_retail_price || result.current_price * 1.3)
        : result.current_price)
    : 0

  // Chart data: predictions with rich contextual metadata
  const chartData = result ? result.predictions.map((p, idx) => {
    const parts = p.date.split('-').map(Number)
    const d = parts.length === 3 ? new Date(parts[0], parts[1] - 1, parts[2]) : new Date(p.date)
    const wholesale = p.predicted_price
    const retail = p.predicted_retail_price || p.predicted_price * 1.3
    const price = priceMode === 'retail' ? retail : wholesale
    const diff = price - activeCurrentPrice
    const diffPct = activeCurrentPrice > 0 ? (diff / activeCurrentPrice) * 100 : 0
    return {
      dayLabel: `Day ${idx + 1}`,
      date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      fullDate: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
      price: Number(price.toFixed(2)),
      wholesalePrice: Number(wholesale.toFixed(2)),
      retailPrice: Number(retail.toFixed(2)),
      diff: Number(diff.toFixed(2)),
      diffPct: Number(diffPct.toFixed(1))
    }
  }) : []

  // Historical data for the table
  const historyTableData = result ? (result.historical_data || []).map((h, idx) => {
    const parts = h.date.split('-').map(Number)
    const d = parts.length === 3 ? new Date(parts[0], parts[1] - 1, parts[2]) : new Date(h.date)
    return {
      date: d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
      wholesale: h.price,
      retail: h.retail_price || Math.round(h.price * 1.3 * 100) / 100,
      isLatest: idx === (result.historical_data?.length || 0) - 1
    }
  }) : []

  // Calculate clear Y-axis domain with buffer so the line/area never clips
  const allPrices = chartData.map(d => d.price)
  if (activeCurrentPrice > 0) allPrices.push(activeCurrentPrice)
  const minVal = allPrices.length > 0 ? Math.min(...allPrices) : 0
  const maxVal = allPrices.length > 0 ? Math.max(...allPrices) : 100
  const priceRange = maxVal - minVal
  const padding = Math.max(1.5, priceRange * 0.25)
  const minPrice = Math.max(0, Math.floor(minVal - padding))
  const maxPrice = Math.ceil(maxVal + padding)

  // Chart summary insights
  const highestPrice = chartData.length > 0 ? Math.max(...chartData.map(d => d.price)) : 0
  const lowestPrice = chartData.length > 0 ? Math.min(...chartData.map(d => d.price)) : 0
  const peakItem = chartData.find(d => d.price === highestPrice)
  const dipItem = chartData.find(d => d.price === lowestPrice)
  const finalPrice = chartData.length > 0 ? chartData[chartData.length - 1].price : 0
  const totalChange = finalPrice - activeCurrentPrice
  const totalChangePct = activeCurrentPrice > 0 ? (totalChange / activeCurrentPrice) * 100 : 0

  // Trend accent color
  const trendColor = result?.trend === 'INCREASING'
    ? '#10b981'
    : result?.trend === 'DECREASING'
      ? '#f43f5e'
      : '#3b82f6'

  return (
    <div className="bg-white dark:bg-slate-800/50 rounded-2xl p-6 border border-slate-200 dark:border-white/5 shadow-sm text-slate-900 dark:text-white">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2.5 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
          <TrendingUp className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div>
          <h2 className="text-xl font-bold">AI Price Prediction</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">Forecast market prices using verified machine learning models</p>
        </div>
      </div>

      {/* Select Controls */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div>
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wider">
            <Package className="h-3 w-3" /> Commodity
          </label>
          <select
            value={commodity}
            onChange={(e) => setCommodity(e.target.value)}
            className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-white/10 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all dark:text-white font-medium"
          >
            <option value="Tomato">Tomato</option>
            <option value="Onion">Onion</option>
            <option value="Potato">Potato</option>
            <option value="Carrot">Carrot</option>
            <option value="Cabbage">Cabbage</option>
            <option value="Green Chilli">Green Chilli</option>
            <option value="Brinjal">Brinjal</option>
          </select>
        </div>

        <div>
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wider">
            <MapPin className="h-3 w-3" /> Market
          </label>
          <select
            value={market}
            onChange={(e) => setMarket(e.target.value)}
            className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-white/10 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all dark:text-white font-medium"
          >
            <option value="Bangalore">Bangalore</option>
            <option value="Mysore">Mysore</option>
            <option value="Mumbai">Mumbai</option>
            <option value="Pune">Pune</option>
            <option value="Delhi">Delhi</option>
            <option value="Hyderabad">Hyderabad</option>
            <option value="Chennai">Chennai</option>
          </select>
        </div>

        <div>
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wider">
            <Calendar className="h-3 w-3" /> Forecast Horizon
          </label>
          <select
            value={forecastDays}
            onChange={(e) => setForecastDays(Number(e.target.value))}
            className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-white/10 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all dark:text-white font-medium"
          >
            <option value={1}>1 Day Ahead</option>
            <option value={3}>3 Days Ahead</option>
            <option value={7}>7 Days Ahead</option>
          </select>
        </div>
      </div>

      <Button
        onClick={handlePredict}
        disabled={loading}
        className="w-full py-6 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl transition-all shadow-lg shadow-emerald-600/20 mb-6"
      >
        {loading ? "Analyzing Real Market Trends..." : "Predict Price"}
      </Button>

      {error && (
        <div className="p-4 mb-6 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      {result && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">

          {/* Stale Data Freshness Notice */}
          {result.warning && (
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/30 border border-slate-200 dark:border-white/5 text-slate-700 dark:text-slate-200 flex items-start gap-3">
              <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shrink-0 mt-0.5">
                <Info className="h-4 w-4" />
              </div>
              <div className="text-xs space-y-1 flex-1">
                <p className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                  <span>Market Data Freshness Notice</span>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 border border-emerald-500/30">
                    {result.data_age_days}d Since Observation
                  </span>
                </p>
                <p className="leading-relaxed text-slate-600 dark:text-slate-300">{result.warning}</p>
              </div>
            </div>
          )}

          {/* Data Source Notice */}
          {(result.data_source === "CEDA_AGMARKNET" || result.data_source === "DATABASE_CACHE" || !result.data_source) && (
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 flex items-center gap-3">
              <Info className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <p className="text-xs font-medium">
                {result.data_source === "CEDA_AGMARKNET"
                  ? "Primary mandi source active: Sourced from CEDA Agmarknet national database."
                  : "Using verified market repository records cached for optimal response time."}
              </p>
            </div>
          )}

          {/* Price Tier Toggle */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex bg-slate-100 dark:bg-slate-800/80 p-1 rounded-xl border border-slate-200/80 dark:border-white/5">
              <button
                onClick={() => setPriceMode("wholesale")}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                  priceMode === "wholesale"
                    ? "bg-white dark:bg-slate-700 text-emerald-700 dark:text-emerald-400 shadow-sm"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                Wholesale Mandi
              </button>
              <button
                onClick={() => setPriceMode("retail")}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                  priceMode === "retail"
                    ? "bg-white dark:bg-slate-700 text-emerald-700 dark:text-emerald-400 shadow-sm"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                City Retail
              </button>
            </div>

            <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-emerald-600" />
              <span>Viewing prices in <strong>{priceMode === 'retail' ? 'City Retail' : 'Wholesale Mandi'}</strong> tier</span>
            </div>
          </div>

          {/* Quick Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl border border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-slate-900/30">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                Latest {priceMode === 'retail' ? 'Retail' : 'Wholesale'}
              </p>
              <div className="text-2xl font-extrabold text-slate-900 dark:text-white">
                {RUPEE}{activeCurrentPrice.toFixed(2)}
                <span className="text-xs text-slate-500 dark:text-slate-400 font-normal ml-1">/kg</span>
              </div>
              <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                {result.data_age_days === 0 ? "As of today" : `As of ${formatAsOf(result.data_as_of)}`}
              </span>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-slate-900/30">
              <p className="text-xs font-semibold uppercase tracking-wider mb-1 text-slate-500 dark:text-slate-400">
                {result.is_stale ? "Live Forecast Status" : `Day ${forecastDays} Forecast`}
              </p>
              {result.is_stale ? (
                <>
                  <div className="text-2xl font-extrabold text-slate-900 dark:text-white">
                    Suspended
                  </div>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                    Data stale (no current forecast)
                  </span>
                </>
              ) : (
                <>
                  <div className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400">
                    {RUPEE}{finalPrice.toFixed(2)}
                    <span className="text-xs font-normal text-emerald-500/70 ml-1">/kg</span>
                  </div>
                  <span className={`text-[11px] font-bold flex items-center gap-0.5 ${totalChange >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                    {totalChange >= 0 ? '+' : ''}{RUPEE}{totalChange.toFixed(2)} ({totalChange >= 0 ? '+' : ''}{totalChangePct.toFixed(1)}%)
                  </span>
                </>
              )}
            </div>

            <div className="p-4 rounded-xl border border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-slate-900/30">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                {result.is_stale ? "Observed Trend" : "Forecast Trend"}
              </p>
              <div className="flex items-center gap-2 mt-0.5">
                {result.trend === 'INCREASING' && <TrendingUp className="h-6 w-6 text-emerald-500" />}
                {result.trend === 'DECREASING' && <TrendingDown className="h-6 w-6 text-rose-500" />}
                {result.trend === 'STABLE' && <Minus className="h-6 w-6 text-slate-400" />}
                <span className={`text-xl font-bold ${
                  result.trend === 'INCREASING' ? 'text-emerald-600 dark:text-emerald-400' :
                  result.trend === 'DECREASING' ? 'text-rose-600 dark:text-rose-400' : 'text-slate-700 dark:text-slate-300'
                }`}>
                  {result.trend.charAt(0) + result.trend.slice(1).toLowerCase()}
                </span>
              </div>
              <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                {result.is_stale ? `As of ${formatAsOf(result.data_as_of)} (Observed)` : "7-day direction"}
              </span>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-slate-900/30">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                Data Freshness
              </p>
              <div className="text-2xl font-extrabold text-slate-900 dark:text-white">
                {result.data_age_days === 0 ? "Live / Today" : `${result.data_age_days}d ago`}
              </div>
              <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                {result.is_stale ? "Verified Stored Records" : "Synchronized"}
              </span>
            </div>
          </div>

          {/* Stale Data Forecast Suspension Banner OR Live Area Chart */}
          {result.is_stale ? (
            <div className="p-6 rounded-xl border border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-slate-900/30 space-y-4">
              <div className="flex items-start gap-4">
                <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shrink-0">
                  <AlertTriangle className="h-6 w-6" />
                </div>
                <div className="space-y-1.5 flex-1">
                  <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <span>Forward-Looking Price Forecast Suspended</span>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 border border-emerald-500/30">
                      Safeguard Active
                    </span>
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                    The latest verified market observation for <strong className="text-slate-900 dark:text-white font-semibold">{commodity}</strong> in <strong className="text-slate-900 dark:text-white font-semibold">{market}</strong> was recorded on{" "}
                    <strong className="text-slate-900 dark:text-white font-semibold">{formatAsOf(result.data_as_of)}</strong> ({result.data_age_days} days ago).
                    To ensure farmers receive reliable and actionable advice, live forecasts are not projected from
                    market observations older than <strong className="text-slate-900 dark:text-white font-semibold">{result.staleness_threshold_days || 2} days</strong>.
                  </p>
                  <div className="text-xs text-slate-600 dark:text-slate-400 space-y-1 pt-1">
                    <p className="flex items-start gap-1.5">
                      <span className="text-emerald-500 font-bold">•</span>
                      <span>Verified daily mandi price history through <strong>{formatAsOf(result.data_as_of)}</strong> is available in the table below.</span>
                    </p>
                    <p className="flex items-start gap-1.5">
                      <span className="text-emerald-500 font-bold">•</span>
                      <span>Live forward-looking forecasts will resume automatically once fresh market data is synchronized.</span>
                    </p>
                  </div>
                </div>
              </div>

              {/* Expired Projections Toggle */}
              <div className="pt-3 border-t border-slate-200/80 dark:border-white/5 flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setShowExpiredProjections(!showExpiredProjections)}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-white dark:bg-slate-800 border border-emerald-500/30 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-slate-700 transition-all flex items-center gap-1.5 shadow-sm"
                >
                  <Calendar className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span>
                    {showExpiredProjections
                      ? "Hide Expired Projections"
                      : `View Expired Model Projections (${chartData[0]?.date || "Past"} – ${chartData[chartData.length - 1]?.date || "Past"} — Reference Only)`}
                  </span>
                </button>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 italic">
                  *Expired projections represent past model output anchored to {formatAsOf(result.data_as_of)}.
                </span>
              </div>

              {/* Optional Expired Projections Chart (Clearly Watermarked & Stamped) */}
              {showExpiredProjections && (
                <div className="mt-4 pt-4 border-t border-slate-200 dark:border-white/5 space-y-3">
                  <div className="p-2.5 rounded-lg bg-emerald-50/80 dark:bg-emerald-500/10 border border-emerald-500/20 text-xs font-semibold text-emerald-900 dark:text-emerald-200 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      <span>HISTORICAL REFERENCE ONLY — DATES IN PAST ({chartData[0]?.date} to {chartData[chartData.length - 1]?.date})</span>
                    </div>
                    <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-600/30 text-emerald-900 dark:text-white border border-emerald-500/30">
                      Expired
                    </span>
                  </div>

                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={chartData} margin={{ top: 20, right: 25, left: 0, bottom: 15 }}>
                      <defs>
                        <linearGradient id="expiredAreaGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.15} vertical={false} />
                      <XAxis dataKey="date" stroke="#64748b" tick={{ fill: '#64748b', fontSize: 12, fontWeight: 500 }} tickLine={false} dy={10} />
                      <YAxis domain={[minPrice, maxPrice]} stroke="#64748b" tick={{ fill: '#64748b', fontSize: 12, fontWeight: 500 }} tickLine={false} axisLine={false} tickFormatter={(val) => `${RUPEE}${val}`} dx={-5} />
                      {activeCurrentPrice > 0 && (
                        <ReferenceLine
                          y={activeCurrentPrice}
                          stroke="#059669"
                          strokeDasharray="4 4"
                          strokeWidth={1.5}
                          label={{
                            value: `Historical Base (${formatAsOf(result.data_as_of)}): ${RUPEE}${activeCurrentPrice.toFixed(2)}`,
                            fill: '#059669',
                            position: 'insideTopLeft',
                            fontSize: 11,
                            fontWeight: 700
                          }}
                        />
                      )}
                      <RechartsTooltip
                        content={({ active, payload }) => {
                          if (active && payload && payload.length) {
                            const data = payload[0].payload
                            return (
                              <div className="bg-slate-900/95 backdrop-blur-md border border-emerald-500/30 rounded-xl p-3 shadow-2xl text-xs space-y-2 min-w-[210px] text-white">
                                <div className="flex items-center justify-between pb-1.5 border-b border-slate-800">
                                  <span className="font-semibold text-slate-200">{data.fullDate}</span>
                                  <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold text-[10px]">
                                    EXPIRED
                                  </span>
                                </div>
                                <div className="flex justify-between items-baseline pt-0.5">
                                  <span className="text-slate-400 font-medium">Expired Projection:</span>
                                  <span className="text-base font-extrabold text-emerald-400">
                                    {RUPEE}{data.price.toFixed(2)}
                                    <span className="text-xs text-slate-400 font-normal">/kg</span>
                                  </span>
                                </div>
                                <div className="text-[10px] text-emerald-400/90 italic pt-1 border-t border-slate-800">
                                  Calculated from {formatAsOf(result.data_as_of)} observation (Date has passed)
                                </div>
                              </div>
                            )
                          }
                          return null
                        }}
                      />
                      <Area type="monotone" dataKey="price" stroke="#10b981" strokeWidth={2.5} fill="url(#expiredAreaGradient)" dot={{ r: 4, fill: '#ffffff', stroke: '#10b981', strokeWidth: 2 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          ) : (
            /* Live Fresh Forecast Area Chart */
            <div className="p-6 rounded-xl border border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-slate-900/30">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <span>{forecastDays}-Day Price Forecast</span>
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300">
                      Live Forecast
                    </span>
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Green dashed baseline shows price on {formatAsOf(result.data_as_of)} ({RUPEE}{activeCurrentPrice.toFixed(2)}) for clear comparison
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {peakItem && (
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-semibold">
                      <ArrowUpRight className="h-3.5 w-3.5 text-emerald-500" />
                      <span>Peak: {RUPEE}{highestPrice.toFixed(2)} ({peakItem.date})</span>
                    </div>
                  )}
                  {dipItem && dipItem.price !== peakItem?.price && (
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 font-semibold">
                      <ArrowDownRight className="h-3.5 w-3.5 text-slate-500" />
                      <span>Low: {RUPEE}{lowestPrice.toFixed(2)} ({dipItem.date})</span>
                    </div>
                  )}
                </div>
              </div>

              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={chartData} margin={{ top: 20, right: 25, left: 0, bottom: 15 }}>
                  <defs>
                    <linearGradient id="forecastAreaGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={trendColor} stopOpacity={0.35} />
                      <stop offset="95%" stopColor={trendColor} stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.15} vertical={false} />
                  <XAxis dataKey="date" stroke="#64748b" tick={{ fill: '#64748b', fontSize: 12, fontWeight: 500 }} tickLine={false} axisLine={{ stroke: '#cbd5e1', strokeOpacity: 0.3 }} dy={10} />
                  <YAxis domain={[minPrice, maxPrice]} stroke="#64748b" tick={{ fill: '#64748b', fontSize: 12, fontWeight: 500 }} tickLine={false} axisLine={false} tickFormatter={(val) => `${RUPEE}${val}`} dx={-5} />
                  {activeCurrentPrice > 0 && (
                    <ReferenceLine
                      y={activeCurrentPrice}
                      stroke="#10b981"
                      strokeDasharray="4 4"
                      strokeWidth={1.5}
                      label={{
                        value: `Base (${formatAsOf(result.data_as_of)}): ${RUPEE}${activeCurrentPrice.toFixed(2)}`,
                        fill: '#10b981',
                        position: 'insideTopLeft',
                        fontSize: 11,
                        fontWeight: 700
                      }}
                    />
                  )}
                  <RechartsTooltip
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0].payload
                        const isUp = data.diff >= 0
                        return (
                          <div className="bg-slate-900/95 backdrop-blur-md border border-slate-700 rounded-xl p-3 shadow-2xl text-xs space-y-2 min-w-[210px] text-white">
                            <div className="flex items-center justify-between pb-1.5 border-b border-slate-800">
                              <span className="font-semibold text-slate-200">{data.fullDate}</span>
                              <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold text-[10px]">
                                {data.dayLabel}
                              </span>
                            </div>
                            <div className="flex justify-between items-baseline pt-0.5">
                              <span className="text-slate-400 font-medium">Forecast ({priceMode}):</span>
                              <span className="text-base font-extrabold text-white">
                                {RUPEE}{data.price.toFixed(2)}
                                <span className="text-xs text-slate-400 font-normal">/kg</span>
                              </span>
                            </div>
                            <div className="flex justify-between items-center bg-slate-800/70 px-2 py-1 rounded-md">
                              <span className="text-[11px] text-slate-400">Change vs Base:</span>
                              <span className={`text-[11px] font-bold flex items-center gap-0.5 ${isUp ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {isUp ? '+' : ''}{RUPEE}{data.diff.toFixed(2)} ({isUp ? '+' : ''}{data.diffPct.toFixed(1)}%)
                              </span>
                            </div>
                            <div className="grid grid-cols-2 gap-2 pt-1.5 border-t border-slate-800 text-[10px] text-slate-400">
                              <div>Wholesale: <strong className="text-slate-200 font-semibold">{RUPEE}{data.wholesalePrice.toFixed(2)}</strong></div>
                              <div>Retail: <strong className="text-slate-200 font-semibold">{RUPEE}{data.retailPrice.toFixed(2)}</strong></div>
                            </div>
                          </div>
                        )
                      }
                      return null
                    }}
                  />
                  <Area type="monotone" dataKey="price" stroke={trendColor} strokeWidth={3} fill="url(#forecastAreaGradient)" dot={{ r: 4, fill: '#ffffff', stroke: trendColor, strokeWidth: 2.5 }} activeDot={{ r: 7, fill: trendColor, stroke: '#ffffff', strokeWidth: 2 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Historical Price Table */}
          {historyTableData.length > 0 && (
            <div className="p-6 rounded-xl border border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-slate-900/30">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Previous 10-Day Market History
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Continuous daily market records leading up to {formatAsOf(result.data_as_of)}
                  </p>
                </div>
                <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border border-emerald-500/20">
                  {historyTableData.length} Days Tracked
                </span>
              </div>

              <div className="overflow-x-auto rounded-lg border border-slate-200/80 dark:border-white/5">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-100/80 dark:bg-slate-800/60 border-b border-slate-200 dark:border-white/10">
                      <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Date</th>
                      <th className="text-right py-3 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Wholesale (per kg)</th>
                      <th className="text-right py-3 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Est. Retail (per kg)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyTableData.map((row, i) => (
                      <tr
                        key={i}
                        className={`border-b border-slate-100 dark:border-white/5 transition-colors ${
                          row.isLatest
                            ? 'bg-emerald-50/60 dark:bg-emerald-500/10 hover:bg-emerald-50 dark:hover:bg-emerald-500/20'
                            : 'hover:bg-slate-100 dark:hover:bg-slate-800/40'
                        }`}
                      >
                        <td className="py-3 px-4 text-slate-700 dark:text-slate-300 font-medium flex items-center gap-2">
                          <span>{row.date}</span>
                          {row.isLatest && (
                            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-600 text-white">
                              {result.data_age_days === 0 ? "Today" : "Latest Record"}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right text-slate-900 dark:text-white font-semibold">
                          {RUPEE}{row.wholesale.toFixed(2)}
                        </td>
                        <td className="py-3 px-4 text-right text-slate-600 dark:text-slate-400 font-medium">
                          {RUPEE}{row.retail.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Model Info Footer */}
          <div className="p-4 rounded-xl bg-slate-100 dark:bg-slate-900/50 border border-slate-200 dark:border-white/5 text-xs text-slate-600 dark:text-slate-400 flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>Forecast modeled on daily market patterns using XGBoost regression.</span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-2 opacity-80">
              <span><strong>Data Source:</strong> {(result.data_source || 'DATABASE_CACHE').replace('_', ' ')}</span>
              <span><strong>Data As Of:</strong> {formatAsOf(result.data_as_of)}</span>
              <span><strong>Policy:</strong> {result.forecast_policy || 'OBSERVATION_ANCHORED'}</span>
              <span><strong>Model:</strong> XGBoost v{result.model_version}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

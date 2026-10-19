import { useState } from "react"
import axios from "axios"
import { useAuth } from "../../context/AuthContext"
import { Search, MapPin, Calendar, User, Hash, Box, AlertCircle, Link as LinkIcon, CheckCircle2 } from "lucide-react"

const API_URL = import.meta.env.VITE_API_URL || "https://farm-to-fork-tracker.onrender.com/api"

export function Traceability() {
  const { token } = useAuth()

  const [searchQuery, setSearchQuery] = useState("")
  const [traceData, setTraceData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!searchQuery.trim()) return

    setLoading(true)
    setError("")
    setTraceData(null)


    try {
      const res = await axios.get(`${API_URL}/retailer/traceability/${searchQuery}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setTraceData(res.data.data)
    } catch (err: any) {
      setError(err.response?.data?.message || "Batch not found or server error")
    } finally {
      setLoading(false)
    }
  }

  const getEventIcon = (type: string) => {
    if (type.includes("RECEIVED")) return <MapPin className="h-4 w-4" />
    if (type.includes("SOLD")) return <Box className="h-4 w-4" />
    if (type.includes("WASTED")) return <AlertCircle className="h-4 w-4" />
    return <CheckCircle2 className="h-4 w-4" />
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="text-center space-y-2 mb-8">
        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Product Provenance</h1>
        <p className="text-slate-500 max-w-lg mx-auto">Verify the origin and journey of any product batch using the secure traceability ledger.</p>
      </div>

      {/* Search Bar */}
      <form onSubmit={handleSearch} className="relative max-w-xl mx-auto">
        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
          <Search className="h-5 w-5 text-slate-400" />
        </div>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Enter Batch Number (e.g., BATCH-QR-12345)"
          className="block w-full pl-12 pr-32 py-4 border-2 border-slate-200 rounded-2xl text-slate-900 bg-white placeholder-slate-400 focus:outline-none focus:ring-4 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all font-mono text-sm shadow-sm"
        />
        <button
          type="submit"
          disabled={loading || !searchQuery.trim()}
          className="absolute right-2 top-2 bottom-2 px-6 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-bold text-sm rounded-xl transition-colors"
        >
          {loading ? "Searching..." : "Track"}
        </button>
      </form>

      {error && (
        <div className="p-4 bg-rose-50 border-2 border-rose-200 rounded-2xl text-center text-rose-600 font-medium animate-in fade-in">
          {error}
        </div>
      )}

      {/* Results */}
      {traceData && traceData.product && (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-6">
          {/* Product Overview Card */}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden relative">
            <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-emerald-400 to-cyan-500"></div>
            <div className="p-8">
              <div className="flex flex-col md:flex-row gap-6 items-start md:items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">{traceData.product.name}</h2>
                  <div className="flex flex-wrap gap-3 mt-2">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-100 text-slate-600 text-xs font-bold rounded-lg border border-slate-200">
                      <Hash className="h-3.5 w-3.5" /> Batch: {traceData.product.batch_number}
                    </span>
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-700 text-xs font-bold rounded-lg border border-emerald-200">
                      <Box className="h-3.5 w-3.5" /> Category: {traceData.product.category}
                    </span>
                  </div>
                </div>
                
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 min-w-[200px]">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Origin Farmer</p>
                  <p className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <User className="h-4 w-4 text-emerald-600" />
                    {traceData.product.farmer?.name || "Unknown Farm"}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Blockchain Hash (if any) */}
          {traceData.product.blockchain_hash && (
            <div className="bg-slate-900 rounded-2xl p-4 text-white shadow-lg flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 bg-emerald-500/20 rounded-full flex items-center justify-center shrink-0">
                  <LinkIcon className="h-5 w-5 text-emerald-400" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-0.5">Verified on Blockchain</p>
                  <p className="font-mono text-xs text-slate-300 break-all">{traceData.product.blockchain_hash}</p>
                </div>
              </div>
            </div>
          )}

          {/* Timeline */}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-8">
            <h3 className="text-lg font-bold text-slate-900 mb-8">Supply Chain Journey</h3>
            
            <div className="relative border-l-2 border-slate-100 ml-4 space-y-8">
              {/* Genesis Event (Farm) */}
              <div className="relative pl-8">
                <div className="absolute -left-[9px] top-1 h-4 w-4 rounded-full border-2 border-white bg-emerald-500 ring-4 ring-emerald-50"></div>
                <div className="mb-1 flex items-center gap-2 text-xs font-bold text-emerald-600 uppercase tracking-wider">
                  <Calendar className="h-3.5 w-3.5" /> {new Date(traceData.product.created_at).toLocaleString()}
                </div>
                <h4 className="text-base font-bold text-slate-900">Harvested & Registered</h4>
                <p className="text-sm text-slate-500 mt-1">Product genesis at <span className="font-semibold text-slate-700">{traceData.product.farmer?.name || "Farm"}</span>.</p>
              </div>

              {/* Dynamic Traceability Events */}
              {traceData.events?.map((evt: any) => (
                <div key={evt.id} className="relative pl-8">
                  <div className="absolute -left-[9px] top-1 h-4 w-4 rounded-full border-2 border-white bg-slate-400 ring-4 ring-slate-50"></div>
                  
                  <div className="mb-1 flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider">
                    <Calendar className="h-3.5 w-3.5" /> {new Date(evt.created_at).toLocaleString()}
                  </div>
                  
                  <h4 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    {getEventIcon(evt.event_type)}
                    {evt.event_type.replace(/_/g, ' ')}
                  </h4>
                  
                  <div className="mt-2 p-3 bg-slate-50 rounded-xl border border-slate-100 text-sm text-slate-600">
                    <div className="flex gap-4 mb-2">
                      {evt.actor && <span className="font-semibold text-slate-800"><User className="h-3.5 w-3.5 inline mr-1 text-slate-400"/> {evt.actor.name} ({evt.actor.role})</span>}
                      {evt.location && <span><MapPin className="h-3.5 w-3.5 inline mr-1 text-slate-400"/> {evt.location}</span>}
                    </div>
                    {evt.blockchain_hash && (
                      <div className="text-[10px] font-mono bg-white p-2 rounded border border-slate-200 text-slate-500 break-all mb-2">
                        TX: {evt.blockchain_hash}
                      </div>
                    )}
                    {evt.metadata && (
                      <div className="text-xs space-y-1">
                        {Object.entries(evt.metadata).map(([k, v]) => (
                          <div key={k}><span className="font-medium capitalize text-slate-500">{k.replace(/_/g, ' ')}:</span> {String(v)}</div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

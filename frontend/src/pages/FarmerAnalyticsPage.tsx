import { useState, useEffect } from "react"
import axios from "axios"
import { useAuth } from "../context/AuthContext"
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/Card"
import { BarChart3, Package, Layers, Activity, AlertTriangle, CheckCircle2, Factory } from "lucide-react"

const API = import.meta.env.VITE_API_URL || "https://farm-to-fork-tracker.onrender.com/api"

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#64748b']

export function FarmerAnalyticsPage() {
  const { token } = useAuth()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    fetchAnalytics()
  }, [token])

  const fetchAnalytics = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await axios.get(`${API}/farmer/analytics`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.data.success) {
        setData(res.data.data)
      } else {
        setError("Failed to load analytics data.")
      }
    } catch (err) {
      console.error(err)
      setError("Unable to load analytics. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <div className="text-center space-y-4">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto"></div>
          <p className="text-muted-foreground animate-pulse">Loading real-time analytics...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <div className="text-center space-y-4 p-8 rounded-2xl bg-red-500/10 border border-red-500/20 max-w-md">
          <AlertTriangle className="h-8 w-8 text-red-500 mx-auto" />
          <p className="text-red-500 font-medium">{error}</p>
          <button onClick={fetchAnalytics} className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors">
            Try Again
          </button>
        </div>
      </div>
    )
  }

  if (!data || data.core.totalProducts === 0) {
    return (
      <div className="flex flex-col h-[60vh] items-center justify-center p-4">
        <div className="text-center space-y-4 p-10 rounded-3xl border border-dashed border-white/20 bg-slate-900/50 max-w-md w-full">
          <div className="bg-primary/20 p-4 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-2">
            <BarChart3 className="h-10 w-10 text-primary" />
          </div>
          <h2 className="text-xl font-bold text-foreground">No product data available yet.</h2>
          <p className="text-muted-foreground text-sm">Register your first product to start seeing analytics.</p>
        </div>
      </div>
    )
  }

  // Formatting chart data
  const statusData = Object.entries(data.statusDistribution || {}).map(([name, value]) => ({ name, value }))
  const qualityData = Object.entries(data.quality?.qualityDistribution || {}).map(([name, value]) => ({ name, value }))
  const shelfLifeData = [
    { name: 'Healthy', value: data.shelfLife?.healthy || 0 },
    { name: 'Expiring Soon', value: data.shelfLife?.expiringSoon || 0 },
    { name: 'Expired', value: data.shelfLife?.expired || 0 }
  ].filter(d => d.value > 0)

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-20 px-4 pt-6 animate-in fade-in duration-300">
      
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <BarChart3 className="h-8 w-8 text-primary" /> 
            Analytics & Insights
          </h1>
          <p className="text-muted-foreground mt-1">Real-time operational metrics for your farm products.</p>
        </div>
        <button 
          onClick={fetchAnalytics}
          className="px-4 py-2 bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20 rounded-xl font-medium transition-colors text-sm"
        >
          Refresh Data
        </button>
      </div>

      {/* TOP SUMMARY CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-slate-900 border-white/10 hover:border-primary/30 transition-colors">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Products</p>
                <h3 className="text-3xl font-bold text-foreground mt-1">{data.core.totalProducts}</h3>
              </div>
              <div className="p-3 bg-blue-500/10 rounded-2xl">
                <Package className="h-6 w-6 text-blue-500" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-4">All time registered batches</p>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-white/10 hover:border-emerald-500/30 transition-colors">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Active Quantity</p>
                <h3 className="text-3xl font-bold text-foreground mt-1">{data.core.activeQuantity} <span className="text-sm font-normal text-muted-foreground">kg</span></h3>
              </div>
              <div className="p-3 bg-emerald-500/10 rounded-2xl">
                <Layers className="h-6 w-6 text-emerald-500" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-4">Total volume: {data.core.totalQuantity} kg</p>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-white/10 hover:border-amber-500/30 transition-colors">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Average Quality</p>
                <h3 className="text-3xl font-bold text-foreground mt-1">
                  {data.quality.averageQuality ? `${data.quality.averageQuality}%` : "N/A"}
                </h3>
              </div>
              <div className="p-3 bg-amber-500/10 rounded-2xl">
                <CheckCircle2 className="h-6 w-6 text-amber-500" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-4">Across {data.quality.productsWithQualityData} inspected items</p>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-white/10 hover:border-purple-500/30 transition-colors">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Traceability Events</p>
                <h3 className="text-3xl font-bold text-foreground mt-1">{data.traceability.totalEvents}</h3>
              </div>
              <div className="p-3 bg-purple-500/10 rounded-2xl">
                <Activity className="h-6 w-6 text-purple-500" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-4">Supply chain milestone records</p>
          </CardContent>
        </Card>
      </div>

      {/* CHARTS GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Status Distribution */}
        <Card className="bg-slate-900 border-white/10">
          <CardHeader>
            <CardTitle className="text-lg">Supply Chain Status</CardTitle>
            <CardDescription>Current stage distribution of all products</CardDescription>
          </CardHeader>
          <CardContent>
            {statusData.length > 0 ? (
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={statusData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={90}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {statusData.map((_entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '12px' }}
                      itemStyle={{ color: '#fff' }}
                    />
                    <Legend verticalAlign="bottom" height={36} iconType="circle" />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-[300px] flex items-center justify-center">
                <p className="text-muted-foreground text-sm">Insufficient data</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Production Trend */}
        <Card className="bg-slate-900 border-white/10">
          <CardHeader>
            <CardTitle className="text-lg">Production Trend</CardTitle>
            <CardDescription>Volume registered over time (kg)</CardDescription>
          </CardHeader>
          <CardContent>
            {data.productionTrend?.length > 1 ? (
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.productionTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                    <XAxis dataKey="period" stroke="#64748b" tick={{ fill: '#64748b', fontSize: 12 }} />
                    <YAxis stroke="#64748b" tick={{ fill: '#64748b', fontSize: 12 }} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '12px' }}
                      itemStyle={{ color: '#fff' }}
                      cursor={{ fill: '#1e293b', opacity: 0.4 }}
                    />
                    <Bar dataKey="quantity" fill="#10b981" radius={[4, 4, 0, 0]} name="Quantity (kg)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-[300px] flex items-center justify-center flex-col gap-2 text-center">
                <Factory className="h-8 w-8 text-muted-foreground/50" />
                <p className="text-muted-foreground text-sm">Not enough historical data for a meaningful trend.</p>
                <p className="text-muted-foreground text-xs">Need at least 2 time periods.</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quality Distribution */}
        <Card className="bg-slate-900 border-white/10">
          <CardHeader>
            <CardTitle className="text-lg">Quality Distribution</CardTitle>
            <CardDescription>AI-assisted quality grades based on inspection data</CardDescription>
          </CardHeader>
          <CardContent>
            {qualityData.length > 0 ? (
              <div className="h-[250px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={qualityData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={true} vertical={false} />
                    <XAxis type="number" stroke="#64748b" tick={{ fill: '#64748b', fontSize: 12 }} />
                    <YAxis dataKey="name" type="category" stroke="#64748b" tick={{ fill: '#64748b', fontSize: 12 }} width={80} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '12px' }}
                      itemStyle={{ color: '#fff' }}
                      cursor={{ fill: '#1e293b', opacity: 0.4 }}
                    />
                    <Bar dataKey="value" fill="#3b82f6" radius={[0, 4, 4, 0]} name="Batches" barSize={30} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-[250px] flex items-center justify-center">
                <p className="text-muted-foreground text-sm">No quality data available</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Shelf Life Status */}
        <Card className="bg-slate-900 border-white/10">
          <CardHeader>
            <CardTitle className="text-lg">Shelf Life Status</CardTitle>
            <CardDescription>Expiry distribution based on AI predictions</CardDescription>
          </CardHeader>
          <CardContent>
            {shelfLifeData.length > 0 ? (
              <div className="h-[250px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={shelfLifeData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {shelfLifeData.map((entry, index) => {
                        let color = '#64748b'
                        if (entry.name === 'Healthy') color = '#10b981'
                        if (entry.name === 'Expiring Soon') color = '#f59e0b'
                        if (entry.name === 'Expired') color = '#ef4444'
                        return <Cell key={`cell-${index}`} fill={color} />
                      })}
                    </Pie>
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '12px' }}
                      itemStyle={{ color: '#fff' }}
                    />
                    <Legend verticalAlign="bottom" height={36} iconType="circle" />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-[250px] flex items-center justify-center">
                <p className="text-muted-foreground text-sm">No shelf life data available</p>
              </div>
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  )
}

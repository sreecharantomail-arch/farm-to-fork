import { useState, useEffect } from "react"
import axios from "axios"
import { useAuth } from "../context/AuthContext"
import { Card, CardContent } from "../components/ui/Card"
import {
  Bell, CheckCircle2, Clock, AlertTriangle, Info,
  Check, ArrowRight, Factory, Truck
} from "lucide-react"

const API = import.meta.env.VITE_API_URL || "https://farm-to-fork-tracker.onrender.com/api"

export interface DbNotification {
  id: string
  type: string
  title: string
  message: string
  is_read: boolean
  related_entity_type?: string
  related_entity_id?: string
  created_at: string
}

export function FarmerNotificationsPage() {
  const { token } = useAuth()
  const [notifications, setNotifications] = useState<DbNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const fetchNotifications = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await axios.get(`${API}/notifications`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.data.success) {
        setNotifications(res.data.data)
      } else {
        setError("Failed to load notifications.")
      }
    } catch (err) {
      console.error(err)
      setError("Unable to load notifications. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchNotifications()
  }, [token])

  const handleMarkAsRead = async (id: string) => {
    try {
      await axios.put(`${API}/notifications/${id}/read`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n))
      // Dispatch event so dashboard bell can update
      window.dispatchEvent(new Event("farmer_notifications_updated"))
    } catch (err) {
      console.error("Failed to mark as read", err)
    }
  }

  const handleMarkAllAsRead = async () => {
    try {
      await axios.put(`${API}/notifications/read-all`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
      window.dispatchEvent(new Event("farmer_notifications_updated"))
    } catch (err) {
      console.error("Failed to mark all as read", err)
    }
  }

  const getIcon = (type: string) => {
    if (type === 'expiry_alert') return <AlertTriangle className="h-5 w-5 text-amber-500" />
    if (type === 'product_status') return <Factory className="h-5 w-5 text-blue-500" />
    if (type === 'product_created') return <CheckCircle2 className="h-5 w-5 text-green-500" />
    if (type === 'traceability_event') return <Truck className="h-5 w-5 text-purple-500" />
    return <Info className="h-5 w-5 text-slate-400" />
  }

  if (loading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <div className="text-center space-y-4">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto"></div>
          <p className="text-muted-foreground animate-pulse">Loading notifications...</p>
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
          <button onClick={fetchNotifications} className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors">
            Try Again
          </button>
        </div>
      </div>
    )
  }

  const unreadCount = notifications.filter(n => !n.is_read).length

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-20 px-4 pt-6 animate-in fade-in duration-300">
      
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Bell className="h-8 w-8 text-primary" /> 
            Notifications
          </h1>
          <p className="text-muted-foreground mt-1">Stay updated on your product status, expiry alerts, and traceability.</p>
        </div>
        
        {unreadCount > 0 && (
          <button 
            onClick={handleMarkAllAsRead}
            className="px-4 py-2 bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20 rounded-xl font-medium transition-colors text-sm flex items-center gap-2"
          >
            <Check className="h-4 w-4" />
            Mark All as Read
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className="flex flex-col h-[40vh] items-center justify-center p-4">
          <div className="text-center space-y-4 p-10 rounded-3xl border border-dashed border-white/20 bg-slate-900/50 max-w-md w-full">
            <div className="bg-primary/20 p-4 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-2">
              <CheckCircle2 className="h-10 w-10 text-primary" />
            </div>
            <h2 className="text-xl font-bold text-foreground">You're all caught up.</h2>
            <p className="text-muted-foreground text-sm">No new notifications.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {notifications.map(n => (
            <Card key={n.id} className={`bg-slate-900 border-white/10 transition-colors hover:border-white/20 ${!n.is_read ? 'border-l-4 border-l-primary' : ''}`}>
              <CardContent className="p-4 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center gap-4">
                <div className={`p-3 rounded-full shrink-0 ${!n.is_read ? 'bg-primary/10' : 'bg-slate-800'}`}>
                  {getIcon(n.type)}
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className={`font-semibold truncate ${!n.is_read ? 'text-foreground' : 'text-slate-400'}`}>
                      {n.title}
                    </h3>
                    {!n.is_read && (
                      <span className="px-2 py-0.5 rounded-full bg-primary/20 text-primary text-[10px] font-bold uppercase tracking-wider">
                        New
                      </span>
                    )}
                  </div>
                  <p className={`text-sm ${!n.is_read ? 'text-slate-300' : 'text-slate-500'}`}>
                    {n.message}
                  </p>
                  <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(n.created_at).toLocaleString()}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 mt-4 sm:mt-0 w-full sm:w-auto shrink-0 justify-end">
                  {!n.is_read && (
                    <button 
                      onClick={() => handleMarkAsRead(n.id)}
                      className="px-3 py-1.5 text-sm bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors border border-slate-700"
                    >
                      Mark Read
                    </button>
                  )}
                  {n.related_entity_type === 'product' && (
                    <a 
                      href="/farmer/products"
                      className="px-3 py-1.5 text-sm bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors flex items-center gap-1"
                    >
                      View
                      <ArrowRight className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

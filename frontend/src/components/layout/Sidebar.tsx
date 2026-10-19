import { Link, useLocation, useNavigate } from "react-router-dom"
import {
  LayoutDashboard, Leaf, PackageSearch, Truck,
  Factory, LogOut, BarChart3, Menu, X, Edit3, Camera, MapPin, Locate, Loader2, CheckCircle2, Clock, QrCode, Trash2, ShoppingCart, Package, DollarSign, RefreshCw, AlertTriangle, LinkIcon, Wand2, Bell, Activity, AlertOctagon, Brain
} from "lucide-react"
import { cn } from "../../utils"
import { useAuth } from "../../context/AuthContext"
import { useState, useEffect } from "react"

const roleNavMap: Record<string, { name: string; path: string; icon: React.ElementType }[]> = {
  admin: [
    { name: "Overview", path: "/admin", icon: LayoutDashboard },
    { name: "User Directory", path: "/admin/users", icon: Edit3 },
    { name: "Supply Chain", path: "/admin/products", icon: Factory },
    { name: "Analytics", path: "/admin/analytics", icon: BarChart3 },
    { name: "SC Intelligence", path: "/admin/supply-chain-analytics", icon: Activity },
    { name: "Anomaly Intel", path: "/admin/anomaly-detection", icon: AlertOctagon },
    { name: "AI Observability", path: "/admin/ai-observability", icon: Brain },
    { name: "Track Product", path: "/track", icon: PackageSearch },
  ],
  farmer: [
    { name: "My Farm", path: "/farmer", icon: Leaf },
    { name: "My Products", path: "/farmer/products", icon: PackageSearch },
    { name: "AI Services", path: "/farmer/ai-services", icon: Wand2 },
    { name: "Supply Requests", path: "/farmer/requests", icon: ShoppingCart },
    { name: "Analytics", path: "/farmer/analytics", icon: BarChart3 },
    { name: "Notifications", path: "/farmer/notifications", icon: Bell },
    { name: "Track Product", path: "/track", icon: PackageSearch },
  ],
  processor: [
    { name: "Processing", path: "/processor", icon: Factory },
    { name: "Track Product", path: "/track", icon: PackageSearch },
  ],
  distributor: [
    { name: "Shipments", path: "/distributor", icon: Truck },
    { name: "Track Product", path: "/track", icon: PackageSearch },
  ],
  retailer: [
    { name: "Dashboard", path: "/retailer", icon: LayoutDashboard },
    { name: "Order Stock", path: "/retailer/requests", icon: ShoppingCart },
    { name: "Shipments", path: "/retailer/shipments", icon: Truck },
    { name: "Receive Batch", path: "/retailer/receive", icon: QrCode },
    { name: "Inventory", path: "/retailer/inventory", icon: Package },
    { name: "Point of Sale", path: "/retailer/sales", icon: DollarSign },
    { name: "Wastage", path: "/retailer/wastage", icon: Trash2 },
    { name: "Expiry", path: "/retailer/expiry", icon: Clock },
    { name: "Returns", path: "/retailer/returns", icon: RefreshCw },
    { name: "Alerts", path: "/retailer/alerts", icon: AlertTriangle },
    { name: "Traceability", path: "/retailer/traceability", icon: LinkIcon },
  ],
  consumer: [
    { name: "Track Product", path: "/track", icon: PackageSearch },
  ],
}

export function Sidebar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, logout, updateUser } = useAuth()
  const [collapsed, setCollapsed] = useState(false)

  // Profile modal state
  const [showModal, setShowModal] = useState(false)
  const [newPhoto, setNewPhoto] = useState<string | null>(null)
  const [newAddress, setNewAddress] = useState("")
  const [locating, setLocating] = useState(false)
  const [newName, setNewName] = useState("")
  const [newEmail, setNewEmail] = useState("")
  const [newPhone, setNewPhone] = useState("")
  const [successMsg, setSuccessMsg] = useState("")
  const [lat, setLat] = useState<number | null>(null)
  const [lng, setLng] = useState<number | null>(null)

  const role = user?.role || "consumer"
  const navItems = roleNavMap[role] || roleNavMap.consumer

  const handleLogout = () => {
    logout()
    navigate("/")
  }

  const handleOpenModal = () => {
    setNewAddress(user?.address || "")
    setNewPhoto(null)
    setNewName(user?.name || "")
    setNewEmail(user?.email || "")
    setNewPhone(user?.phone || "")
    setLat(null)
    setLng(null)
    setSuccessMsg("")
    setShowModal(true)
  }

  // Listen for global open modal events
  useEffect(() => {
    const handleOpen = () => handleOpenModal()
    window.addEventListener("open_farmer_settings", handleOpen)
    window.addEventListener("open_processor_settings", handleOpen)
    return () => {
      window.removeEventListener("open_farmer_settings", handleOpen)
      window.removeEventListener("open_processor_settings", handleOpen)
    }
  }, [user])

  const handleFetchGPSLocation = () => {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser.")
      return
    }

    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords
        setLat(latitude)
        setLng(longitude)
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`
          )
          const data = await res.json()
          if (data && data.display_name) {
            setNewAddress(data.display_name)
          } else {
            setNewAddress(`Lat: ${latitude.toFixed(4)}, Long: ${longitude.toFixed(4)}`)
          }
        } catch {
          setNewAddress(`Lat: ${latitude.toFixed(4)}, Long: ${longitude.toFixed(4)}`)
        } finally {
          setLocating(false)
        }
      },
      (err) => {
        console.error("Location error:", err)
        alert("Unable to detect location. Please enter manually.")
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault()
    const nowISO = new Date().toISOString()
    const updates: Record<string, string> = {}

    if (newName !== user?.name) updates.name = newName
    if (newEmail !== user?.email) updates.email = newEmail
    if (newPhone !== user?.phone) updates.phone = newPhone
    if (newAddress !== user?.address) updates.address = newAddress
    if (newPhoto) updates.photo = newPhoto
    updates.settingsLastUpdated = nowISO

    if (Object.keys(updates).length > 0) {
      updateUser(updates)
      if (updates.address) {
        if (user?.role === "farmer") {
          localStorage.setItem("farmer_address", updates.address)
        } else if (user?.role === "processor") {
          localStorage.setItem("processor_address", updates.address)
        } else if (user?.role === "distributor") {
          localStorage.setItem("distributor_address", updates.address)
        } else if (user?.role === "retailer") {
          localStorage.setItem("retailer_address", updates.address)
        } else if (user?.role === "consumer") {
          localStorage.setItem("consumer_address", updates.address)
        }
      }

      // Sync registered user profiles map
      if (user?.email) {
        try {
          const userProfiles = JSON.parse(localStorage.getItem("registered_user_profiles") || "{}")
          if (userProfiles[user.email.toLowerCase()]) {
            userProfiles[user.email.toLowerCase()] = {
              ...userProfiles[user.email.toLowerCase()],
              ...updates,
            }
          }
          if (updates.email && updates.email.toLowerCase() !== user.email.toLowerCase()) {
            userProfiles[updates.email.toLowerCase()] = {
              ...(userProfiles[user.email.toLowerCase()] || {}),
              ...updates,
            }
          }
          localStorage.setItem("registered_user_profiles", JSON.stringify(userProfiles))
        } catch (err) {
          console.warn("Could not sync registered_user_profiles", err)
        }
      }

      window.dispatchEvent(new Event("farmer_profile_updated"))
      const roleLabel = user?.role ? (user.role.charAt(0).toUpperCase() + user.role.slice(1)) : "User"
      setSuccessMsg(`${roleLabel} settings saved successfully!`)
      setTimeout(() => {
        setShowModal(false)
        setSuccessMsg("")
      }, 1200)
    } else {
      setShowModal(false)
    }
  }

  return (
    <>
      <div className={cn(
        "flex h-screen flex-col border-r border-emerald-100 bg-white transition-all duration-300",
        collapsed ? "w-16" : "w-64"
      )}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          {!collapsed && (
            <div>
              <h2 className="text-xl font-bold tracking-tight text-primary">FarmChain AI</h2>
              <p className="text-xs text-muted-foreground mt-0.5 truncate">Blockchain Traceability</p>
            </div>
          )}
          <button onClick={() => setCollapsed(!collapsed)} className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground">
            {collapsed ? <Menu className="h-5 w-5" /> : <X className="h-4 w-4" />}
          </button>
        </div>

        {/* User info */}
        {!collapsed && user && (
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              {user.photo ? (
                <img
                  src={user.photo}
                  alt={user.name}
                  className="h-9 w-9 rounded-full object-cover border-2 border-emerald-500 shrink-0"
                />
              ) : (
                <div className="h-9 w-9 rounded-full bg-emerald-100 flex items-center justify-center text-primary font-bold text-sm shrink-0">
                  {user.name ? user.name.charAt(0).toUpperCase() : "U"}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{user.name}</p>
                <p className="text-xs text-muted-foreground capitalize">{user.role}</p>
              </div>
            </div>
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 space-y-1 p-3 overflow-y-auto">
          {role !== "processor" ? (
            <>
              {navItems.map((item) => {
                const isActive = location.pathname === item.path
                return (
                  <Link key={item.path} to={item.path}>
                    <div className={cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 cursor-pointer",
                      isActive
                        ? "bg-emerald-100 text-primary"
                        : "text-muted-foreground hover:bg-emerald-50 hover:text-primary"
                    )}>
                      <item.icon className="h-5 w-5 shrink-0" />
                      {!collapsed && <span className="text-sm font-medium">{item.name}</span>}
                    </div>
                  </Link>
                )
              })}

              {/* Settings Nav Button */}
              <button
                onClick={handleOpenModal}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all duration-200 text-muted-foreground hover:bg-emerald-50 hover:text-primary text-sm font-medium cursor-pointer"
              >
                <Edit3 className="h-5 w-5 shrink-0" />
                {!collapsed && <span>Settings</span>}
              </button>
            </>
          ) : (
            <div className="space-y-1">
              {/* Dashboard */}
              <Link
                to="/processor?tab=browse"
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 cursor-pointer text-sm font-medium",
                  location.pathname === "/processor" && (location.search === "" || location.search.includes("tab=browse"))
                    ? "bg-emerald-100 text-primary"
                    : "text-muted-foreground hover:bg-emerald-50 hover:text-primary"
                )}
              >
                <LayoutDashboard className="h-5 w-5 shrink-0" />
                {!collapsed && <span>Dashboard</span>}
              </Link>

              {/* Processing */}
              <Link
                to="/processor?tab=pipeline"
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 cursor-pointer text-sm font-medium",
                  location.pathname === "/processor" && location.search.includes("tab=pipeline")
                    ? "bg-emerald-100 text-primary"
                    : "text-muted-foreground hover:bg-emerald-50 hover:text-primary"
                )}
              >
                <Factory className="h-5 w-5 shrink-0" />
                {!collapsed && <span>Processing</span>}
              </Link>

              {/* History */}
              <Link
                to="/processor?tab=history"
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 cursor-pointer text-sm font-medium",
                  location.pathname === "/processor" && location.search.includes("tab=history")
                    ? "bg-emerald-100 text-primary"
                    : "text-muted-foreground hover:bg-emerald-50 hover:text-primary"
                )}
              >
                <Clock className="h-5 w-5 shrink-0" />
                {!collapsed && <span>History</span>}
              </Link>

              {/* Settings */}
              <button
                onClick={handleOpenModal}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all duration-200 text-muted-foreground hover:bg-emerald-50 hover:text-primary text-sm font-medium cursor-pointer"
              >
                <Edit3 className="h-5 w-5 shrink-0" />
                {!collapsed && <span>Settings</span>}
              </button>
            </div>
          )}
        </nav>

        {/* Sidebar Footer */}
        <div className="p-3 border-t">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-destructive hover:bg-destructive/10 transition-all"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {!collapsed && <span>Logout</span>}
          </button>
        </div>
      </div>

      {/* Profile / Settings Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-white rounded-3xl p-6 space-y-5 shadow-2xl border border-emerald-100">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                <Leaf className="h-5 w-5 text-emerald-600" />
                <span>⚙️ {user?.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : "User"} Settings</span>
              </h3>
              <button onClick={() => setShowModal(false)} className="p-1 rounded-lg hover:bg-slate-100 text-slate-400">
                <X className="h-5 w-5" />
              </button>
            </div>

            {successMsg && (
              <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs rounded-xl">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>{successMsg}</span>
              </div>
            )}

            <form onSubmit={handleSaveProfile} className="space-y-4 text-left">
              {/* 1. Name */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <span>1. 👤 {user?.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : "User"} Name</span>
                </label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Enter name"
                  className="flex h-9 w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
                />
              </div>

              {/* 2. Profile Photo */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <span>2. 📷 Profile Photo</span>
                </label>
                <div className="flex items-center gap-3 pt-1">
                  {(newPhoto || user?.photo) ? (
                    <img
                      src={newPhoto || user?.photo}
                      alt="Profile preview"
                      className="h-10 w-10 rounded-full object-cover border border-emerald-500 shrink-0"
                    />
                  ) : (
                    <div className="h-10 w-10 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                      <Camera className="h-4 w-4 text-emerald-600" />
                    </div>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) {
                        const reader = new FileReader()
                        reader.onloadend = () => setNewPhoto(reader.result as string)
                        reader.readAsDataURL(file)
                      }
                    }}
                    className="block w-full text-xs text-slate-500 file:mr-2 file:py-1 file:px-2.5 file:rounded-lg file:border-0 file:text-[11px] file:font-semibold file:bg-emerald-600 file:text-white hover:file:bg-emerald-700 cursor-pointer"
                  />
                </div>
              </div>

              {/* 3. Email */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <span>3. 📧 Email</span>
                </label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder={user?.role === "farmer" ? "farmer@gmail.com" : "processor@company.com"}
                  className="flex h-9 w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
                />
              </div>

              {/* 4. Phone */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <span>4. 📱 Phone</span>
                </label>
                <input
                  type="text"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="+91 00000 00000"
                  className="flex h-9 w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
                />
              </div>

              {/* 5. Address */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                    <span>5. 📍 {user?.role === "farmer" ? "Farm Address" : user?.role === "processor" ? "Facility Address" : user?.role === "distributor" ? "Warehouse Address" : user?.role === "retailer" ? "Store Address" : "Delivery Address"}</span>
                  </label>
                  <button
                    type="button"
                    onClick={handleFetchGPSLocation}
                    disabled={locating}
                    className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 bg-emerald-50 hover:bg-emerald-100 px-2 py-0.5 rounded-md border border-emerald-200 cursor-pointer disabled:opacity-50"
                  >
                    {locating ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin" />
                        <span>Accessing live GPS location...</span>
                      </>
                    ) : (
                      <>
                        <Locate className="h-3.5 w-3.5" />
                        <span>Use Current Location</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="relative">
                  <MapPin className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                  <textarea
                    rows={2}
                    value={newAddress}
                    onChange={(e) => setNewAddress(e.target.value)}
                    placeholder={user?.role === "farmer" ? "Click 'Use Current Location' above or enter farm address" : "Click 'Use Current Location' above or enter facility address"}
                    className="flex w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 resize-none"
                  />
                </div>

                {/* Show location on map */}
                {lat && lng && (
                  <div className="space-y-1">
                    <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Show location on map</span>
                    <div className="w-full h-32 rounded-xl overflow-hidden border border-slate-200 shadow-inner">
                      <iframe
                        title="Location map"
                        width="100%"
                        height="100%"
                        src={`https://maps.google.com/maps?q=${lat},${lng}&t=&z=15&ie=UTF8&iwloc=&output=embed`}
                        frameBorder="0"
                        scrolling="no"
                        marginHeight={0}
                        marginWidth={0}
                      ></iframe>
                    </div>
                  </div>
                )}
              </div>

              {/* Footnote warning */}
              <div className="flex items-start gap-1.5 text-[10px] text-emerald-700 bg-emerald-50/50 border border-emerald-100 p-2 rounded-xl">
                <Clock className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" />
                <span>Automatically record the Date & Time whenever profile or location details are updated.</span>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t mt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <span>❌ Cancel</span>
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <span>💾 Save Changes</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}

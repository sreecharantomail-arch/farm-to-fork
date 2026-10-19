import { useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { useAuth } from "../context/AuthContext"
import { Button } from "../components/ui/Button"
import { Leaf, Mail, Lock, User, AlertCircle, Phone, MapPin, Camera, Locate, Loader2, Eye, EyeOff, ShieldCheck, Clock, ArrowRight } from "lucide-react"

export function RegisterPage() {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    role: "farmer",
    phone: "",
    address: "",
    photo: ""
  })
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [locating, setLocating] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")
  const [successMsg, setSuccessMsg] = useState("")
  const { register, loading } = useAuth()
  const navigate = useNavigate()

  const roles = ["farmer", "processor", "distributor", "retailer", "consumer"]

  const getRoleBadgeLabel = (role: string) => {
    switch (role) {
      case "farmer": return "Farmer Details"
      case "processor": return "Processor Facility Details"
      case "distributor": return "Distributor Hub Details"
      case "retailer": return "Retail Store Details"
      case "consumer": return "Consumer Profile Details"
      default: return `${role.charAt(0).toUpperCase() + role.slice(1)} Details`
    }
  }

  const getAddressLabel = (role: string) => {
    switch (role) {
      case "farmer": return "Farm Address"
      case "processor": return "Processor Facility Address"
      case "distributor": return "Warehouse / Hub Address"
      case "retailer": return "Store / Retail Location"
      case "consumer": return "Delivery / Home Address"
      default: return "Address"
    }
  }

  const getPhotoLabel = (role: string) => {
    switch (role) {
      case "farmer": return "Farmer Photo"
      case "processor": return "Processor Photo / Facility Logo"
      case "distributor": return "Distributor Photo / Logo"
      case "retailer": return "Store / Retailer Photo"
      case "consumer": return "Consumer Profile Photo"
      default: return "Profile Photo"
    }
  }

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        setError("Photo must be less than 2MB")
        return
      }
      const reader = new FileReader()
      reader.onloadend = () => {
        setPhotoPreview(reader.result as string)
        setFormData(prev => ({ ...prev, photo: reader.result as string }))
      }
      reader.readAsDataURL(file)
    }
  }

  const handleGetCurrentLocation = () => {
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${pos.coords.latitude}&lon=${pos.coords.longitude}`)
          const data = await res.json()
          if (data.display_name) {
            setFormData(prev => ({ ...prev, address: data.display_name }))
          }
        } catch {
          setError("Failed to resolve address. Please type it manually.")
        } finally {
          setLocating(false)
        }
      },
      (err) => {
        console.error(err)
        setError("Location access denied or failed.")
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setSuccessMsg("")

    if (!formData.address.trim()) {
      setError('Please set your location using the "Use Current Location" button or type your address.')
      return
    }

    // Persist registration details to persistent local registry
    if (formData.address || formData.name || formData.email) {
      try {
        const userProfiles = JSON.parse(localStorage.getItem("registered_user_profiles") || "{}")
        const emailKey = formData.email.toLowerCase().trim()
        const nameKey = formData.name.toLowerCase().trim()
        const profileData = {
          name: formData.name,
          email: formData.email,
          role: formData.role,
          phone: formData.phone,
          address: formData.address,
          photo: formData.photo || photoPreview
        }
        if (emailKey) userProfiles[emailKey] = profileData
        if (nameKey) userProfiles[nameKey] = profileData
        localStorage.setItem("registered_user_profiles", JSON.stringify(userProfiles))

        if (formData.address) {
          if (formData.role === "farmer") {
            localStorage.setItem("farmer_address", formData.address)
          } else if (formData.role === "processor") {
            localStorage.setItem("processor_address", formData.address)
          } else if (formData.role === "distributor") {
            localStorage.setItem("distributor_address", formData.address)
          } else if (formData.role === "retailer") {
            localStorage.setItem("retailer_address", formData.address)
          } else if (formData.role === "consumer") {
            localStorage.setItem("consumer_address", formData.address)
          }
        }
      } catch (err) {
        console.warn("Could not save to registered_user_profiles", err)
      }
    }

    try {
      await register(formData.name, formData.email, formData.password, formData.role)
      const stored = localStorage.getItem("farmchain_user")
      if (stored) {
        const u = JSON.parse(stored)
        const userPhoto = formData.photo || photoPreview
        const updatedUser = {
          ...u,
          phone: formData.phone,
          address: formData.address,
          photo: userPhoto,
          photoLastUpdated: undefined,
          addressLastUpdated: undefined,
        }
        localStorage.setItem("farmchain_user", JSON.stringify(updatedUser))

        if (u.role === "consumer") navigate("/track")
        else navigate(`/${u.role}`)
      } else {
        navigate("/admin")
      }
    } catch (err: any) {
      const actualError = err.response?.data?.message || err.message
      if (actualError && actualError.includes("wait for an admin")) {
        setSuccessMsg(actualError)
      } else {
        setError(actualError || "Registration failed. Please check your details and try again.")
      }
    }
  }

  if (successMsg) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[radial-gradient(circle_at_top,_#e5f6eb_0%,_#fbfefc_48%,_#ffffff_100%)] p-4">
        <div className="relative w-full max-w-md p-8 overflow-hidden rounded-3xl border border-emerald-100 bg-white shadow-[0_20px_50px_rgba(24,112,75,0.10)] text-center">
          
          {/* Background decorative elements */}
          <div className="absolute -top-24 -right-24 h-48 w-48 rounded-full bg-emerald-500/5 blur-3xl"></div>
          <div className="absolute -bottom-24 -left-24 h-48 w-48 rounded-full bg-green-500/5 blur-3xl"></div>

          <div className="relative z-10 space-y-6">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-green-100 to-emerald-50 shadow-inner border border-emerald-100/50 mb-2 relative">
              <div className="absolute inset-0 bg-green-500/20 rounded-2xl animate-ping opacity-20"></div>
              <ShieldCheck className="h-10 w-10 text-emerald-600" />
            </div>
            
            <div>
              <h1 className="text-2xl font-extrabold text-slate-800 tracking-tight">Account Created!</h1>
              <p className="text-slate-500 text-sm mt-2 leading-relaxed">
                Your profile is safely stored on the network, but requires admin verification to unlock full access.
              </p>
            </div>

            <div className="bg-slate-50 border border-slate-100 rounded-2xl p-5 text-left space-y-4 shadow-sm">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">What happens next?</h3>
              <div className="flex gap-3 items-start">
                <div className="mt-0.5 bg-amber-100 p-1.5 rounded-full text-amber-600">
                  <Clock className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-700">Admin Review</p>
                  <p className="text-xs text-slate-500 mt-0.5">A network administrator is reviewing your details.</p>
                </div>
              </div>
              <div className="flex gap-3 items-start">
                <div className="mt-0.5 bg-emerald-100 p-1.5 rounded-full text-emerald-600">
                  <Leaf className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-700">Access Granted</p>
                  <p className="text-xs text-slate-500 mt-0.5">Once approved, you can log in and trace products.</p>
                </div>
              </div>
            </div>

            <div className="pt-2">
              <Link to="/login" className="block">
                <Button className="w-full bg-slate-900 hover:bg-slate-800 text-white rounded-xl h-12 shadow-md hover:shadow-lg transition-all group">
                  Return to Login <ArrowRight className="h-4 w-4 ml-2 group-hover:translate-x-1 transition-transform" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[radial-gradient(circle_at_top,_#e5f6eb_0%,_#fbfefc_48%,_#ffffff_100%)] p-4">
      <div className="relative w-full max-w-md p-8 space-y-6 rounded-3xl border border-emerald-100 bg-white shadow-[0_20px_50px_rgba(24,112,75,0.10)]">
        <div className="text-center space-y-2">
          <Link to="/" className="flex items-center justify-center gap-2 mb-4">
            <Leaf className="h-8 w-8 text-primary" />
            <span className="font-bold text-2xl text-foreground">FarmChain<span className="text-primary">AI</span></span>
          </Link>
          <h1 className="text-2xl font-bold text-foreground">Create your account</h1>
          <p className="text-slate-400 text-sm">Join the blockchain supply chain network</p>
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">Full Name</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input type="text" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} placeholder="John Smith" required className="flex h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50" />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">Email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input type="email" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} placeholder="you@example.com" required className="flex h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50" />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type={showPassword ? "text" : "password"}
                value={formData.password}
                onChange={e => setFormData({ ...formData, password: e.target.value })}
                placeholder="••••••••"
                required
                className="flex h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-10 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">Your Role</label>
            <select value={formData.role} onChange={e => setFormData({ ...formData, role: e.target.value })} className="flex h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50">
              {roles.map(r => <option key={r} value={r} className="capitalize">{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
            </select>
          </div>

            <div className="space-y-4 pt-3 border-t border-emerald-100">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200">
                  {getRoleBadgeLabel(formData.role)}
                </span>
              </div>

              {/* Phone Number */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Phone Number</label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={e => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="+91 0000000000"
                    className="flex h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                  />
                </div>
              </div>

              {/* Address */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-slate-700">
                    {getAddressLabel(formData.role)}
                  </label>
                  <button
                    type="button"
                    onClick={handleGetCurrentLocation}
                    disabled={locating}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:text-emerald-800 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1 rounded-lg border border-emerald-200 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {locating ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>Detecting...</span>
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
                    value={formData.address}
                    onChange={e => setFormData({ ...formData, address: e.target.value })}
                    placeholder="Click 'Use Current Location' above to detect GPS address or type manually"
                    className="flex w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 resize-none"
                  />
                </div>
                <p className="text-[11px] text-slate-500">
                  📍 Click <strong className="text-emerald-700 font-semibold">"Use Current Location"</strong> above to auto-detect and lock your coordinates and address.
                </p>
              </div>

              {/* Photo */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">
                  {getPhotoLabel(formData.role)}
                </label>
                <div className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 bg-slate-50">
                  {photoPreview ? (
                    <img
                      src={photoPreview}
                      alt={`${formData.role} preview`}
                      className="h-12 w-12 rounded-full object-cover border-2 border-emerald-500 shrink-0"
                    />
                  ) : (
                    <div className="h-12 w-12 rounded-full bg-emerald-100/60 border border-emerald-200 flex items-center justify-center shrink-0">
                      <Camera className="h-5 w-5 text-emerald-600" />
                    </div>
                  )}
                  <div className="flex-1 space-y-1">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handlePhotoUpload}
                      className="block w-full text-xs text-slate-500 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-emerald-600 file:text-white hover:file:bg-emerald-700 cursor-pointer"
                    />
                  </div>
                </div>
              </div>
            </div>

          <Button type="submit" className="w-full h-11 rounded-xl" disabled={loading}>
            {loading ? "Creating account..." : "Create Account"}
          </Button>
        </form>

        <p className="text-center text-sm text-slate-400">
          Already have an account?{" "}
          <Link to="/login" className="text-primary hover:underline font-medium">Sign in</Link>
        </p>
      </div>
    </div>
  )
}



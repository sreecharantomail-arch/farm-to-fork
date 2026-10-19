import { useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { useAuth } from "../context/AuthContext"
import { Button } from "../components/ui/Button"
import { Leaf, Mail, Lock, AlertCircle, Eye, EyeOff, ShieldCheck, Clock, ArrowRight } from "lucide-react"

export function LoginPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")
  const [pendingMessage, setPendingMessage] = useState("")
  const { login, loading } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setPendingMessage("")
    try {
      await login(email, password)
      
      const stored = localStorage.getItem("farmchain_user")
      
      if (stored) {
        const u = JSON.parse(stored)
        try {
          const userProfiles = JSON.parse(localStorage.getItem("registered_user_profiles") || "{}")
          const emailKey = (u.email || email || "").toLowerCase().trim()
          const nameKey = (u.name || "").toLowerCase().trim()
          const savedProfile = userProfiles[emailKey] || userProfiles[nameKey]
          if (savedProfile) {
            if (savedProfile.address && !u.address) u.address = savedProfile.address
            if (savedProfile.phone && !u.phone) u.phone = savedProfile.phone
            if (savedProfile.photo && !u.photo) u.photo = savedProfile.photo
            localStorage.setItem("farmchain_user", JSON.stringify(u))
          }
          if (u.address) {
            if (u.role === "farmer") localStorage.setItem("farmer_address", u.address)
            else if (u.role === "processor") localStorage.setItem("processor_address", u.address)
            else if (u.role === "distributor") localStorage.setItem("distributor_address", u.address)
            else if (u.role === "retailer") localStorage.setItem("retailer_address", u.address)
            else if (u.role === "consumer") localStorage.setItem("consumer_address", u.address)
          }
        } catch {}

        if (u.role === "consumer") navigate("/track")
        else navigate(`/${u.role}`)
      } else {
        navigate("/admin")
      }
    } catch (err: any) {
      const msg = err.response?.data?.message || err.message
      if (msg && msg.includes("pending admin approval")) {
        setPendingMessage(msg)
      } else if (msg) {
        setError(msg)
      } else {
        setError("Invalid email or password. Please try again.")
      }
    }
  }

  if (pendingMessage) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[radial-gradient(circle_at_top,_#e5f6eb_0%,_#fbfefc_48%,_#ffffff_100%)] p-4">
        <div className="relative w-full max-w-md p-8 overflow-hidden rounded-3xl border border-emerald-100 bg-white shadow-[0_20px_50px_rgba(24,112,75,0.10)] text-center">
          
          {/* Background decorative elements */}
          <div className="absolute -top-24 -right-24 h-48 w-48 rounded-full bg-emerald-500/5 blur-3xl"></div>
          <div className="absolute -bottom-24 -left-24 h-48 w-48 rounded-full bg-green-500/5 blur-3xl"></div>

          <div className="relative z-10 space-y-6">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-100 to-orange-50 shadow-inner border border-amber-100/50 mb-2 relative">
              <div className="absolute inset-0 bg-amber-500/20 rounded-2xl animate-ping opacity-20"></div>
              <ShieldCheck className="h-10 w-10 text-amber-600" />
            </div>
            
            <div>
              <h1 className="text-2xl font-extrabold text-slate-800 tracking-tight">Access Pending</h1>
              <p className="text-slate-500 text-sm mt-2 leading-relaxed">
                {pendingMessage}
              </p>
            </div>

            <div className="bg-slate-50 border border-slate-100 rounded-2xl p-5 text-left space-y-4 shadow-sm">
              <div className="flex gap-3 items-start">
                <div className="mt-0.5 bg-amber-100 p-1.5 rounded-full text-amber-600">
                  <Clock className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-700">In Review</p>
                  <p className="text-xs text-slate-500 mt-0.5">An admin must manually verify your account details.</p>
                </div>
              </div>
              <div className="flex gap-3 items-start">
                <div className="mt-0.5 bg-emerald-100 p-1.5 rounded-full text-emerald-600">
                  <Leaf className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-700">Unlock Network</p>
                  <p className="text-xs text-slate-500 mt-0.5">Once approved, you will have full access to trace products.</p>
                </div>
              </div>
            </div>

            <div className="pt-2">
              <Button onClick={() => setPendingMessage("")} className="w-full bg-slate-900 hover:bg-slate-800 text-white rounded-xl h-12 shadow-md hover:shadow-lg transition-all group">
                Back to Login <ArrowRight className="h-4 w-4 ml-2 group-hover:translate-x-1 transition-transform" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[radial-gradient(circle_at_top,_#e5f6eb_0%,_#fbfefc_48%,_#ffffff_100%)]">
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiMxNmEzNGEiIGZpbGwtb3BhY2l0eT0iMC4wNSI+PHBhdGggZD0iTTM2IDM0djZoNnYtNmgtNnptNiA2djZoNnYtNmgtNnptLTEyIDB2Nmg2di02aC02em0tNiAwdjZoNnYtNmgtNnoiLz48L2c+PC9nPjwvc3ZnPg==')] opacity-30" />
      
      <div className="relative w-full max-w-md p-8 space-y-6 rounded-3xl border border-emerald-100 bg-white shadow-[0_20px_50px_rgba(24,112,75,0.10)]">
        <div className="text-center space-y-2">
          <Link to="/" className="flex items-center justify-center gap-2 mb-4">
            <Leaf className="h-8 w-8 text-primary" />
            <span className="font-bold text-2xl text-foreground">FarmChain<span className="text-primary">AI</span></span>
          </Link>
          <h1 className="text-2xl font-bold text-foreground">Welcome back</h1>
          <p className="text-slate-400 text-sm">Sign in to your account to continue</p>
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300">Email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="farmer@example.com"
                required
                className="flex h-11 w-full rounded-xl border border-white/10 bg-white/5 pl-10 pr-3 py-2 text-sm text-white placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 backdrop-blur-sm"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300">Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="flex h-11 w-full rounded-xl border border-white/10 bg-white/5 pl-10 pr-10 py-2 text-sm text-white placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 backdrop-blur-sm"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 focus:outline-none"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <Button type="submit" className="w-full h-11 rounded-xl" disabled={loading}>
            {loading ? "Signing in..." : "Sign In"}
          </Button>
        </form>

        <p className="text-center text-sm text-slate-400">
          Don't have an account?{" "}
          <Link to="/register" className="text-primary hover:underline font-medium">
            Create one
          </Link>
        </p>

        {/* Demo accounts hint */}
        <div className="p-3 rounded-xl bg-primary/10 border border-primary/20 text-xs text-slate-400 space-y-1">
          <p className="font-medium text-primary">Demo: Register an account to get started</p>
          <p>Roles: Admin, Farmer, Processor, Distributor, Retailer, Consumer</p>
        </div>
      </div>
    </div>
  )
}

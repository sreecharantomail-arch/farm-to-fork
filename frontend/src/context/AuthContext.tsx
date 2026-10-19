import { createContext, useContext, useState, useEffect, type ReactNode } from "react"
import axios from "axios"

const API_URL = (import.meta.env.VITE_API_URL || "https://farm-to-fork-tracker.onrender.com/api").replace(/\/api\/?$/, "") + "/api"

export interface User {
  id: string
  name: string
  email: string
  role: string
  phone?: string
  address?: string
  photo?: string
  availability_status?: string | null
  photoLastUpdated?: string
  addressLastUpdated?: string
}

interface AuthContextType {
  user: User | null
  token: string | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (name: string, email: string, password: string, role: string) => Promise<void>
  updateUser: (updatedFields: Partial<User>) => void
  logout: () => void
  isAuthenticated: boolean
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    try {
      const storedUser = localStorage.getItem("farmchain_user")
      const storedToken = localStorage.getItem("farmchain_token") || localStorage.getItem("token")
      if (storedUser && storedToken) {
        return JSON.parse(storedUser)
      }
    } catch {
      return null
    }
    return null
  })
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("farmchain_token") || localStorage.getItem("token"))
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const storedUser = localStorage.getItem("farmchain_user")
    if (storedUser && token) {
      try {
        setUser(JSON.parse(storedUser))
      } catch {
        setUser(null)
      }
    }
    if (token) {
      axios.defaults.headers.common["Authorization"] = `Bearer ${token}`
    } else {
      delete axios.defaults.headers.common["Authorization"]
    }
  }, [token])

  const updateUser = (updatedFields: Partial<User>) => {
    setUser((prev) => {
      if (!prev) return null
      const updated = { ...prev, ...updatedFields }
      localStorage.setItem("farmchain_user", JSON.stringify(updated))
      return updated
    })
  }

  const login = async (email: string, password: string) => {
    setLoading(true)
    try {
      const res = await axios.post(`${API_URL}/auth/login`, { email, password })
      const { token: newToken, user: newUser } = res.data
      localStorage.setItem("farmchain_token", newToken)
      localStorage.setItem("token", newToken)
      localStorage.setItem("farmchain_user", JSON.stringify(newUser))
      setToken(newToken)
      setUser(newUser)
      axios.defaults.headers.common["Authorization"] = `Bearer ${newToken}`
    } finally {
      setLoading(false)
    }
  }

  const register = async (name: string, email: string, password: string, role: string) => {
    setLoading(true)
    try {
      const res = await axios.post(`${API_URL}/auth/register`, { name, email, password, role })
      if (!res.data.token) {
        throw new Error(res.data.message || "Account pending admin approval.")
      }
      const { token: newToken, user: newUser } = res.data
      localStorage.setItem("farmchain_token", newToken)
      localStorage.setItem("token", newToken)
      localStorage.setItem("farmchain_user", JSON.stringify(newUser))
      setToken(newToken)
      setUser(newUser)
      axios.defaults.headers.common["Authorization"] = `Bearer ${newToken}`
    } finally {
      setLoading(false)
    }
  }

  const logout = () => {
    localStorage.removeItem("farmchain_token")
    localStorage.removeItem("token")
    localStorage.removeItem("farmchain_user")
    setToken(null)
    setUser(null)
    delete axios.defaults.headers.common["Authorization"]
  }

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, updateUser, logout, isAuthenticated: !!token }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error("useAuth must be used within an AuthProvider")
  return context
}


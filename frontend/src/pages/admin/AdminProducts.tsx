import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import axios from "axios"
import { useAuth } from "../../context/AuthContext"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/Card"
import { Search, Download, Trash2, Eye } from "lucide-react"
import { Button } from "../../components/ui/Button"

const API = import.meta.env.VITE_API_URL || "https://farm-to-fork-tracker.onrender.com/api"

interface AdminProduct {
  id: string
  product_id: string
  name: string
  category: string
  batch_number: string
  quantity: string
  status: string
  ai_quality_label: string
  ai_quality_score: number
  created_at: string
  blockchain_hash: string
  farmer?: { name: string }
}

export function AdminProducts() {
  const { token } = useAuth()
  const navigate = useNavigate()
  const [products, setProducts] = useState<AdminProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")

  const fetchProducts = async () => {
    try {
      const res = await axios.get(`${API}/products`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.data.success) {
        setProducts(res.data.data)
      }
    } catch (err) {
      console.error("Failed to fetch products", err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchProducts()
  }, [token])

  const handleDeleteProduct = async (id: string) => {
    if (!confirm("Are you sure you want to delete this product? This action cannot be undone.")) return
    try {
      const baseApi = API.replace(/\/admin\/?$/, "")
      await axios.delete(`${baseApi}/products/${id}`, { headers: { Authorization: `Bearer ${token}` } })
      fetchProducts()
    } catch (err) {
      console.error(err)
      alert("Failed to delete product")
    }
  }

  const handleApproveProduct = async (id: string) => {
    try {
      await axios.put(`${API}/admin/products/${id}/approve`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      })
      fetchProducts()
    } catch (err) {
      console.error(err)
      alert("Failed to approve product")
    }
  }

  const filteredProducts = products.filter(p => 
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    p.batch_number.toLowerCase().includes(searchTerm.toLowerCase())
  )

  if (loading) return <div className="p-8 flex justify-center"><div className="animate-spin h-8 w-8 border-b-2 border-primary rounded-full"></div></div>

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Supply Chain</h1>
          <p className="text-muted-foreground mt-1">Manage all products traversing the network.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2">
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-4">
          <CardTitle>Product Registry</CardTitle>
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <input 
              type="text" 
              placeholder="Search products..." 
              className="w-full bg-background border border-input rounded-md pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/50">
                <tr className="border-b">
                  <th className="h-10 px-4 text-left font-medium text-muted-foreground">Product</th>
                  <th className="h-10 px-4 text-left font-medium text-muted-foreground">Category</th>
                  <th className="h-10 px-4 text-left font-medium text-muted-foreground">Batch</th>
                  <th className="h-10 px-4 text-left font-medium text-muted-foreground">Status</th>
                  <th className="h-10 px-4 text-left font-medium text-muted-foreground">AI Quality</th>
                  <th className="h-10 px-4 text-right font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-muted-foreground">
                      No products found.
                    </td>
                  </tr>
                ) : (
                  filteredProducts.map(p => (
                    <tr key={p.id} className="border-b hover:bg-slate-50 dark:hover:bg-slate-900/20">
                      <td className="p-4 font-medium">{p.name}</td>
                      <td className="p-4">{p.category}</td>
                      <td className="p-4 font-mono text-xs">{p.batch_number}</td>
                      <td className="p-4">
                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold
                          ${p.status === "Pending Approval" ? "bg-amber-100 text-amber-700" : 
                            p.status === "Harvested" ? "bg-emerald-100 text-emerald-700" : 
                            "bg-blue-100 text-blue-700"}`}>
                          {p.status}
                        </span>
                      </td>
                      <td className="p-4">
                        <span className={`font-semibold ${p.ai_quality_label === 'Poor' ? 'text-red-500' : p.ai_quality_label === 'Excellent' ? 'text-green-500' : 'text-amber-500'}`}>
                          {p.ai_quality_label || 'Unknown'} 
                          {p.ai_quality_score > 0 && <span className="text-xs ml-1 text-muted-foreground">({(p.ai_quality_score * 100).toFixed(0)}%)</span>}
                        </span>
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {p.status === "Pending Approval" && (
                            <Button size="sm" variant="outline" className="text-emerald-600 border-emerald-600 mr-2" onClick={() => handleApproveProduct(p.id)}>
                              Approve
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => navigate('/admin/products/' + p.id)}>
                            <Eye className="h-4 w-4 text-muted-foreground" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => handleDeleteProduct(p.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

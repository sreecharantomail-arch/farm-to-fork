import { BrowserRouter, Routes, Route } from "react-router-dom"
import { AuthProvider } from "./context/AuthContext"
import { DashboardLayout } from "./components/layout/DashboardLayout"
import { ProtectedRoute } from "./components/layout/ProtectedRoute"
import { PublicLayout } from "./components/layout/PublicLayout"
import { LandingPage } from "./pages/LandingPage"
import { LoginPage } from "./pages/LoginPage"
import { RegisterPage } from "./pages/RegisterPage"
import { Dashboard } from "./pages/Dashboard"
import { FarmerDashboard } from "./pages/FarmerDashboard"
import { MyProductsPage } from "./pages/MyProductsPage"
import { FarmerAIServices } from "./pages/FarmerAIServices"
import { FarmerRequestsPage } from "./pages/FarmerRequestsPage"
import { FarmerAnalyticsPage } from "./pages/FarmerAnalyticsPage"
import { FarmerNotificationsPage } from "./pages/FarmerNotificationsPage"
import { ProcessorDashboard } from "./pages/ProcessorDashboard"
import { DistributorDashboard } from "./pages/DistributorDashboard"
import { AnalyticsDashboard } from "./pages/AnalyticsDashboard"
import SupplyChainAnalytics from "./pages/analytics/SupplyChainAnalytics"
import AnomalyDetection from "./pages/analytics/AnomalyDetection"
import { AIObservability } from "./pages/analytics/AIObservability"
import { Tracker } from "./pages/Tracker"
import { AdminUsers } from "./pages/admin/AdminUsers"
import { AdminUserDetails } from "./pages/admin/AdminUserDetails"
import { AdminProducts } from "./pages/admin/AdminProducts"
import { AdminProductDetails } from "./pages/admin/AdminProductDetails"

import { Dashboard as RetailerDashboard } from "./pages/retailer/Dashboard"
import { ProductRequests as RetailerProductRequests } from "./pages/retailer/ProductRequests"
import { Shipments as RetailerShipments } from "./pages/retailer/Shipments"
import { ReceiveProduct as RetailerReceiveProduct } from "./pages/retailer/ReceiveProduct"
import { Inventory as RetailerInventory } from "./pages/retailer/Inventory"
import { Sales as RetailerSales } from "./pages/retailer/Sales"
import { Wastage as RetailerWastage } from "./pages/retailer/Wastage"
import { Expiry as RetailerExpiry } from "./pages/retailer/Expiry"
import { Alerts as RetailerAlerts } from "./pages/retailer/Alerts"
import { Traceability as RetailerTraceability } from "./pages/retailer/Traceability"
import { Returns as RetailerReturns } from "./pages/retailer/Returns"

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public routes wrapped in PublicLayout */}
          <Route element={<PublicLayout />}>
            <Route path="/" element={<LandingPage />} />
            <Route path="/track" element={<Tracker />} />
            <Route path="/tracker" element={<Tracker />} />
            <Route path="/verify" element={<Tracker />} />
          </Route>

          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />

          {/* Protected dashboard routes */}
          <Route element={<ProtectedRoute allowedRoles={['admin']} />}>
            <Route path="/admin" element={<DashboardLayout />}>
              <Route index element={<Dashboard />} />
              <Route path="analytics" element={<AnalyticsDashboard />} />
              <Route path="supply-chain-analytics" element={<SupplyChainAnalytics />} />
              <Route path="anomaly-detection" element={<AnomalyDetection />} />
              <Route path="ai-observability" element={<AIObservability />} />
              <Route path="users" element={<AdminUsers />} />
              <Route path="users/:id" element={<AdminUserDetails />} />
              <Route path="products" element={<AdminProducts />} />
              <Route path="products/:id" element={<AdminProductDetails />} />
            </Route>
          </Route>

          <Route element={<ProtectedRoute allowedRoles={['farmer', 'admin']} />}>
            <Route path="/farmer" element={<DashboardLayout />}>
              <Route index element={<FarmerDashboard />} />
              <Route path="products" element={<MyProductsPage />} />
              <Route path="ai-services" element={<FarmerAIServices />} />
              <Route path="requests" element={<FarmerRequestsPage />} />
              <Route path="analytics" element={<FarmerAnalyticsPage />} />
              <Route path="notifications" element={<FarmerNotificationsPage />} />
            </Route>
          </Route>

          <Route element={<ProtectedRoute allowedRoles={['processor', 'admin']} />}>
            <Route path="/processor" element={<DashboardLayout />}>
              <Route index element={<ProcessorDashboard />} />
            </Route>
          </Route>

          <Route element={<ProtectedRoute allowedRoles={['distributor', 'admin']} />}>
            <Route path="/distributor" element={<DashboardLayout />}>
              <Route index element={<DistributorDashboard />} />
            </Route>
          </Route>

          <Route element={<ProtectedRoute allowedRoles={['retailer', 'admin']} />}>
            <Route path="/retailer" element={<DashboardLayout />}>
              <Route index element={<RetailerDashboard />} />
              <Route path="requests" element={<RetailerProductRequests />} />
              <Route path="shipments" element={<RetailerShipments />} />
              <Route path="receive" element={<RetailerReceiveProduct />} />
              <Route path="inventory" element={<RetailerInventory />} />
              <Route path="sales" element={<RetailerSales />} />
              <Route path="wastage" element={<RetailerWastage />} />
              <Route path="expiry" element={<RetailerExpiry />} />
              <Route path="returns" element={<RetailerReturns />} />
              <Route path="alerts" element={<RetailerAlerts />} />
              <Route path="traceability" element={<RetailerTraceability />} />
            </Route>
          </Route>

          {/* Fallback */}
          <Route path="*" element={
            <div className="flex min-h-screen items-center justify-center flex-col gap-4">
              <h1 className="text-6xl font-bold text-primary">404</h1>
              <p className="text-muted-foreground">Page not found.</p>
              <a href="/" className="text-primary hover:underline">Go Home</a>
            </div>
          } />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App

import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getFarmerLocation(product: any): string {
  if (!product) return "Certified Origin Farm"
  if (product.farmer?.address) return product.farmer.address
  if (product.farmer?.location) return product.farmer.location
  if (product.farm_location) return product.farm_location

  const farmerEmail = (product.farmer?.email || "").toLowerCase().trim()
  const farmerName = (product.farmer?.name || "").toLowerCase().trim()

  // 1. Check persistent registered user profiles by email or name
  try {
    const userProfiles = JSON.parse(localStorage.getItem("registered_user_profiles") || "{}")
    if (farmerEmail && userProfiles[farmerEmail]?.address) return userProfiles[farmerEmail].address
    if (farmerName && userProfiles[farmerName]?.address) return userProfiles[farmerName].address
  } catch {}

  // 2. Check product-specific location map stored in localStorage
  try {
    const locMap = JSON.parse(localStorage.getItem("product_farmer_locations") || "{}")
    const idKey = String(product.id || product._id || product.product_id || "")
    const batchKey = String(product.batch_number || product.batchNumber || "")
    if (idKey && locMap[idKey]) return locMap[idKey]
    if (batchKey && locMap[batchKey]) return locMap[batchKey]
  } catch {}

  // 3. Check global saved farmer address from user session or profile
  try {
    const savedFarmerAddress = localStorage.getItem("farmer_address")
    if (savedFarmerAddress) return savedFarmerAddress

    const storedUser = JSON.parse(localStorage.getItem("farmchain_user") || "{}")
    if (storedUser && storedUser.role === "farmer" && storedUser.address) return storedUser.address
  } catch {}

  return "Certified Regional Farm"
}

export function getProcessorLocation(processorNameOrEmail?: string): string {
  if (processorNameOrEmail) {
    try {
      const userProfiles = JSON.parse(localStorage.getItem("registered_user_profiles") || "{}")
      const key = processorNameOrEmail.toLowerCase().trim()
      if (userProfiles[key]?.address) return userProfiles[key].address
    } catch {}
  }

  try {
    const savedProcessorAddress = localStorage.getItem("processor_address")
    if (savedProcessorAddress) return savedProcessorAddress

    const storedUser = JSON.parse(localStorage.getItem("farmchain_user") || "{}")
    if (storedUser && storedUser.role === "processor" && storedUser.address) return storedUser.address
  } catch {}

  return "Certified Processing Facility"
}

export function getApiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_URL || "https://farm-to-fork-tracker.onrender.com/api";
  return raw.replace(/\/api\/?$/, "") + "/api";
}

export function getAuthToken(): string | null {
  return localStorage.getItem("farmchain_token") || localStorage.getItem("token");
}

import { useState, useEffect } from "react"
import axios from "axios"
import { useAuth } from "../../context/AuthContext"
import { Html5QrcodeScanner } from "html5-qrcode"
import { QrCode, AlertCircle, CheckCircle2, Package, Search, Calendar, FileCheck, ShieldAlert, X, Eye, Thermometer } from "lucide-react"

const API_URL = import.meta.env.VITE_API_URL || "https://farm-to-fork-tracker.onrender.com/api"

export function ReceiveProduct() {
  const { token } = useAuth()
  const [shipments, setShipments] = useState<any[]>([])
  const [selectedShipment, setSelectedShipment] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const [scanning, setScanning] = useState(false)
  const [verifiedData, setVerifiedData] = useState<any>(null)
  const [verificationError, setVerificationError] = useState("")
  const [verifying, setVerifying] = useState(false)

  // Discrepancy state
  const [showDiscrepancyModal, setShowDiscrepancyModal] = useState(false)
  const [discrepancyReason, setDiscrepancyReason] = useState("")
  const [discrepancyNotes, setDiscrepancyNotes] = useState("")
  const [reportingDiscrepancy, setReportingDiscrepancy] = useState(false)
  const [discrepancyError, setDiscrepancyError] = useState("")
  const [discrepancySuccess, setDiscrepancySuccess] = useState("")

  const fetchEligibleShipments = async () => {
    try {
      setLoading(true)
      const res = await axios.get(`${API_URL}/retailer/shipments`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      // Only show shipments that can be received or reviewed
      const eligible = res.data.data?.filter((s: any) =>
        s.status === 'DELIVERED' || s.status === 'ARRIVED' || s.status === 'DELIVERY_DISPUTED'
      ) || []
      setShipments(eligible)
    } catch (err: any) {
      setError(err.response?.data?.message || "Failed to load shipments")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (token) fetchEligibleShipments()
  }, [token])

  useEffect(() => {
    if (scanning && selectedShipment) {
      const scanner = new Html5QrcodeScanner(
        "qr-reader",
        { fps: 10, qrbox: { width: 250, height: 250 } },
        false
      )

      scanner.render(
        async (decodedText) => {
          // Pause scanner on successful scan to prevent multiple hits
          scanner.pause(true)
          await handleVerification(decodedText)
          scanner.clear()
          setScanning(false)
        },
        () => {
          // Ignore frequent scan errors (expected when no QR is in view)
        }
      )

      return () => {
        scanner.clear().catch(console.error)
      }
    }
  }, [scanning, selectedShipment])

  const handleVerification = async (qrData: string) => {
    setVerifying(true)
    setVerificationError("")
    setVerifiedData(null)
    try {
      const res = await axios.post(`${API_URL}/retailer/verify-batch`, {
        shipment_id: selectedShipment,
        qr_data: qrData
      }, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setVerifiedData(res.data.data)
    } catch (err: any) {
      setVerificationError(err.response?.data?.message || "Verification failed.")
    } finally {
      setVerifying(false)
    }
  }

  const [receiptSuccess, setReceiptSuccess] = useState<any>(null)
  const [confirming, setConfirming] = useState(false)

  const selectedShipmentData = shipments.find(s => s.id === selectedShipment)

  const handleConfirmReceipt = async () => {
    setConfirming(true)
    try {
      // Use dedicated acknowledge-delivery endpoint when proof exists, or receive-product
      const endpoint = selectedShipmentData?.proof_of_delivery
        ? `${API_URL}/retailer/shipments/${selectedShipment}/acknowledge-delivery`
        : `${API_URL}/retailer/receive-product`

      const payload = selectedShipmentData?.proof_of_delivery
        ? { qr_data: verifiedData.batch_number }
        : { shipment_id: selectedShipment, qr_data: verifiedData.batch_number }

      const res = await axios.post(endpoint, payload, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setReceiptSuccess(res.data.data) // Contains blockchain_hash
      fetchEligibleShipments()
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to confirm receipt.")
    } finally {
      setConfirming(false)
    }
  }

  const handleReportDiscrepancy = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedShipment || !discrepancyReason) return
    setReportingDiscrepancy(true)
    setDiscrepancyError("")

    try {
      await axios.post(`${API_URL}/retailer/shipments/${selectedShipment}/report-discrepancy`, {
        reason: discrepancyReason,
        notes: discrepancyNotes
      }, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setDiscrepancySuccess("Discrepancy reported successfully. Distributor notified.")
      setTimeout(() => {
        setShowDiscrepancyModal(false)
        setDiscrepancySuccess("")
        setDiscrepancyReason("")
        setDiscrepancyNotes("")
        fetchEligibleShipments()
      }, 1200)
    } catch (err: any) {
      setDiscrepancyError(err.response?.data?.message || "Failed to report discrepancy.")
    } finally {
      setReportingDiscrepancy(false)
    }
  }

  const handleManualEntry = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.target as HTMLFormElement
    const input = form.elements.namedItem('batch_number') as HTMLInputElement
    if (input.value) {
      setScanning(false)
      handleVerification(input.value)
    }
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Receive Product</h1>
        <p className="text-sm text-slate-500">Scan batch QR codes to verify incoming shipments.</p>
      </div>

      {!verifiedData ? (
        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Package className="h-5 w-5 text-emerald-600" /> Select Shipment
            </h3>

            {loading ? (
              <div className="p-4 text-center text-sm text-slate-500 bg-slate-50 rounded-xl">Loading shipments...</div>
            ) : error ? (
              <div className="p-4 text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-xl">{error}</div>
            ) : shipments.length === 0 ? (
              <div className="p-4 text-center text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-xl">
                No shipments ready to receive (status ARRIVED or DELIVERED).
              </div>
            ) : (
              <select
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500/50 text-sm font-medium text-slate-900"
                value={selectedShipment}
                onChange={(e) => setSelectedShipment(e.target.value)}
              >
                <option value="">-- Choose a shipment --</option>
                {shipments.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.shipment_tracking_id} - {s.request?.product_name} ({s.quantity} {s.unit}) [{s.status}]
                  </option>
                ))}
              </select>
            )}

            {/* Proof of Delivery Banner if present */}
            {selectedShipmentData?.proof_of_delivery && (
              <div className="p-3.5 bg-emerald-50/70 border border-emerald-200/80 rounded-xl space-y-2 text-xs animate-in fade-in">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-emerald-900 flex items-center gap-1.5">
                    <FileCheck className="h-4 w-4 text-emerald-600" /> Digital Proof of Delivery
                  </span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                    selectedShipmentData.proof_of_delivery.status === 'ACKNOWLEDGED' ? 'bg-emerald-200 text-emerald-800' :
                    selectedShipmentData.proof_of_delivery.status === 'DISPUTED' ? 'bg-rose-200 text-rose-800' :
                    'bg-blue-100 text-blue-800'
                  }`}>
                    {selectedShipmentData.proof_of_delivery.status}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-700 pt-1">
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-semibold">Delivered To</span>
                    <span className="font-semibold text-slate-900">{selectedShipmentData.proof_of_delivery.recipient_name}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-semibold">Delivered Qty</span>
                    <span className="font-semibold text-emerald-700">{selectedShipmentData.proof_of_delivery.quantity_delivered} {selectedShipmentData.proof_of_delivery.unit}</span>
                  </div>
                </div>

                {selectedShipmentData.proof_of_delivery.delivery_notes && (
                  <div className="text-[11px] text-slate-600 pt-1 border-t border-emerald-200/60">
                    <span className="font-semibold">Notes:</span> {selectedShipmentData.proof_of_delivery.delivery_notes}
                  </div>
                )}

                {selectedShipmentData.proof_of_delivery.photo_url && (
                  <div className="pt-1">
                    <a href={selectedShipmentData.proof_of_delivery.photo_url} target="_blank" rel="noopener noreferrer" className="text-emerald-700 underline text-[11px] flex items-center gap-1">
                      <Eye className="h-3 w-3" /> View Delivery Photo Evidence
                    </a>
                  </div>
                )}

                {selectedShipmentData.proof_of_delivery.status === 'DISPUTED' && (
                  <div className="p-2 bg-rose-100 border border-rose-300 rounded-lg text-rose-800 text-[11px] space-y-0.5">
                    <div className="font-bold flex items-center gap-1">
                      <ShieldAlert className="h-3.5 w-3.5" /> Discrepancy Dispute Active
                    </div>
                    <div>Reason: {selectedShipmentData.proof_of_delivery.discrepancy_reason}</div>
                    {selectedShipmentData.proof_of_delivery.discrepancy_notes && (
                      <div>Notes: {selectedShipmentData.proof_of_delivery.discrepancy_notes}</div>
                    )}
                  </div>
                )}

                {selectedShipmentData.proof_of_delivery.status !== 'DISPUTED' && selectedShipmentData.proof_of_delivery.status !== 'ACKNOWLEDGED' && (
                  <div className="pt-1 flex justify-end">
                    <button
                      type="button"
                      onClick={() => setShowDiscrepancyModal(true)}
                      className="text-xs text-rose-600 hover:text-rose-800 font-semibold hover:underline flex items-center gap-1"
                    >
                      <ShieldAlert className="h-3.5 w-3.5" /> Report Discrepancy
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Transport Condition & Food Safety Alert Banner */}
            {selectedShipmentData && (
              <div className={`p-3.5 rounded-xl space-y-2 text-xs border ${
                selectedShipmentData.cold_chain_status === 'CRITICAL'
                  ? 'bg-rose-50/90 border-rose-300 text-rose-900 animate-in fade-in'
                  : selectedShipmentData.cold_chain_status === 'WARNING'
                  ? 'bg-amber-50/90 border-amber-300 text-amber-900 animate-in fade-in'
                  : selectedShipmentData.cold_chain_status === 'NORMAL'
                  ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                  : 'bg-slate-50 border-slate-200 text-slate-700'
              }`}>
                <div className="flex items-center justify-between">
                  <span className="font-bold flex items-center gap-1.5">
                    <Thermometer className="h-4 w-4" /> Transport Condition
                  </span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                    selectedShipmentData.cold_chain_status === 'CRITICAL' ? 'bg-rose-200 text-rose-800' :
                    selectedShipmentData.cold_chain_status === 'WARNING' ? 'bg-amber-200 text-amber-800' :
                    selectedShipmentData.cold_chain_status === 'NORMAL' ? 'bg-emerald-200 text-emerald-800' :
                    'bg-slate-200 text-slate-700'
                  }`}>
                    {selectedShipmentData.cold_chain_status || 'UNAVAILABLE'}
                  </span>
                </div>

                {selectedShipmentData.latest_reading ? (
                  <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-semibold">Latest Temp</span>
                      <span className="font-semibold text-slate-900">
                        {selectedShipmentData.latest_reading.temperature_celsius}°C
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-semibold">Humidity</span>
                      <span className="font-semibold text-slate-900">
                        {selectedShipmentData.latest_reading.relative_humidity_pct !== null && selectedShipmentData.latest_reading.relative_humidity_pct !== undefined
                          ? `${selectedShipmentData.latest_reading.relative_humidity_pct}% RH`
                          : 'N/A'}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-500 italic">No temperature readings recorded during transit.</p>
                )}

                {selectedShipmentData.has_critical_alert && (
                  <div className="p-2 bg-rose-100 border border-rose-300 rounded-lg text-rose-800 text-[11px] font-medium flex items-start gap-1.5">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-rose-600" />
                    <div>
                      <span className="font-bold">CRITICAL FOOD SAFETY NOTICE:</span> Severe temperature breach detected during transit. Inspect item quality thoroughly before acknowledging delivery.
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="pt-4 border-t border-slate-100">
              <button
                onClick={() => setScanning(!scanning)}
                disabled={!selectedShipment || verifying}
                className="w-full flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-500 text-white px-4 py-3 rounded-xl text-sm font-bold transition-colors"
              >
                <QrCode className="h-4 w-4" /> {scanning ? "Stop Scanner" : "Start QR Scanner"}
              </button>
            </div>

            <div className="relative">
              <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-slate-200" /></div>
              <div className="relative flex justify-center text-xs uppercase"><span className="bg-white px-2 text-slate-400">Or enter manually</span></div>
            </div>

            <form onSubmit={handleManualEntry} className="flex gap-2">
              <input
                name="batch_number"
                type="text"
                placeholder="Enter Batch Number"
                disabled={!selectedShipment || verifying}
                className="flex-1 px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500/50 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!selectedShipment || verifying}
                className="px-4 py-2 bg-emerald-100 text-emerald-700 hover:bg-emerald-200 font-medium rounded-xl text-sm transition-colors disabled:opacity-50"
              >
                Verify
              </button>
            </form>
          </div>

          <div className="bg-slate-50 rounded-2xl border border-slate-200 p-6 flex flex-col items-center justify-center min-h-[350px]">
            {scanning ? (
              <div className="w-full max-w-[300px]">
                <div id="qr-reader" className="w-full overflow-hidden rounded-xl border-2 border-emerald-500 shadow-lg"></div>
                <p className="text-center text-xs text-slate-500 mt-4">Point your camera at the batch QR code.</p>
              </div>
            ) : verifying ? (
              <div className="text-center space-y-3">
                <Search className="h-10 w-10 text-emerald-500 animate-pulse mx-auto" />
                <p className="text-sm font-medium text-slate-700">Verifying on backend...</p>
              </div>
            ) : verificationError ? (
              <div className="text-center space-y-3 w-full">
                <div className="mx-auto h-16 w-16 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center">
                  <AlertCircle className="h-8 w-8" />
                </div>
                <h3 className="text-lg font-bold text-slate-900">Verification Failed</h3>
                <p className="text-sm text-rose-600 bg-rose-50 p-4 rounded-xl border border-rose-200 mx-auto">{verificationError}</p>
                <button
                  onClick={() => setVerificationError("")}
                  className="mt-4 px-6 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 text-sm font-semibold rounded-xl transition-colors"
                >
                  Try Again
                </button>
              </div>
            ) : (
              <div className="text-center opacity-50">
                <QrCode className="h-16 w-16 mx-auto mb-4 text-slate-400" />
                <p className="text-sm font-medium text-slate-500">Scanner is inactive.</p>
              </div>
            )}
          </div>
        </div>
      ) : receiptSuccess ? (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-lg mx-auto overflow-hidden animate-in fade-in zoom-in-95 duration-300">
          <div className="bg-slate-900 p-8 text-center text-white">
            <div className="h-20 w-20 bg-emerald-500 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg shadow-emerald-500/30">
              <CheckCircle2 className="h-10 w-10 text-white" />
            </div>
            <h2 className="text-2xl font-bold tracking-tight">Receipt Confirmed</h2>
            <p className="text-slate-400 mt-2 text-sm">Product has been securely added to your inventory.</p>
          </div>

          <div className="p-6 space-y-6">
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
              <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Blockchain Transaction Hash</h4>
              <p className="font-mono text-xs text-slate-700 break-all bg-white p-3 border border-slate-200 rounded-lg shadow-inner">
                {receiptSuccess.blockchain_hash || "Simulated (No RPC Provided)"}
              </p>
            </div>

            <button
              onClick={() => {
                setVerifiedData(null)
                setReceiptSuccess(null)
                setSelectedShipment("")
              }}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-4 rounded-xl text-sm font-bold shadow-md transition-all flex items-center justify-center gap-2 uppercase tracking-wide"
            >
              Scan Next Item
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border-2 border-emerald-500 shadow-lg max-w-lg mx-auto overflow-hidden animate-in fade-in zoom-in-95 duration-300">
          <div className="bg-emerald-500 p-6 text-center">
            <CheckCircle2 className="h-16 w-16 text-white mx-auto mb-3" />
            <h2 className="text-2xl font-bold text-white tracking-tight">PRODUCT VERIFIED</h2>
          </div>

          <div className="p-8 space-y-6">
            <div className="grid grid-cols-2 gap-y-6 gap-x-4">
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Product</p>
                <p className="text-lg font-bold text-slate-900">{verifiedData.product_name}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Batch</p>
                <p className="font-mono text-sm font-semibold text-slate-700 bg-slate-100 px-2 py-1 rounded inline-block">{verifiedData.batch_number}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Quantity</p>
                <p className="text-lg font-bold text-emerald-600">{verifiedData.quantity} {verifiedData.unit}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Expiry</p>
                <p className="text-sm font-medium text-slate-900 flex items-center gap-1.5">
                  <Calendar className="h-4 w-4 text-slate-400" />
                  {verifiedData.expiry_date ? new Date(verifiedData.expiry_date).toLocaleDateString() : "N/A"}
                </p>
              </div>
            </div>

            {selectedShipmentData?.proof_of_delivery && (
              <div className="p-3 bg-slate-50 border rounded-xl text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-500">Delivered To:</span>
                  <span className="font-semibold">{selectedShipmentData.proof_of_delivery.recipient_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Quantity Claimed:</span>
                  <span className="font-semibold text-emerald-600">{selectedShipmentData.proof_of_delivery.quantity_delivered} {selectedShipmentData.proof_of_delivery.unit}</span>
                </div>
                {selectedShipmentData.proof_of_delivery.delivery_notes && (
                  <div className="text-slate-600 pt-1 border-t">
                    <span className="font-medium">Distributor Notes:</span> {selectedShipmentData.proof_of_delivery.delivery_notes}
                  </div>
                )}
              </div>
            )}

            {selectedShipmentData && (
              <div className={`p-3 border rounded-xl text-xs space-y-1.5 ${
                selectedShipmentData.cold_chain_status === 'CRITICAL'
                  ? 'bg-rose-50 border-rose-300 text-rose-900'
                  : selectedShipmentData.cold_chain_status === 'WARNING'
                  ? 'bg-amber-50 border-amber-300 text-amber-900'
                  : 'bg-slate-50 border-slate-200 text-slate-700'
              }`}>
                <div className="flex justify-between items-center">
                  <span className="flex items-center gap-1 font-semibold">
                    <Thermometer className="h-3.5 w-3.5" /> Cold-Chain Transit Status:
                  </span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                    selectedShipmentData.cold_chain_status === 'CRITICAL' ? 'bg-rose-200 text-rose-800' :
                    selectedShipmentData.cold_chain_status === 'WARNING' ? 'bg-amber-200 text-amber-800' :
                    selectedShipmentData.cold_chain_status === 'NORMAL' ? 'bg-emerald-200 text-emerald-800' :
                    'bg-slate-200 text-slate-700'
                  }`}>
                    {selectedShipmentData.cold_chain_status || 'UNAVAILABLE'}
                  </span>
                </div>
                {selectedShipmentData.latest_reading && (
                  <div className="flex justify-between text-slate-600">
                    <span>Observed Transit Reading:</span>
                    <span className="font-semibold text-slate-900">
                      {selectedShipmentData.latest_reading.temperature_celsius}°C
                      {selectedShipmentData.latest_reading.relative_humidity_pct !== null && ` • ${selectedShipmentData.latest_reading.relative_humidity_pct}% RH`}
                    </span>
                  </div>
                )}
                {selectedShipmentData.has_critical_alert && (
                  <div className="text-[11px] text-rose-700 font-semibold pt-1 border-t border-rose-200">
                    ⚠ Notice: A critical cold-chain alert was triggered for this batch. Proceed only after inspecting produce condition.
                  </div>
                )}
              </div>
            )}

            <div className="pt-6 border-t border-slate-100 space-y-2">
              {selectedShipmentData?.proof_of_delivery?.status === 'DISPUTED' ? (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs text-center font-medium">
                  Delivery is currently disputed. Resolve discrepancy with distributor before acknowledging.
                </div>
              ) : (
                <button
                  onClick={handleConfirmReceipt}
                  disabled={confirming}
                  className="w-full bg-slate-900 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-4 rounded-xl text-sm font-bold shadow-md transition-all flex items-center justify-center gap-2 uppercase tracking-wide"
                >
                  {confirming ? "Writing to Blockchain & Updating Inventory..." : "Confirm & Acknowledge Receipt"}
                </button>
              )}

              {selectedShipmentData?.proof_of_delivery?.status !== 'DISPUTED' && selectedShipmentData?.proof_of_delivery?.status !== 'ACKNOWLEDGED' && (
                <button
                  type="button"
                  onClick={() => setShowDiscrepancyModal(true)}
                  disabled={confirming}
                  className="w-full bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 disabled:opacity-50 px-6 py-3 text-sm font-semibold rounded-xl transition-colors flex items-center justify-center gap-1.5"
                >
                  <ShieldAlert className="h-4 w-4" /> Report Delivery Discrepancy
                </button>
              )}

              <button
                onClick={() => setVerifiedData(null)}
                disabled={confirming}
                className="w-full bg-transparent text-slate-500 hover:text-slate-700 disabled:opacity-50 px-6 py-2.5 text-sm font-semibold transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Discrepancy Report Modal */}
      {showDiscrepancyModal && selectedShipmentData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full overflow-hidden p-6 space-y-4">
            <div className="flex justify-between items-center pb-2 border-b">
              <div>
                <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <ShieldAlert className="h-5 w-5 text-rose-600" /> Report Delivery Discrepancy
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">Two-party delivery dispute notice</p>
              </div>
              <button onClick={() => setShowDiscrepancyModal(false)} className="text-slate-400 hover:text-slate-600 p-1">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-3 bg-slate-50 border rounded-xl text-xs space-y-1">
              <div><span className="text-slate-500">Tracking ID:</span> <span className="font-mono font-semibold">{selectedShipmentData.shipment_tracking_id}</span></div>
              <div><span className="text-slate-500">Batch:</span> <span className="font-mono">{selectedShipmentData.batch_number}</span></div>
              <div><span className="text-slate-500">Claimed Delivered:</span> <span className="font-semibold text-emerald-600">{selectedShipmentData.proof_of_delivery?.quantity_delivered || selectedShipmentData.quantity} {selectedShipmentData.unit}</span></div>
            </div>

            {discrepancyError && (
              <div className="p-3 bg-rose-50 text-rose-700 border border-rose-200 rounded-xl text-xs">
                {discrepancyError}
              </div>
            )}

            {discrepancySuccess && (
              <div className="p-3 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl text-xs flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>{discrepancySuccess}</span>
              </div>
            )}

            <form onSubmit={handleReportDiscrepancy} className="space-y-3.5">
              <div>
                <label className="text-xs font-semibold text-slate-700">Discrepancy Reason *</label>
                <select
                  required
                  value={discrepancyReason}
                  onChange={(e) => setDiscrepancyReason(e.target.value)}
                  className="w-full mt-1 px-3 py-2 text-sm rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-rose-500/50 outline-none"
                >
                  <option value="">-- Select reason --</option>
                  <option value="Quantity Mismatch (Short Delivery)">Quantity Mismatch (Short Delivery)</option>
                  <option value="Damaged Goods / Broken Packaging">Damaged Goods / Broken Packaging</option>
                  <option value="Spoiled or Expired Product">Spoiled or Expired Product</option>
                  <option value="Wrong Product Delivered">Wrong Product Delivered</option>
                  <option value="Missing Items from Pallet">Missing Items from Pallet</option>
                  <option value="Temperature Abuse / Cold Chain Broken">Temperature Abuse / Cold Chain Broken</option>
                  <option value="Other Discrepancy">Other Discrepancy</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700">Discrepancy Notes (Optional)</label>
                <textarea
                  rows={3}
                  value={discrepancyNotes}
                  onChange={(e) => setDiscrepancyNotes(e.target.value)}
                  placeholder="Provide specific details about the discrepancy (e.g. only 40kg received instead of 50kg, packaging crushed)"
                  className="w-full mt-1 px-3 py-2 text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-rose-500/50 outline-none resize-none"
                />
              </div>

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowDiscrepancyModal(false)}
                  disabled={reportingDiscrepancy}
                  className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 font-semibold rounded-xl text-sm hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={reportingDiscrepancy || !discrepancyReason}
                  className="flex-1 px-4 py-2.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-semibold rounded-xl text-sm transition-colors"
                >
                  {reportingDiscrepancy ? "Submitting..." : "Submit Discrepancy"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

import { ShoppingCart, Leaf, Info, Factory, Truck } from "lucide-react"

export function FarmerRequestsPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Supply Requests</h1>
          <p className="text-slate-400 mt-1">Manage direct product requests from supply chain partners.</p>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-slate-900 overflow-hidden shadow-xl p-8 lg:p-12 text-center">
        <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-6">
          <ShoppingCart className="h-8 w-8 text-primary" />
        </div>
        
        <h2 className="text-2xl font-bold text-foreground mb-3">Direct Farmer Requests Not Yet Supported</h2>
        <p className="text-slate-400 max-w-xl mx-auto mb-8">
          Based on the current Farm-to-Fork data architecture, supply requests are currently managed downstream between 
          <strong className="text-slate-300 font-semibold px-1">Retailers</strong> and <strong className="text-slate-300 font-semibold px-1">Distributors/Processors</strong>.
        </p>

        <div className="grid sm:grid-cols-3 gap-4 max-w-3xl mx-auto text-left">
          <div className="p-4 rounded-xl bg-white/5 border border-white/10 relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
              <Leaf className="h-16 w-16 text-primary" />
            </div>
            <h3 className="font-semibold text-slate-200 mb-1 flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/20 text-[10px] font-bold text-primary">1</span>
              Farm
            </h3>
            <p className="text-xs text-slate-400 relative z-10">You register harvests and await processor interest on your dashboard.</p>
          </div>
          
          <div className="p-4 rounded-xl bg-blue-500/5 border border-blue-500/20 relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
              <Factory className="h-16 w-16 text-blue-400" />
            </div>
            <h3 className="font-semibold text-blue-200 mb-1 flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-500/20 text-[10px] font-bold text-blue-400">2</span>
              Processing
            </h3>
            <p className="text-xs text-slate-400 relative z-10">Processors initiate deals directly with your specific batches.</p>
          </div>

          <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/20 relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
              <Truck className="h-16 w-16 text-amber-400" />
            </div>
            <h3 className="font-semibold text-amber-200 mb-1 flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/20 text-[10px] font-bold text-amber-400">3</span>
              Distribution
            </h3>
            <p className="text-xs text-slate-400 relative z-10">Retailers submit open requests which are fulfilled by processed stock.</p>
          </div>
        </div>

        <div className="mt-8 inline-flex items-start gap-3 p-4 rounded-xl bg-slate-800/50 border border-slate-700/50 text-left max-w-2xl">
          <Info className="h-5 w-5 text-slate-400 shrink-0 mt-0.5" />
          <p className="text-sm text-slate-400 leading-relaxed">
            <strong className="text-slate-300 block mb-1">Future Architecture Upgrade</strong>
            A future platform update will introduce a unified bidding and supply request engine, allowing Retailers to issue direct-to-farm supply requests for raw produce (Case C implementation plan). For now, please monitor your <strong>Dashboard</strong> for Processor deals.
          </p>
        </div>
      </div>
    </div>
  )
}

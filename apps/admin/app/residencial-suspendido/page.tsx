import { ShieldAlert } from "lucide-react";
import { GateFlowLogo } from "@gateflow/ui";

export default function ResidencialSuspendidoPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-950 px-4">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center text-white">
        <GateFlowLogo size={48} onDark />
        <ShieldAlert className="mt-4 h-10 w-10 text-warn" />
        <p className="font-display text-lg font-semibold">Este residencial está suspendido</p>
        <p className="text-sm text-white/60">
          El acceso a GateFlow para este residencial está temporalmente suspendido.
        </p>
        <a href="mailto:soporte@gateflow.mx" className="text-sm text-primary/80 underline hover:text-primary">
          soporte@gateflow.mx
        </a>
      </div>
    </div>
  );
}

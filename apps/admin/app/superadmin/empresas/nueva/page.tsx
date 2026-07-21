import { FormularioEmpresa } from "./formulario-empresa";

export default function NuevaEmpresaPage() {
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Nueva empresa</h1>
        <p className="text-sm text-muted-foreground">El cliente que contrata GateFlow — puede administrar uno o varios residenciales.</p>
      </div>
      <FormularioEmpresa />
    </div>
  );
}

import { ConfirmarCuentaForm } from "./confirmar-cuenta-form";

/**
 * Destino del enlace del correo de confirmación de /registro. Pública
 * (middleware): establece la sesión con el token del enlace y manda al
 * onboarding existente.
 */
export default function ConfirmarCuentaPage() {
  return <ConfirmarCuentaForm />;
}

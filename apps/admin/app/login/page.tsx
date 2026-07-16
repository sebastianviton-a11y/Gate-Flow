import { Suspense } from "react";
import { LoginForm } from "@/components/shared/login-form";

// useSearchParams (para preservar "next") requiere un límite de Suspense
// explícito; de lo contrario Next.js fuerza toda la ruta a client-side
// rendering sin avisarlo con claridad.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

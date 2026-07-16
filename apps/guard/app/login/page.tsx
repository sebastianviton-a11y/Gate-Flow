import { Suspense } from "react";
import { GuardLoginForm } from "@/components/guard-login-form";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <GuardLoginForm />
    </Suspense>
  );
}

"use server";

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@gateflow/supabase";
import { leerAccesoAdmin } from "@/lib/acceso-servidor";
import { autorizarBilling, permiteAlta } from "@/lib/billing/autorizacion";
import { planIdDeFormulario } from "@/lib/billing/checkout";
import { iniciarCheckoutServidor, urlGestionServidor } from "@/lib/billing/servidor";

/**
 * "Elegir plan": el navegador solo aporta planId. Usuario y residencial
 * salen de la sesión y de gf_tenant (leerAccesoAdmin); monto y moneda,
 * del catálogo del servidor. Nunca activa nada: solo redirige al
 * checkout hospedado; la activación llega por el webhook verificado.
 */
export async function elegirPlanAction(formulario: FormData): Promise<void> {
  const { userId, resultado } = await leerAccesoAdmin();
  const autorizacion = autorizarBilling(userId, resultado);
  if (!autorizacion.ok) {
    redirect(autorizacion.motivo === "sesion" ? "/login?next=/suscripcion" : "/suscripcion?error=rol");
  }
  if (!permiteAlta(resultado)) redirect("/suscripcion?error=estado");

  const {
    data: { user },
  } = await createServerSupabaseClient().auth.getUser();
  const resultadoCheckout = await iniciarCheckoutServidor({
    userId: autorizacion.userId,
    tenantId: autorizacion.tenantId,
    planId: planIdDeFormulario(formulario),
    emailPagador: user?.email ?? null,
  });
  if (!resultadoCheckout.ok) redirect(`/suscripcion?error=${resultadoCheckout.motivo}`);
  redirect(resultadoCheckout.url);
}

/** "Administrar suscripción" / "Actualizar método de pago": portal del proveedor. */
export async function administrarSuscripcionAction(): Promise<void> {
  const { userId, resultado } = await leerAccesoAdmin();
  const autorizacion = autorizarBilling(userId, resultado);
  if (!autorizacion.ok) {
    redirect(autorizacion.motivo === "sesion" ? "/login?next=/suscripcion" : "/suscripcion?error=rol");
  }
  const url = await urlGestionServidor(autorizacion.tenantId);
  redirect(url ?? "/suscripcion?error=gestion");
}

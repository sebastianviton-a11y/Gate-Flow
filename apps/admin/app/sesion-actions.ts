"use server";

import { cookies } from "next/headers";
import { COOKIE_TENANT } from "@gateflow/auth";

/**
 * Al cerrar sesión: borra la cookie gf_tenant de Admin (httpOnly, el
 * navegador no puede borrarla). Se llama antes de supabase.auth.signOut().
 */
export async function borrarResidencialSeleccionado(): Promise<void> {
  cookies().delete(COOKIE_TENANT);
}

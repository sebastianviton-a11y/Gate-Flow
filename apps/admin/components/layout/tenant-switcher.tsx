"use client";

import Link from "next/link";
import { ChevronsUpDown, Check, Building, ArrowLeftRight } from "lucide-react";
import type { Tenant } from "@gateflow/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@gateflow/ui";

/**
 * Residencial activo y, si hay más de uno, "Cambiar residencial": la
 * elección se hace en /seleccionar-residencial, que valida la membresía
 * en el servidor y reemplaza la cookie gf_tenant. Aquí no se cambia
 * nada en el cliente.
 */
export function TenantSwitcher({
  currentTenant,
  availableTenants,
}: {
  currentTenant: Tenant;
  availableTenants: Tenant[];
}) {
  const hasMultipleTenants = availableTenants.length > 1;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted">
          <Building className="h-4 w-4 text-muted-foreground" />
          <span className="max-w-[10rem] truncate">{currentTenant.nombre}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Residencial</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled className="justify-between opacity-100">
          <span className="truncate">{currentTenant.nombre}</span>
          <Check className="h-4 w-4 text-primary" />
        </DropdownMenuItem>
        {hasMultipleTenants && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/seleccionar-residencial" className="flex items-center gap-2">
                <ArrowLeftRight className="h-4 w-4" />
                Cambiar residencial
              </Link>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

"use client";

import { ChevronsUpDown, Check, Building } from "lucide-react";
import type { Tenant } from "@gateflow/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@gateflow/ui";
import { cn } from "@gateflow/ui";

/**
 * Selector de tenant activo.
 *
 * Sprint 01 solo tiene, en la práctica, un tenant disponible por sesión
 * (real o demo) — no existe todavía la resolución multi-tenant real contra
 * `user_tenants` con más de una fila. En vez de simular un cambio de tenant
 * que no hace nada (bug detectado en la revisión: los items no tenían
 * onClick), los tenants que no son el activo se muestran deshabilitados
 * con una etiqueta explícita, para no presentar un control que parece
 * funcional pero no hace nada. Sprint 02 reemplaza esto por el cambio real
 * de tenant activo (y su reflejo en el JWT vía Auth Hook).
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
        <DropdownMenuLabel>Residenciales</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {availableTenants.map((tenant) => {
          const isCurrent = tenant.id === currentTenant.id;
          return (
            <DropdownMenuItem
              key={tenant.id}
              disabled={!isCurrent}
              className={cn("justify-between", !isCurrent && "opacity-50")}
            >
              <span className="truncate">{tenant.nombre}</span>
              {isCurrent && <Check className="h-4 w-4 text-primary" />}
            </DropdownMenuItem>
          );
        })}
        {!hasMultipleTenants && (
          <>
            <DropdownMenuSeparator />
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              El cambio entre residenciales se habilita en Sprint 02.
            </p>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

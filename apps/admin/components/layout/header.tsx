"use client";

import { useRouter } from "next/navigation";
import { LogOut, User } from "lucide-react";
import type { SessionContext } from "@gateflow/types";
import { createBrowserSupabaseClient } from "@gateflow/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@gateflow/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@gateflow/ui";
import { TenantSwitcher } from "./tenant-switcher";
import { MobileNav } from "./mobile-nav";
import { ROLE_LABELS } from "@gateflow/auth/client";

function initials(nombre: string) {
  return nombre
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function Header({ session }: { session: SessionContext }) {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createBrowserSupabaseClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border bg-background px-4 md:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <MobileNav role={session.role} />
        <TenantSwitcher currentTenant={session.tenant} availableTenants={session.availableTenants} />
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted">
            <div className="text-right">
              <p className="text-sm font-medium leading-tight">{session.user.nombreCompleto}</p>
              <p className="text-xs leading-tight text-muted-foreground">{ROLE_LABELS[session.role]}</p>
            </div>
            <Avatar>
              <AvatarImage src={session.user.avatarUrl ?? undefined} alt={session.user.nombreCompleto} />
              <AvatarFallback>{initials(session.user.nombreCompleto)}</AvatarFallback>
            </Avatar>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Mi cuenta</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem>
            <User className="h-4 w-4" />
            Perfil
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:bg-destructive/10">
            <LogOut className="h-4 w-4" />
            Cerrar sesión
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}

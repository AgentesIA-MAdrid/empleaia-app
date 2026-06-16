"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  Menu,
  Bell,
  ChevronDown,
  User,
  LogOut,
  Settings,
} from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

// ─── Page title map ───────────────────────────────────────────────────────────

const PAGE_TITLES: Record<string, string> = {
  "/admin": "Dashboard",
  "/admin/tiendas": "Sedes",
  "/admin/empleados": "Empleados",
  "/admin/turnos": "Turnos",
  "/admin/ausencias": "Ausencias",
  "/admin/informes": "Informes",
  "/admin/configuracion": "Configuración",
  "/admin/tareas": "Tareas",
  "/admin/comunicados": "Comunicados",
  "/admin/articulos": "Artículos",
  "/admin/documentos": "Documentos",
  "/admin/onboarding": "On/Offboardings",
  "/admin/reclutamiento": "Reclutamiento",
  "/admin/encuestas": "Encuestas",
  "/admin/evaluaciones": "Evaluaciones",
  "/admin/formacion": "Formación",
  "/admin/objetivos": "Objetivos",
  "/admin/nominas": "Nóminas",
  "/admin/envio-nominas": "Envío Nóminas",
  "/admin/control-gastos": "Control de Gastos",
  "/admin/retribucion": "Retribución Flexible",
  "/admin/wallet": "Wallet",
  "/admin/bolsa-horas": "Bolsa de Horas",
  "/admin/people-analytics": "People Analytics",
  "/admin/firma": "Firma Electrónica",
  "/admin/organigrama": "Organigrama",
  "/admin/grupo": "Grupo",
  "/manager": "Dashboard",
  "/manager/presencia": "Presencia",
  "/manager/turnos": "Turnos",
  "/manager/ausencias": "Ausencias",
  "/manager/informes": "Informes",
  "/manager/tareas": "Tareas",
  "/manager/comunicados": "Comunicados",
  "/manager/articulos": "Artículos",
  "/manager/documentos": "Documentos",
  "/empleado": "Fichar",
  "/empleado/mis-fichajes": "Mis Fichajes",
  "/empleado/mis-turnos": "Mis Turnos",
  "/empleado/mis-ausencias": "Mis Ausencias",
  "/empleado/tareas": "Mis Tareas",
  "/empleado/comunicados": "Comunicados",
  "/empleado/articulos": "Artículos",
  "/empleado/documentos": "Mis Documentos",
  "/empleado/preferencias": "Preferencias de notificaciones",
};

function getPageTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  // Try matching with trailing segments
  const parts = pathname.split("/");
  for (let i = parts.length; i > 0; i--) {
    const key = parts.slice(0, i).join("/");
    if (PAGE_TITLES[key]) return PAGE_TITLES[key];
  }
  return "empleaIA";
}

function getInitials(name?: string | null): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

// ─── Header ───────────────────────────────────────────────────────────────────

interface SessionUser {
  id: string;
  nombre: string;
  apellidos: string;
  email: string;
  rol: string;
  tiendaId: string | null;
}

interface HeaderProps {
  user: SessionUser;
  onMenuToggle?: () => void;
  notificationCount?: number;
}

export function Header({ user, onMenuToggle, notificationCount = 0 }: HeaderProps) {
  const pathname = usePathname();

  const nombre = user.nombre;
  const apellidos = user.apellidos;
  const fullName = apellidos ? `${nombre} ${apellidos}` : nombre;
  const email = user.email;

  const pageTitle = getPageTitle(pathname);

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60 lg:px-6">
      {/* Left: menu toggle + page title */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          onClick={onMenuToggle}
          aria-label="Abrir menú"
        >
          <Menu className="h-5 w-5" />
        </Button>

        <div>
          <h1 className="text-lg font-semibold text-foreground leading-none">
            {pageTitle}
          </h1>
        </div>
      </div>

      {/* Right: notifications + user menu */}
      <div className="flex items-center gap-2">
        {/* Notification bell */}
        <button
          className="relative flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          aria-label="Notificaciones"
        >
          <Bell className="h-5 w-5" />
          {notificationCount > 0 && (
            <span className="absolute top-1.5 right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-0.5 text-[10px] font-bold text-white leading-none">
              {notificationCount > 9 ? "9+" : notificationCount}
            </span>
          )}
        </button>

        {/* User dropdown */}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium text-foreground hover:bg-accent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Menú de usuario"
            >
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-primary/10 text-primary text-sm font-semibold">
                  {getInitials(fullName)}
                </AvatarFallback>
              </Avatar>
              <span className="hidden sm:block max-w-[140px] truncate">
                {nombre}
              </span>
              <ChevronDown className="h-4 w-4 text-muted-foreground hidden sm:block" />
            </button>
          </DropdownMenu.Trigger>

          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={8}
              className={cn(
                "z-50 min-w-[200px] overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-lg",
                "data-[state=open]:animate-in data-[state=closed]:animate-out",
                "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
                "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
                "data-[side=bottom]:slide-in-from-top-2"
              )}
            >
              {/* User info header */}
              <div className="px-3 py-2 border-b border-border mb-1">
                <p className="text-sm font-semibold text-foreground truncate">
                  {fullName}
                </p>
                <p className="text-xs text-muted-foreground truncate">{email}</p>
              </div>

              {/* Navegación con <Link> (ancla real): el patrón anterior
                  con <button onClick={router.push}> no navegaba porque al
                  seleccionar el item Radix cierra/desmonta el menú y cancela
                  el push antes de que se complete. */}
              <DropdownMenu.Item asChild>
                <Link
                  href="/perfil"
                  className="flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground hover:bg-accent focus:bg-accent focus:outline-none transition-colors"
                >
                  <User className="h-4 w-4 text-muted-foreground" />
                  Mi perfil
                </Link>
              </DropdownMenu.Item>

              <DropdownMenu.Item asChild>
                <Link
                  href={
                    user.rol === "OWNER" || user.rol === "MANAGER"
                      ? "/admin/configuracion"
                      : "/empleado/preferencias"
                  }
                  className="flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground hover:bg-accent focus:bg-accent focus:outline-none transition-colors"
                >
                  <Settings className="h-4 w-4 text-muted-foreground" />
                  Preferencias
                </Link>
              </DropdownMenu.Item>

              <DropdownMenu.Separator className="my-1 h-px bg-border" />

              <DropdownMenu.Item asChild>
                <button
                  onClick={() => signOut({ callbackUrl: "/login" })}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-red-600 hover:bg-red-50 focus:bg-red-50 focus:outline-none transition-colors"
                >
                  <LogOut className="h-4 w-4" />
                  Cerrar sesión
                </button>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </header>
  );
}

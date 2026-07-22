"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bell, CheckCheck, Loader2 } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";

interface Notificacion {
  id: string;
  titulo: string;
  mensaje: string;
  tipo: string;
  leida: boolean;
  enlace: string | null;
  createdAt: string;
}

interface NotificationsBellProps {
  /** "header" = botón cuadrado top-right; "sidebar" = fila con etiqueta. */
  variant?: "header" | "sidebar";
  /** Solo aplica a variant="sidebar": oculta la etiqueta cuando está plegado. */
  collapsed?: boolean;
}

/**
 * Campana de notificaciones funcional. Antes ambos botones (header y
 * sidebar) eran decorativos (sin onClick, contador fijo a 0) pese a existir
 * el backend completo en `/api/notificaciones`. Este componente los conecta:
 * lee las notificaciones del usuario autenticado, pinta el contador de no
 * leídas y despliega la lista, marcando como leídas al pulsar.
 */
export function NotificationsBell({ variant = "header", collapsed = false }: NotificationsBellProps) {
  const [notificaciones, setNotificaciones] = useState<Notificacion[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const noLeidas = notificaciones.filter((n) => !n.leida).length;

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/notificaciones");
      if (res.ok) {
        setNotificaciones(await res.json());
      }
    } catch {
      // silencioso: la campana no debe romper el layout si falla la red
    } finally {
      setLoading(false);
    }
  }, []);

  // Carga inicial para poder pintar el contador sin abrir el panel.
  useEffect(() => {
    cargar();
  }, [cargar]);

  // Refresca al abrir para no mostrar datos rancios.
  useEffect(() => {
    if (open) cargar();
  }, [open, cargar]);

  const marcarLeida = useCallback(async (id: string) => {
    setNotificaciones((prev) =>
      prev.map((n) => (n.id === id ? { ...n, leida: true } : n))
    );
    try {
      await fetch(`/api/notificaciones/${id}`, { method: "PATCH" });
    } catch {
      // el estado local ya se actualizó; el backend se resincroniza al recargar
    }
  }, []);

  const marcarTodasLeidas = useCallback(async () => {
    if (noLeidas === 0) return;
    setNotificaciones((prev) => prev.map((n) => ({ ...n, leida: true })));
    try {
      await fetch("/api/notificaciones", { method: "PATCH" });
    } catch {
      // idem: se resincroniza en la próxima carga
    }
  }, [noLeidas]);

  const Badge = noLeidas > 0 && (
    <span
      className={cn(
        "absolute flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-0.5 text-[10px] font-bold text-white leading-none",
        variant === "header" ? "top-1.5 right-1.5" : "-top-1.5 -right-1.5"
      )}
    >
      {noLeidas > 9 ? "9+" : noLeidas}
    </span>
  );

  const trigger =
    variant === "header" ? (
      <button
        className="relative flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        aria-label="Notificaciones"
      >
        <Bell className="h-5 w-5" />
        {Badge}
      </button>
    ) : (
      <button
        className={cn(
          "group flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors",
          collapsed && "justify-center px-2"
        )}
        title={collapsed ? "Notificaciones" : undefined}
        aria-label="Notificaciones"
      >
        <div className="relative shrink-0">
          <Bell className="h-4 w-4 text-slate-400 group-hover:text-slate-700 transition-colors" />
          {Badge}
        </div>
        {!collapsed && <span className="flex-1 text-left text-sm">Notificaciones</span>}
      </button>
    );

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={variant === "header" ? "end" : "start"}
          side={variant === "header" ? "bottom" : "right"}
          sideOffset={8}
          className={cn(
            "z-50 w-[340px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-popover p-0 shadow-lg",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
          )}
        >
          {/* Cabecera */}
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <p className="text-sm font-semibold text-foreground">Notificaciones</p>
            {noLeidas > 0 && (
              <button
                onClick={marcarTodasLeidas}
                className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Marcar todas
              </button>
            )}
          </div>

          {/* Lista */}
          <div className="max-h-[380px] overflow-y-auto">
            {loading && notificaciones.length === 0 ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : notificaciones.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                No tienes notificaciones.
              </div>
            ) : (
              notificaciones.map((n) => {
                const contenido = (
                  <>
                    {!n.leida && (
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                    )}
                    <div className={cn("min-w-0 flex-1", n.leida && "pl-4")}>
                      <p className="truncate text-sm font-medium text-foreground">
                        {n.titulo}
                      </p>
                      <p className="line-clamp-2 text-xs text-muted-foreground">
                        {n.mensaje}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                        {formatDistanceToNow(new Date(n.createdAt), {
                          addSuffix: true,
                          locale: es,
                        })}
                      </p>
                    </div>
                  </>
                );

                const claseFila = cn(
                  "flex w-full items-start gap-2 border-b border-border/60 px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-accent",
                  !n.leida && "bg-primary/5"
                );

                return n.enlace ? (
                  <Link
                    key={n.id}
                    href={n.enlace}
                    onClick={() => {
                      if (!n.leida) marcarLeida(n.id);
                      setOpen(false);
                    }}
                    className={claseFila}
                  >
                    {contenido}
                  </Link>
                ) : (
                  <button
                    key={n.id}
                    onClick={() => n.leida || marcarLeida(n.id)}
                    className={claseFila}
                  >
                    {contenido}
                  </button>
                );
              })
            )}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

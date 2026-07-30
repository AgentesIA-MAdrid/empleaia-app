"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";

interface SessionUser {
  id: string;
  nombre: string;
  apellidos: string;
  email: string;
  rol: string;
  tiendaId: string | null;
}

interface Branding {
  logo?: string | null;
  appNombre: string;
  nombre?: string | null;
}

interface TrialInfo {
  trialEnd: string | null;
  isTrialing: boolean;
}

interface DashboardShellProps {
  children: React.ReactNode;
  user: SessionUser;
  branding?: Branding;
  trial?: TrialInfo | null;
  /** Cierre de turno en rodaje: el menú del módulo solo se pinta a administración. */
  cierreTurnoEnRodaje?: boolean;
}

function daysLeft(iso: string | null): number | null {
  if (!iso) return null;
  const end = new Date(iso).getTime();
  const ms = end - Date.now();
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

export function DashboardShell({
  children,
  user,
  branding,
  trial,
  cierreTurnoEnRodaje = false,
}: DashboardShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const toggleSidebar = () => setSidebarOpen((prev) => !prev);

  const dias = trial?.isTrialing ? daysLeft(trial.trialEnd) : null;

  return (
    <div className="flex h-full min-h-screen bg-muted/30">
      <Sidebar
        user={user}
        branding={branding}
        isOpen={sidebarOpen}
        onToggle={toggleSidebar}
        pendingAusencias={0}
        cierreTurnoEnRodaje={cierreTurnoEnRodaje}
      />

      {/* Main content area */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        <Header user={user} onMenuToggle={toggleSidebar} />
        {trial?.isTrialing && user.rol === "OWNER" && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 lg:px-6 py-2.5 text-sm flex items-center gap-3 flex-wrap">
            <Sparkles className="h-4 w-4 text-amber-600 shrink-0" />
            <span className="text-amber-900">
              Estás en <strong>periodo de prueba</strong>
              {dias !== null && (dias > 0
                ? <> — te {dias === 1 ? "queda" : "quedan"} <strong>{dias} {dias === 1 ? "día" : "días"}</strong> de evaluación.</>
                : <> — el periodo de prueba ha terminado.</>)}
            </span>
            <Link
              href="/admin/planes"
              className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 text-xs font-semibold"
            >
              Activar cuenta
            </Link>
          </div>
        )}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <div className="mx-auto max-w-7xl animate-fade-in">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

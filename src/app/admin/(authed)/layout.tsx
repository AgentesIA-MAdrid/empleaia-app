/**
 * Layout del panel super-admin. Plan Fase 7 §5.1 + fix bug parallel pages.
 *
 * Subido al subdominio admin.<root>. NO usa withTenantPage —
 * el panel vive sin tenant. Branding fijo empleaIA.
 *
 * Vive en src/app/admin/ (path real, no grupo) para evitar conflicto
 * con (auth)/login del subdominio del tenant. Next.js rechaza dos
 * pages que resuelvan al mismo path.
 */

import type { ReactNode } from "react";
import Link from "next/link";
import { LayoutDashboard, Users, FileText, LogOut, MessageSquare, KeyRound, ShieldCheck } from "lucide-react";
import { EmpleaIASymbol } from "@/components/brand/empleaia-logo";
import { NewTicketsBanner } from "@/components/admin/new-tickets-banner";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--bg-subtle,#F8FAFC)]">
      <header className="bg-white border-b border-[var(--color-border,#E2E8F0)]">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link href="/admin/dashboard" className="inline-flex items-center gap-2 font-bold tracking-[-0.02em]">
              <EmpleaIASymbol size={28} />
              <span className="text-[15px]">
                <span className="text-[var(--color-text-dark,#0F172A)]">emplea</span>
                <span className="text-[var(--primary)]">IA</span>
                <span className="text-[var(--color-text-muted,#94A3B8)] font-normal ml-2">· super-admin</span>
              </span>
            </Link>
            <nav className="hidden md:flex items-center gap-1 text-sm">
              <NavLink href="/admin/dashboard" icon={LayoutDashboard}>Dashboard</NavLink>
              <NavLink href="/admin/tenants" icon={Users}>Tenants</NavLink>
              <NavLink href="/admin/audit-log" icon={FileText}>Audit log</NavLink>
              <NavLink href="/admin/feedback" icon={MessageSquare}>Feedback</NavLink>
              <NavLink href="/admin/admins" icon={ShieldCheck}>Admins</NavLink>
              <NavLink href="/admin/cuenta" icon={KeyRound}>Cuenta</NavLink>
            </nav>
          </div>
          <form action="/api/admin/logout" method="POST">
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 text-sm text-[var(--color-text-body,#475569)] hover:text-[var(--color-text-dark,#0F172A)] hover:bg-slate-100 rounded-md px-3 py-1.5 transition-colors"
            >
              <LogOut className="h-4 w-4" />
              Salir
            </button>
          </form>
        </div>
      </header>
      <NewTicketsBanner />
      <main className="max-w-7xl mx-auto px-6 py-8">{children}</main>
    </div>
  );
}

function NavLink({
  href,
  icon: Icon,
  children,
}: {
  href: string;
  icon: typeof LayoutDashboard;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[var(--color-text-body,#475569)] hover:text-[var(--color-text-dark,#0F172A)] hover:bg-slate-100 transition-colors"
    >
      <Icon className="h-4 w-4" />
      {children}
    </Link>
  );
}

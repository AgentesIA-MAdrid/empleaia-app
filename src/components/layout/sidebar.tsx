"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useFeatures } from "@/lib/hooks/use-features";
import { Lock } from "lucide-react";
import {
  LayoutDashboard, Store, Users, Calendar, FileText,
  Settings, LogOut, Clock, ClipboardList, CalendarCheck, BarChart3,
  ChevronLeft, ChevronRight, UserCheck, CheckSquare, Megaphone, ClipboardCheck,
  BookOpen, FolderOpen, Rocket, Timer, Search, Pen,
  ChevronDown, Sparkles, ShieldAlert, Network,
  Bot, ScanFace, Target, MessageSquare,
  Star, CreditCard, Building2, Send, GraduationCap,
  Building, Boxes, MessageCircle, Calculator, Wallet, Scale,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { EmpleaIALogo, EmpleaIASymbol } from "@/components/brand/empleaia-logo";
import { NotificationsBell } from "@/components/layout/notifications-bell";

interface SessionUser {
  id: string;
  nombre: string;
  apellidos: string;
  email: string;
  rol: string;
  tiendaId: string | null;
}

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
  /**
   * Feature key del catálogo (ADR-004). Si está presente y el plan del
   * tenant NO la incluye, el item se pinta como bloqueado y al pulsar
   * lleva a /admin/planes en lugar de a su href real.
   */
  feature?: string;
  /**
   * Con `feature` bloqueada, oculta el item en lugar de pintarlo con candado
   * y enlace a /admin/planes. Es para módulos que aún se están construyendo:
   * un candado invita al cliente a preguntar por algo que todavía no existe,
   * mientras que el upsell normal sí quiere verse.
   */
  ocultarSiBloqueado?: boolean;
}

interface NavSection {
  key: string;
  label: string;
  items: NavItem[];
}

interface SidebarConfig {
  top: NavItem;
  sections: NavSection[];
}

function getSidebarConfig(rol: string, pendingAusencias = 0): SidebarConfig {
  if (rol === "OWNER") {
    return {
      top: { label: "Dashboard", href: "/admin", icon: LayoutDashboard },
      sections: [
        {
          key: "admin",
          label: "ADMINISTRADOR",
          items: [
            { label: "Empleados", href: "/admin/empleados", icon: Users },
            { label: "Sedes", href: "/admin/tiendas", icon: Store, feature: "multi_tienda" },
          ],
        },
        {
          key: "tiempo",
          label: "GESTIÓN DEL TIEMPO",
          items: [
            { label: "Fichajes", href: "/admin/fichajes", icon: Clock },
            { label: "Aprobaciones de fichaje", href: "/admin/solicitudes-fichaje", icon: ClipboardCheck },
            { label: "Ausencias", href: "/admin/ausencias", icon: ClipboardList, badge: pendingAusencias || undefined, feature: "ausencias_aprobacion" },
            { label: "Turnos", href: "/admin/turnos", icon: Calendar, feature: "turnos_publicacion" },
            { label: "Bolsa de horas", href: "/admin/bolsa-horas", icon: Timer, feature: "bolsa_horas" },
            { label: "Tareas", href: "/admin/tareas", icon: CheckSquare, feature: "tareas" },
          ],
        },
        {
          key: "ventas",
          label: "VENTAS Y CAJA",
          items: [
            { label: "Cierre de turno", href: "/admin/cierre-turno", icon: ClipboardList, feature: "cierre_turno", ocultarSiBloqueado: true },
            { label: "Arqueos", href: "/admin/arqueos", icon: Wallet, feature: "cierre_turno", ocultarSiBloqueado: true },
            { label: "Objetivos de venta", href: "/admin/objetivos-venta", icon: Target, feature: "cierre_turno", ocultarSiBloqueado: true },
            { label: "Conciliación", href: "/admin/conciliacion", icon: Scale, feature: "cierre_turno", ocultarSiBloqueado: true },
          ],
        },
        {
          key: "talento",
          label: "TALENTO",
          items: [
            { label: "Incorporaciones y bajas", href: "/admin/onboarding", icon: Rocket, feature: "onboarding_offboarding" },
            { label: "Reclutamiento", href: "/admin/reclutamiento", icon: Search, feature: "reclutamiento" },
            { label: "Organigrama", href: "/admin/organigrama", icon: Network, feature: "organigrama" },
            { label: "Objetivos (OKRs)", href: "/admin/objetivos", icon: Target, feature: "objetivos" },
            { label: "Encuestas de clima", href: "/admin/encuestas", icon: MessageSquare, feature: "encuestas_clima" },
            { label: "Evaluaciones", href: "/admin/evaluaciones", icon: Star, feature: "evaluaciones" },
            { label: "Formación", href: "/admin/formacion", icon: GraduationCap, feature: "formacion" },
          ],
        },
        {
          key: "operaciones",
          label: "OPERACIONES",
          items: [
            { label: "Control de gastos", href: "/admin/control-gastos", icon: CreditCard, feature: "control_gastos" },
            { label: "Reserva de espacios", href: "/admin/reserva-espacios", icon: Building2, feature: "reserva_espacios" },
            { label: "Envío de nóminas", href: "/admin/envio-nominas", icon: Send, feature: "envio_nominas" },
            { label: "Prenómina", href: "/admin/nominas", icon: Calculator, feature: "prenomina" },
            { label: "Retribución flexible", href: "/admin/retribucion", icon: Wallet, feature: "retribucion_flex" },
            { label: "Peticiones", href: "/admin/custom-requests", icon: ClipboardList, feature: "custom_requests" },
          ],
        },
        {
          key: "plataforma",
          label: "PLATAFORMA",
          items: [
            { label: "Chat", href: "/chat", icon: MessageCircle, feature: "chat" },
            { label: "WhatsApp Bot", href: "/admin/whatsapp-bot", icon: MessageSquare, feature: "whatsapp_bot" },
            { label: "Marketplace", href: "/admin/marketplace", icon: Boxes, feature: "marketplace" },
            { label: "Grupo empresarial", href: "/admin/grupo", icon: Building, feature: "multi_empresa" },
          ],
        },
        {
          key: "comunicacion",
          label: "COMUNICACIÓN",
          items: [
            { label: "Comunicados", href: "/admin/comunicados", icon: Megaphone, feature: "comunicados" },
            { label: "Artículos", href: "/admin/articulos", icon: BookOpen, feature: "articulos" },
            { label: "Canal de denuncias", href: "/admin/canal-denuncias", icon: ShieldAlert, feature: "canal_denuncias" },
          ],
        },
        {
          key: "empresa",
          label: "EMPRESA",
          items: [
            { label: "Documentos", href: "/admin/documentos", icon: FolderOpen, feature: "documentos" },
            { label: "Informes", href: "/admin/informes", icon: BarChart3, feature: "informes_avanzados" },
            { label: "Asistente IA", href: "/admin/asistente-ia", icon: Bot, feature: "asistente_ia" },
            { label: "Face ID", href: "/admin/face-id", icon: ScanFace, feature: "face_id" },
            { label: "Firma electrónica", href: "/admin/firma", icon: Pen, feature: "firma_electronica" },
          ],
        },
        {
          key: "facturacion",
          label: "FACTURACIÓN",
          items: [
            { label: "Planes y facturación", href: "/admin/planes", icon: Sparkles },
          ],
        },
      ],
    };
  }

  if (rol === "MANAGER") {
    return {
      top: { label: "Dashboard", href: "/manager", icon: LayoutDashboard },
      sections: [
        {
          key: "tiempo",
          label: "GESTIÓN DEL TIEMPO",
          items: [
            { label: "Presencia", href: "/manager/presencia", icon: UserCheck },
            { label: "Aprobaciones de fichaje", href: "/manager/solicitudes-fichaje", icon: ClipboardCheck },
            { label: "Ausencias", href: "/manager/ausencias", icon: ClipboardList, badge: pendingAusencias || undefined },
            { label: "Mis Ausencias", href: "/manager/mis-ausencias", icon: CalendarCheck },
            { label: "Turnos", href: "/manager/turnos", icon: Calendar },
            { label: "Tareas", href: "/manager/tareas", icon: CheckSquare },
          ],
        },
        {
          key: "comunicacion",
          label: "COMUNICACIÓN",
          items: [
            { label: "Comunicados", href: "/manager/comunicados", icon: Megaphone },
            { label: "Artículos", href: "/manager/articulos", icon: BookOpen },
          ],
        },
        {
          key: "empresa",
          label: "EMPRESA",
          items: [
            { label: "Documentos", href: "/manager/documentos", icon: FolderOpen },
            { label: "Informes", href: "/manager/informes", icon: BarChart3 },
            { label: "Cierre de turno", href: "/manager/cierre-turno", icon: ClipboardList, feature: "cierre_turno", ocultarSiBloqueado: true },
            { label: "Objetivos de venta", href: "/manager/objetivos-venta", icon: Target, feature: "cierre_turno", ocultarSiBloqueado: true },
          ],
        },
      ],
    };
  }

  // EMPLEADO
  return {
    top: { label: "Fichar", href: "/empleado", icon: Clock },
    sections: [
      {
        key: "tiempo",
        label: "GESTIÓN DEL TIEMPO",
        items: [
          { label: "Mis Fichajes", href: "/empleado/mis-fichajes", icon: FileText },
          { label: "Mis Turnos", href: "/empleado/mis-turnos", icon: CalendarCheck },
          { label: "Mis Ausencias", href: "/empleado/mis-ausencias", icon: ClipboardList },
          { label: "Mis Tareas", href: "/empleado/tareas", icon: CheckSquare },
        ],
      },
      {
        key: "ventas",
        label: "VENTAS Y CAJA",
        items: [
          { label: "Cierre de turno", href: "/empleado/cierre-turno", icon: ClipboardList, feature: "cierre_turno", ocultarSiBloqueado: true },
          { label: "Arqueos", href: "/empleado/arqueos", icon: Wallet, feature: "cierre_turno", ocultarSiBloqueado: true },
        ],
      },
      {
        key: "comunicacion",
        label: "COMUNICACIÓN",
        items: [
          { label: "Comunicados", href: "/empleado/comunicados", icon: Megaphone },
          { label: "Artículos", href: "/empleado/articulos", icon: BookOpen },
          { label: "Encuestas", href: "/empleado/encuestas", icon: MessageSquare, feature: "encuestas_clima" },
          { label: "Chat", href: "/chat", icon: MessageCircle, feature: "chat" },
        ],
      },
      {
        key: "empresa",
        label: "EMPRESA",
        items: [
          { label: "Mis Documentos", href: "/empleado/documentos", icon: FolderOpen },
          { label: "Mis Firmas", href: "/empleado/firmas", icon: Pen },
          { label: "Peticiones", href: "/empleado/peticiones", icon: ClipboardList, feature: "custom_requests" },
          { label: "Face ID", href: "/empleado/face-id", icon: ScanFace },
        ],
      },
    ],
  };
}

function getRolLabel(rol: string) {
  switch (rol) {
    case "OWNER": return "Administrador";
    case "MANAGER": return "Coordinador";
    default: return "Empleado";
  }
}

function getRolColor(rol: string) {
  switch (rol) {
    case "OWNER": return "bg-violet-100 text-violet-700";
    case "MANAGER": return "bg-sky-100 text-sky-700";
    default: return "bg-emerald-100 text-emerald-700";
  }
}

function getInitials(nombre: string, apellidos: string): string {
  return `${nombre[0] ?? ""}${apellidos[0] ?? ""}`.toUpperCase();
}

interface Branding {
  logo?: string | null;
  appNombre: string;
  nombre?: string | null;
}

interface SidebarProps {
  user: SessionUser;
  branding?: Branding;
  pendingAusencias?: number;
  isOpen?: boolean;
  onToggle?: () => void;
}

export function Sidebar({
  user,
  branding,
  pendingAusencias = 0,
  isOpen = true,
  onToggle,
}: SidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

  const { top, sections } = getSidebarConfig(user.rol, pendingAusencias);
  const fullName = user.apellidos ? `${user.nombre} ${user.apellidos}` : user.nombre;

  // Plan del tenant: para items con `feature`, comprobamos si el plan
  // incluye esa key. `null` = aún cargando (no bloqueamos nada hasta
  // saber, evitamos pintar todo locked durante el primer paint).
  const { data: features } = useFeatures();
  const isLocked = (feature?: string): boolean => {
    if (!feature) return false;
    if (!features) return false; // sin datos aún → tratamos como disponible
    return features.booleans[feature] !== true;
  };

  const isActive = (href: string) => {
    if (pathname === href) return true;
    if (href !== "/admin" && href !== "/manager" && href !== "/empleado") {
      return pathname.startsWith(href);
    }
    return false;
  };

  const toggleSection = (key: string) => {
    setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const NavLink = ({ item }: { item: NavItem }) => {
    const active = isActive(item.href);
    const Icon = item.icon;

    if (isLocked(item.feature)) {
      return (
        <Link
          href="/admin/planes"
          className={cn(
            "group flex items-center gap-3 rounded-md pl-3 pr-3 py-2 text-sm transition-colors",
            "text-slate-400 hover:text-slate-700 hover:bg-amber-50",
            collapsed && "justify-center px-2"
          )}
          title={collapsed ? `${item.label} — requiere plan superior` : undefined}
        >
          <Icon className="h-4 w-4 shrink-0 text-slate-300 group-hover:text-amber-600" />
          {!collapsed && (
            <>
              <span className="flex-1 truncate">{item.label}</span>
              <span className="inline-flex items-center gap-1 text-[10px] bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded-full font-medium shrink-0">
                <Lock className="h-3 w-3" />
                Plan
              </span>
            </>
          )}
        </Link>
      );
    }

    return (
      <Link
        href={item.href}
        className={cn(
          "group relative flex items-center gap-3 rounded-md pl-3 pr-3 py-2 text-sm font-medium transition-colors",
          active
            ? "bg-[var(--sidebar-active-bg)] text-[var(--sidebar-active-text)]"
            : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
          collapsed && "justify-center px-2"
        )}
        title={collapsed ? item.label : undefined}
      >
        {active && !collapsed && (
          <span
            aria-hidden="true"
            className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-[var(--sidebar-active-border)]"
          />
        )}
        <Icon
          className={cn(
            "h-4 w-4 shrink-0 transition-colors",
            active ? "text-[var(--sidebar-active-text)]" : "text-slate-400 group-hover:text-slate-700"
          )}
        />
        {!collapsed && (
          <>
            <span className="flex-1 truncate">{item.label}</span>
            {item.badge !== undefined && item.badge > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-xs font-bold text-white leading-none">
                {item.badge > 99 ? "99+" : item.badge}
              </span>
            )}
          </>
        )}
      </Link>
    );
  };

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/50 lg:hidden"
          onClick={onToggle}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 flex flex-col bg-[var(--sidebar-bg)] text-slate-700 border-r border-slate-200 transition-all duration-300 overflow-hidden",
          "lg:relative lg:translate-x-0",
          collapsed ? "w-16" : "w-64",
          isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        {/* Header */}
        <div className="flex h-16 items-center justify-between px-3 border-b border-slate-200 shrink-0">
          {!collapsed && (
            <div className="flex items-center overflow-hidden">
              {branding?.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={branding.logo}
                  alt={branding.appNombre}
                  className="h-9 max-w-[180px] object-contain"
                />
              ) : (
                <EmpleaIALogo appNombre={branding?.appNombre} symbolSize={52} />
              )}
            </div>
          )}
          {collapsed && (
            <div className="mx-auto flex items-center justify-center overflow-hidden">
              {branding?.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={branding.logo} alt="" className="h-9 w-9 object-contain rounded-lg" />
              ) : (
                <EmpleaIALogo appNombre={branding?.appNombre} symbolSize={40} />
              )}
            </div>
          )}
          <button
            onClick={() => setCollapsed((c) => !c)}
            className={cn(
              "hidden lg:flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors shrink-0",
              collapsed && "mx-auto"
            )}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>

        {/* User info */}
        {!collapsed ? (
          <div className="px-3 py-3 border-b border-slate-200 shrink-0">
            <div className="flex items-center gap-2">
              <Avatar className="h-8 w-8 shrink-0">
                <AvatarFallback className="bg-[var(--primary-light)] text-[var(--primary)] text-xs font-semibold">
                  {getInitials(user.nombre, user.apellidos)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900 truncate leading-tight">{fullName}</p>
                <span className={cn("inline-block rounded-full px-2 py-0.5 text-xs font-medium mt-0.5", getRolColor(user.rol))}>
                  {getRolLabel(user.rol)}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex justify-center py-3 border-b border-slate-200 shrink-0">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-[var(--primary-light)] text-[var(--primary)] text-xs font-semibold">
                {getInitials(user.nombre, user.apellidos)}
              </AvatarFallback>
            </Avatar>
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-2 space-y-0.5 px-2">
          {/* Top item (Dashboard/Fichar) */}
          <div className="mb-1">
            <NavLink item={top} />
          </div>

          {/* Sections */}
          {sections.map((section) => {
            const isSectionCollapsed = collapsedSections[section.key];
            // Items realmente visibles: los que se ocultan cuando su módulo no
            // está activo no deben dejar la cabecera de sección huérfana.
            const visibles = section.items.filter(
              (item) => !(item.ocultarSiBloqueado && isLocked(item.feature)),
            );
            if (visibles.length === 0) return null;
            return (
              <div key={section.key} className="mb-1">
                {!collapsed && (
                  <button
                    onClick={() => toggleSection(section.key)}
                    className="w-full flex items-center justify-between px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider hover:text-slate-600 transition-colors"
                  >
                    <span>{section.label}</span>
                    {isSectionCollapsed
                      ? <ChevronRight className="h-3 w-3" />
                      : <ChevronDown className="h-3 w-3" />}
                  </button>
                )}
                {!isSectionCollapsed && (
                  <div className="space-y-0.5">
                    {visibles.map((item) => (
                      <NavLink key={item.href} item={item} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Bottom */}
        <div className="mt-auto border-t border-slate-200 p-2 space-y-0.5 shrink-0">
          <NotificationsBell variant="sidebar" collapsed={collapsed} />

          {user.rol === "OWNER" && (
            <Link
              href="/admin/configuracion"
              className={cn(
                "group relative flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive("/admin/configuracion")
                  ? "bg-[var(--sidebar-active-bg)] text-[var(--sidebar-active-text)]"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                collapsed && "justify-center px-2"
              )}
              title={collapsed ? "Configuración" : undefined}
            >
              {isActive("/admin/configuracion") && !collapsed && (
                <span
                  aria-hidden="true"
                  className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-[var(--sidebar-active-border)]"
                />
              )}
              <Settings
                className={cn(
                  "h-4 w-4 shrink-0 transition-colors",
                  isActive("/admin/configuracion") ? "text-[var(--sidebar-active-text)]" : "text-slate-400 group-hover:text-slate-700"
                )}
              />
              {!collapsed && <span className="flex-1 text-left text-sm">Configuración</span>}
            </Link>
          )}

          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className={cn(
              "group flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-red-50 hover:text-red-600 transition-colors",
              collapsed && "justify-center px-2"
            )}
            title={collapsed ? "Cerrar sesión" : undefined}
          >
            <LogOut className="h-4 w-4 shrink-0 text-slate-400 group-hover:text-red-500 transition-colors" />
            {!collapsed && <span>Cerrar sesión</span>}
          </button>
        </div>
      </aside>
    </>
  );
}

"use client";

import { useEffect, useState, useCallback } from "react";
import { Users, UserCheck, UserX, Coffee, RefreshCw, CheckSquare, Calendar, Megaphone, Gift, Flag, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { format, isToday, isTomorrow } from "date-fns";
import { es } from "date-fns/locale";

interface PersonaSimple {
  id: string;
  nombre: string;
  apellidos: string;
}

interface WhosIn {
  trabajando: PersonaSimple[];
  enPausa: PersonaSimple[];
  sinFichar: PersonaSimple[];
  ausente: PersonaSimple[];
  salida: PersonaSimple[];
}

interface Cumpleano {
  id: string;
  nombre: string;
  apellidos: string;
  fecha: string;
  diasRestantes: number;
}

interface Festivo {
  id: string;
  nombre: string;
  fecha: string;
  ambito: string;
}

interface Tarea {
  id: string;
  titulo: string;
  prioridad: string;
  fechaLimite?: string;
  asignadoA?: { nombre: string; apellidos: string };
}

interface Stats {
  totalEmpleados: number;
  trabajando: number;
  enPausa: number;
  ausentes: number;
  sinFichar: number;
  ausenciasPendientes: number;
}

import { EmployeeAvatar } from "@/components/ui/employee-avatar";

const PRIORIDAD_COLOR: Record<string, string> = {
  ALTA: "bg-[var(--danger-bg)] text-[var(--danger-text)]",
  MEDIA: "bg-[var(--warning-bg)] text-[var(--warning-text)]",
  BAJA: "bg-[var(--muted)] text-[var(--text-body)]",
};

export default function AdminDashboardPage() {
  const [data, setData] = useState<{
    whosIn: WhosIn;
    proximosCumpleanos: Cumpleano[];
    proximosFestivos: Festivo[];
    tareasActivas: Tarea[];
    stats: Stats;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/dashboard");
      const json = await res.json();
      setData(json);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const now = new Date();
  const greeting = now.getHours() < 14 ? "Buenos días" : now.getHours() < 21 ? "Buenas tardes" : "Buenas noches";
  const fechaFormateada = format(now, "EEEE, d 'de' MMMM 'de' yyyy", { locale: es });

  const stats = data?.stats;
  const whosIn = data?.whosIn;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">

      {/* Welcome banner */}
      <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-[var(--primary)] to-[var(--primary-dark)] p-6 text-white">
        <div className="relative z-10">
          <p className="text-white/80 text-sm capitalize">{fechaFormateada}</p>
          <h1 className="text-2xl font-bold mt-1">{greeting} 👋</h1>
          <p className="text-white/80 text-sm mt-2">
            {stats
              ? `${stats.trabajando} empleados trabajando ahora · ${stats.ausenciasPendientes} ausencias pendientes`
              : "Cargando datos..."}
          </p>
        </div>
        <div className="absolute right-6 top-4 opacity-10">
          <Clock className="h-24 w-24" />
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-4 right-4 text-white hover:bg-[var(--card)]/20 z-20"
          onClick={fetchData}
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Empleados", value: stats?.totalEmpleados ?? "—", icon: Users, color: "text-[var(--primary)]", bg: "bg-[var(--primary-light)]" },
          { label: "Trabajando", value: stats?.trabajando ?? "—", icon: UserCheck, color: "text-[var(--success-text)]", bg: "bg-[var(--success-bg)]" },
          { label: "En pausa", value: stats?.enPausa ?? "—", icon: Coffee, color: "text-[var(--warning-text)]", bg: "bg-[var(--warning-bg)]" },
          { label: "Ausentes", value: stats?.ausentes ?? "—", icon: UserX, color: "text-[var(--danger)]", bg: "bg-[var(--danger-bg)]" },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center shrink-0", s.bg)}>
                  <s.icon className={cn("h-5 w-5", s.color)} />
                </div>
                <div>
                  <p className="text-xs text-[var(--text-muted)]">{s.label}</p>
                  <p className={cn("text-2xl font-bold", s.color)}>{s.value}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Who's in (2/3 width) */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <div className="w-2 h-2 bg-[var(--success)] rounded-full animate-pulse" />
              Who&apos;s in
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => <div key={i} className="h-8 bg-[var(--muted)] rounded animate-pulse" />)}
              </div>
            ) : !whosIn ? null : (
              <>
                {whosIn.trabajando.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">Trabajando</p>
                    <div className="flex flex-wrap gap-2">
                      {whosIn.trabajando.map((p) => (
                        <div key={p.id} className="flex items-center gap-1.5 bg-[var(--success-bg)] rounded-full pl-1 pr-3 py-1">
                          <EmployeeAvatar nombre={p.nombre} apellidos={p.apellidos} seed={p.id} />
                          <span className="text-sm font-medium text-[var(--text-dark)]">{p.nombre} {p.apellidos}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {whosIn.enPausa.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">En pausa</p>
                    <div className="flex flex-wrap gap-2">
                      {whosIn.enPausa.map((p) => (
                        <div key={p.id} className="flex items-center gap-1.5 bg-[var(--warning-bg)] rounded-full pl-1 pr-3 py-1">
                          <EmployeeAvatar nombre={p.nombre} apellidos={p.apellidos} seed={p.id} />
                          <span className="text-sm font-medium text-[var(--text-dark)]">{p.nombre} {p.apellidos}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {whosIn.ausente.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">Ausentes</p>
                    <div className="flex flex-wrap gap-2">
                      {whosIn.ausente.map((p) => (
                        <div key={p.id} className="flex items-center gap-1.5 bg-[var(--danger-bg)] rounded-full pl-1 pr-3 py-1">
                          <EmployeeAvatar nombre={p.nombre} apellidos={p.apellidos} seed={p.id} />
                          <span className="text-sm font-medium text-[var(--text-dark)]">{p.nombre} {p.apellidos}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {whosIn.sinFichar.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">Sin fichar</p>
                    <div className="flex flex-wrap gap-2">
                      {whosIn.sinFichar.map((p) => (
                        <div key={p.id} className="flex items-center gap-1.5 bg-[var(--muted)] border border-[var(--border)] rounded-full pl-1 pr-3 py-1">
                          <EmployeeAvatar nombre={p.nombre} apellidos={p.apellidos} seed={p.id} />
                          <span className="text-sm text-[var(--text-muted)]">{p.nombre} {p.apellidos}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {!whosIn.trabajando.length && !whosIn.enPausa.length && !whosIn.ausente.length && !whosIn.sinFichar.length && (
                  <p className="text-[var(--text-muted)] text-sm text-center py-6">No hay empleados registrados todavía</p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Right column */}
        <div className="space-y-4">
          {/* Próximos cumpleaños */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Gift className="h-4 w-4 text-rose-500" /> Próximos cumpleaños
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!data?.proximosCumpleanos.length ? (
                <p className="text-sm text-[var(--text-muted)] py-2">Sin cumpleaños próximos</p>
              ) : (
                <div className="space-y-3">
                  {data.proximosCumpleanos.map((c) => {
                    const fecha = new Date(c.fecha);
                    const label = c.diasRestantes === 0 ? "¡Hoy!" : c.diasRestantes === 1 ? "Mañana" : format(fecha, "d MMM", { locale: es });
                    return (
                      <div key={c.id} className="flex items-center gap-3">
                        <EmployeeAvatar nombre={c.nombre} apellidos={c.apellidos} seed={c.id} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-[var(--text-dark)] truncate">{c.nombre} {c.apellidos}</p>
                          <p className="text-xs text-[var(--text-muted)]">{label}</p>
                        </div>
                        {c.diasRestantes === 0 && <span className="text-lg">🎂</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Próximos festivos */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Flag className="h-4 w-4 text-[var(--primary)]" /> Próximos festivos
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!data?.proximosFestivos.length ? (
                <div className="space-y-1">
                  <p className="text-sm text-[var(--text-muted)]">Sin festivos configurados</p>
                  <Link href="/admin/configuracion" className="text-xs text-[var(--primary)] hover:underline">Añadir festivos →</Link>
                </div>
              ) : (
                <div className="space-y-2">
                  {data.proximosFestivos.map((f) => {
                    const fecha = new Date(f.fecha);
                    return (
                      <div key={f.id} className="flex items-center gap-3">
                        <div className="text-center w-10 shrink-0">
                          <p className="text-xs text-[var(--text-muted)] uppercase">{format(fecha, "MMM", { locale: es })}</p>
                          <p className="text-lg font-bold text-[var(--primary)] leading-tight">{format(fecha, "d")}</p>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-[var(--text-dark)]">{f.nombre}</p>
                          <p className="text-xs text-[var(--text-muted)] capitalize">{f.ambito}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Bottom grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Tareas activas */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <CheckSquare className="h-4 w-4 text-[var(--primary)]" /> Tareas activas
              </CardTitle>
              <Link href="/admin/tareas" className="text-xs text-[var(--primary)] hover:underline">Ver todas →</Link>
            </div>
          </CardHeader>
          <CardContent>
            {!data?.tareasActivas.length ? (
              <div className="text-center py-6">
                <CheckSquare className="h-8 w-8 text-slate-200 mx-auto mb-2" />
                <p className="text-sm text-[var(--text-muted)]">No hay tareas activas</p>
                <Link href="/admin/tareas" className="text-xs text-[var(--primary)] hover:underline mt-1 block">Crear tarea →</Link>
              </div>
            ) : (
              <div className="space-y-2">
                {data.tareasActivas.map((t) => (
                  <div key={t.id} className="flex items-start gap-3 p-2 rounded-md hover:bg-[var(--muted)]">
                    <div className="w-1.5 h-1.5 rounded-full bg-[var(--primary)] mt-1.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--text-dark)] truncate">{t.titulo}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={cn("text-xs px-1.5 py-0.5 rounded-full font-medium", PRIORIDAD_COLOR[t.prioridad] ?? "bg-[var(--muted)] text-[var(--text-body)]")}>
                          {t.prioridad}
                        </span>
                        {t.asignadoA && (
                          <span className="text-xs text-[var(--text-muted)]">{t.asignadoA.nombre} {t.asignadoA.apellidos}</span>
                        )}
                        {t.fechaLimite && (
                          <span className="text-xs text-[var(--text-muted)]">{format(new Date(t.fechaLimite), "d MMM", { locale: es })}</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Accesos rápidos */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Accesos rápidos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Empleados", href: "/admin/empleados", icon: Users, color: "bg-sky-50 text-sky-700" },
                { label: "Ausencias", href: "/admin/ausencias", icon: Calendar, color: "bg-[var(--warning-bg)] text-[var(--warning-text)]", badge: stats?.ausenciasPendientes },
                { label: "Comunicados", href: "/admin/comunicados", icon: Megaphone, color: "bg-violet-50 text-violet-700" },
                { label: "Informes", href: "/admin/informes", icon: CheckSquare, color: "bg-[var(--success-bg)] text-[var(--success-text)]" },
              ].map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="relative flex items-center gap-3 p-3 rounded-lg border border-[var(--border)] hover:border-[var(--primary)] hover:bg-[var(--primary-light)]/40 transition-colors group"
                >
                  <div className={cn("w-9 h-9 rounded-md flex items-center justify-center", item.color)}>
                    <item.icon className="h-4 w-4" />
                  </div>
                  <span className="text-sm font-medium text-[var(--text-body)] group-hover:text-[var(--primary)]">{item.label}</span>
                  {item.badge !== undefined && item.badge > 0 && (
                    <span className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--danger)] text-xs font-bold text-white">
                      {item.badge}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

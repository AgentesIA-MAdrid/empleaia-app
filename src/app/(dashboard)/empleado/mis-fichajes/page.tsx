"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  FileText,
  Clock,
  CalendarDays,
  TrendingUp,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Download,
  AlertCircle,
  InboxIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { FeatureGateClient } from "@/components/feature-gate-client";
import { SolicitudesEmpleado } from "@/components/solicitudes-fichaje/solicitudes-empleado";

// ─── Types ────────────────────────────────────────────────────────────────────

type TipoFichaje = "ENTRADA" | "PAUSA" | "VUELTA_PAUSA" | "SALIDA";

interface FichajeItem {
  id: string;
  tipo: TipoFichaje;
  timestamp: string;
  tienda?: { id: string; nombre: string } | null;
}

interface DiaGroup {
  fecha: string; // YYYY-MM-DD
  fichajes: FichajeItem[];
  totalMinutos: number;
}

type QuickRange = "hoy" | "semana" | "mes";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MESES_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
const DIAS_CORTOS_ES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function formatFechaDia(fechaStr: string): string {
  const [y, m, d] = fechaStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const dia = DIAS_CORTOS_ES[date.getDay()];
  return `${dia}, ${d} de ${MESES_ES[m - 1]}`;
}

function formatHoraCorta(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function minutosAHoras(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  if (h === 0) return `${min}m`;
  if (min === 0) return `${h}h`;
  return `${h}h ${min}m`;
}

function calcularTotalMinutosDia(fichajes: FichajeItem[]): number {
  let total = 0;
  let inicio: Date | null = null;
  const sorted = [...fichajes].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  for (const f of sorted) {
    if (f.tipo === "ENTRADA" || f.tipo === "VUELTA_PAUSA") {
      inicio = new Date(f.timestamp);
    } else if ((f.tipo === "PAUSA" || f.tipo === "SALIDA") && inicio) {
      total += Math.floor((new Date(f.timestamp).getTime() - inicio.getTime()) / 60000);
      inicio = null;
    }
  }
  return total;
}

function agruparPorDia(fichajes: FichajeItem[]): DiaGroup[] {
  const map = new Map<string, FichajeItem[]>();
  for (const f of fichajes) {
    const key = f.timestamp.slice(0, 10);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(f);
  }
  const groups: DiaGroup[] = [];
  for (const [fecha, items] of map) {
    groups.push({ fecha, fichajes: items, totalMinutos: calcularTotalMinutosDia(items) });
  }
  return groups.sort((a, b) => b.fecha.localeCompare(a.fecha));
}

function dateToISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function startOfWeek(d: Date): Date {
  const r = new Date(d);
  const day = r.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  r.setDate(r.getDate() + diff);
  r.setHours(0, 0, 0, 0);
  return r;
}

function tipoLabel(tipo: TipoFichaje): string {
  return { ENTRADA: "Entrada", PAUSA: "Pausa", VUELTA_PAUSA: "Vuelta", SALIDA: "Salida" }[tipo];
}

function tipoBadgeClass(tipo: TipoFichaje): string {
  return {
    ENTRADA: "bg-emerald-100 text-emerald-700",
    PAUSA: "bg-amber-100 text-amber-700",
    VUELTA_PAUSA: "bg-sky-100 text-sky-700",
    SALIDA: "bg-rose-100 text-rose-700",
  }[tipo];
}

function getRangeLabel(from: string, to: string): string {
  if (from === to) return "Hoy";
  return `${from.slice(8)} ${MESES_ES[Number(from.slice(5, 7)) - 1]} – ${to.slice(8)} ${MESES_ES[Number(to.slice(5, 7)) - 1]}`;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 10;

export default function MisFichajesPage() {
  const today = dateToISO(new Date());

  const [quickRange, setQuickRange] = useState<QuickRange>("semana");
  const [dateFrom, setDateFrom] = useState<string>(() => dateToISO(startOfWeek(new Date())));
  const [dateTo, setDateTo] = useState<string>(today);

  const [fichajes, setFichajes] = useState<FichajeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [page, setPage] = useState(1);

  // Fetch
  const fetchFichajes = useCallback(async (from: string, to: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      // Fetch each day in range
      const results: FichajeItem[] = [];
      const start = new Date(from);
      const end = new Date(to);
      const days: string[] = [];
      const cur = new Date(start);
      while (cur <= end) {
        days.push(dateToISO(cur));
        cur.setDate(cur.getDate() + 1);
      }

      // Batch fetch — API accepts a date param for a single day; fetch in parallel
      const fetches = days.map((day) =>
        fetch(`/api/fichajes?fecha=${day}`)
          .then((r) => (r.ok ? r.json() : []))
          .catch(() => [] as FichajeItem[])
      );
      const perDay = await Promise.all(fetches);
      perDay.forEach((arr: FichajeItem[]) => results.push(...arr));
      setFichajes(results);
      setPage(1);
    } catch {
      setError("No se pudieron cargar los fichajes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFichajes(dateFrom, dateTo);
  }, [dateFrom, dateTo, fetchFichajes]);

  // Quick range handlers
  const applyQuickRange = useCallback(
    (range: QuickRange) => {
      setQuickRange(range);
      const now = new Date();
      if (range === "hoy") {
        setDateFrom(today);
        setDateTo(today);
      } else if (range === "semana") {
        setDateFrom(dateToISO(startOfWeek(now)));
        setDateTo(today);
      } else {
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
        setDateFrom(dateToISO(firstDay));
        setDateTo(today);
      }
    },
    [today]
  );

  // Paginate groups
  const groups = agruparPorDia(fichajes);
  const totalPages = Math.max(1, Math.ceil(groups.length / PAGE_SIZE));
  const pageGroups = groups.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Summary stats
  const diasTrabajados = groups.filter((g) => g.totalMinutos > 0).length;
  const totalMinutos = groups.reduce((acc, g) => acc + g.totalMinutos, 0);
  const horasLaborales = diasTrabajados * 8 * 60;
  const horasExtra = Math.max(0, totalMinutos - horasLaborales);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--primary-light)]">
            <FileText className="h-5 w-5 text-[var(--primary)]" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Mis Fichajes</h1>
            <p className="text-sm text-muted-foreground">
              {getRangeLabel(dateFrom, dateTo)}
            </p>
          </div>
        </div>
        <FeatureGateClient feature="export_csv">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => {
              const url = `/api/informes/exportar?fechaInicio=${dateFrom}&fechaFin=${dateTo}&formato=csv`;
              window.open(url, "_blank");
            }}
          >
            <Download className="h-4 w-4" />
            Exportar
          </Button>
        </FeatureGateClient>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {/* Quick range */}
            <div className="flex gap-2">
              {(["hoy", "semana", "mes"] as QuickRange[]).map((r) => {
                const labels = { hoy: "Hoy", semana: "Esta semana", mes: "Este mes" };
                return (
                  <button
                    key={r}
                    onClick={() => applyQuickRange(r)}
                    className={cn(
                      "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                      quickRange === r
                        ? "bg-[var(--primary)] text-white"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    )}
                  >
                    {labels[r]}
                  </button>
                );
              })}
            </div>
            {/* Date range */}
            <div className="flex items-center gap-2 text-sm">
              <input
                type="date"
                value={dateFrom}
                max={dateTo}
                onChange={(e) => { setDateFrom(e.target.value); setQuickRange("semana"); }}
                className="rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <span className="text-muted-foreground">–</span>
              <input
                type="date"
                value={dateTo}
                min={dateFrom}
                max={today}
                onChange={(e) => { setDateTo(e.target.value); setQuickRange("semana"); }}
                className="rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          {
            icon: <Clock className="h-5 w-5 text-[var(--primary)]" />,
            label: "Total horas",
            value: minutosAHoras(totalMinutos),
            bg: "bg-[var(--primary-light)]",
          },
          {
            icon: <CalendarDays className="h-5 w-5 text-emerald-500" />,
            label: "Días trabajados",
            value: String(diasTrabajados),
            bg: "bg-emerald-50",
          },
          {
            icon: <TrendingUp className="h-5 w-5 text-amber-500" />,
            label: "Horas extra",
            value: minutosAHoras(horasExtra),
            bg: "bg-amber-50",
          },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <div className={cn("mb-2 inline-flex h-9 w-9 items-center justify-center rounded-lg", s.bg)}>
                {s.icon}
              </div>
              <p className="text-2xl font-bold">{loading ? "—" : s.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Solicitudes de fichaje (olvido / corrección) */}
      <SolicitudesEmpleado />

      {/* Fichajes list */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Detalle por día</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="h-7 w-7 animate-spin text-[var(--primary)] mr-3" />
              Cargando registros…
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
              <AlertCircle className="h-8 w-8 text-rose-400" />
              <p>{error}</p>
            </div>
          ) : pageGroups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
              <InboxIcon className="h-10 w-10 opacity-30" />
              <p className="text-sm">No hay fichajes en este periodo</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {pageGroups.map((group) => (
                <div key={group.fecha}>
                  {/* Day header */}
                  <div className="flex items-center justify-between bg-muted/30 px-6 py-3">
                    <span className="text-sm font-semibold text-foreground">
                      {formatFechaDia(group.fecha)}
                    </span>
                    <span className="text-sm font-medium text-muted-foreground">
                      {group.totalMinutos > 0
                        ? minutosAHoras(group.totalMinutos)
                        : "—"}
                    </span>
                  </div>
                  {/* Fichajes for day */}
                  <div className="divide-y divide-border/50">
                    {[...group.fichajes]
                      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
                      .map((f) => (
                        <div
                          key={f.id}
                          className="flex items-center justify-between px-6 py-2.5 hover:bg-muted/20 transition-colors"
                        >
                          <span
                            className={cn(
                              "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
                              tipoBadgeClass(f.tipo)
                            )}
                          >
                            {tipoLabel(f.tipo)}
                          </span>
                          {f.tienda && (
                            <span className="text-xs text-muted-foreground hidden sm:block">
                              {f.tienda.nombre}
                            </span>
                          )}
                          <span className="font-mono text-sm font-medium">
                            {formatHoraCorta(f.timestamp)}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Página {page} de {totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

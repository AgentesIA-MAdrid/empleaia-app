"use client";

import { Suspense, useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FileSpreadsheet, FileText, BarChart2, CalendarRange, Search, Lock, AlarmClock, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FeatureGateClient } from "@/components/feature-gate-client";
import { useFeatures } from "@/lib/hooks/use-features";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { subDays, format } from "date-fns";
import { EmployeeAvatar } from "@/components/ui/employee-avatar";
import { ProgressBar } from "@/components/ui/progress-bar";
import { descargarCSVHorasPorCentro } from "@/lib/informes/horas-centro-csv";
import { InformeVentas } from "@/components/cierre-turno/informe-ventas";

/** Origen de las horas del informe por centro: fichadas o planificadas. */
type OrigenHoras = "fichajes" | "cuadrante";

interface Tienda { id: string; nombre: string; }
interface Empleado {
  id: string;
  nombre: string;
  apellidos: string;
  foto: string | null;
  tiendaId: string | null;
}
interface ResumenEmpleado {
  userId: string; nombre: string; apellidos: string;
  diasTrabajados: number; horasTotales: number;
  /** Horas de contrato imputables al periodo filtrado. */
  horasContrato: number;
  /** `horasTotales − horasContrato`: positiva = exceso, negativa = déficit. */
  diferencia: number;
  horasExtra: number; diasAusencia: number;
}
/** Fila del cuadro de retrasos acumulados (ticket 4a71c8d3). */
interface FilaRetraso {
  userId: string;
  nombre: string;
  sede: string | null;
  turnos: number;
  retrasos: number;
  minutosTotales: number;
  mediaMinutos: number;
  peorRetraso: number;
  ultimoRetraso: string | null;
}
/** Una incidencia del cuadro de discrepancias (ticket 5f83b0c7). */
interface Discrepancia {
  userId: string;
  empleado: string;
  dia: string;
  tipo: "sede_distinta" | "sin_turno" | "turno_sin_fichaje";
  sedeTurno: string | null;
  sedeFichaje: string | null;
  hora: string;
  distancia: number | null;
  /** Fichó a más de la tolerancia de su sede: estaba en otro sitio. */
  lejos: boolean;
}
interface Stats {
  totalHoras: number; mediaHorasDia: number; totalAusencias: number;
  horasContrato: number; diferencia: number; horasExtra: number;
}
/** Fila del informe de horas por centro que devuelve la API. */
interface FilaCentro {
  empleado: string; centro: string; horas: number;
  horasTotales: number; horasContrato: number; diferencia: number;
}

/**
 * Análisis de asistencia y horas trabajadas. El registro en crudo de
 * entradas y salidas vive en su propia pantalla (`/admin/fichajes`): son
 * dos cosas distintas y cada entrada del menú abre la suya.
 */
function AdminInformesContent() {
  const { toast } = useToast();
  const { data: features, loading: featuresLoading } = useFeatures();
  // Análisis avanzado (resumen agregado, gráficos, estadísticas) requiere
  // plan Pro o superior. Sin la feature esta pantalla solo muestra el
  // upsell: el listado de fichajes (obligatorio por RD 8/2019) está en
  // /admin/fichajes, sin gate.
  // Mientras el hook carga tratamos el plan como avanzado (evita el flash
  // del upsell) y no pedimos datos todavía, así no provocamos un 402
  // seguro en `tipo=resumen`. Si el hook falla, `features` se queda a null
  // y seguimos pidiendo: el backend es quien manda.
  const hasAdvanced = features == null || features.booleans?.informes_avanzados === true;
  // La pestaña de Ventas es del módulo "Cierre de turno" (Enterprise). Sin la
  // feature no se pinta: el endpoint responde 402 y una pestaña que siempre
  // falla es peor que no tenerla.
  const tieneVentas = features?.booleans?.cierre_turno === true;

  // Compatibilidad con los enlaces antiguos `?vista=fichajes` (cuando
  // Fichajes e Informes compartían página): llevan a la pantalla nueva.
  const searchParams = useSearchParams();
  const router = useRouter();
  const vistaLegacy = searchParams.get("vista");
  useEffect(() => {
    if (vistaLegacy === "fichajes") router.replace("/admin/fichajes");
  }, [vistaLegacy, router]);

  const [fechaInicio, setFechaInicio] = useState(format(subDays(new Date(), 30), "yyyy-MM-dd"));
  const [fechaFin, setFechaFin] = useState(format(new Date(), "yyyy-MM-dd"));
  const [tiendas, setTiendas] = useState<Tienda[]>([]);
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [tiendaId, setTiendaId] = useState<string>("todas");
  const [empleadoId, setEmpleadoId] = useState<string>("todos");

  /** Pestaña activa: asistencia (lo de siempre) o ventas (módulo Enterprise). */
  const [vista, setVista] = useState<"asistencia" | "ventas">("asistencia");

  const [datos, setDatos] = useState<ResumenEmpleado[]>([]);
  const [retrasos, setRetrasos] = useState<FilaRetraso[]>([]);
  const [margenRetrasos, setMargenRetrasos] = useState(15);
  const [discrepancias, setDiscrepancias] = useState<Discrepancia[]>([]);
  const [resumenDisc, setResumenDisc] = useState<{
    sede_distinta: number;
    sin_turno: number;
    turno_sin_fichaje: number;
  } | null>(null);
  const [totalDisc, setTotalDisc] = useState(0);
  const [toleranciaMetros, setToleranciaMetros] = useState(2000);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [exportando, setExportando] = useState(false);
  // Origen del informe por centro que se está generando (null = ninguno).
  const [horasCargando, setHorasCargando] = useState<OrigenHoras | null>(null);

  // ── Carga inicial: sedes + empleados ────────────────────────────────────
  useEffect(() => {
    fetch("/api/tiendas").then(r => r.json()).then(d => setTiendas(d.tiendas || [])).catch(() => setTiendas([]));
    fetch("/api/empleados").then(r => r.json()).then(d => {
      const list: Empleado[] = (d.empleados || d || []).map((e: Record<string, unknown>) => ({
        id: String(e.id),
        nombre: String(e.nombre ?? ""),
        apellidos: String(e.apellidos ?? ""),
        foto: (e.foto as string | null) ?? null,
        tiendaId: (e.tiendaId as string | null) ?? null,
      }));
      setEmpleados(list);
    }).catch(() => setEmpleados([]));
  }, []);

  // Cuando cambia la sede, si el empleado seleccionado no pertenece a esa
  // sede, lo reseteamos a "todos".
  useEffect(() => {
    if (tiendaId === "todas" || empleadoId === "todos") return;
    const e = empleados.find((x) => x.id === empleadoId);
    if (e && e.tiendaId !== tiendaId) setEmpleadoId("todos");
  }, [tiendaId, empleadoId, empleados]);

  const empleadosFiltrados = useMemo(() => {
    if (tiendaId === "todas") return empleados;
    return empleados.filter((e) => e.tiendaId === tiendaId);
  }, [empleados, tiendaId]);

  const buildParams = useCallback(() => {
    const params = new URLSearchParams({
      fechaInicio: `${fechaInicio}T00:00:00Z`,
      fechaFin: `${fechaFin}T23:59:59Z`,
    });
    if (tiendaId !== "todas") params.set("tiendaId", tiendaId);
    if (empleadoId !== "todos") params.set("userId", empleadoId);
    return params;
  }, [fechaInicio, fechaFin, tiendaId, empleadoId]);

  // ── Fetch principal: resumen agregado ────────────────────────────────────
  const fetchInformes = useCallback(async () => {
    if (featuresLoading) return;
    if (!hasAdvanced) {
      setDatos([]);
      setStats(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // Los dos informes del periodo van juntos: el resumen de horas y el
      // cuadro de retrasos, que sale del mismo filtro de fechas y sede.
      const [res, resRetrasos, resDisc] = await Promise.all([
        fetch(`/api/informes?${buildParams()}&tipo=resumen`),
        fetch(`/api/informes?${buildParams()}&tipo=retrasos`),
        fetch(`/api/informes?${buildParams()}&tipo=discrepancias`),
      ]);
      const data = await res.json();
      setDatos(data.empleados || []);
      setStats(data.stats || null);
      if (resRetrasos.ok) {
        const dr = await resRetrasos.json();
        setRetrasos(dr.empleados || []);
        setMargenRetrasos(dr.margenMinutos ?? 15);
      } else {
        setRetrasos([]);
      }
      if (resDisc.ok) {
        const dd = await resDisc.json();
        setDiscrepancias(dd.incidencias || []);
        setResumenDisc(dd.resumen ?? null);
        setTotalDisc(dd.total ?? 0);
        setToleranciaMetros(dd.toleranciaMetros ?? 2000);
      } else {
        setDiscrepancias([]);
        setResumenDisc(null);
        setTotalDisc(0);
      }
    } catch {
      setDatos([]);
      setStats(null);
      setRetrasos([]);
      setDiscrepancias([]);
      setResumenDisc(null);
      setTotalDisc(0);
    } finally {
      setLoading(false);
    }
  }, [buildParams, featuresLoading, hasAdvanced]);

  useEffect(() => { fetchInformes(); }, [fetchInformes]);

  const chartData = datos.slice(0, 10).map(e => ({
    nombre: e.nombre,
    horas: parseFloat(e.horasTotales.toFixed(1)),
    extra: parseFloat(e.horasExtra.toFixed(1)),
  }));

  const handleExport = async (formato: "xlsx" | "pdf") => {
    setExportando(true);
    try {
      const params = buildParams();
      params.set("tipo", "resumen");
      params.set("formato", formato);
      const res = await fetch(`/api/informes/exportar?${params}`);
      if (!res.ok) {
        if (res.status === 402 || res.status === 429) {
          const body = (await res.json()) as { error?: string; upgrade_url?: string };
          toast({
            title: body.error === "limit_reached" ? "Límite de exports alcanzado" : "Función no disponible en tu plan",
            description: body.upgrade_url ? "Actualiza tu plan para usar exportación." : undefined,
            variant: "destructive",
          });
          return;
        }
        throw new Error();
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `informe_${fechaInicio}_${fechaFin}.${formato}`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Error al exportar", variant: "destructive" });
    } finally {
      setExportando(false);
    }
  };

  // Informe de horas por empleado y centro: descarga un CSV. `origen`
  // decide si las horas salen de los fichajes reales o del cuadrante de
  // turnos (horas planificadas), que es un dato distinto y no equivalente.
  const handleHorasPorCentro = async (origen: OrigenHoras) => {
    setHorasCargando(origen);
    try {
      const params = new URLSearchParams({
        fechaInicio: `${fechaInicio}T00:00:00Z`,
        fechaFin: `${fechaFin}T23:59:59Z`,
        origen,
      });
      if (tiendaId !== "todas") params.set("tiendaId", tiendaId);
      const res = await fetch(`/api/informes/horas-por-centro?${params}`);
      if (!res.ok) {
        if (res.status === 402) {
          toast({ title: "Función no disponible en tu plan", variant: "destructive" });
          return;
        }
        throw new Error();
      }
      const { filas } = (await res.json()) as { filas: FilaCentro[] };
      if (!filas.length) {
        toast({
          title:
            origen === "cuadrante"
              ? "Sin turnos planificados en el periodo"
              : "Sin horas registradas en el periodo",
        });
        return;
      }
      const sufijo = origen === "cuadrante" ? "_cuadrante" : "";
      descargarCSVHorasPorCentro(
        filas,
        `horas_por_centro${sufijo}_${fechaInicio}_${fechaFin}.csv`,
      );
    } catch {
      toast({ title: "Error al generar el informe", variant: "destructive" });
    } finally {
      setHorasCargando(null);
    }
  };

  const maxHoras = Math.max(...datos.map((d) => d.horasTotales), 0);

  /** Enlace al registro de fichajes con los filtros actuales aplicados. */
  const enlaceFichajes = (userId?: string) => {
    const params = new URLSearchParams({ fechaInicio, fechaFin });
    if (tiendaId !== "todas") params.set("tiendaId", tiendaId);
    if (userId) params.set("userId", userId);
    return `/admin/fichajes?${params}`;
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Informes</h1>
          <p className="text-slate-500 text-sm mt-1">
            {vista === "ventas"
              ? "Qué se ha vendido y si el dinero cuadra con la caja"
              : "Análisis de asistencia y horas trabajadas"}
          </p>
        </div>
        {vista === "asistencia" && (
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="outline"
              disabled={horasCargando !== null}
              onClick={() => handleHorasPorCentro("fichajes")}
            >
              <BarChart2 className="h-4 w-4 mr-2" />
              {horasCargando === "fichajes" ? "Generando…" : "Horas fichadas por centro"}
            </Button>
            {/* Mismo informe pero con las horas del cuadrante (planificadas).
                Gateado por la feature de Turnos: sin ella el endpoint responde
                402 y el botón no debe ni pintarse. */}
            <FeatureGateClient feature="turnos_publicacion">
              <Button
                variant="outline"
                disabled={horasCargando !== null}
                onClick={() => handleHorasPorCentro("cuadrante")}
              >
                <CalendarRange className="h-4 w-4 mr-2" />
                {horasCargando === "cuadrante" ? "Generando…" : "Horas del cuadrante por centro"}
              </Button>
            </FeatureGateClient>
            <FeatureGateClient feature="export_excel">
              <Button variant="outline" disabled={exportando} onClick={() => handleExport("xlsx")}>
                <FileSpreadsheet className="h-4 w-4 mr-2" /> Excel
              </Button>
            </FeatureGateClient>
            <FeatureGateClient feature="export_pdf">
              <Button variant="outline" disabled={exportando} onClick={() => handleExport("pdf")}>
                <FileText className="h-4 w-4 mr-2" /> PDF
              </Button>
            </FeatureGateClient>
          </div>
        )}
      </div>

      {/* Ventas es una pestaña y no una pantalla aparte porque es la misma
          pregunta con otra unidad: aquí horas, allí unidades y euros. Solo
          aparece con el módulo de cierre de turno contratado. */}
      {tieneVentas && (
        <div className="flex gap-2 border-b border-slate-200">
          {(
            [
              { key: "asistencia" as const, label: "Asistencia y horas" },
              { key: "ventas" as const, label: "Ventas" },
            ]
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setVista(t.key)}
              aria-current={vista === t.key ? "page" : undefined}
              className={
                vista === t.key
                  ? "px-3 py-2 text-sm font-semibold text-[var(--primary)] border-b-2 border-[var(--primary)] -mb-px"
                  : "px-3 py-2 text-sm text-slate-500 hover:text-slate-800"
              }
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {vista === "ventas" ? (
        <InformeVentas sedes={tiendas} />
      ) : (
        <>
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-end gap-4 flex-wrap">
            <div>
              <Label>Sede</Label>
              <Select value={tiendaId} onValueChange={setTiendaId}>
                <SelectTrigger className="mt-1 w-full sm:w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas las sedes</SelectItem>
                  {tiendas.map(t => <SelectItem key={t.id} value={t.id}>{t.nombre}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Empleado</Label>
              <Select value={empleadoId} onValueChange={setEmpleadoId}>
                <SelectTrigger className="mt-1 w-full sm:w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos los empleados</SelectItem>
                  {empleadosFiltrados.map(e => (
                    <SelectItem key={e.id} value={e.id}>{e.nombre} {e.apellidos}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Desde</Label>
              <Input type="date" className="mt-1 w-40" value={fechaInicio} max={fechaFin} onChange={e => setFechaInicio(e.target.value)} />
            </div>
            <div>
              <Label>Hasta</Label>
              {/* Sin tope en hoy (ticket #64): el cuadrante se planifica a futuro,
                  así que el informe de horas del cuadrante necesita poder pedir
                  fechas posteriores a hoy. En fichajes, un rango futuro sale vacío. */}
              <Input type="date" className="mt-1 w-40" value={fechaFin} min={fechaInicio} onChange={e => setFechaFin(e.target.value)} />
            </div>
            <Button onClick={fetchInformes} disabled={loading}>
              <Search className="h-4 w-4 mr-1.5" />
              {loading ? "Cargando..." : "Aplicar"}
            </Button>
            <Link href={enlaceFichajes(empleadoId !== "todos" ? empleadoId : undefined)} className="ml-auto">
              <Button variant="ghost">Ver registro de fichajes →</Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      {!hasAdvanced && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="pt-4 pb-4 flex items-start gap-3">
            <Lock className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-900">
                Análisis avanzado disponible en plan Pro y superiores
              </p>
              <p className="text-sm text-amber-800 mt-0.5">
                Tu plan actual incluye el listado de fichajes (obligatorio por
                RD 8/2019), en la pantalla de Fichajes. Para ver resumen
                agregado, gráficos de horas, detección de horas extra y
                ausencias, actualiza tu plan.
              </p>
            </div>
            <Link href="/admin/planes" className="shrink-0">
              <Button size="sm" variant="default">Ver planes</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-4">
          {[
            { label: "Total horas", value: `${stats.totalHoras.toFixed(0)}h`, color: "text-[var(--primary)]" },
            { label: "Media horas/día", value: `${stats.mediaHorasDia.toFixed(1)}h`, color: "text-slate-900" },
            // Horas de contrato del periodo y saldo frente a ellas: sin esto,
            // "horas extra" no se puede contrastar con nada.
            { label: "Horas de contrato", value: `${stats.horasContrato.toFixed(0)}h`, color: "text-slate-900" },
            {
              label: "Diferencia",
              value: `${stats.diferencia > 0 ? "+" : ""}${stats.diferencia.toFixed(1)}h`,
              color: stats.diferencia > 0 ? "text-amber-600" : stats.diferencia < 0 ? "text-slate-500" : "text-slate-900",
            },
            { label: "Horas extra", value: `${stats.horasExtra.toFixed(0)}h`, color: "text-amber-600" },
            { label: "Ausencias", value: stats.totalAusencias.toString(), color: "text-red-500" },
          ].map(s => (
            <Card key={s.label}>
              <CardContent className="pt-4 pb-4">
                <p className="text-sm text-slate-500">{s.label}</p>
                <p className={`text-3xl font-bold mt-1 ${s.color}`}>{s.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {hasAdvanced && (
        <>
          {chartData.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart2 className="h-4 w-4 text-[var(--primary)]" /> Horas trabajadas por empleado
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={chartData} margin={{ top: 0, right: 0, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="nombre" tick={{ fontSize: 12, fill: "#475569" }} />
                    <YAxis tick={{ fontSize: 12, fill: "#475569" }} />
                    <Tooltip formatter={v => [`${v}h`]} />
                    <Bar dataKey="horas" name="Horas" fill="#2563EB" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="extra" name="Extra" fill="#F59E0B" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle className="text-base">Detalle por empleado</CardTitle></CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-4 space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" />)}</div>
              ) : datos.length === 0 ? (
                <p className="text-center py-8 text-slate-400">No hay datos para el período seleccionado</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>{["Empleado", "Días trab.", "Horas trabajadas", "Horas de contrato", "Diferencia", "Horas extra", "Ausencias", ""].map(h => (
                        <th key={h} className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 px-4 py-3">{h}</th>
                      ))}</tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {datos.map(e => {
                        const pct = maxHoras > 0 ? (e.horasTotales / maxHoras) * 100 : 0;
                        return (
                          <tr key={e.userId} className="hover:bg-slate-50 transition-colors">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                <EmployeeAvatar nombre={e.nombre} apellidos={e.apellidos} seed={e.userId} size="sm" />
                                <span className="font-medium text-sm text-slate-900">{e.nombre} {e.apellidos}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-600">{e.diasTrabajados}</td>
                            <td className="px-4 py-3 text-sm">
                              <div className="flex items-center gap-3 min-w-[140px]">
                                <ProgressBar value={pct} className="flex-1 max-w-[140px]" />
                                <span className="font-semibold text-slate-900 tabular-nums shrink-0">
                                  {e.horasTotales.toFixed(1)}h
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-600 tabular-nums">
                              {e.horasContrato.toFixed(1)}h
                            </td>
                            {/* Diferencia con signo: por encima del contrato (extra)
                                o por debajo (horas pendientes de cubrir). */}
                            <td className="px-4 py-3 text-sm">
                              <span
                                className={
                                  e.diferencia > 0
                                    ? "text-amber-600 font-medium tabular-nums"
                                    : e.diferencia < 0
                                      ? "text-slate-500 tabular-nums"
                                      : "text-slate-400 tabular-nums"
                                }
                              >
                                {e.diferencia > 0 ? "+" : ""}{e.diferencia.toFixed(1)}h
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm">
                              <span className={e.horasExtra > 0 ? "text-amber-600 font-medium" : "text-slate-400"}>
                                {e.horasExtra > 0 ? `+${e.horasExtra.toFixed(1)}h` : "0h"}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-600">{e.diasAusencia} días</td>
                            <td className="px-4 py-3 text-right">
                              {/* El detalle en crudo vive en su propia pantalla. */}
                              <Link href={enlaceFichajes(e.userId)}>
                                <Button variant="ghost" size="sm">Ver fichajes →</Button>
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Retrasos acumulados (ticket 4a71c8d3). Va después del resumen de
              horas porque contesta a otra pregunta: no cuánto se trabaja, sino
              quién llega tarde. Fichar pasada la hora de entrada no se bloquea
              ni se ajusta —eso sería regalar minutos—, así que sin este cuadro
              el retraso queda registrado y no salta en ninguna parte. */}
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <p className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                    <AlarmClock className="h-4 w-4 text-amber-600" /> Retrasos acumulados
                  </p>
                  <p className="text-xs text-slate-400 mt-1 max-w-2xl">
                    Entradas fichadas más tarde de la hora de su turno, con{" "}
                    <strong className="font-medium text-slate-500">
                      {margenRetrasos} min de cortesía
                    </strong>{" "}
                    (el mismo margen que el fichaje fuera de horario, en Configuración → Fichajes).
                    Solo cuentan los días con cuadrante publicado: sin hora de entrada fijada no hay
                    retraso que medir.
                  </p>
                </div>
              </div>

              {retrasos.length === 0 ? (
                <p className="text-center py-8 text-slate-400 text-sm">
                  Nadie ha llegado tarde en este periodo.
                </p>
              ) : (
                <div className="overflow-x-auto mt-3 -mx-6">
                  <table className="w-full">
                    <thead className="bg-slate-50 border-y border-slate-200">
                      <tr>
                        {[
                          "Empleado",
                          "Retrasos",
                          "Minutos acumulados",
                          "Media",
                          "El peor",
                          "Último",
                          "",
                        ].map((h, i) => (
                          <th
                            key={`${h}-${i}`}
                            className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 px-4 py-2.5"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {retrasos.map((r) => (
                        <tr key={r.userId} className="border-b border-slate-100 last:border-0">
                          <td className="px-4 py-3 text-sm">
                            <span className="font-medium text-slate-800">{r.nombre}</span>
                            <span className="block text-xs text-slate-400">
                              {r.sede ?? "Sin sede"} · {r.turnos} turno{r.turnos === 1 ? "" : "s"}{" "}
                              en el periodo
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={
                                r.retrasos > 0
                                  ? "text-base font-bold tabular-nums text-amber-700"
                                  : "text-sm tabular-nums text-slate-400"
                              }
                            >
                              {r.retrasos}
                            </span>
                            {r.turnos > 0 && r.retrasos > 0 && (
                              <span className="block text-xs text-slate-400 tabular-nums">
                                {Math.round((r.retrasos / r.turnos) * 100)} % de sus turnos
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm tabular-nums text-slate-700">
                            {r.minutosTotales} min
                          </td>
                          <td className="px-4 py-3 text-sm tabular-nums text-slate-500">
                            {r.retrasos > 0 ? `${r.mediaMinutos} min` : "—"}
                          </td>
                          <td className="px-4 py-3 text-sm tabular-nums text-slate-500">
                            {r.peorRetraso > 0 ? `${r.peorRetraso} min` : "—"}
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-500">
                            {r.ultimoRetraso
                              ? new Date(`${r.ultimoRetraso}T00:00:00`).toLocaleDateString("es-ES", {
                                  day: "2-digit",
                                  month: "short",
                                })
                              : "—"}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Link href={enlaceFichajes(r.userId)}>
                              <Button variant="ghost" size="sm">Ver fichajes →</Button>
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Discrepancias entre cuadrante y fichajes (ticket 5f83b0c7). Tres
              cosas que no cuadran y que no salían en ninguna pantalla: fichar en
              una sede distinta de la del turno, fichar un día sin turno y tener
              turno y no fichar. */}
          <Card>
            <CardContent className="pt-4 pb-4">
              <p className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-rose-600" /> Discrepancias con el cuadrante
              </p>
              <p className="text-xs text-slate-400 mt-1 max-w-3xl">
                El fichaje guarda la sede asignada al empleado, así que esto compara lo que decía el
                cuadrante con lo que quedó registrado. Cuando el móvil dio ubicación se añade a
                cuántos metros de su sede fichó, y se señala si pasa de{" "}
                {(toleranciaMetros / 1000).toFixed(0)} km: por debajo se da por hecho que estaba
                allí, porque el GPS de ciudad se desvía.
              </p>

              {resumenDisc && (
                <div className="grid grid-cols-3 gap-2 sm:gap-4 mt-3">
                  {[
                    { label: "Sede distinta", valor: resumenDisc.sede_distinta, color: "text-amber-700" },
                    { label: "Fichó sin turno", valor: resumenDisc.sin_turno, color: "text-sky-700" },
                    { label: "Turno sin fichaje", valor: resumenDisc.turno_sin_fichaje, color: "text-rose-700" },
                  ].map((k) => (
                    <div key={k.label} className="rounded-lg border border-slate-200 px-3 py-2">
                      <p className="text-xs text-slate-500">{k.label}</p>
                      <p className={`text-2xl font-bold tabular-nums ${k.color}`}>{k.valor}</p>
                    </div>
                  ))}
                </div>
              )}

              {discrepancias.length === 0 ? (
                <p className="text-center py-8 text-slate-400 text-sm">
                  Todo cuadra con el cuadrante en este periodo.
                </p>
              ) : (
                <>
                  <div className="overflow-x-auto mt-4 -mx-6">
                    <table className="w-full">
                      <thead className="bg-slate-50 border-y border-slate-200">
                        <tr>
                          {["Día", "Empleado", "Qué pasó", "Cuadrante", "Fichaje", "Ubicación", ""].map(
                            (h, i) => (
                              <th
                                key={`${h}-${i}`}
                                className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 px-4 py-2.5"
                              >
                                {h}
                              </th>
                            ),
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {discrepancias.map((d, i) => (
                          <tr
                            key={`${d.userId}-${d.dia}-${d.tipo}-${i}`}
                            className="border-b border-slate-100 last:border-0"
                          >
                            <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">
                              {new Date(`${d.dia}T00:00:00`).toLocaleDateString("es-ES", {
                                day: "2-digit",
                                month: "short",
                              })}
                              <span className="block text-xs text-slate-400 tabular-nums">
                                {d.hora}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm font-medium text-slate-800">
                              {d.empleado}
                            </td>
                            <td className="px-4 py-3 text-sm">
                              <span
                                className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                  d.tipo === "sede_distinta"
                                    ? "bg-amber-100 text-amber-700"
                                    : d.tipo === "sin_turno"
                                      ? "bg-sky-100 text-sky-700"
                                      : "bg-rose-100 text-rose-700"
                                }`}
                              >
                                {d.tipo === "sede_distinta"
                                  ? "Sede distinta"
                                  : d.tipo === "sin_turno"
                                    ? "Fichó sin turno"
                                    : "Turno sin fichaje"}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-600">
                              {d.sedeTurno ?? "—"}
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-600">
                              {d.sedeFichaje ?? "—"}
                            </td>
                            <td className="px-4 py-3 text-sm tabular-nums">
                              {d.distancia === null ? (
                                <span className="text-slate-400">—</span>
                              ) : (
                                <span className={d.lejos ? "text-rose-600 font-medium" : "text-slate-500"}>
                                  {d.distancia >= 1000
                                    ? `${(d.distancia / 1000).toFixed(1)} km`
                                    : `${d.distancia} m`}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <Link href={enlaceFichajes(d.userId)}>
                                <Button variant="ghost" size="sm">Ver fichajes →</Button>
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {/* Sin decir el tope, una lista cortada parece la lista entera. */}
                  {totalDisc > discrepancias.length && (
                    <p className="text-xs text-slate-400 mt-2">
                      Se enseñan las {discrepancias.length} más recientes de {totalDisc}. Acota el
                      periodo o filtra por sede para verlas todas.
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}
        </>
      )}
    </div>
  );
}

// `useSearchParams` exige un límite de Suspense en Next 16 (misma pauta
// que /admin/configuracion).
export default function AdminInformesPage() {
  return (
    <Suspense fallback={<div className="p-6 animate-pulse"><div className="h-40 bg-slate-100 rounded-xl" /></div>}>
      <AdminInformesContent />
    </Suspense>
  );
}

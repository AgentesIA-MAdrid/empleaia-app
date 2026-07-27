"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { FileSpreadsheet, FileText, BarChart2, MapPin, Smartphone, Tablet, Globe, ScanFace, Search, Lock } from "lucide-react";
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
  diasTrabajados: number; horasTotales: number; horasExtra: number; diasAusencia: number;
}
interface Stats { totalHoras: number; mediaHorasDia: number; totalAusencias: number; horasExtra: number; }

interface FichajeDetalle {
  id: string;
  timestamp: string;
  tipo: "ENTRADA" | "PAUSA" | "VUELTA_PAUSA" | "SALIDA";
  metodo: "WEB" | "MOVIL" | "TABLET" | "MANUAL";
  latitud: number | null;
  longitud: number | null;
  distancia: number | null;
  nota: string | null;
  user: { id: string; nombre: string; apellidos: string; foto: string | null };
  tienda: { id: string; nombre: string; radio?: number | null } | null;
  tieneFoto?: boolean;
}

/** "34 m" / "1,2 km" — distancia del fichaje al centro de la sede. */
function formatDistancia(metros: number): string {
  return metros < 1000
    ? `${Math.round(metros)} m`
    : `${(metros / 1000).toFixed(1).replace(".", ",")} km`;
}

const TIPO_LABEL: Record<FichajeDetalle["tipo"], string> = {
  ENTRADA: "Entrada",
  PAUSA: "Pausa",
  VUELTA_PAUSA: "Vuelta",
  SALIDA: "Salida",
};
const TIPO_CLS: Record<FichajeDetalle["tipo"], string> = {
  ENTRADA: "bg-emerald-50 text-emerald-700",
  PAUSA: "bg-amber-50 text-amber-700",
  VUELTA_PAUSA: "bg-sky-50 text-sky-700",
  SALIDA: "bg-rose-50 text-rose-700",
};

function MetodoIcon({ m }: { m: FichajeDetalle["metodo"] }) {
  if (m === "MOVIL") return <Smartphone className="h-3.5 w-3.5" />;
  if (m === "TABLET") return <Tablet className="h-3.5 w-3.5" />;
  if (m === "MANUAL") return <ScanFace className="h-3.5 w-3.5" />;
  return <Globe className="h-3.5 w-3.5" />;
}

export default function AdminInformesPage() {
  const { toast } = useToast();
  const { data: features } = useFeatures();
  // Análisis avanzado (resumen agregado, gráficos, estadísticas) requiere
  // plan Pro o superior. Sin la feature mostramos solo el listado de
  // fichajes (RD 8/2019 obliga a que el OWNER pueda consultarlo siempre).
  // `null` mientras carga: tratamos como avanzado para evitar el flash
  // del estado básico antes de saber el plan real.
  const hasAdvanced = features == null || features.booleans?.informes_avanzados === true;

  const [fechaInicio, setFechaInicio] = useState(format(subDays(new Date(), 30), "yyyy-MM-dd"));
  const [fechaFin, setFechaFin] = useState(format(new Date(), "yyyy-MM-dd"));
  const [tiendas, setTiendas] = useState<Tienda[]>([]);
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [tiendaId, setTiendaId] = useState<string>("todas");
  const [empleadoId, setEmpleadoId] = useState<string>("todos");

  const [datos, setDatos] = useState<ResumenEmpleado[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [fichajes, setFichajes] = useState<FichajeDetalle[]>([]);
  const [loading, setLoading] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [horasCargando, setHorasCargando] = useState(false);

  // ── Carga inicial: sedes + empleados ────────────────────────────────────
  useEffect(() => {
    fetch("/api/tiendas").then(r => r.json()).then(d => setTiendas(d.tiendas || []));
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

  const empleadoSel = useMemo(
    () => empleados.find((e) => e.id === empleadoId) ?? null,
    [empleados, empleadoId],
  );
  const empleadoTienda = useMemo(
    () => (empleadoSel?.tiendaId ? tiendas.find((t) => t.id === empleadoSel.tiendaId) : null),
    [empleadoSel, tiendas],
  );

  // ── Fetch principal ──────────────────────────────────────────────────────
  const fetchInformes = useCallback(async () => {
    setLoading(true);
    try {
      const baseParams = new URLSearchParams({
        fechaInicio: `${fechaInicio}T00:00:00Z`,
        fechaFin: `${fechaFin}T23:59:59Z`,
      });
      if (tiendaId !== "todas") baseParams.set("tiendaId", tiendaId);
      if (empleadoId !== "todos") baseParams.set("userId", empleadoId);

      if (hasAdvanced) {
        // Plan con análisis avanzado: resumen + (si toca) detalle.
        const resResumen = await fetch(`/api/informes?${baseParams}&tipo=resumen`);
        const dataResumen = await resResumen.json();
        setDatos(dataResumen.empleados || []);
        setStats(dataResumen.stats || null);

        if (empleadoId !== "todos") {
          const resF = await fetch(`/api/informes?${baseParams}&tipo=fichajes`);
          const dataF = await resF.json();
          setFichajes((dataF?.data ?? []) as FichajeDetalle[]);
        } else {
          setFichajes([]);
        }
      } else {
        // Plan básico: solo listado de fichajes, sin agregaciones.
        setDatos([]);
        setStats(null);
        const resF = await fetch(`/api/informes?${baseParams}&tipo=fichajes`);
        const dataF = await resF.json();
        setFichajes((dataF?.data ?? []) as FichajeDetalle[]);
      }
    } finally {
      setLoading(false);
    }
  }, [fechaInicio, fechaFin, tiendaId, empleadoId, hasAdvanced]);

  useEffect(() => { fetchInformes(); }, [fetchInformes]);

  const chartData = datos.slice(0, 10).map(e => ({
    nombre: e.nombre,
    horas: parseFloat(e.horasTotales.toFixed(1)),
    extra: parseFloat(e.horasExtra.toFixed(1)),
  }));

  const handleExport = async (formato: "xlsx" | "pdf") => {
    setExportando(true);
    try {
      const params = new URLSearchParams({
        tipo: "fichajes",
        fechaInicio: `${fechaInicio}T00:00:00Z`,
        fechaFin: `${fechaFin}T23:59:59Z`,
        formato,
      });
      if (tiendaId !== "todas") params.set("tiendaId", tiendaId);
      if (empleadoId !== "todos") params.set("userId", empleadoId);
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

  // Informe de horas por empleado y centro: descarga un CSV.
  const handleHorasPorCentro = async () => {
    setHorasCargando(true);
    try {
      const params = new URLSearchParams({
        fechaInicio: `${fechaInicio}T00:00:00Z`,
        fechaFin: `${fechaFin}T23:59:59Z`,
      });
      if (tiendaId !== "todas") params.set("tiendaId", tiendaId);
      const res = await fetch(`/api/informes/horas-por-centro?${params}`);
      if (!res.ok) throw new Error();
      const { filas } = (await res.json()) as {
        filas: { empleado: string; centro: string; horas: number }[];
      };
      if (!filas.length) {
        toast({ title: "Sin horas registradas en el periodo" });
        return;
      }
      const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
      const csv = [
        "Empleado,Centro,Horas",
        ...filas.map((f) =>
          [esc(f.empleado), esc(f.centro), String(f.horas).replace(".", ",")].join(","),
        ),
      ].join("\r\n");
      const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `horas_por_centro_${fechaInicio}_${fechaFin}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Error al generar el informe", variant: "destructive" });
    } finally {
      setHorasCargando(false);
    }
  };

  const maxHoras = Math.max(...datos.map((d) => d.horasTotales), 0);

  // Selecciona la fila del resumen correspondiente al empleado activo.
  const detalleEmpleadoStats = useMemo(() => {
    if (empleadoId === "todos") return null;
    return datos.find((d) => d.userId === empleadoId) ?? null;
  }, [datos, empleadoId]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Informes</h1>
          <p className="text-slate-500 text-sm mt-1">Análisis de asistencia y detalle de fichajes</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" disabled={horasCargando} onClick={handleHorasPorCentro}>
            <BarChart2 className="h-4 w-4 mr-2" /> {horasCargando ? "Generando…" : "Horas por centro"}
          </Button>
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
      </div>

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
              <Input type="date" className="mt-1 w-40" value={fechaFin} min={fechaInicio} max={format(new Date(), "yyyy-MM-dd")} onChange={e => setFechaFin(e.target.value)} />
            </div>
            <Button onClick={fetchInformes} disabled={loading}>
              <Search className="h-4 w-4 mr-1.5" />
              {loading ? "Cargando..." : "Aplicar"}
            </Button>
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
                RD 8/2019). Para ver resumen agregado, gráficos de horas,
                detección de horas extra y ausencias, actualiza tu plan.
              </p>
            </div>
            <Link href="/admin/planes" className="shrink-0">
              <Button size="sm" variant="default">Ver planes</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
          {[
            { label: "Total horas", value: `${stats.totalHoras.toFixed(0)}h`, color: "text-[var(--primary)]" },
            { label: "Media horas/día", value: `${stats.mediaHorasDia.toFixed(1)}h`, color: "text-slate-900" },
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

      {/* ─── Vista resumen (sin empleado seleccionado) — requiere informes_avanzados ─── */}
      {empleadoId === "todos" && hasAdvanced && (
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
                      <tr>{["Empleado", "Días trab.", "Horas trabajadas", "Horas extra", "Ausencias", ""].map(h => (
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
                            <td className="px-4 py-3 text-sm">
                              <span className={e.horasExtra > 0 ? "text-amber-600 font-medium" : "text-slate-400"}>
                                {e.horasExtra > 0 ? `+${e.horasExtra.toFixed(1)}h` : "0h"}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-600">{e.diasAusencia} días</td>
                            <td className="px-4 py-3 text-right">
                              <Button variant="ghost" size="sm" onClick={() => setEmpleadoId(e.userId)}>
                                Ver fichajes →
                              </Button>
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
        </>
      )}

      {/* ─── Vista plana de fichajes (plan básico, sin agregaciones) ────── */}
      {!hasAdvanced && empleadoId === "todos" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Listado de fichajes</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-4 space-y-2">{[1, 2, 3, 4].map(i => <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" />)}</div>
            ) : fichajes.length === 0 ? (
              <p className="text-center py-8 text-slate-400">No hay fichajes en el periodo seleccionado</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      {["Fecha", "Hora", "Empleado", "Tipo", "Método", "Sede"].map(h => (
                        <th key={h} className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 px-4 py-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {fichajes.map(f => {
                      const d = new Date(f.timestamp);
                      return (
                        <tr key={f.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-3 text-sm text-slate-700 whitespace-nowrap">{format(d, "dd/MM/yyyy")}</td>
                          <td className="px-4 py-3 text-sm font-mono text-slate-900 whitespace-nowrap">{format(d, "HH:mm:ss")}</td>
                          <td className="px-4 py-3 text-sm text-slate-700 whitespace-nowrap">{f.user.nombre} {f.user.apellidos}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${TIPO_CLS[f.tipo]}`}>
                              {TIPO_LABEL[f.tipo]}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-500"><MetodoIcon m={f.metodo} /></td>
                          <td className="px-4 py-3 text-sm text-slate-600">{f.tienda?.nombre ?? "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ─── Vista detalle de un empleado ───────────────────────────────── */}
      {empleadoId !== "todos" && empleadoSel && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-4 flex-wrap">
              {empleadoSel.foto ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={empleadoSel.foto}
                  alt={`${empleadoSel.nombre} ${empleadoSel.apellidos}`}
                  className="h-14 w-14 rounded-full object-cover border-2 border-white shadow-sm"
                />
              ) : (
                <EmployeeAvatar nombre={empleadoSel.nombre} apellidos={empleadoSel.apellidos} seed={empleadoSel.id} size="lg" />
              )}
              <div className="flex-1 min-w-0">
                <CardTitle className="text-lg">{empleadoSel.nombre} {empleadoSel.apellidos}</CardTitle>
                <p className="text-sm text-slate-500 mt-0.5">
                  {empleadoTienda ? empleadoTienda.nombre : "Sin sede asignada"}
                  {detalleEmpleadoStats && (
                    <> · <strong>{detalleEmpleadoStats.horasTotales.toFixed(1)}h</strong> en {detalleEmpleadoStats.diasTrabajados} días</>
                  )}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setEmpleadoId("todos")}>
                ← Volver al resumen
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-4 space-y-2">{[1, 2, 3, 4].map(i => <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" />)}</div>
            ) : fichajes.length === 0 ? (
              <p className="text-center py-8 text-slate-400">No hay fichajes en el periodo seleccionado</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      {["Fecha", "Hora", "Tipo", "Método", "Sede", "Localización", "Foto", "Nota"].map(h => (
                        <th key={h} className={`text-left text-xs font-semibold uppercase tracking-wide text-slate-500 px-4 py-3${(h === "Localización" || h === "Foto") ? " hidden md:table-cell" : ""}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {fichajes.map(f => {
                      const d = new Date(f.timestamp);
                      const tieneGeo = f.latitud != null && f.longitud != null;
                      const mapsUrl = tieneGeo
                        ? `https://www.google.com/maps?q=${f.latitud},${f.longitud}`
                        : null;
                      // Fuera de la sede = distancia mayor que el radio
                      // configurado para esa tienda (200 m por defecto).
                      const radio = f.tienda?.radio ?? null;
                      const fueraDeSede =
                        f.distancia != null && radio != null && f.distancia > radio;
                      return (
                        <tr key={f.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-3 text-sm text-slate-700 whitespace-nowrap">
                            {format(d, "dd/MM/yyyy")}
                          </td>
                          <td className="px-4 py-3 text-sm font-mono text-slate-900 whitespace-nowrap">
                            {format(d, "HH:mm:ss")}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${TIPO_CLS[f.tipo]}`}>
                              {TIPO_LABEL[f.tipo]}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center gap-1 text-xs text-slate-600">
                              <MetodoIcon m={f.metodo} />
                              {f.metodo}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">
                            {f.tienda?.nombre ?? "—"}
                          </td>
                          <td className="hidden md:table-cell px-4 py-3 text-sm">
                            {mapsUrl ? (
                              <div className="flex items-center gap-2">
                                <a
                                  href={mapsUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-[var(--primary)] hover:underline"
                                  title={`${f.latitud!.toFixed(6)}, ${f.longitud!.toFixed(6)}`}
                                >
                                  <MapPin className="h-3.5 w-3.5" />
                                  Ver en mapa
                                </a>
                                {f.distancia != null && (
                                  <span
                                    className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium whitespace-nowrap ${
                                      fueraDeSede
                                        ? "bg-amber-50 text-amber-700"
                                        : "bg-slate-100 text-slate-600"
                                    }`}
                                    title={
                                      radio != null
                                        ? `${formatDistancia(f.distancia)} del centro de la sede (radio configurado: ${radio} m)`
                                        : `${formatDistancia(f.distancia)} del centro de la sede`
                                    }
                                  >
                                    {fueraDeSede ? "Fuera de la sede · " : ""}
                                    {formatDistancia(f.distancia)}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-slate-400 text-xs">Sin ubicación</span>
                            )}
                          </td>
                          <td className="hidden md:table-cell px-4 py-3">
                            {f.tieneFoto ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <a href={`/api/fichajes/${f.id}/foto`} target="_blank" rel="noopener noreferrer" title="Ver foto del fichaje">
                                <img
                                  src={`/api/fichajes/${f.id}/foto`}
                                  alt="Snapshot Face ID"
                                  className="h-10 w-10 rounded-md object-cover border border-slate-200 hover:scale-110 transition-transform"
                                  loading="lazy"
                                />
                              </a>
                            ) : (
                              <span className="text-slate-300 text-xs">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-600 max-w-[200px] truncate" title={f.nota ?? ""}>
                            {f.nota || "—"}
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
      )}
    </div>
  );
}

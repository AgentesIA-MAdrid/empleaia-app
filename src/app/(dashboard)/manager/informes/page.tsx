"use client";

import { useEffect, useState, useCallback } from "react";
import { Download, FileSpreadsheet, FileText, BarChart2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FeatureGateClient } from "@/components/feature-gate-client";
import { InformeVentas } from "@/components/cierre-turno/informe-ventas";
import { useFeatures } from "@/lib/hooks/use-features";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { formatFecha } from "@/lib/utils";
import { subDays, format } from "date-fns";

interface ResumenEmpleado {
  userId: string;
  nombre: string;
  apellidos: string;
  diasTrabajados: number;
  horasTotales: number;
  /** Horas de contrato imputables al periodo filtrado. */
  horasContrato: number;
  /** `horasTotales − horasContrato`: positiva = exceso, negativa = déficit. */
  diferencia: number;
  horasExtra: number;
  diasAusencia: number;
}

interface Stats {
  totalHoras: number;
  mediaHorasDia: number;
  totalAusencias: number;
  horasContrato: number;
  diferencia: number;
  horasExtra: number;
}

export default function ManagerInformesPage() {
  const { toast } = useToast();
  const { data: features } = useFeatures();
  // La pestaña de Ventas es del módulo "Cierre de turno" (Enterprise).
  const tieneVentas = features?.booleans?.cierre_turno === true;
  /** Pestaña activa: asistencia (lo de siempre) o ventas. */
  const [vista, setVista] = useState<"asistencia" | "ventas">("asistencia");
  const [fechaInicio, setFechaInicio] = useState(
    format(subDays(new Date(), 30), "yyyy-MM-dd")
  );
  const [fechaFin, setFechaFin] = useState(format(new Date(), "yyyy-MM-dd"));
  const [datos, setDatos] = useState<ResumenEmpleado[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [exportando, setExportando] = useState(false);

  const fetchInformes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/informes?tipo=resumen&fechaInicio=${fechaInicio}T00:00:00Z&fechaFin=${fechaFin}T23:59:59Z`
      );
      const data = await res.json();
      setDatos(data.empleados || []);
      setStats(data.stats || null);
    } finally {
      setLoading(false);
    }
  }, [fechaInicio, fechaFin]);

  useEffect(() => { fetchInformes(); }, [fetchInformes]);

  const chartData = datos.slice(0, 10).map((e) => ({
    nombre: e.nombre,
    horas: parseFloat(e.horasTotales.toFixed(1)),
    extra: parseFloat(e.horasExtra.toFixed(1)),
  }));

  const handleExport = async (formato: "xlsx" | "pdf") => {
    setExportando(true);
    try {
      const res = await fetch(
        `/api/informes/exportar?tipo=fichajes&fechaInicio=${fechaInicio}T00:00:00Z&fechaFin=${fechaFin}T23:59:59Z&formato=${formato}`
      );
      if (!res.ok) {
        if (res.status === 402 || res.status === 429) {
          const body = (await res.json()) as { error?: string };
          toast({
            title: body.error === "limit_reached" ? "Límite de exports alcanzado" : "Función no disponible en tu plan",
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

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Informes</h1>
          <p className="text-slate-500 text-sm mt-1">
            {vista === "ventas"
              ? "Qué ha vendido tu sede y si cuadra con la caja"
              : "Análisis de asistencia de tu sede"}
          </p>
        </div>
        {vista === "asistencia" && (
          <div className="flex gap-2">
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

      {/* El informe de ventas es la misma pregunta en otra unidad, así que va
          como pestaña y no como pantalla aparte. El servidor lo limita a la
          sede del coordinador. */}
      {tieneVentas && (
        <div className="flex gap-2 border-b border-slate-200">
          {[
            { key: "asistencia" as const, label: "Asistencia y horas" },
            { key: "ventas" as const, label: "Ventas" },
          ].map((t) => (
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
        <InformeVentas />
      ) : (
        <>
      {/* Filtros */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-end gap-4 flex-wrap">
            <div>
              <Label>Desde</Label>
              <Input
                type="date"
                className="mt-1 w-40"
                value={fechaInicio}
                max={fechaFin}
                onChange={(e) => setFechaInicio(e.target.value)}
              />
            </div>
            <div>
              <Label>Hasta</Label>
              <Input
                type="date"
                className="mt-1 w-40"
                value={fechaFin}
                min={fechaInicio}
                max={format(new Date(), "yyyy-MM-dd")}
                onChange={(e) => setFechaFin(e.target.value)}
              />
            </div>
            <Button onClick={fetchInformes} disabled={loading}>
              {loading ? "Cargando..." : "Aplicar"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-4">
          {[
            { label: "Total horas", value: `${stats.totalHoras.toFixed(0)}h`, color: "text-[var(--primary)]" },
            { label: "Media horas/día", value: `${stats.mediaHorasDia.toFixed(1)}h`, color: "text-slate-700" },
            { label: "Horas de contrato", value: `${stats.horasContrato.toFixed(0)}h`, color: "text-slate-700" },
            {
              label: "Diferencia",
              value: `${stats.diferencia > 0 ? "+" : ""}${stats.diferencia.toFixed(1)}h`,
              color: stats.diferencia > 0 ? "text-amber-600" : "text-slate-500",
            },
            { label: "Horas extra", value: `${stats.horasExtra.toFixed(0)}h`, color: "text-amber-600" },
            { label: "Ausencias", value: stats.totalAusencias.toString(), color: "text-red-500" },
          ].map((s) => (
            <Card key={s.label}>
              <CardContent className="pt-4 pb-4">
                <p className="text-sm text-slate-500">{s.label}</p>
                <p className={`text-3xl font-bold mt-1 ${s.color}`}>{s.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Gráfico */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart2 className="h-4 w-4 text-[var(--primary)]" />
              Horas trabajadas por empleado
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={chartData} margin={{ top: 0, right: 0, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="nombre" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip formatter={(v) => [`${v}h`]} />
                <Bar dataKey="horas" name="Horas" fill="#6366f1" radius={[4, 4, 0, 0]} />
                <Bar dataKey="extra" name="Extra" fill="#fbbf24" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Tabla */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Detalle por empleado</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-2">
              {[1, 2, 3].map((i) => <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" />)}
            </div>
          ) : datos.length === 0 ? (
            <p className="text-center py-8 text-slate-400">No hay datos para el período seleccionado</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b">
                  <tr>
                    {["Empleado", "Días trab.", "Horas totales", "Horas de contrato", "Diferencia", "Horas extra", "Ausencias"].map((h) => (
                      <th key={h} className="text-left text-xs font-semibold text-slate-500 px-4 py-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {datos.map((e) => (
                    <tr key={e.userId} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-sm text-slate-900">
                        {e.nombre} {e.apellidos}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">{e.diasTrabajados}</td>
                      <td className="px-4 py-3 text-sm font-semibold text-slate-900">{e.horasTotales.toFixed(1)}h</td>
                      <td className="px-4 py-3 text-sm text-slate-600 tabular-nums">{e.horasContrato.toFixed(1)}h</td>
                      <td className="px-4 py-3 text-sm">
                        <span className={e.diferencia > 0 ? "text-amber-600 font-medium tabular-nums" : "text-slate-500 tabular-nums"}>
                          {e.diferencia > 0 ? "+" : ""}{e.diferencia.toFixed(1)}h
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className={e.horasExtra > 0 ? "text-amber-600 font-medium" : "text-slate-400"}>
                          {e.horasExtra > 0 ? `+${e.horasExtra.toFixed(1)}h` : "0h"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">{e.diasAusencia} días</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
        </>
      )}
    </div>
  );
}

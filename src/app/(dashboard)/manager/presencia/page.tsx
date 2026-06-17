"use client";

import { useEffect, useState, useCallback } from "react";
import { RefreshCw, Download, Edit2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FeatureGateClient } from "@/components/feature-gate-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import { FichajeStatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/hooks/use-toast";
import { cn, formatHora, formatFecha } from "@/lib/utils";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface EmpleadoPresencia {
  id: string;
  nombre: string;
  apellidos: string;
  foto?: string;
  estado: "trabajando" | "en_pausa" | "sin_fichar" | "ausente";
  horaEntrada?: string;
  horasHoy: number;
  fichajes: Array<{ tipo: string; timestamp: string }>;
}

interface FichajeEditable {
  id: string;
  tipo: string;
  timestamp: string;
  user: { nombre: string; apellidos: string };
  nota?: string;
}

const ESTADO_INDICATOR: Record<EmpleadoPresencia["estado"], string> = {
  trabajando: "bg-emerald-500",
  en_pausa: "bg-amber-500",
  sin_fichar: "bg-slate-300",
  ausente: "bg-red-400",
};

export default function PresenciaPage() {
  const { toast } = useToast();
  const [empleados, setEmpleados] = useState<EmpleadoPresencia[]>([]);
  const [loading, setLoading] = useState(true);
  const [fechaSeleccionada, setFechaSeleccionada] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [busqueda, setBusqueda] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("todos");

  const fetchPresencia = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/informes?tipo=presencia&fecha=${fechaSeleccionada}`
      );
      const data = await res.json();
      setEmpleados(data.empleados || []);
    } catch {
      setEmpleados([]);
    } finally {
      setLoading(false);
    }
  }, [fechaSeleccionada]);

  useEffect(() => { fetchPresencia(); }, [fetchPresencia]);
  useEffect(() => {
    const interval = setInterval(fetchPresencia, 60000);
    return () => clearInterval(interval);
  }, [fetchPresencia]);

  const esHoy = fechaSeleccionada === new Date().toISOString().split("T")[0];

  const empleadosFiltrados = empleados.filter((e) => {
    const matchBusqueda = busqueda
      ? `${e.nombre} ${e.apellidos}`.toLowerCase().includes(busqueda.toLowerCase())
      : true;
    const matchEstado = filtroEstado === "todos" ? true : e.estado === filtroEstado;
    return matchBusqueda && matchEstado;
  });

  const stats = {
    total: empleados.length,
    trabajando: empleados.filter((e) => e.estado === "trabajando").length,
    enPausa: empleados.filter((e) => e.estado === "en_pausa").length,
    sinFichar: empleados.filter((e) => e.estado === "sin_fichar").length,
  };

  const handleExport = async () => {
    try {
      const res = await fetch(
        `/api/informes/exportar?tipo=fichajes&fechaInicio=${fechaSeleccionada}&fechaFin=${fechaSeleccionada}&formato=xlsx`
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
      a.download = `presencia_${fechaSeleccionada}.xlsx`;
      a.click();
    } catch {
      toast({ title: "Error al exportar", variant: "destructive" });
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Presencia</h1>
          <p className="text-slate-500 text-sm mt-1 capitalize">
            {format(new Date(fechaSeleccionada + "T12:00:00"), "EEEE, d 'de' MMMM yyyy", { locale: es })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={fechaSeleccionada}
            max={new Date().toISOString().split("T")[0]}
            onChange={(e) => setFechaSeleccionada(e.target.value)}
            className="w-40"
          />
          <Button variant="outline" size="icon" onClick={fetchPresencia}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <FeatureGateClient feature="export_excel">
            <Button variant="outline" onClick={handleExport}>
              <Download className="h-4 w-4 mr-2" /> Exportar
            </Button>
          </FeatureGateClient>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
        {[
          { label: "Total empleados", value: stats.total, color: "text-slate-900" },
          { label: "Trabajando", value: stats.trabajando, color: "text-emerald-600" },
          { label: "En pausa", value: stats.enPausa, color: "text-amber-600" },
          { label: "Sin fichar", value: stats.sinFichar, color: "text-slate-400" },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-4 pb-4">
              <p className="text-sm text-slate-500">{s.label}</p>
              <p className={cn("text-3xl font-bold mt-1", s.color)}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="Buscar empleado..."
            className="pl-9"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>
        <div className="flex gap-1 bg-slate-100 p-1 rounded-lg">
          {["todos", "trabajando", "en_pausa", "sin_fichar"].map((f) => (
            <button
              key={f}
              onClick={() => setFiltroEstado(f)}
              className={cn(
                "px-3 py-1 rounded-md text-sm font-medium transition-all capitalize",
                filtroEstado === f
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              )}
            >
              {f === "todos" ? "Todos" : f.replace("_", " ")}
            </button>
          ))}
        </div>
      </div>

      {/* Tabla */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-14 bg-slate-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : empleadosFiltrados.length === 0 ? (
            <div className="py-12 text-center text-slate-400">No se encontraron empleados</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 px-4 py-3">Empleado</th>
                    <th className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 px-4 py-3">Estado</th>
                    <th className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 px-4 py-3">Entrada</th>
                    <th className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 px-4 py-3">Horas hoy</th>
                    <th className="hidden md:table-cell text-left text-xs font-semibold uppercase tracking-wide text-slate-500 px-4 py-3">Fichajes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {empleadosFiltrados.map((e) => (
                    <tr key={e.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="relative">
                            <div className="w-9 h-9 rounded-full bg-[var(--primary-light)] flex items-center justify-center text-[var(--primary)] font-semibold text-sm">
                              {e.nombre[0]}{e.apellidos[0]}
                            </div>
                            <span className={cn("absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white", ESTADO_INDICATOR[e.estado])} />
                          </div>
                          <span className="font-medium text-slate-900 text-sm">
                            {e.nombre} {e.apellidos}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <FichajeStatusPill estado={e.estado} />
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {e.horaEntrada ? formatHora(e.horaEntrada) : "—"}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-slate-900">
                        {e.horasHoy > 0 ? `${e.horasHoy.toFixed(1)}h` : "—"}
                      </td>
                      <td className="hidden md:table-cell px-4 py-3">
                        <div className="flex gap-1 flex-wrap">
                          {e.fichajes.map((f, i) => (
                            <span key={i} className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-md">
                              {f.tipo.charAt(0)} {formatHora(f.timestamp)}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

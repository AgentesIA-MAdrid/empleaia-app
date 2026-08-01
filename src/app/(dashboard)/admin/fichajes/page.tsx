"use client";

import { Suspense, useEffect, useState, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import {
  FileSpreadsheet, FileText, MapPin, Smartphone, Tablet, Globe, ScanFace, Search,
  ClipboardCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { FeatureGateClient } from "@/components/feature-gate-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { subDays, format } from "date-fns";
import { EmployeeAvatar } from "@/components/ui/employee-avatar";

interface Tienda { id: string; nombre: string; }
interface Empleado {
  id: string;
  nombre: string;
  apellidos: string;
  foto: string | null;
  tiendaId: string | null;
}

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
  /** Comprobaciones confirmadas al fichar (checklist de entrada/salida). */
  checklist?: { texto: string; marcado: boolean }[];
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
  ENTRADA: "bg-[var(--success-bg)] text-[var(--success-text)]",
  PAUSA: "bg-[var(--warning-bg)] text-[var(--warning-text)]",
  VUELTA_PAUSA: "bg-sky-50 text-sky-700",
  SALIDA: "bg-rose-50 text-rose-700",
};

function MetodoIcon({ m }: { m: FichajeDetalle["metodo"] }) {
  if (m === "MOVIL") return <Smartphone className="h-3.5 w-3.5" />;
  if (m === "TABLET") return <Tablet className="h-3.5 w-3.5" />;
  if (m === "MANUAL") return <ScanFace className="h-3.5 w-3.5" />;
  return <Globe className="h-3.5 w-3.5" />;
}

/**
 * Registro de fichajes de la plantilla (pantalla propia, separada de
 * /admin/informes). Sin gate de plan: el registro de jornada tiene que
 * poder consultarse siempre (RD 8/2019). Acepta `?userId`, `?tiendaId`,
 * `?fechaInicio` y `?fechaFin` para poder enlazar desde Informes.
 */
function AdminFichajesContent() {
  const { toast } = useToast();
  const searchParams = useSearchParams();

  const [fechaInicio, setFechaInicio] = useState(
    () => searchParams.get("fechaInicio") || format(subDays(new Date(), 30), "yyyy-MM-dd"),
  );
  const [fechaFin, setFechaFin] = useState(
    () => searchParams.get("fechaFin") || format(new Date(), "yyyy-MM-dd"),
  );
  const [tiendas, setTiendas] = useState<Tienda[]>([]);
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [tiendaId, setTiendaId] = useState<string>(() => searchParams.get("tiendaId") || "todas");
  const [empleadoId, setEmpleadoId] = useState<string>(() => searchParams.get("userId") || "todos");

  const [fichajes, setFichajes] = useState<FichajeDetalle[]>([]);
  const [loading, setLoading] = useState(false);
  const [exportando, setExportando] = useState(false);

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

  const empleadoSel = useMemo(
    () => empleados.find((e) => e.id === empleadoId) ?? null,
    [empleados, empleadoId],
  );
  const empleadoTienda = useMemo(
    () => (empleadoSel?.tiendaId ? tiendas.find((t) => t.id === empleadoSel.tiendaId) : null),
    [empleadoSel, tiendas],
  );

  const buildParams = useCallback(() => {
    const params = new URLSearchParams({
      fechaInicio: `${fechaInicio}T00:00:00Z`,
      fechaFin: `${fechaFin}T23:59:59Z`,
    });
    if (tiendaId !== "todas") params.set("tiendaId", tiendaId);
    if (empleadoId !== "todos") params.set("userId", empleadoId);
    return params;
  }, [fechaInicio, fechaFin, tiendaId, empleadoId]);

  // ── Fetch del listado ────────────────────────────────────────────────────
  const fetchFichajes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/informes?${buildParams()}&tipo=fichajes`);
      const data = await res.json();
      setFichajes((data?.data ?? []) as FichajeDetalle[]);
    } catch {
      setFichajes([]);
    } finally {
      setLoading(false);
    }
  }, [buildParams]);

  useEffect(() => { fetchFichajes(); }, [fetchFichajes]);

  const handleExport = async (formato: "xlsx" | "pdf") => {
    setExportando(true);
    try {
      const params = buildParams();
      params.set("tipo", "fichajes");
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
      a.download = `fichajes_${fechaInicio}_${fechaFin}.${formato}`;
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
          <h1 className="text-2xl font-bold text-[var(--text-dark)]">Fichajes</h1>
          <p className="text-[var(--text-muted)] text-sm mt-1">
            Registro de entradas y salidas de tu plantilla
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
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
            <Button onClick={fetchFichajes} disabled={loading}>
              <Search className="h-4 w-4 mr-1.5" />
              {loading ? "Cargando..." : "Aplicar"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ─── Listado de toda la plantilla ───────────────────────────────── */}
      {empleadoId === "todos" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Listado de fichajes</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-4 space-y-2">{[1, 2, 3, 4].map(i => <div key={i} className="h-10 bg-[var(--muted)] rounded animate-pulse" />)}</div>
            ) : fichajes.length === 0 ? (
              <p className="text-center py-8 text-[var(--text-muted)]">No hay fichajes en el periodo seleccionado</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-[var(--muted)] border-b border-[var(--border)]">
                    <tr>
                      {["Fecha", "Hora", "Empleado", "Tipo", "Método", "Sede"].map(h => (
                        <th key={h} className="text-left text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] px-4 py-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {fichajes.map(f => {
                      const d = new Date(f.timestamp);
                      return (
                        <tr key={f.id} className="hover:bg-[var(--muted)] transition-colors">
                          <td className="px-4 py-3 text-sm text-[var(--text-body)] whitespace-nowrap">{format(d, "dd/MM/yyyy")}</td>
                          <td className="px-4 py-3 text-sm font-mono text-[var(--text-dark)] whitespace-nowrap">{format(d, "HH:mm:ss")}</td>
                          <td className="px-4 py-3 text-sm text-[var(--text-body)] whitespace-nowrap">{f.user.nombre} {f.user.apellidos}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${TIPO_CLS[f.tipo]}`}>
                              {TIPO_LABEL[f.tipo]}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-[var(--text-muted)]"><MetodoIcon m={f.metodo} /></td>
                          <td className="px-4 py-3 text-sm text-[var(--text-body)]">{f.tienda?.nombre ?? "—"}</td>
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

      {/* ─── Detalle de un empleado ─────────────────────────────────────── */}
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
                <p className="text-sm text-[var(--text-muted)] mt-0.5">
                  {empleadoTienda ? empleadoTienda.nombre : "Sin sede asignada"}
                  {" · "}
                  <strong>{fichajes.length}</strong> fichajes en el periodo
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setEmpleadoId("todos")}>
                ← Ver toda la plantilla
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-4 space-y-2">{[1, 2, 3, 4].map(i => <div key={i} className="h-10 bg-[var(--muted)] rounded animate-pulse" />)}</div>
            ) : fichajes.length === 0 ? (
              <p className="text-center py-8 text-[var(--text-muted)]">No hay fichajes en el periodo seleccionado</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-[var(--muted)] border-b border-[var(--border)]">
                    <tr>
                      {["Fecha", "Hora", "Tipo", "Método", "Sede", "Localización", "Foto", "Comprobaciones", "Nota"].map(h => (
                        <th key={h} className={`text-left text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] px-4 py-3${(h === "Localización" || h === "Foto") ? " hidden md:table-cell" : ""}`}>{h}</th>
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
                        <tr key={f.id} className="hover:bg-[var(--muted)] transition-colors">
                          <td className="px-4 py-3 text-sm text-[var(--text-body)] whitespace-nowrap">
                            {format(d, "dd/MM/yyyy")}
                          </td>
                          <td className="px-4 py-3 text-sm font-mono text-[var(--text-dark)] whitespace-nowrap">
                            {format(d, "HH:mm:ss")}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${TIPO_CLS[f.tipo]}`}>
                              {TIPO_LABEL[f.tipo]}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center gap-1 text-xs text-[var(--text-body)]">
                              <MetodoIcon m={f.metodo} />
                              {f.metodo}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-[var(--text-body)] whitespace-nowrap">
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
                                        ? "bg-[var(--warning-bg)] text-[var(--warning-text)]"
                                        : "bg-[var(--muted)] text-[var(--text-body)]"
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
                              <span className="text-[var(--text-muted)] text-xs">Sin ubicación</span>
                            )}
                          </td>
                          <td className="hidden md:table-cell px-4 py-3">
                            {f.tieneFoto ? (
                              <a href={`/api/fichajes/${f.id}/foto`} target="_blank" rel="noopener noreferrer" title="Ver foto del fichaje">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={`/api/fichajes/${f.id}/foto`}
                                  alt="Snapshot Face ID"
                                  className="h-10 w-10 rounded-md object-cover border border-[var(--border)] hover:scale-110 transition-transform"
                                  loading="lazy"
                                />
                              </a>
                            ) : (
                              <span className="text-[var(--text-muted)] text-xs">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm">
                            {f.checklist && f.checklist.length > 0 ? (
                              <span
                                className="inline-flex items-center gap-1 rounded-md bg-[var(--success-bg)] px-1.5 py-0.5 text-xs font-medium text-[var(--success-text)]"
                                title={f.checklist.map(c => `${c.marcado ? "✔" : "✘"} ${c.texto}`).join("\n")}
                              >
                                <ClipboardCheck className="h-3.5 w-3.5" />
                                {f.checklist.filter(c => c.marcado).length}/{f.checklist.length}
                              </span>
                            ) : (
                              <span className="text-[var(--text-muted)] text-xs">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm text-[var(--text-body)] max-w-[200px] truncate" title={f.nota ?? ""}>
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

// `useSearchParams` exige un límite de Suspense en Next 16 (misma pauta
// que /admin/configuracion).
export default function AdminFichajesPage() {
  return (
    <Suspense fallback={<div className="p-6 animate-pulse"><div className="h-40 bg-[var(--muted)] rounded-xl" /></div>}>
      <AdminFichajesContent />
    </Suspense>
  );
}

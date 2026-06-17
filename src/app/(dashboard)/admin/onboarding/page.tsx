"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Plus, Trash2, CheckCircle, Clock, XCircle, ChevronDown, ChevronUp,
  Settings, Check, ArrowUpCircle, ArrowDownCircle, GripVertical, Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface TareaOnboarding {
  id: string;
  titulo: string;
  descripcion?: string;
  completada: boolean;
  orden: number;
}

interface Proceso {
  id: string;
  tipo: string;
  estado: string;
  fechaInicio: string;
  fechaFin?: string;
  notas?: string;
  user: { id: string; nombre: string; apellidos: string; email: string; tienda?: { nombre: string } };
  tareas: TareaOnboarding[];
}

interface Empleado { id: string; nombre: string; apellidos: string; }
interface Plantilla { id: string; tipo: string; titulo: string; descripcion?: string; orden: number; activa: boolean; }

const ESTADOS = ["PENDIENTE", "EN_PROCESO", "COMPLETADO", "CANCELADO"];
const ESTADO_CONFIG: Record<string, { label: string; icon: typeof CheckCircle; color: string }> = {
  PENDIENTE: { label: "Pendiente", icon: Clock, color: "bg-amber-100 text-amber-700" },
  EN_PROCESO: { label: "En proceso", icon: Clock, color: "bg-sky-100 text-sky-700" },
  COMPLETADO: { label: "Completado", icon: CheckCircle, color: "bg-emerald-100 text-emerald-700" },
  CANCELADO: { label: "Cancelado", icon: XCircle, color: "bg-red-100 text-red-700" },
};

const FORM_INICIAL = { userId: "", tipo: "ONBOARDING", estado: "PENDIENTE", fechaInicio: "", fechaFin: "", notas: "" };

export default function AdminOnboardingPage() {
  const { toast } = useToast();
  const [procesos, setProcesos] = useState<Proceso[]>([]);
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtroTipo, setFiltroTipo] = useState("TODOS");
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const [tareasCache, setTareasCache] = useState<Record<string, TareaOnboarding[]>>({});

  // Dialog crear proceso
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(FORM_INICIAL);
  const [saving, setSaving] = useState(false);

  // Dialog plantillas
  const [plantillaDialogOpen, setPlantillaDialogOpen] = useState(false);
  const [plantillaForm, setPlantillaForm] = useState({ tipo: "ONBOARDING", titulo: "", descripcion: "" });
  const [savingPlantilla, setSavingPlantilla] = useState(false);

  // Tarea nueva por proceso
  const [nuevaTarea, setNuevaTarea] = useState<Record<string, string>>({});

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [procRes, empRes, plantRes] = await Promise.all([
        fetch("/api/onboarding"),
        fetch("/api/empleados"),
        fetch("/api/onboarding/plantillas"),
      ]);
      const [procData, empData, plantData] = await Promise.all([procRes.json(), empRes.json(), plantRes.json()]);
      setProcesos(procData.procesos || []);
      setEmpleados(empData.empleados || []);
      setPlantillas(plantData.plantillas || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Procesos ────────────────────────────────────────────────────────────────

  const handleCrearProceso = async () => {
    if (!form.userId || !form.fechaInicio) {
      toast({ title: "Selecciona empleado y fecha de inicio", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      const procesoId = data.proceso.id;

      // Aplicar plantillas activas del tipo seleccionado
      const plantillasTipo = plantillas.filter((p) => p.activa && p.tipo === form.tipo);
      if (plantillasTipo.length > 0) {
        await Promise.all(
          plantillasTipo.map((p) =>
            fetch(`/api/onboarding/${procesoId}/tareas`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ titulo: p.titulo, descripcion: p.descripcion, orden: p.orden }),
            })
          )
        );
      }

      toast({ title: "Proceso creado", description: plantillasTipo.length > 0 ? `${plantillasTipo.length} tareas aplicadas desde la plantilla` : undefined });
      setDialogOpen(false);
      setForm(FORM_INICIAL);
      fetchData();
    } catch {
      toast({ title: "Error al crear", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const updateEstado = async (id: string, estado: string) => {
    try {
      await fetch(`/api/onboarding/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado }),
      });
      fetchData();
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  };

  const handleEliminarProceso = async (id: string) => {
    if (!confirm("¿Eliminar este proceso? Se eliminarán también todas sus tareas.")) return;
    try {
      await fetch(`/api/onboarding/${id}`, { method: "DELETE" });
      toast({ title: "Proceso eliminado" });
      fetchData();
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  };

  const toggleExpand = async (id: string) => {
    const next = new Set(expandidos);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
      if (!tareasCache[id]) {
        const res = await fetch(`/api/onboarding/${id}/tareas`);
        const data = await res.json();
        setTareasCache((prev) => ({ ...prev, [id]: data.tareas || [] }));
      }
    }
    setExpandidos(next);
  };

  // ── Tareas de proceso ───────────────────────────────────────────────────────

  const toggleTarea = async (procesoId: string, tarea: TareaOnboarding) => {
    try {
      await fetch(`/api/onboarding/${procesoId}/tareas`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tareaId: tarea.id, completada: !tarea.completada }),
      });
      setTareasCache((prev) => ({
        ...prev,
        [procesoId]: prev[procesoId].map((t) => t.id === tarea.id ? { ...t, completada: !t.completada } : t),
      }));
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  };

  const addTarea = async (procesoId: string) => {
    const titulo = nuevaTarea[procesoId]?.trim();
    if (!titulo) return;
    try {
      const res = await fetch(`/api/onboarding/${procesoId}/tareas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ titulo, orden: (tareasCache[procesoId]?.length ?? 0) }),
      });
      const data = await res.json();
      setTareasCache((prev) => ({ ...prev, [procesoId]: [...(prev[procesoId] || []), data.tarea] }));
      setNuevaTarea((prev) => ({ ...prev, [procesoId]: "" }));
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  };

  const deleteTarea = async (procesoId: string, tareaId: string) => {
    try {
      await fetch(`/api/onboarding/${procesoId}/tareas?tareaId=${tareaId}`, { method: "DELETE" });
      setTareasCache((prev) => ({
        ...prev,
        [procesoId]: prev[procesoId].filter((t) => t.id !== tareaId),
      }));
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  };

  // ── Plantillas ──────────────────────────────────────────────────────────────

  const handleCrearPlantilla = async () => {
    if (!plantillaForm.titulo) {
      toast({ title: "El título es obligatorio", variant: "destructive" });
      return;
    }
    setSavingPlantilla(true);
    try {
      const ordenMax = plantillas.filter((p) => p.tipo === plantillaForm.tipo).length;
      const res = await fetch("/api/onboarding/plantillas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...plantillaForm, orden: ordenMax }),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Tarea de plantilla creada" });
      setPlantillaForm({ tipo: "ONBOARDING", titulo: "", descripcion: "" });
      fetchData();
    } catch {
      toast({ title: "Error al crear plantilla", variant: "destructive" });
    } finally {
      setSavingPlantilla(false);
    }
  };

  const togglePlantillaActiva = async (p: Plantilla) => {
    try {
      await fetch(`/api/onboarding/plantillas/${p.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activa: !p.activa }),
      });
      fetchData();
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  };

  const deletePlantilla = async (id: string) => {
    try {
      await fetch(`/api/onboarding/plantillas/${id}`, { method: "DELETE" });
      toast({ title: "Plantilla eliminada" });
      fetchData();
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  const procesosFiltrados = filtroTipo === "TODOS" ? procesos : procesos.filter((p) => p.tipo === filtroTipo);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Incorporaciones y Bajas</h1>
          <p className="text-slate-500 text-sm mt-1">Gestión de onboarding y offboarding de empleados</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" /> Nuevo proceso
        </Button>
      </div>

      <Tabs defaultValue="procesos">
        <TabsList>
          <TabsTrigger value="procesos">Procesos</TabsTrigger>
          <TabsTrigger value="plantillas"><Settings className="h-3.5 w-3.5 mr-1.5" />Plantillas</TabsTrigger>
        </TabsList>

        {/* ── Tab Procesos ── */}
        <TabsContent value="procesos" className="space-y-4 mt-4">
          <div className="flex gap-2">
            {["TODOS", "ONBOARDING", "OFFBOARDING"].map((t) => (
              <button
                key={t}
                onClick={() => setFiltroTipo(t)}
                className={cn(
                  "px-4 py-1.5 rounded-full text-sm font-medium border transition-all",
                  filtroTipo === t ? "bg-[var(--primary)] text-white border-[var(--primary)]" : "bg-white text-slate-600 border-slate-200 hover:border-[var(--primary)]"
                )}
              >
                {t === "TODOS" ? "Todos" : t === "ONBOARDING" ? "Incorporaciones" : "Bajas"}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-20 bg-slate-100 rounded-xl animate-pulse" />)}</div>
          ) : procesosFiltrados.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <ArrowUpCircle className="h-10 w-10 text-slate-200 mx-auto mb-3" />
                <p className="text-slate-400">No hay procesos de {filtroTipo === "TODOS" ? "incorporación/baja" : filtroTipo === "ONBOARDING" ? "incorporación" : "baja"}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {procesosFiltrados.map((p) => {
                const estadoConf = ESTADO_CONFIG[p.estado] ?? ESTADO_CONFIG.PENDIENTE;
                const Icon = estadoConf.icon;
                const isExpanded = expandidos.has(p.id);
                const tareas = tareasCache[p.id] || [];
                const completadas = tareas.filter((t) => t.completada).length;

                return (
                  <div key={p.id} className="bg-white rounded-xl border hover:shadow-sm transition-all">
                    {/* Cabecera del proceso */}
                    <div className="flex items-center gap-4 p-4">
                      <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
                        p.tipo === "ONBOARDING" ? "bg-emerald-50" : "bg-red-50")}>
                        {p.tipo === "ONBOARDING"
                          ? <ArrowUpCircle className="h-5 w-5 text-emerald-600" />
                          : <ArrowDownCircle className="h-5 w-5 text-red-600" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          <p className="font-medium text-slate-900">{p.user.nombre} {p.user.apellidos}</p>
                          <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium",
                            p.tipo === "ONBOARDING" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700")}>
                            {p.tipo === "ONBOARDING" ? "Incorporación" : "Baja"}
                          </span>
                          <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1", estadoConf.color)}>
                            <Icon className="h-3 w-3" /> {estadoConf.label}
                          </span>
                          {tareas.length > 0 && (
                            <span className="text-xs text-slate-400">{completadas}/{tareas.length} tareas</span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400">
                          {p.user.tienda?.nombre ?? "Sin sede"} · Inicio: {format(new Date(p.fechaInicio), "d MMM yyyy", { locale: es })}
                          {p.fechaFin ? ` · Fin: ${format(new Date(p.fechaFin), "d MMM yyyy", { locale: es })}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Select value={p.estado} onValueChange={(v) => updateEstado(p.id, v)}>
                          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {ESTADOS.map((e) => <SelectItem key={e} value={e} className="text-xs">{ESTADO_CONFIG[e]?.label ?? e}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <button onClick={() => toggleExpand(p.id)} className="p-1.5 text-slate-400 hover:text-[var(--primary)] transition-colors">
                          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </button>
                        <button onClick={() => handleEliminarProceso(p.id)} className="p-1.5 text-slate-400 hover:text-red-500 transition-colors">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    {/* Checklist de tareas */}
                    {isExpanded && (
                      <div className="border-t px-4 pb-4 pt-3 space-y-2">
                        {tareas.length === 0 && (
                          <p className="text-xs text-slate-400 py-1">Sin tareas — añade una abajo</p>
                        )}
                        {tareas.map((tarea) => (
                          <div key={tarea.id} className="flex items-center gap-3 group">
                            <button
                              onClick={() => toggleTarea(p.id, tarea)}
                              className={cn("w-5 h-5 rounded flex items-center justify-center border-2 shrink-0 transition-all",
                                tarea.completada ? "bg-emerald-500 border-green-500" : "border-slate-300 hover:border-green-400"
                              )}
                            >
                              {tarea.completada && <Check className="h-3 w-3 text-white" />}
                            </button>
                            <span className={cn("text-sm flex-1", tarea.completada && "line-through text-slate-400")}>
                              {tarea.titulo}
                              {tarea.descripcion && <span className="text-slate-400 ml-1">— {tarea.descripcion}</span>}
                            </span>
                            <button
                              onClick={() => deleteTarea(p.id, tarea.id)}
                              className="opacity-0 group-hover:opacity-100 p-1 text-slate-300 hover:text-red-400 transition-all"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                        {/* Añadir tarea manual */}
                        <div className="flex gap-2 mt-3">
                          <Input
                            className="h-8 text-sm"
                            placeholder="Nueva tarea..."
                            value={nuevaTarea[p.id] || ""}
                            onChange={(e) => setNuevaTarea((prev) => ({ ...prev, [p.id]: e.target.value }))}
                            onKeyDown={(e) => e.key === "Enter" && addTarea(p.id)}
                          />
                          <Button size="sm" variant="outline" className="h-8" onClick={() => addTarea(p.id)}>
                            <Plus className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ── Tab Plantillas ── */}
        <TabsContent value="plantillas" className="space-y-6 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {["ONBOARDING", "OFFBOARDING"].map((tipo) => {
              const lista = plantillas.filter((p) => p.tipo === tipo);
              return (
                <Card key={tipo}>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      {tipo === "ONBOARDING"
                        ? <ArrowUpCircle className="h-4 w-4 text-emerald-600" />
                        : <ArrowDownCircle className="h-4 w-4 text-red-600" />}
                      Plantilla de {tipo === "ONBOARDING" ? "Incorporación" : "Baja"}
                    </CardTitle>
                    <p className="text-xs text-slate-400">
                      Estas tareas se añaden automáticamente al crear un proceso de {tipo === "ONBOARDING" ? "incorporación" : "baja"}
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {lista.length === 0 && (
                      <p className="text-xs text-slate-400 py-2 text-center">Sin tareas configuradas</p>
                    )}
                    {lista.map((p) => (
                      <div key={p.id} className="flex items-center gap-2 py-1.5 border-b last:border-0">
                        <GripVertical className="h-4 w-4 text-slate-300 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className={cn("text-sm", !p.activa && "line-through text-slate-400")}>{p.titulo}</p>
                          {p.descripcion && <p className="text-xs text-slate-400 truncate">{p.descripcion}</p>}
                        </div>
                        <button
                          onClick={() => togglePlantillaActiva(p)}
                          className={cn("text-xs px-2 py-0.5 rounded-full border transition-all shrink-0",
                            p.activa ? "bg-emerald-50 text-emerald-700 border-green-200" : "bg-slate-50 text-slate-400 border-slate-200"
                          )}
                        >
                          {p.activa ? "Activa" : "Inactiva"}
                        </button>
                        <button onClick={() => deletePlantilla(p.id)} className="p-1 text-slate-300 hover:text-red-400 transition-colors shrink-0">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                    {/* Añadir nueva tarea a plantilla */}
                    <button
                      onClick={() => {
                        setPlantillaForm({ tipo, titulo: "", descripcion: "" });
                        setPlantillaDialogOpen(true);
                      }}
                      className="w-full mt-2 flex items-center gap-2 text-xs text-[var(--primary)] hover:text-[var(--primary-dark)] py-1.5 border border-dashed border-[var(--primary)] rounded-lg hover:border-[var(--primary)] transition-all justify-center"
                    >
                      <Plus className="h-3.5 w-3.5" /> Añadir tarea
                    </button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>

      {/* Dialog crear proceso */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-md">
          <DialogHeader><DialogTitle>Nuevo proceso</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Empleado *</Label>
              <Select value={form.userId} onValueChange={(v) => setForm((f) => ({ ...f, userId: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Selecciona empleado" /></SelectTrigger>
                <SelectContent>
                  {empleados.map((e) => <SelectItem key={e.id} value={e.id}>{e.nombre} {e.apellidos}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Tipo</Label>
                <Select value={form.tipo} onValueChange={(v) => setForm((f) => ({ ...f, tipo: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ONBOARDING">Incorporación</SelectItem>
                    <SelectItem value="OFFBOARDING">Baja</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Estado inicial</Label>
                <Select value={form.estado} onValueChange={(v) => setForm((f) => ({ ...f, estado: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ESTADOS.map((e) => <SelectItem key={e} value={e}>{ESTADO_CONFIG[e]?.label ?? e}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Fecha inicio *</Label>
                <Input className="mt-1" type="date" value={form.fechaInicio}
                  onChange={(e) => setForm((f) => ({ ...f, fechaInicio: e.target.value }))} />
              </div>
              <div>
                <Label>Fecha fin <span className="text-slate-400 font-normal">(opcional)</span></Label>
                <Input className="mt-1" type="date" value={form.fechaFin}
                  onChange={(e) => setForm((f) => ({ ...f, fechaFin: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Notas</Label>
              <Input className="mt-1" value={form.notas}
                onChange={(e) => setForm((f) => ({ ...f, notas: e.target.value }))}
                placeholder="Observaciones adicionales" />
            </div>
            {plantillas.filter((p) => p.activa && p.tipo === form.tipo).length > 0 && (
              <div className="bg-[var(--primary-light)] rounded-lg p-3 text-xs text-[var(--primary)]">
                Se aplicarán automáticamente {plantillas.filter((p) => p.activa && p.tipo === form.tipo).length} tareas de la plantilla
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleCrearProceso} disabled={saving}>{saving ? "Creando..." : "Crear proceso"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog nueva plantilla */}
      <Dialog open={plantillaDialogOpen} onOpenChange={setPlantillaDialogOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Nueva tarea de plantilla</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Tipo</Label>
              <Select value={plantillaForm.tipo} onValueChange={(v) => setPlantillaForm((f) => ({ ...f, tipo: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ONBOARDING">Incorporación</SelectItem>
                  <SelectItem value="OFFBOARDING">Baja</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Tarea *</Label>
              <Input className="mt-1" value={plantillaForm.titulo}
                onChange={(e) => setPlantillaForm((f) => ({ ...f, titulo: e.target.value }))}
                placeholder="Ej: Firma del contrato" />
            </div>
            <div>
              <Label>Descripción <span className="text-slate-400 font-normal">(opcional)</span></Label>
              <Input className="mt-1" value={plantillaForm.descripcion}
                onChange={(e) => setPlantillaForm((f) => ({ ...f, descripcion: e.target.value }))}
                placeholder="Instrucciones o detalle" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPlantillaDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleCrearPlantilla} disabled={savingPlantilla}>
              {savingPlantilla ? "Guardando..." : "Añadir tarea"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

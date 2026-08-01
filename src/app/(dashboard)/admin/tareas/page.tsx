"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, CheckSquare, Square, Trash2, User, Calendar, Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface Tarea {
  id: string;
  titulo: string;
  descripcion?: string;
  prioridad: string;
  completada: boolean;
  fechaLimite?: string;
  asignadoA?: { id: string; nombre: string; apellidos: string };
  creadoPor: { id: string; nombre: string; apellidos: string };
  createdAt: string;
}

interface Empleado {
  id: string;
  nombre: string;
  apellidos: string;
}

const PRIORIDAD = ["ALTA", "MEDIA", "BAJA"];
const PRIORIDAD_COLOR: Record<string, string> = {
  ALTA: "bg-[var(--danger-bg)] text-[var(--danger-text)] border-[var(--danger-bg)]",
  MEDIA: "bg-[var(--warning-bg)] text-[var(--warning-text)] border-[var(--warning-bg)]",
  BAJA: "bg-[var(--muted)] text-[var(--text-body)] border-[var(--border)]",
};

export default function AdminTareasPage() {
  const { toast } = useToast();
  const [tareas, setTareas] = useState<Tarea[]>([]);
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [filtro, setFiltro] = useState<"todas" | "pendientes" | "completadas">("pendientes");
  const [form, setForm] = useState({ titulo: "", descripcion: "", prioridad: "MEDIA", fechaLimite: "", asignadoAId: "" });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [tareasRes, empRes] = await Promise.all([
        fetch("/api/tareas"),
        fetch("/api/empleados"),
      ]);
      const [tareasData, empData] = await Promise.all([tareasRes.json(), empRes.json()]);
      setTareas(tareasData.tareas || []);
      setEmpleados(empData.empleados || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleCreate = async () => {
    if (!form.titulo) { toast({ title: "El título es obligatorio", variant: "destructive" }); return; }
    try {
      const res = await fetch("/api/tareas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          asignadoAId: form.asignadoAId || null,
          fechaLimite: form.fechaLimite || null,
        }),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Tarea creada" });
      setDialogOpen(false);
      setForm({ titulo: "", descripcion: "", prioridad: "MEDIA", fechaLimite: "", asignadoAId: "" });
      fetchData();
    } catch {
      toast({ title: "Error al crear tarea", variant: "destructive" });
    }
  };

  const toggleCompletada = async (tarea: Tarea) => {
    try {
      await fetch(`/api/tareas/${tarea.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completada: !tarea.completada }),
      });
      fetchData();
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/tareas/${id}`, { method: "DELETE" });
      toast({ title: "Tarea eliminada" });
      fetchData();
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  };

  const tareasFiltradas = tareas.filter((t) => {
    if (filtro === "pendientes") return !t.completada;
    if (filtro === "completadas") return t.completada;
    return true;
  });

  const pendientes = tareas.filter((t) => !t.completada).length;
  const completadas = tareas.filter((t) => t.completada).length;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-dark)]">Tareas</h1>
          <p className="text-[var(--text-muted)] text-sm mt-1">{pendientes} pendientes · {completadas} completadas</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" /> Nueva tarea
        </Button>
      </div>

      {/* Filtro tabs */}
      <div className="flex gap-1 bg-[var(--muted)] p-1 rounded-xl w-fit">
        {(["pendientes", "completadas", "todas"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFiltro(f)}
            className={cn(
              "px-4 py-1.5 rounded-lg text-sm font-medium transition-all capitalize",
              filtro === f ? "bg-[var(--card)] text-[var(--text-dark)] shadow-sm" : "text-[var(--text-muted)] hover:text-[var(--text-body)]"
            )}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Lista */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-20 bg-[var(--muted)] rounded-xl animate-pulse" />)}
        </div>
      ) : tareasFiltradas.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <CheckSquare className="h-10 w-10 text-slate-200 mx-auto mb-3" />
            <p className="text-[var(--text-muted)]">No hay tareas {filtro !== "todas" ? filtro : ""}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {tareasFiltradas.map((tarea) => (
            <div
              key={tarea.id}
              className={cn(
                "flex items-start gap-3 p-4 rounded-xl border bg-[var(--card)] hover:shadow-sm transition-all",
                tarea.completada ? "opacity-60" : ""
              )}
            >
              <button onClick={() => toggleCompletada(tarea)} className="mt-0.5 shrink-0">
                {tarea.completada
                  ? <CheckSquare className="h-5 w-5 text-[var(--primary)]" />
                  : <Square className="h-5 w-5 text-[var(--text-muted)] hover:text-[var(--primary-lighter)] transition-colors" />}
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className={cn("font-medium text-[var(--text-dark)]", tarea.completada && "line-through text-[var(--text-muted)]")}>
                    {tarea.titulo}
                  </p>
                  <span className={cn("text-xs px-2 py-0.5 rounded-full border font-medium", PRIORIDAD_COLOR[tarea.prioridad])}>
                    {tarea.prioridad}
                  </span>
                </div>
                {tarea.descripcion && (
                  <p className="text-sm text-[var(--text-muted)] mt-0.5 truncate">{tarea.descripcion}</p>
                )}
                <div className="flex items-center gap-4 mt-1.5 flex-wrap">
                  {tarea.asignadoA && (
                    <span className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
                      <User className="h-3 w-3" />
                      {tarea.asignadoA.nombre} {tarea.asignadoA.apellidos}
                    </span>
                  )}
                  {tarea.fechaLimite && (
                    <span className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
                      <Calendar className="h-3 w-3" />
                      {format(new Date(tarea.fechaLimite), "d MMM yyyy", { locale: es })}
                    </span>
                  )}
                  <span className="text-xs text-[var(--text-muted)]">
                    por {tarea.creadoPor.nombre} {tarea.creadoPor.apellidos}
                  </span>
                </div>
              </div>
              <button
                onClick={() => handleDelete(tarea.id)}
                className="shrink-0 text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors p-1"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nueva tarea</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Título *</Label>
              <Input className="mt-1" value={form.titulo} onChange={(e) => setForm((f) => ({ ...f, titulo: e.target.value }))} placeholder="Título de la tarea" />
            </div>
            <div>
              <Label>Descripción</Label>
              <Input className="mt-1" value={form.descripcion} onChange={(e) => setForm((f) => ({ ...f, descripcion: e.target.value }))} placeholder="Descripción opcional" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Prioridad</Label>
                <Select value={form.prioridad} onValueChange={(v) => setForm((f) => ({ ...f, prioridad: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRIORIDAD.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Fecha límite</Label>
                <Input className="mt-1" type="date" value={form.fechaLimite} onChange={(e) => setForm((f) => ({ ...f, fechaLimite: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Asignar a</Label>
              <Select value={form.asignadoAId} onValueChange={(v) => setForm((f) => ({ ...f, asignadoAId: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Sin asignar" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Sin asignar</SelectItem>
                  {empleados.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.nombre} {e.apellidos}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreate}>Crear tarea</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

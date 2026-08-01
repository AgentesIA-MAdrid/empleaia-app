"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { CheckCircle, XCircle, Calendar, AlertCircle, Plus, ChevronDown, Search, Check, Settings, List, CalendarDays, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CalendarioAusencias, type FestivoCal } from "@/components/ausencias/calendario-ausencias";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn, formatFecha } from "@/lib/utils";
import { differenceInCalendarDays, parseISO } from "date-fns";

interface TipoAusencia {
  id: string;
  nombre: string;
  color: string;
}

interface Empleado {
  id: string;
  nombre: string;
  apellidos: string;
}

interface Ausencia {
  id: string;
  fechaInicio: string;
  fechaFin: string;
  dias: number;
  motivo?: string;
  estado: "PENDIENTE" | "APROBADA" | "RECHAZADA" | "CANCELADA";
  comentarioAdmin?: string;
  tipoAusencia: { id: string; nombre: string; color: string };
  user: { nombre: string; apellidos: string };
  createdAt: string;
}

const TABS = ["PENDIENTE", "APROBADA", "RECHAZADA", "TODAS"] as const;
type Tab = (typeof TABS)[number];

const ESTADO = {
  PENDIENTE: { label: "Pendiente", color: "bg-[var(--warning-bg)] text-[var(--warning-text)]" },
  APROBADA: { label: "Aprobada", color: "bg-[var(--success-bg)] text-[var(--success-text)]" },
  RECHAZADA: { label: "Rechazada", color: "bg-[var(--danger-bg)] text-[var(--danger-text)]" },
  CANCELADA: { label: "Cancelada", color: "bg-[var(--muted)] text-[var(--text-body)]" },
};

/**
 * Selector de empleado con búsqueda y orden alfabético. A nivel de módulo
 * (evita la regla react-hooks/static-components).
 */
function EmpleadoCombobox({
  empleados,
  value,
  onChange,
}: {
  empleados: Empleado[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const candidatos = empleados
    .slice()
    .sort((a, b) =>
      `${a.nombre} ${a.apellidos}`.localeCompare(`${b.nombre} ${b.apellidos}`, "es"),
    );
  const filtrados = q
    ? candidatos.filter((e) =>
        `${e.nombre} ${e.apellidos}`.toLowerCase().includes(q.toLowerCase()),
      )
    : candidatos;
  const sel = candidatos.find((e) => e.id === value);
  return (
    <div className="relative mt-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm"
      >
        <span className={cn("truncate", !sel && "text-[var(--text-muted)]")}>
          {sel ? `${sel.nombre} ${sel.apellidos}` : "Selecciona empleado..."}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute z-50 mt-1 w-full rounded-md border border-input bg-background shadow-lg">
            <div className="border-b border-[var(--border)] p-2">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Buscar empleado…"
                  className="w-full rounded-md border border-input bg-background py-1.5 pl-8 pr-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                />
              </div>
            </div>
            <div className="max-h-56 overflow-y-auto py-1">
              {filtrados.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => { onChange(e.id); setOpen(false); setQ(""); }}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-[var(--muted)]",
                    e.id === value && "bg-[var(--muted)]",
                  )}
                >
                  <span className="truncate">
                    {e.nombre} {e.apellidos}
                  </span>
                  {e.id === value && <Check className="h-4 w-4 shrink-0 text-[var(--primary)]" />}
                </button>
              ))}
              {filtrados.length === 0 && (
                <p className="px-3 py-2 text-sm text-[var(--text-muted)]">Sin resultados</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function AdminAusenciasPage() {
  const { toast } = useToast();
  const [ausencias, setAusencias] = useState<Ausencia[]>([]);
  const [festivos, setFestivos] = useState<FestivoCal[]>([]);
  const [vista, setVista] = useState<"lista" | "calendario">("lista");
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("PENDIENTE");
  const [rechazarId, setRechazarId] = useState<string | null>(null);
  const [comentario, setComentario] = useState("");
  const [procesando, setProcesando] = useState<string | null>(null);
  const [tipos, setTipos] = useState<TipoAusencia[]>([]);
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    userId: "",
    tipoAusenciaId: "",
    fechaInicio: "",
    fechaFin: "",
    motivo: "",
  });
  const [editId, setEditId] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editForm, setEditForm] = useState({
    tipoAusenciaId: "",
    fechaInicio: "",
    fechaFin: "",
    motivo: "",
  });

  const fetchAusencias = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ausencias");
      const data = await res.json();
      setAusencias(Array.isArray(data) ? data : (data?.ausencias ?? []));
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchFormData = useCallback(async () => {
    const [tiposRes, empRes] = await Promise.all([
      fetch("/api/ausencias/tipos"),
      fetch("/api/empleados"),
    ]);
    const [tiposData, empData] = await Promise.all([tiposRes.json(), empRes.json()]);
    setTipos(Array.isArray(tiposData) ? tiposData : (tiposData?.tipos ?? []));
    setEmpleados(empData?.empleados ?? (Array.isArray(empData) ? empData : []));
  }, []);

  const fetchFestivos = useCallback(async () => {
    try {
      const res = await fetch("/api/festivos");
      const data = await res.json();
      setFestivos(data?.festivos ?? []);
    } catch {
      // la lista sigue funcionando aunque falle el calendario
    }
  }, []);

  useEffect(() => { fetchAusencias(); }, [fetchAusencias]);
  useEffect(() => { fetchFormData(); }, [fetchFormData]);
  useEffect(() => { fetchFestivos(); }, [fetchFestivos]);

  const diasCalc =
    form.fechaInicio && form.fechaFin
      ? Math.max(0, differenceInCalendarDays(parseISO(form.fechaFin), parseISO(form.fechaInicio)) + 1)
      : 0;

  const handleCrear = async () => {
    if (!form.userId || !form.tipoAusenciaId || !form.fechaInicio || !form.fechaFin) {
      toast({ title: "Completa todos los campos", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/ausencias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Error al crear la ausencia");
      }
      toast({ title: "Ausencia creada", description: "Queda pendiente de aprobación" });
      setDialogOpen(false);
      setForm({ userId: "", tipoAusenciaId: "", fechaInicio: "", fechaFin: "", motivo: "" });
      setTab("PENDIENTE");
      fetchAusencias();
    } catch (e) {
      toast({ title: "Error", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const filtradas = ausencias.filter((a) =>
    tab === "TODAS" ? a.estado !== "CANCELADA" : a.estado === tab
  );

  const pendientesCount = ausencias.filter((a) => a.estado === "PENDIENTE").length;

  const handleAccion = async (id: string, estado: "APROBADA" | "RECHAZADA", comentarioAdmin?: string) => {
    setProcesando(id);
    try {
      const res = await fetch(`/api/ausencias/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado, comentarioAdmin }),
      });
      if (!res.ok) throw new Error();
      toast({
        title: estado === "APROBADA" ? "Ausencia aprobada" : "Ausencia rechazada",
        variant: estado === "APROBADA" ? "default" : "destructive",
      });
      setRechazarId(null);
      setComentario("");
      fetchAusencias();
    } catch {
      toast({ title: "Error al procesar", variant: "destructive" });
    } finally {
      setProcesando(null);
    }
  };

  const editDiasCalc =
    editForm.fechaInicio && editForm.fechaFin
      ? Math.max(0, differenceInCalendarDays(parseISO(editForm.fechaFin), parseISO(editForm.fechaInicio)) + 1)
      : 0;

  const handleEditar = (a: Ausencia) => {
    setEditId(a.id);
    setEditForm({
      tipoAusenciaId: a.tipoAusencia.id,
      fechaInicio: a.fechaInicio.slice(0, 10),
      fechaFin: a.fechaFin.slice(0, 10),
      motivo: a.motivo ?? "",
    });
  };

  const handleGuardarEdicion = async () => {
    if (!editId) return;
    if (!editForm.tipoAusenciaId || !editForm.fechaInicio || !editForm.fechaFin) {
      toast({ title: "Completa todos los campos", variant: "destructive" });
      return;
    }
    setEditSubmitting(true);
    try {
      const res = await fetch(`/api/ausencias/${editId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Error al guardar los cambios");
      }
      toast({ title: "Ausencia actualizada" });
      setEditId(null);
      fetchAusencias();
    } catch (e) {
      toast({ title: "Error", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally {
      setEditSubmitting(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-dark)]">Ausencias — Todas las sedes</h1>
          <p className="text-[var(--text-muted)] text-sm mt-1">Gestiona las solicitudes de ausencia de todos los empleados</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/configuracion?tab=ausencias">
            <Button variant="outline">
              <Settings className="h-4 w-4 mr-2" /> Tipos de ausencia
            </Button>
          </Link>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" /> Nueva ausencia
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        {vista === "lista" ? (
          <div className="flex gap-1 bg-[var(--muted)] p-1 rounded-xl w-fit flex-wrap">
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  "px-4 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5",
                  tab === t ? "bg-[var(--card)] text-[var(--text-dark)] shadow-sm" : "text-[var(--text-muted)] hover:text-[var(--text-body)]"
                )}
              >
                {t === "PENDIENTE" ? "Pendientes" : t === "APROBADA" ? "Aprobadas" : t === "RECHAZADA" ? "Rechazadas" : "Todas"}
                {t === "PENDIENTE" && pendientesCount > 0 && (
                  <span className="bg-[var(--warning)] text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                    {pendientesCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        ) : <div />}
        <div className="flex gap-1 bg-[var(--muted)] p-1 rounded-xl">
          <button
            onClick={() => setVista("lista")}
            className={cn(
              "px-3 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5",
              vista === "lista" ? "bg-[var(--card)] text-[var(--text-dark)] shadow-sm" : "text-[var(--text-muted)] hover:text-[var(--text-body)]"
            )}
          >
            <List className="h-4 w-4" /> Lista
          </button>
          <button
            onClick={() => setVista("calendario")}
            className={cn(
              "px-3 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5",
              vista === "calendario" ? "bg-[var(--card)] text-[var(--text-dark)] shadow-sm" : "text-[var(--text-muted)] hover:text-[var(--text-body)]"
            )}
          >
            <CalendarDays className="h-4 w-4" /> Calendario
          </button>
        </div>
      </div>

      {vista === "calendario" ? (
        <CalendarioAusencias
          ausencias={ausencias}
          festivos={festivos}
          empleados={empleados}
          editable
          onChange={fetchFestivos}
        />
      ) : loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 bg-[var(--muted)] rounded-xl animate-pulse" />
          ))}
        </div>
      ) : filtradas.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Calendar className="h-10 w-10 text-[var(--text-muted)] mx-auto mb-3" />
            <p className="text-[var(--text-muted)]">No hay ausencias en esta categoría</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtradas.map((a) => (
            <Card key={a.id} className={cn(a.estado === "PENDIENTE" && "border-[var(--warning-bg)]")}>
              <CardContent className="py-4">
                <div className="flex items-start gap-4">
                  <div className="w-1 h-16 rounded-full flex-shrink-0" style={{ backgroundColor: a.tipoAusencia.color }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div>
                        <p className="font-semibold text-[var(--text-dark)]">
                          {a.user.nombre} {a.user.apellidos}
                        </p>
                        <p className="text-sm text-[var(--text-muted)] mt-0.5">{a.tipoAusencia.nombre}</p>
                      </div>
                      <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium", ESTADO[a.estado].color)}>
                        {ESTADO[a.estado].label}
                      </span>
                    </div>
                    <p className="text-sm text-[var(--text-body)] mt-1">
                      {formatFecha(a.fechaInicio)} — {formatFecha(a.fechaFin)}
                      <span className="text-[var(--text-muted)] ml-2">({a.dias} días)</span>
                    </p>
                    {a.motivo && <p className="text-xs text-[var(--text-muted)] mt-1">{a.motivo}</p>}
                    {a.comentarioAdmin && (
                      <p className="text-xs text-[var(--danger)] mt-1 flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" />{a.comentarioAdmin}
                      </p>
                    )}
                  </div>
                  {a.estado !== "CANCELADA" && (
                    <div className="flex gap-2 flex-shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={procesando === a.id}
                        onClick={() => handleEditar(a)}
                      >
                        <Pencil className="h-4 w-4 mr-1" /> Editar
                      </Button>
                      {a.estado !== "APROBADA" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-green-300 text-[var(--success-text)] hover:bg-[var(--success-bg)]"
                          disabled={procesando === a.id}
                          onClick={() => handleAccion(a.id, "APROBADA")}
                        >
                          <CheckCircle className="h-4 w-4 mr-1" /> Aprobar
                        </Button>
                      )}
                      {a.estado !== "RECHAZADA" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-red-300 text-[var(--danger-text)] hover:bg-[var(--danger-bg)]"
                          disabled={procesando === a.id}
                          onClick={() => setRechazarId(a.id)}
                        >
                          <XCircle className="h-4 w-4 mr-1" /> Rechazar
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nueva ausencia</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Empleado</Label>
              <EmpleadoCombobox
                empleados={empleados}
                value={form.userId}
                onChange={(v) => setForm((f) => ({ ...f, userId: v }))}
              />
            </div>
            <div>
              <Label>Tipo de ausencia</Label>
              <Select value={form.tipoAusenciaId} onValueChange={(v) => setForm((f) => ({ ...f, tipoAusenciaId: v }))}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Selecciona tipo..." />
                </SelectTrigger>
                <SelectContent>
                  {tipos.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      <span className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: t.color }} />
                        {t.nombre}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Fecha inicio</Label>
                <Input
                  type="date"
                  className="mt-1"
                  value={form.fechaInicio}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      fechaInicio: e.target.value,
                      // Por defecto una ausencia es de 1 día: al elegir el inicio,
                      // igualamos el fin si está vacío o quedó antes del inicio.
                      fechaFin:
                        !f.fechaFin || f.fechaFin < e.target.value
                          ? e.target.value
                          : f.fechaFin,
                    }))
                  }
                />
              </div>
              <div>
                <Label>Fecha fin</Label>
                <Input
                  type="date"
                  className="mt-1"
                  value={form.fechaFin}
                  min={form.fechaInicio || undefined}
                  onChange={(e) => setForm((f) => ({ ...f, fechaFin: e.target.value }))}
                />
              </div>
            </div>
            {diasCalc > 0 && (
              <p className="text-sm text-[var(--primary)] font-medium">
                Total: {diasCalc} {diasCalc === 1 ? "día" : "días"}
              </p>
            )}
            <div>
              <Label>Motivo (opcional)</Label>
              <textarea
                className="mt-1 w-full rounded-lg border border-[var(--border)] p-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                rows={3}
                placeholder="Describe el motivo de la ausencia..."
                value={form.motivo}
                onChange={(e) => setForm((f) => ({ ...f, motivo: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleCrear} disabled={submitting}>
              {submitting ? "Creando..." : "Crear ausencia"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rechazarId} onOpenChange={() => setRechazarId(null)}>
        <DialogContent className="max-w-[95vw] sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rechazar ausencia</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Label>Motivo del rechazo (opcional)</Label>
            <textarea
              className="mt-1 w-full rounded-lg border border-[var(--border)] p-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
              rows={3}
              placeholder="Indica el motivo del rechazo..."
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRechazarId(null)}>Cancelar</Button>
            <Button
              variant="destructive"
              disabled={!!procesando}
              onClick={() => rechazarId && handleAccion(rechazarId, "RECHAZADA", comentario)}
            >
              Confirmar rechazo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editId} onOpenChange={(o) => !o && setEditId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editar ausencia</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Tipo de ausencia</Label>
              <Select value={editForm.tipoAusenciaId} onValueChange={(v) => setEditForm((f) => ({ ...f, tipoAusenciaId: v }))}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Selecciona tipo..." />
                </SelectTrigger>
                <SelectContent>
                  {tipos.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      <span className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: t.color }} />
                        {t.nombre}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Fecha inicio</Label>
                <Input
                  type="date"
                  className="mt-1"
                  value={editForm.fechaInicio}
                  onChange={(e) =>
                    setEditForm((f) => ({
                      ...f,
                      fechaInicio: e.target.value,
                      fechaFin:
                        !f.fechaFin || f.fechaFin < e.target.value
                          ? e.target.value
                          : f.fechaFin,
                    }))
                  }
                />
              </div>
              <div>
                <Label>Fecha fin</Label>
                <Input
                  type="date"
                  className="mt-1"
                  value={editForm.fechaFin}
                  min={editForm.fechaInicio || undefined}
                  onChange={(e) => setEditForm((f) => ({ ...f, fechaFin: e.target.value }))}
                />
              </div>
            </div>
            {editDiasCalc > 0 && (
              <p className="text-sm text-[var(--primary)] font-medium">
                Total: {editDiasCalc} {editDiasCalc === 1 ? "día" : "días"}
              </p>
            )}
            <div>
              <Label>Motivo (opcional)</Label>
              <textarea
                className="mt-1 w-full rounded-lg border border-[var(--border)] p-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                rows={3}
                placeholder="Describe el motivo de la ausencia..."
                value={editForm.motivo}
                onChange={(e) => setEditForm((f) => ({ ...f, motivo: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditId(null)}>Cancelar</Button>
            <Button onClick={handleGuardarEdicion} disabled={editSubmitting}>
              {editSubmitting ? "Guardando..." : "Guardar cambios"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

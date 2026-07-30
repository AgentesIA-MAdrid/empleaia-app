"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Target, Plus, Trash2, CheckCircle2, XCircle, Loader2, TrendingUp } from "lucide-react";
import { useFeatures } from "@/lib/hooks/use-features";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { EmployeeAvatar } from "@/components/ui/employee-avatar";

interface Empleado { id: string; nombre: string; apellidos: string; foto: string | null; }
interface Objetivo {
  id: string;
  titulo: string;
  descripcion: string | null;
  asignadoAId: string | null;
  asignadoA: { id: string; nombre: string; apellidos: string; foto: string | null } | null;
  periodo: string;
  estado: "activo" | "completado" | "cancelado";
  progreso: number;
  creadoPor: { id: string; nombre: string; apellidos: string };
  fechaCierre: string | null;
  createdAt: string;
}

const ESTADO_LABEL: Record<Objetivo["estado"], string> = {
  activo: "Activo",
  completado: "Completado",
  cancelado: "Cancelado",
};
const ESTADO_CLS: Record<Objetivo["estado"], string> = {
  activo: "bg-sky-50 text-sky-700",
  completado: "bg-emerald-50 text-emerald-700",
  cancelado: "bg-slate-100 text-slate-500",
};

export default function ObjetivosPage() {
  const { toast } = useToast();
  // Esta pantalla son objetivos de avance manual. Quien busca "cuántas altas
  // lleva cada comercial" quiere la otra, y llegaba aquí por el nombre; el
  // aviso solo se pinta si el módulo de ventas está contratado, igual que el
  // menú, para no ofrecer lo que no se puede abrir.
  const { data: features } = useFeatures();
  const tieneVentas = features?.booleans?.cierre_turno === true;
  const [objetivos, setObjetivos] = useState<Objetivo[]>([]);
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  // form state
  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [asignadoAId, setAsignadoAId] = useState<string>("empresa");
  const [periodo, setPeriodo] = useState("");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [resObj, resEmp] = await Promise.all([
        fetch("/api/objetivos"),
        fetch("/api/empleados"),
      ]);
      if (resObj.status === 402) {
        toast({ title: "Función no disponible en tu plan", description: "Los OKRs requieren plan Pro o superior.", variant: "destructive" });
        return;
      }
      const dataObj = await resObj.json();
      const dataEmp = await resEmp.json();
      setObjetivos(dataObj.objetivos ?? []);
      const empList: Empleado[] = (dataEmp.empleados || dataEmp || []).map((e: Record<string, unknown>) => ({
        id: String(e.id),
        nombre: String(e.nombre ?? ""),
        apellidos: String(e.apellidos ?? ""),
        foto: (e.foto as string | null) ?? null,
      }));
      setEmpleados(empList);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleCreate = async () => {
    if (!titulo.trim() || !periodo.trim()) {
      toast({ title: "Faltan datos", description: "Título y período son obligatorios.", variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/objetivos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titulo: titulo.trim(),
          descripcion: descripcion.trim() || null,
          asignadoAId: asignadoAId === "empresa" ? null : asignadoAId,
          periodo: periodo.trim(),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast({ title: "No se pudo crear", description: body?.error ?? "Error", variant: "destructive" });
        return;
      }
      toast({ title: "Objetivo creado" });
      setTitulo(""); setDescripcion(""); setAsignadoAId("empresa"); setPeriodo("");
      setDialogOpen(false);
      await fetchAll();
    } finally {
      setCreating(false);
    }
  };

  const updateProgreso = async (id: string, progreso: number) => {
    const res = await fetch(`/api/objetivos/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ progreso }),
    });
    if (res.ok) {
      const data = await res.json();
      setObjetivos((prev) => prev.map((o) => (o.id === id ? data.objetivo : o)));
    }
  };

  const updateEstado = async (id: string, estado: Objetivo["estado"]) => {
    const res = await fetch(`/api/objetivos/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estado }),
    });
    if (res.ok) {
      const data = await res.json();
      setObjetivos((prev) => prev.map((o) => (o.id === id ? data.objetivo : o)));
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("¿Borrar este objetivo?")) return;
    const res = await fetch(`/api/objetivos/${id}`, { method: "DELETE" });
    if (res.ok) {
      setObjetivos((prev) => prev.filter((o) => o.id !== id));
      toast({ title: "Objetivo borrado" });
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center">
            <Target className="h-5 w-5 text-[var(--primary)]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Objetivos (OKRs)</h1>
            <p className="text-slate-500 text-sm mt-0.5">Define y sigue los objetivos del equipo y la empresa</p>
          </div>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" /> Nuevo objetivo
        </Button>
      </div>

      {tieneVentas && (
        <Card className="border-[var(--primary)]/20 bg-[var(--primary)]/5">
          <CardContent className="py-4 flex items-start gap-3">
            <TrendingUp className="h-5 w-5 text-[var(--primary)] shrink-0 mt-0.5" />
            <div className="text-sm text-slate-700">
              <p>
                ¿Buscas los objetivos de venta por producto (pospago, fibra, renove…)? Se fijan
                por comercial y por punto de venta en{" "}
                <Link href="/admin/objetivos-venta" className="font-semibold text-[var(--primary)] underline">
                  Objetivos de venta
                </Link>
                , y se comparan solos con lo que el equipo registra al cerrar el turno.
              </p>
              <p className="text-slate-500 mt-1">
                Los productos sobre los que fijar objetivo se definen en Configuración →
                Catálogo de ventas.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      ) : objetivos.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Target className="h-10 w-10 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 text-sm">Aún no hay objetivos. Crea el primero.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {objetivos.map((o) => (
            <Card key={o.id} className="flex flex-col">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-base leading-snug">{o.titulo}</CardTitle>
                    <p className="text-xs text-slate-500 mt-1">{o.periodo}</p>
                  </div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-md ${ESTADO_CLS[o.estado]}`}>
                    {ESTADO_LABEL[o.estado]}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col gap-3">
                {o.descripcion && (
                  <p className="text-sm text-slate-600 line-clamp-3">{o.descripcion}</p>
                )}

                <div className="flex items-center gap-2 text-xs text-slate-500">
                  {o.asignadoA ? (
                    <>
                      <EmployeeAvatar nombre={o.asignadoA.nombre} apellidos={o.asignadoA.apellidos} seed={o.asignadoA.id} size="sm" />
                      <span>{o.asignadoA.nombre} {o.asignadoA.apellidos}</span>
                    </>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-violet-50 text-violet-700">
                      Empresa
                    </span>
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                    <span>Progreso</span>
                    <span className="font-semibold text-slate-900 tabular-nums">{o.progreso}%</span>
                  </div>
                  <ProgressBar value={o.progreso} className="w-full" />
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={o.progreso}
                    onChange={(e) => updateProgreso(o.id, Number(e.target.value))}
                    className="w-full mt-2"
                    disabled={o.estado !== "activo"}
                  />
                </div>

                <div className="flex items-center gap-1 mt-auto pt-2 border-t border-slate-100">
                  {o.estado === "activo" && (
                    <>
                      <Button size="sm" variant="ghost" className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50" onClick={() => updateEstado(o.id, "completado")}>
                        <CheckCircle2 className="h-4 w-4 mr-1" /> Completar
                      </Button>
                      <Button size="sm" variant="ghost" className="text-slate-500" onClick={() => updateEstado(o.id, "cancelado")}>
                        <XCircle className="h-4 w-4 mr-1" /> Cancelar
                      </Button>
                    </>
                  )}
                  {o.estado !== "activo" && (
                    <Button size="sm" variant="ghost" className="text-slate-500" onClick={() => updateEstado(o.id, "activo")}>
                      Reabrir
                    </Button>
                  )}
                  <div className="flex-1" />
                  <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => handleDelete(o.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo objetivo</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Título</Label>
              <Input className="mt-1" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Aumentar conversión un 20%" />
            </div>
            <div>
              <Label>Descripción (opcional)</Label>
              <textarea
                className="mt-1 w-full min-h-[80px] rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
                rows={3}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Período</Label>
                <Input className="mt-1" value={periodo} onChange={(e) => setPeriodo(e.target.value)} placeholder="2026-Q1" />
              </div>
              <div>
                <Label>Asignado a</Label>
                <Select value={asignadoAId} onValueChange={setAsignadoAId}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="empresa">Empresa (todos)</SelectItem>
                    {empleados.map((e) => (
                      <SelectItem key={e.id} value={e.id}>{e.nombre} {e.apellidos}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Crear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

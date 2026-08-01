"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Star, Plus, Lock, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { EmployeeAvatar } from "@/components/ui/employee-avatar";

type Tipo = "escala_1_5" | "texto";
interface Pregunta { idx: number; texto: string; tipo: Tipo; }
interface Persona { id: string; nombre: string; apellidos: string; foto?: string | null; }
interface Evaluacion {
  id: string; ciclo: string; estado: "pendiente" | "completada";
  evaluadoA: Persona; evaluador: Persona;
  preguntas: Pregunta[]; respuestas: unknown; createdAt: string; completadaAt: string | null;
}

const PLANTILLA_DEFAULT: Pregunta[] = [
  { idx: 0, texto: "¿Cumple los objetivos asignados?", tipo: "escala_1_5" },
  { idx: 1, texto: "¿Demuestra iniciativa?", tipo: "escala_1_5" },
  { idx: 2, texto: "¿Cómo es su trabajo en equipo?", tipo: "escala_1_5" },
  { idx: 3, texto: "Comentarios y áreas de mejora", tipo: "texto" },
];

export default function AdminEvaluacionesPage() {
  const { toast } = useToast();
  const [evals, setEvals] = useState<Evaluacion[]>([]);
  const [empleados, setEmpleados] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [ciclo, setCiclo] = useState("2026-H1");
  const [evaluadoAId, setEvaluadoAId] = useState("");
  const [evaluadorId, setEvaluadorId] = useState("");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [rEv, rEmp] = await Promise.all([fetch("/api/evaluaciones"), fetch("/api/empleados")]);
      if (rEv.status === 402) { setUnavailable(true); return; }
      const dEv = await rEv.json();
      const dEmp = await rEmp.json();
      setEvals(dEv.evaluaciones ?? []);
      setEmpleados((dEmp.empleados ?? dEmp ?? []).map((e: Record<string, unknown>) => ({
        id: String(e.id), nombre: String(e.nombre ?? ""), apellidos: String(e.apellidos ?? ""),
      })));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleCreate = async () => {
    if (!ciclo || !evaluadoAId || !evaluadorId) {
      toast({ title: "Faltan datos", variant: "destructive" }); return;
    }
    if (evaluadoAId === evaluadorId) {
      toast({ title: "Evaluado y evaluador no pueden ser la misma persona", variant: "destructive" }); return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/evaluaciones", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ciclo, evaluadoAId, evaluadorId, preguntas: PLANTILLA_DEFAULT }),
      });
      if (!res.ok) {
        toast({ title: "Error", variant: "destructive" }); return;
      }
      toast({ title: "Evaluación creada" });
      setOpen(false); setEvaluadoAId(""); setEvaluadorId("");
      await fetchAll();
    } finally { setCreating(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("¿Borrar evaluación?")) return;
    const r = await fetch(`/api/evaluaciones/${id}`, { method: "DELETE" });
    if (r.ok) setEvals((prev) => prev.filter((e) => e.id !== id));
  };

  if (unavailable) {
    return (
      <div className="p-6">
        <Card className="border-[var(--warning-bg)] bg-[var(--warning-bg)]">
          <CardContent className="pt-4 pb-4 flex items-start gap-3">
            <Lock className="h-5 w-5 text-[var(--warning-text)] shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-[var(--warning-text)]">Evaluaciones — plan Pro o superior</p>
              <p className="text-sm text-[var(--warning-text)] mt-0.5">Ciclos de evaluación 360 con feedback estructurado.</p>
            </div>
            <Link href="/admin/planes"><Button size="sm">Ver planes</Button></Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center"><Star className="h-5 w-5 text-[var(--primary)]" /></div>
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-dark)]">Evaluaciones de desempeño</h1>
            <p className="text-[var(--text-muted)] text-sm mt-0.5">Ciclos de evaluación entre manager y empleado</p>
          </div>
        </div>
        <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1.5" /> Nueva evaluación</Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-[var(--text-muted)]" /></div>
      ) : evals.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-[var(--text-muted)] text-sm">Aún no hay evaluaciones.</CardContent></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {evals.map((ev) => (
            <Card key={ev.id} className="flex flex-col">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{ev.ciclo}</CardTitle>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-md ${ev.estado === "completada" ? "bg-[var(--success-bg)] text-[var(--success-text)]" : "bg-[var(--warning-bg)] text-[var(--warning-text)]"}`}>{ev.estado}</span>
                </div>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col gap-2 text-sm">
                <div className="flex items-center gap-2 text-[var(--text-body)]">
                  <EmployeeAvatar nombre={ev.evaluadoA.nombre} apellidos={ev.evaluadoA.apellidos} seed={ev.evaluadoA.id} size="sm" />
                  <span><strong>Evaluado:</strong> {ev.evaluadoA.nombre} {ev.evaluadoA.apellidos}</span>
                </div>
                <div className="text-xs text-[var(--text-muted)]">
                  Evaluador: {ev.evaluador.nombre} {ev.evaluador.apellidos}
                </div>
                <div className="flex items-center gap-1 mt-auto pt-2 border-t border-[var(--border)]">
                  <Link href={`/admin/evaluaciones/${ev.id}`}><Button size="sm" variant="ghost">Abrir</Button></Link>
                  <div className="flex-1" />
                  <Button size="sm" variant="ghost" className="text-[var(--danger)]" onClick={() => handleDelete(ev.id)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nueva evaluación</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>Ciclo</Label><Input className="mt-1" value={ciclo} onChange={(e) => setCiclo(e.target.value)} placeholder="2026-H1" /></div>
            <div>
              <Label>Evaluado</Label>
              <Select value={evaluadoAId} onValueChange={setEvaluadoAId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Selecciona empleado" /></SelectTrigger>
                <SelectContent>{empleados.map((e) => (<SelectItem key={e.id} value={e.id}>{e.nombre} {e.apellidos}</SelectItem>))}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Evaluador</Label>
              <Select value={evaluadorId} onValueChange={setEvaluadorId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Selecciona evaluador" /></SelectTrigger>
                <SelectContent>{empleados.map((e) => (<SelectItem key={e.id} value={e.id}>{e.nombre} {e.apellidos}</SelectItem>))}</SelectContent>
              </Select>
            </div>
            <p className="text-xs text-[var(--text-muted)]">Se usa la plantilla por defecto (3 preguntas escala 1-5 + comentarios). El evaluador completará la evaluación desde su perfil.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={creating}>{creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Crear</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

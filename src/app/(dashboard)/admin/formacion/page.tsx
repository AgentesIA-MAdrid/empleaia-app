"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { GraduationCap, Plus, Lock, Loader2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

interface Persona { id: string; nombre: string; apellidos: string; }
interface Curso {
  id: string; titulo: string; descripcion: string | null;
  contenidoUrl: string | null; duracionMin: number;
  creadoPor: Persona; _count: { asignaciones: number }; createdAt: string;
}

export default function FormacionPage() {
  const { toast } = useToast();
  const [cursos, setCursos] = useState<Curso[]>([]);
  const [empleados, setEmpleados] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [contenidoUrl, setContenidoUrl] = useState("");
  const [duracion, setDuracion] = useState("60");
  const [asignados, setAsignados] = useState<string[]>([]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [rC, rE] = await Promise.all([fetch("/api/formacion"), fetch("/api/empleados")]);
      if (rC.status === 402) { setUnavailable(true); return; }
      const dC = await rC.json();
      const dE = await rE.json();
      setCursos(dC.cursos ?? []);
      setEmpleados((dE.empleados ?? dE ?? []).map((e: Record<string, unknown>) => ({
        id: String(e.id), nombre: String(e.nombre ?? ""), apellidos: String(e.apellidos ?? ""),
      })));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const toggleAsignado = (id: string) =>
    setAsignados((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const handleCreate = async () => {
    if (!titulo) { toast({ title: "Falta título", variant: "destructive" }); return; }
    setCreating(true);
    try {
      const r = await fetch("/api/formacion", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titulo, descripcion: descripcion || null,
          contenidoUrl: contenidoUrl || null,
          duracionMin: parseInt(duracion, 10) || 60,
          asignadosA: asignados,
        }),
      });
      if (!r.ok) { toast({ title: "Error", variant: "destructive" }); return; }
      toast({ title: "Curso creado" });
      setOpen(false); setTitulo(""); setDescripcion(""); setContenidoUrl(""); setAsignados([]);
      await fetchAll();
    } finally { setCreating(false); }
  };

  if (unavailable) {
    return (
      <div className="p-6">
        <Card className="border-[var(--warning-bg)] bg-[var(--warning-bg)]">
          <CardContent className="pt-4 pb-4 flex items-start gap-3">
            <Lock className="h-5 w-5 text-[var(--warning-text)] shrink-0 mt-0.5" />
            <div className="flex-1"><p className="text-sm font-semibold text-[var(--warning-text)]">Formación — plan Pro o superior</p></div>
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
          <div className="h-10 w-10 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center"><GraduationCap className="h-5 w-5 text-[var(--primary)]" /></div>
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-dark)]">Formación</h1>
            <p className="text-[var(--text-muted)] text-sm mt-0.5">Asigna cursos al equipo y mide el progreso</p>
          </div>
        </div>
        <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1.5" /> Nuevo curso</Button>
      </div>

      {loading ? <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-[var(--text-muted)]" /></div> :
        cursos.length === 0 ? <Card><CardContent className="py-12 text-center text-[var(--text-muted)] text-sm">Sin cursos.</CardContent></Card> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cursos.map((c) => (
            <Card key={c.id}>
              <CardHeader className="pb-2"><CardTitle className="text-base">{c.titulo}</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {c.descripcion && <p className="text-sm text-[var(--text-body)] line-clamp-3">{c.descripcion}</p>}
                <p className="text-xs text-[var(--text-muted)]">{c.duracionMin} min · {c._count.asignaciones} asignados</p>
                {c.contenidoUrl && (
                  <a href={c.contenidoUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-[var(--primary)] hover:underline">
                    Abrir contenido <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Nuevo curso</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2 max-h-[60vh] overflow-y-auto pr-1">
            <div><Label>Título</Label><Input className="mt-1" value={titulo} onChange={(e) => setTitulo(e.target.value)} /></div>
            <div><Label>Descripción</Label><textarea className="mt-1 w-full min-h-[80px] rounded-md border border-[var(--border)] px-3 py-2 text-sm" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>URL contenido</Label><Input className="mt-1" value={contenidoUrl} onChange={(e) => setContenidoUrl(e.target.value)} placeholder="https://..." /></div>
              <div><Label>Duración (min)</Label><Input className="mt-1" type="number" value={duracion} onChange={(e) => setDuracion(e.target.value)} /></div>
            </div>
            <div>
              <Label>Asignar a empleados</Label>
              <div className="mt-1 max-h-48 overflow-y-auto rounded-md border border-[var(--border)] p-2 space-y-1">
                {empleados.map((e) => (
                  <label key={e.id} className="flex items-center gap-2 px-2 py-1 hover:bg-[var(--muted)] rounded cursor-pointer">
                    <input type="checkbox" checked={asignados.includes(e.id)} onChange={() => toggleAsignado(e.id)} />
                    <span className="text-sm">{e.nombre} {e.apellidos}</span>
                  </label>
                ))}
              </div>
            </div>
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

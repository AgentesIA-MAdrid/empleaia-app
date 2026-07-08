"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, FolderOpen, Folder, Trash2, FileText, Download, ArrowLeft, Settings2, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface Documento {
  id: string;
  nombre: string;
  descripcion?: string;
  url?: string;
  tipo: string;
  user?: { nombre: string; apellidos: string };
  subidoPor: { nombre: string; apellidos: string };
  createdAt: string;
}

interface Empleado { id: string; nombre: string; apellidos: string; }
interface TipoDoc { id: string; nombre: string; slug: string; orden: number; }

// Radix Select prohíbe SelectItem con value="" (lanza en runtime). Usamos un
// centinela para la opción "Documento general" y lo traducimos a "" (→ null).
const GENERAL = "__general__";

export default function AdminDocumentosPage() {
  const { toast } = useToast();
  const [documentos, setDocumentos] = useState<Documento[]>([]);
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [tipos, setTipos] = useState<TipoDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [carpeta, setCarpeta] = useState<string | null>(null); // slug de la carpeta abierta
  const [dialogOpen, setDialogOpen] = useState(false);
  const [gestionOpen, setGestionOpen] = useState(false);
  const [form, setForm] = useState({ nombre: "", descripcion: "", url: "", tipo: "", userId: "" });
  const [saving, setSaving] = useState(false);
  const [nuevoTipo, setNuevoTipo] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [docsRes, empRes, tiposRes] = await Promise.all([
        fetch("/api/documentos"),
        fetch("/api/empleados"),
        fetch("/api/documentos/tipos"),
      ]);
      const [docsData, empData, tiposData] = await Promise.all([
        docsRes.json(), empRes.json(), tiposRes.json(),
      ]);
      setDocumentos(docsData.documentos || []);
      setEmpleados(empData.empleados || []);
      setTipos(tiposData.tipos || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Carpetas = catálogo de tipos + tipos "huérfanos" presentes en documentos.
  const slugSet = new Set(tipos.map((t) => t.slug));
  const huérfanos = [...new Set(documentos.map((d) => d.tipo).filter(Boolean))].filter((s) => !slugSet.has(s));
  const carpetas = [
    ...tipos.map((t) => ({ slug: t.slug, nombre: t.nombre, gestionable: true })),
    ...huérfanos.map((s) => ({ slug: s, nombre: s, gestionable: false })),
  ].map((c) => ({ ...c, count: documentos.filter((d) => d.tipo === c.slug).length }));

  const nombreCarpeta = (slug: string) => carpetas.find((c) => c.slug === slug)?.nombre ?? slug;

  const handleCreate = async () => {
    if (!form.nombre) { toast({ title: "El nombre es obligatorio", variant: "destructive" }); return; }
    const tipo = form.tipo || carpeta || tipos[0]?.slug || "otro";
    setSaving(true);
    try {
      const res = await fetch("/api/documentos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, tipo, userId: form.userId || null }),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Documento añadido", variant: "success" });
      setDialogOpen(false);
      setForm({ nombre: "", descripcion: "", url: "", tipo: "", userId: "" });
      fetchData();
    } catch {
      toast({ title: "Error al guardar", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/documentos/${id}`, { method: "DELETE" });
      toast({ title: "Documento eliminado", variant: "success" });
      fetchData();
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  };

  const crearTipo = async () => {
    const nombre = nuevoTipo.trim();
    if (nombre.length < 2) return;
    try {
      const res = await fetch("/api/documentos/tipos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error);
      }
      setNuevoTipo("");
      toast({ title: "Tipo creado", variant: "success" });
      fetchData();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Error al crear", variant: "destructive" });
    }
  };

  const renombrarTipo = async (id: string, actual: string) => {
    const nombre = window.prompt("Nuevo nombre del tipo:", actual)?.trim();
    if (!nombre || nombre === actual) return;
    try {
      const res = await fetch(`/api/documentos/tipos/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre }),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Tipo renombrado", variant: "success" });
      fetchData();
    } catch {
      toast({ title: "Error al renombrar", variant: "destructive" });
    }
  };

  const borrarTipo = async (id: string) => {
    try {
      const res = await fetch(`/api/documentos/tipos/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast({ title: "Tipo eliminado", variant: "success" });
      fetchData();
    } catch {
      toast({ title: "Error al eliminar", variant: "destructive" });
    }
  };

  const docsCarpeta = carpeta ? documentos.filter((d) => d.tipo === carpeta) : [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Archivos</h1>
          <p className="text-slate-500 text-sm mt-1">{documentos.length} documentos en {carpetas.length} carpetas</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setGestionOpen(true)}>
            <Settings2 className="h-4 w-4 mr-2" /> Gestionar tipos
          </Button>
          <Button onClick={() => { setForm((f) => ({ ...f, tipo: carpeta ?? "" })); setDialogOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" /> Añadir documento
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-44 bg-slate-100 rounded-2xl animate-pulse" />)}
        </div>
      ) : carpeta === null ? (
        // ─── Vista de carpetas ───
        carpetas.length === 0 ? (
          <Card><CardContent className="py-12 text-center">
            <FolderOpen className="h-10 w-10 text-slate-200 mx-auto mb-3" />
            <p className="text-slate-400">No hay tipos de carpeta. Crea uno en “Gestionar tipos”.</p>
          </CardContent></Card>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {carpetas.map((c) => (
              <button
                key={c.slug}
                onClick={() => setCarpeta(c.slug)}
                className="group rounded-2xl border border-slate-200 bg-white p-6 text-center transition-all hover:border-[var(--primary)] hover:shadow-md"
              >
                <div className="mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-full bg-[var(--primary-light)]">
                  <Folder className="h-10 w-10 text-[var(--primary)]" />
                </div>
                <p className="font-semibold text-slate-900">{c.nombre}</p>
                <p className="text-sm text-slate-400">{c.count} {c.count === 1 ? "elemento" : "elementos"}</p>
              </button>
            ))}
          </div>
        )
      ) : (
        // ─── Vista de una carpeta ───
        <div className="space-y-3">
          <button onClick={() => setCarpeta(null)} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-[var(--primary)]">
            <ArrowLeft className="h-4 w-4" /> Todas las carpetas
          </button>
          <h2 className="text-lg font-semibold text-slate-800">{nombreCarpeta(carpeta)}</h2>
          {docsCarpeta.length === 0 ? (
            <Card><CardContent className="py-12 text-center">
              <FolderOpen className="h-10 w-10 text-slate-200 mx-auto mb-3" />
              <p className="text-slate-400">Esta carpeta está vacía</p>
            </CardContent></Card>
          ) : (
            <div className="space-y-2">
              {docsCarpeta.map((doc) => (
                <div key={doc.id} className="flex items-center gap-4 p-4 bg-white rounded-xl border hover:shadow-sm transition-all">
                  <div className="w-10 h-10 bg-[var(--primary-light)] rounded-lg flex items-center justify-center shrink-0">
                    <FileText className="h-5 w-5 text-[var(--primary)]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-900 truncate">{doc.nombre}</p>
                    {doc.descripcion && <p className="text-sm text-slate-500 truncate">{doc.descripcion}</p>}
                    <p className="text-xs text-slate-400 mt-0.5">
                      {doc.user ? `${doc.user.nombre} ${doc.user.apellidos} · ` : "General · "}
                      {format(new Date(doc.createdAt), "d MMM yyyy", { locale: es })}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {doc.url && (
                      <a href={doc.url} target="_blank" rel="noopener noreferrer" className="p-2 text-slate-400 hover:text-[var(--primary)] transition-colors">
                        <Download className="h-4 w-4" />
                      </a>
                    )}
                    <button className="p-2 text-slate-400 hover:text-red-500 transition-colors" onClick={() => handleDelete(doc.id)}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Añadir documento */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-md">
          <DialogHeader><DialogTitle>Añadir documento</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Nombre *</Label>
              <Input className="mt-1" value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} placeholder="Contrato indefinido 2024" />
            </div>
            <div>
              <Label>Carpeta / tipo</Label>
              <Select value={form.tipo || tipos[0]?.slug || ""} onValueChange={(v) => setForm((f) => ({ ...f, tipo: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Selecciona…" /></SelectTrigger>
                <SelectContent>
                  {tipos.map((t) => <SelectItem key={t.slug} value={t.slug}>{t.nombre}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Empleado (opcional)</Label>
              <Select value={form.userId || GENERAL} onValueChange={(v) => setForm((f) => ({ ...f, userId: v === GENERAL ? "" : v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Documento general" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={GENERAL}>Documento general</SelectItem>
                  {empleados.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.nombre} {e.apellidos}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>URL del archivo (opcional)</Label>
              <Input className="mt-1" value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} placeholder="https://..." />
            </div>
            <div>
              <Label>Descripción</Label>
              <Input className="mt-1" value={form.descripcion} onChange={(e) => setForm((f) => ({ ...f, descripcion: e.target.value }))} placeholder="Descripción breve" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={saving}>{saving ? "Guardando..." : "Añadir"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Gestionar tipos */}
      <Dialog open={gestionOpen} onOpenChange={setGestionOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-md">
          <DialogHeader><DialogTitle>Tipos de carpeta</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="flex gap-2">
              <Input
                value={nuevoTipo}
                onChange={(e) => setNuevoTipo(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") crearTipo(); }}
                placeholder="Nuevo tipo (ej. Contratos)"
              />
              <Button onClick={crearTipo} disabled={nuevoTipo.trim().length < 2}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-100">
              {tipos.length === 0 ? (
                <p className="px-3 py-3 text-sm text-slate-400">Aún no hay tipos.</p>
              ) : (
                tipos.map((t) => (
                  <div key={t.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="flex items-center gap-2">
                      <Folder className="h-4 w-4 text-[var(--primary)]" />
                      {t.nombre}
                      <span className="text-xs text-slate-400">
                        ({documentos.filter((d) => d.tipo === t.slug).length})
                      </span>
                    </span>
                    <span className="flex items-center gap-1">
                      <button onClick={() => renombrarTipo(t.id, t.nombre)} className="p-1 text-slate-400 hover:text-[var(--primary)]" title="Renombrar">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => borrarTipo(t.id)} className="p-1 text-slate-400 hover:text-red-500" title="Eliminar">
                        <X className="h-4 w-4" />
                      </button>
                    </span>
                  </div>
                ))
              )}
            </div>
            <p className="text-xs text-slate-400">
              Al eliminar un tipo, los documentos que tenía no se borran: siguen visibles en su carpeta.
            </p>
          </div>
          <DialogFooter>
            <Button onClick={() => setGestionOpen(false)}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

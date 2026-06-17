"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, FolderOpen, Trash2, FileText, Download } from "lucide-react";
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

interface Empleado {
  id: string;
  nombre: string;
  apellidos: string;
}

const TIPOS = ["contrato", "nomina", "certificado", "formacion", "otro"];
const TIPO_COLOR: Record<string, string> = {
  contrato: "bg-sky-100 text-sky-700",
  nomina: "bg-emerald-100 text-emerald-700",
  certificado: "bg-purple-100 text-purple-700",
  formacion: "bg-amber-100 text-amber-700",
  otro: "bg-slate-100 text-slate-600",
};

export default function AdminDocumentosPage() {
  const { toast } = useToast();
  const [documentos, setDocumentos] = useState<Documento[]>([]);
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [tipoFiltro, setTipoFiltro] = useState("todos");
  const [form, setForm] = useState({ nombre: "", descripcion: "", url: "", tipo: "otro", userId: "" });
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [docsRes, empRes] = await Promise.all([
        fetch("/api/documentos"),
        fetch("/api/empleados"),
      ]);
      const [docsData, empData] = await Promise.all([docsRes.json(), empRes.json()]);
      setDocumentos(docsData.documentos || []);
      setEmpleados(empData.empleados || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleCreate = async () => {
    if (!form.nombre) { toast({ title: "El nombre es obligatorio", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/documentos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, userId: form.userId || null }),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Documento añadido" });
      setDialogOpen(false);
      setForm({ nombre: "", descripcion: "", url: "", tipo: "otro", userId: "" });
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
      toast({ title: "Documento eliminado" });
      fetchData();
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  };

  const docsFiltrados = tipoFiltro === "todos" ? documentos : documentos.filter((d) => d.tipo === tipoFiltro);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Documentos</h1>
          <p className="text-slate-500 text-sm mt-1">{documentos.length} documentos en total</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" /> Añadir documento
        </Button>
      </div>

      {/* Filtro */}
      <div className="flex gap-2 flex-wrap">
        {["todos", ...TIPOS].map((t) => (
          <button
            key={t}
            onClick={() => setTipoFiltro(t)}
            className={cn(
              "px-3 py-1.5 rounded-full text-sm font-medium border transition-all capitalize",
              tipoFiltro === t ? "bg-[var(--primary)] text-white border-[var(--primary)]" : "bg-white text-slate-600 border-slate-200 hover:border-[var(--primary)]"
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-20 bg-slate-100 rounded-xl animate-pulse" />)}
        </div>
      ) : docsFiltrados.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FolderOpen className="h-10 w-10 text-slate-200 mx-auto mb-3" />
            <p className="text-slate-400">No hay documentos</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {docsFiltrados.map((doc) => (
            <div key={doc.id} className="flex items-center gap-4 p-4 bg-white rounded-xl border hover:shadow-sm transition-all">
              <div className="w-10 h-10 bg-[var(--primary-light)] rounded-lg flex items-center justify-center shrink-0">
                <FileText className="h-5 w-5 text-[var(--primary)]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium text-slate-900 truncate">{doc.nombre}</p>
                  <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium capitalize", TIPO_COLOR[doc.tipo] ?? "bg-slate-100 text-slate-600")}>
                    {doc.tipo}
                  </span>
                </div>
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Añadir documento</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Nombre *</Label>
              <Input className="mt-1" value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} placeholder="Contrato indefinido 2024" />
            </div>
            <div>
              <Label>Tipo</Label>
              <Select value={form.tipo} onValueChange={(v) => setForm((f) => ({ ...f, tipo: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIPOS.map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Empleado (opcional)</Label>
              <Select value={form.userId} onValueChange={(v) => setForm((f) => ({ ...f, userId: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Documento general" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Documento general</SelectItem>
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
    </div>
  );
}

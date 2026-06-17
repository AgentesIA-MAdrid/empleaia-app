"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, BookOpen, Trash2, Eye, EyeOff } from "lucide-react";
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

interface Articulo {
  id: string;
  titulo: string;
  contenido: string;
  categoria: string;
  publicado: boolean;
  vistas: number;
  autor: { nombre: string; apellidos: string };
  createdAt: string;
}

const CATEGORIAS = ["general", "novedades", "recursos", "formacion", "empresa"];

export default function AdminArticulosPage() {
  const { toast } = useToast();
  const [articulos, setArticulos] = useState<Articulo[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [categoriaFiltro, setCategoriaFiltro] = useState("todas");
  const [form, setForm] = useState({ titulo: "", contenido: "", categoria: "general", publicado: false });
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/articulos?publicados=false");
      const data = await res.json();
      setArticulos(data.articulos || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleCreate = async () => {
    if (!form.titulo || !form.contenido) {
      toast({ title: "Rellena título y contenido", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/articulos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error();
      toast({ title: form.publicado ? "Artículo publicado" : "Artículo guardado como borrador" });
      setDialogOpen(false);
      setForm({ titulo: "", contenido: "", categoria: "general", publicado: false });
      fetchData();
    } catch {
      toast({ title: "Error al guardar", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const togglePublicado = async (a: Articulo) => {
    try {
      await fetch(`/api/articulos/${a.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicado: !a.publicado }),
      });
      toast({ title: a.publicado ? "Artículo despublicado" : "Artículo publicado" });
      fetchData();
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/articulos/${id}`, { method: "DELETE" });
      toast({ title: "Artículo eliminado" });
      fetchData();
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  };

  const articulosFiltrados = categoriaFiltro === "todas"
    ? articulos
    : articulos.filter((a) => a.categoria === categoriaFiltro);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Artículos</h1>
          <p className="text-slate-500 text-sm mt-1">Base de conocimiento y recursos</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" /> Nuevo artículo
        </Button>
      </div>

      {/* Filtros por categoría */}
      <div className="flex gap-2 flex-wrap">
        {["todas", ...CATEGORIAS].map((cat) => (
          <button
            key={cat}
            onClick={() => setCategoriaFiltro(cat)}
            className={cn(
              "px-3 py-1.5 rounded-full text-sm font-medium border transition-all capitalize",
              categoriaFiltro === cat
                ? "bg-[var(--primary)] text-white border-[var(--primary)]"
                : "bg-white text-slate-600 border-slate-200 hover:border-[var(--primary)]"
            )}
          >
            {cat}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-40 bg-slate-100 rounded-xl animate-pulse" />)}
        </div>
      ) : articulosFiltrados.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <BookOpen className="h-10 w-10 text-slate-200 mx-auto mb-3" />
            <p className="text-slate-400">No hay artículos en esta categoría</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {articulosFiltrados.map((a) => (
            <Card key={a.id} className={cn("transition-all hover:shadow-md", !a.publicado && "opacity-70 border-dashed")}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-xs bg-[var(--primary-light)] text-[var(--primary)] px-2 py-0.5 rounded-full font-medium capitalize">{a.categoria}</span>
                      {a.publicado
                        ? <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">Publicado</span>
                        : <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">Borrador</span>}
                    </div>
                    <h3 className="font-semibold text-slate-900 truncate">{a.titulo}</h3>
                    <p className="text-sm text-slate-500 mt-1 line-clamp-2">{a.contenido}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button className="p-1 text-slate-400 hover:text-[var(--primary)] transition-colors" onClick={() => togglePublicado(a)}>
                      {a.publicado ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                    <button className="p-1 text-slate-400 hover:text-red-500 transition-colors" onClick={() => handleDelete(a.id)}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <p className="text-xs text-slate-400">
                  {a.autor.nombre} {a.autor.apellidos} · {format(new Date(a.createdAt), "d MMM yyyy", { locale: es })}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Nuevo artículo</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Título *</Label>
              <Input className="mt-1" value={form.titulo} onChange={(e) => setForm((f) => ({ ...f, titulo: e.target.value }))} placeholder="Título del artículo" />
            </div>
            <div>
              <Label>Categoría</Label>
              <Select value={form.categoria} onValueChange={(v) => setForm((f) => ({ ...f, categoria: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIAS.map((c) => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Contenido *</Label>
              <textarea
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[140px] resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                value={form.contenido}
                onChange={(e) => setForm((f) => ({ ...f, contenido: e.target.value }))}
                placeholder="Escribe el contenido del artículo..."
              />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.publicado} onChange={(e) => setForm((f) => ({ ...f, publicado: e.target.checked }))} className="rounded" />
              <span className="text-sm text-slate-700">Publicar inmediatamente</span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving ? "Guardando..." : form.publicado ? "Publicar" : "Guardar borrador"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

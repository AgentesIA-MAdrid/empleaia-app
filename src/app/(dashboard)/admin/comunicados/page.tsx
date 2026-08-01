"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Megaphone, Send, Trash2, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface Comunicado {
  id: string;
  titulo: string;
  contenido: string;
  publicado: boolean;
  publicadoEn?: string;
  autor: { nombre: string; apellidos: string };
  createdAt: string;
}

export default function AdminComunicadosPage() {
  const { toast } = useToast();
  const [comunicados, setComunicados] = useState<Comunicado[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ titulo: "", contenido: "", publicado: false });
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/comunicados?publicados=false");
      const data = await res.json();
      setComunicados(data.comunicados || []);
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
      const res = await fetch("/api/comunicados", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error();
      toast({ title: form.publicado ? "Comunicado publicado" : "Comunicado guardado como borrador" });
      setDialogOpen(false);
      setForm({ titulo: "", contenido: "", publicado: false });
      fetchData();
    } catch {
      toast({ title: "Error al guardar", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const togglePublicado = async (c: Comunicado) => {
    try {
      await fetch(`/api/comunicados/${c.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicado: !c.publicado }),
      });
      toast({ title: c.publicado ? "Comunicado despublicado" : "Comunicado publicado" });
      fetchData();
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/comunicados/${id}`, { method: "DELETE" });
      toast({ title: "Comunicado eliminado" });
      fetchData();
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-dark)]">Comunicados</h1>
          <p className="text-[var(--text-muted)] text-sm mt-1">Mensajes internos para toda la empresa</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" /> Nuevo comunicado
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-28 bg-[var(--muted)] rounded-xl animate-pulse" />)}
        </div>
      ) : comunicados.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Megaphone className="h-10 w-10 text-slate-200 mx-auto mb-3" />
            <p className="text-[var(--text-muted)]">No hay comunicados todavía</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {comunicados.map((c) => (
            <Card key={c.id} className={cn("transition-all", !c.publicado && "opacity-70 border-dashed")}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <h3 className="font-semibold text-[var(--text-dark)]">{c.titulo}</h3>
                      {c.publicado
                        ? <span className="text-xs bg-[var(--success-bg)] text-[var(--success-text)] px-2 py-0.5 rounded-full font-medium">Publicado</span>
                        : <span className="text-xs bg-[var(--muted)] text-[var(--text-muted)] px-2 py-0.5 rounded-full font-medium">Borrador</span>}
                    </div>
                    <p className="text-sm text-[var(--text-body)] line-clamp-2">{c.contenido}</p>
                    <p className="text-xs text-[var(--text-muted)] mt-2">
                      {c.autor.nombre} {c.autor.apellidos} · {format(new Date(c.createdAt), "d MMM yyyy", { locale: es })}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => togglePublicado(c)} title={c.publicado ? "Despublicar" : "Publicar"}>
                      {c.publicado ? <EyeOff className="h-4 w-4" /> : <Send className="h-4 w-4 text-[var(--primary)]" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-[var(--danger)] hover:text-[var(--danger-text)]" onClick={() => handleDelete(c.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Nuevo comunicado</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Título *</Label>
              <Input className="mt-1" value={form.titulo} onChange={(e) => setForm((f) => ({ ...f, titulo: e.target.value }))} placeholder="Asunto del comunicado" />
            </div>
            <div>
              <Label>Contenido *</Label>
              <textarea
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[120px] resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                value={form.contenido}
                onChange={(e) => setForm((f) => ({ ...f, contenido: e.target.value }))}
                placeholder="Escribe el contenido del comunicado..."
              />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.publicado}
                onChange={(e) => setForm((f) => ({ ...f, publicado: e.target.checked }))}
                className="rounded"
              />
              <span className="text-sm text-[var(--text-body)]">Publicar inmediatamente</span>
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

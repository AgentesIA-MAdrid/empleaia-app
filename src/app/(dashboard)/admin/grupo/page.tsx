"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Building, Plus, Lock, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

interface Empresa {
  id: string; nombre: string; cif: string; direccion: string | null;
  codigoPostal: string | null; ciudad: string | null; telefono: string | null; email: string | null;
  activa: boolean; _count: { usuarios: number };
}

export default function GrupoPage() {
  const { toast } = useToast();
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ nombre: "", cif: "", direccion: "", codigoPostal: "", ciudad: "", telefono: "", email: "" });

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/empresas");
      if (r.status === 402) { setUnavailable(true); return; }
      const d = await r.json();
      setEmpresas(d.empresas ?? []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleCreate = async () => {
    if (!form.nombre || !form.cif) { toast({ title: "Faltan datos", variant: "destructive" }); return; }
    const r = await fetch("/api/empresas", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nombre: form.nombre, cif: form.cif,
        direccion: form.direccion || null, codigoPostal: form.codigoPostal || null,
        ciudad: form.ciudad || null, telefono: form.telefono || null, email: form.email || null,
      }),
    });
    if (!r.ok) { const b = await r.json().catch(() => ({})); toast({ title: b?.error ?? "Error", variant: "destructive" }); return; }
    toast({ title: "Empresa creada" });
    setOpen(false); setForm({ nombre: "", cif: "", direccion: "", codigoPostal: "", ciudad: "", telefono: "", email: "" });
    await fetchAll();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("¿Borrar empresa?")) return;
    const r = await fetch(`/api/empresas/${id}`, { method: "DELETE" });
    if (r.ok) setEmpresas((prev) => prev.filter((e) => e.id !== id));
  };

  if (unavailable) {
    return (
      <div className="p-6">
        <Card className="border-[var(--warning-bg)] bg-[var(--warning-bg)]">
          <CardContent className="pt-4 pb-4 flex items-start gap-3">
            <Lock className="h-5 w-5 text-[var(--warning-text)] shrink-0 mt-0.5" />
            <div className="flex-1"><p className="text-sm font-semibold text-[var(--warning-text)]">Multi-empresa — plan Pro o superior</p></div>
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
          <div className="h-10 w-10 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center"><Building className="h-5 w-5 text-[var(--primary)]" /></div>
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-dark)]">Grupo empresarial</h1>
            <p className="text-[var(--text-muted)] text-sm mt-0.5">Gestiona varios CIFs bajo el mismo tenant</p>
          </div>
        </div>
        <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1.5" /> Nueva empresa</Button>
      </div>

      {loading ? <Loader2 className="h-6 w-6 animate-spin text-[var(--text-muted)]" /> :
        empresas.length === 0 ? <Card><CardContent className="py-12 text-center text-[var(--text-muted)] text-sm">Sin empresas registradas.</CardContent></Card> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {empresas.map((e) => (
            <Card key={e.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{e.nombre}</CardTitle>
                <p className="text-xs text-[var(--text-muted)] mt-0.5 font-mono">{e.cif}</p>
              </CardHeader>
              <CardContent className="space-y-1 text-sm text-[var(--text-body)]">
                {e.direccion && <p>{e.direccion}{e.codigoPostal ? `, ${e.codigoPostal}` : ""}{e.ciudad ? ` · ${e.ciudad}` : ""}</p>}
                {e.telefono && <p>{e.telefono}</p>}
                {e.email && <p>{e.email}</p>}
                <p className="text-xs text-[var(--text-muted)] pt-2 border-t border-[var(--border)]">{e._count.usuarios} empleado(s)</p>
                <div className="flex justify-end">
                  <Button size="sm" variant="ghost" className="text-[var(--danger)]" onClick={() => handleDelete(e.id)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nueva empresa</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Nombre</Label><Input className="mt-1" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} /></div>
              <div><Label>CIF</Label><Input className="mt-1" value={form.cif} onChange={(e) => setForm({ ...form, cif: e.target.value })} placeholder="B12345678" /></div>
            </div>
            <div><Label>Dirección</Label><Input className="mt-1" value={form.direccion} onChange={(e) => setForm({ ...form, direccion: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Código postal</Label><Input className="mt-1" value={form.codigoPostal} onChange={(e) => setForm({ ...form, codigoPostal: e.target.value })} /></div>
              <div><Label>Ciudad</Label><Input className="mt-1" value={form.ciudad} onChange={(e) => setForm({ ...form, ciudad: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Teléfono</Label><Input className="mt-1" value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} /></div>
              <div><Label>Email</Label><Input className="mt-1" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreate}>Crear</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

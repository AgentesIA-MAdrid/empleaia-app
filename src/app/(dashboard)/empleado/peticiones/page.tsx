"use client";

import { useEffect, useState, useCallback } from "react";
import { ClipboardList, Plus, Lock, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

interface Peticion {
  id: string; tipo: string; titulo: string; descripcion: string;
  estado: "pendiente" | "en_proceso" | "resuelta" | "rechazada";
  respuesta: string | null;
  solicitante: { id: string; nombre: string; apellidos: string };
  gestor: { id: string; nombre: string; apellidos: string } | null;
  createdAt: string;
}

const ESTADO_CLS: Record<Peticion["estado"], string> = {
  pendiente: "bg-[var(--warning-bg)] text-[var(--warning-text)]",
  en_proceso: "bg-sky-50 text-sky-700",
  resuelta: "bg-[var(--success-bg)] text-[var(--success-text)]",
  rechazada: "bg-[var(--danger-bg)] text-[var(--danger-text)]",
};

const TIPOS: Record<string, string> = {
  certificado_empresa: "Certificado de empresa",
  anticipo: "Anticipo de nómina",
  cambio_datos: "Cambio de datos",
  otro: "Otro",
};

export default function MisPeticionesPage() {
  const { toast } = useToast();
  const [peticiones, setPeticiones] = useState<Peticion[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [open, setOpen] = useState(false);

  const [tipo, setTipo] = useState("anticipo");
  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/peticiones");
      if (r.status === 402) { setUnavailable(true); return; }
      const d = await r.json();
      setPeticiones(d.peticiones ?? []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleCreate = async () => {
    if (!titulo || !descripcion) { toast({ title: "Faltan datos", variant: "destructive" }); return; }
    const r = await fetch("/api/peticiones", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipo, titulo, descripcion }),
    });
    if (!r.ok) { toast({ title: "Error", variant: "destructive" }); return; }
    toast({ title: "Petición enviada", description: "Tu petición está pendiente de revisión" });
    setOpen(false); setTitulo(""); setDescripcion("");
    await fetchAll();
  };

  const handleDelete = async (id: string) => {
    const r = await fetch(`/api/peticiones/${id}`, { method: "DELETE" });
    if (!r.ok) { toast({ title: "No se pudo eliminar", variant: "destructive" }); return; }
    toast({ title: "Petición eliminada" });
    await fetchAll();
  };

  if (unavailable) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <Card className="border-[var(--warning-bg)] bg-[var(--warning-bg)]">
          <CardContent className="pt-4 pb-4 flex items-start gap-3">
            <Lock className="h-5 w-5 text-[var(--warning-text)] shrink-0 mt-0.5" />
            <div className="flex-1"><p className="text-sm font-semibold text-[var(--warning-text)]">Las peticiones no están disponibles en el plan actual de tu empresa.</p></div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center"><ClipboardList className="h-5 w-5 text-[var(--primary)]" /></div>
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-dark)]">Mis Peticiones</h1>
            <p className="text-[var(--text-muted)] text-sm mt-0.5">Solicita un anticipo de nómina, un certificado de empresa y más</p>
          </div>
        </div>
        <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1.5" /> Nueva petición</Button>
      </div>

      {loading ? <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-[var(--text-muted)]" /></div> :
        peticiones.length === 0 ? <Card><CardContent className="py-12 text-center text-[var(--text-muted)] text-sm">Aún no has hecho ninguna petición.</CardContent></Card> : (
        <div className="space-y-3">
          {peticiones.map((p) => (
            <Card key={p.id}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-[var(--text-dark)]">{p.titulo}</p>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-md ${ESTADO_CLS[p.estado]}`}>{p.estado.replace("_", " ")}</span>
                    </div>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">{TIPOS[p.tipo] ?? p.tipo}</p>
                    <p className="text-sm text-[var(--text-body)] mt-2">{p.descripcion}</p>
                    {p.respuesta && (
                      <div className="mt-2 rounded-md bg-[var(--muted)] px-3 py-2 text-sm">
                        <p className="text-xs text-[var(--text-muted)] mb-0.5">Respuesta de {p.gestor ? `${p.gestor.nombre} ${p.gestor.apellidos}` : "—"}:</p>
                        <p className="text-[var(--text-body)]">{p.respuesta}</p>
                      </div>
                    )}
                  </div>
                  {p.estado === "pendiente" && (
                    <Button size="sm" variant="outline" className="text-[var(--danger-text)]" onClick={() => handleDelete(p.id)}><Trash2 className="h-4 w-4" /></Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nueva petición</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Tipo</Label>
              <Select value={tipo} onValueChange={setTipo}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(TIPOS).map(([k, v]) => (<SelectItem key={k} value={k}>{v}</SelectItem>))}</SelectContent>
              </Select>
            </div>
            <div><Label>Título</Label><Input className="mt-1" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Solicito un anticipo de nómina" /></div>
            <div><Label>Detalle</Label><textarea className="mt-1 w-full min-h-[100px] rounded-md border border-[var(--border)] px-3 py-2 text-sm" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Indica el importe y el motivo de tu petición" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreate}>Enviar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

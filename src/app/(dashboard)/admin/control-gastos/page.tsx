"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { CreditCard, Plus, Lock, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

interface Gasto {
  id: string; concepto: string; importe: string; moneda: string;
  categoria: string; fecha: string; ticketUrl: string | null; notas: string | null;
  estado: "pendiente" | "aprobado" | "rechazado";
  user: { id: string; nombre: string; apellidos: string };
  revisor: { id: string; nombre: string; apellidos: string } | null;
  comentarioRevision: string | null;
}

const ESTADO_CLS: Record<Gasto["estado"], string> = {
  pendiente: "bg-[var(--warning-bg)] text-[var(--warning-text)]",
  aprobado: "bg-[var(--success-bg)] text-[var(--success-text)]",
  rechazado: "bg-[var(--danger-bg)] text-[var(--danger-text)]",
};

export default function ControlGastosPage() {
  const { toast } = useToast();
  const [gastos, setGastos] = useState<Gasto[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [open, setOpen] = useState(false);

  const [concepto, setConcepto] = useState("");
  const [importe, setImporte] = useState("");
  const [categoria, setCategoria] = useState("varios");
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [notas, setNotas] = useState("");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/gastos");
      if (r.status === 402) { setUnavailable(true); return; }
      const d = await r.json();
      setGastos(d.gastos ?? []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleCreate = async () => {
    const imp = parseFloat(importe);
    if (!concepto || !imp || imp <= 0) {
      toast({ title: "Datos inválidos", variant: "destructive" }); return;
    }
    const r = await fetch("/api/gastos", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        concepto, importe: imp, categoria, fecha: new Date(fecha).toISOString(),
        notas: notas || null,
      }),
    });
    if (!r.ok) { toast({ title: "Error", variant: "destructive" }); return; }
    toast({ title: "Gasto registrado" });
    setOpen(false); setConcepto(""); setImporte(""); setNotas("");
    await fetchAll();
  };

  const handleReview = async (id: string, estado: "aprobado" | "rechazado") => {
    const r = await fetch(`/api/gastos/${id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estado }),
    });
    if (r.ok) await fetchAll();
  };

  if (unavailable) {
    return (
      <div className="p-6">
        <Card className="border-[var(--warning-bg)] bg-[var(--warning-bg)]">
          <CardContent className="pt-4 pb-4 flex items-start gap-3">
            <Lock className="h-5 w-5 text-[var(--warning-text)] shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-[var(--warning-text)]">Control de gastos — plan Pro o superior</p>
              <p className="text-sm text-[var(--warning-text)] mt-0.5">Los empleados registran tickets; los managers aprueban.</p>
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
          <div className="h-10 w-10 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center"><CreditCard className="h-5 w-5 text-[var(--primary)]" /></div>
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-dark)]">Control de gastos</h1>
            <p className="text-[var(--text-muted)] text-sm mt-0.5">Tickets y reembolsos de empresa</p>
          </div>
        </div>
        <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1.5" /> Nuevo gasto</Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-[var(--text-muted)]" /></div>
      ) : gastos.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-[var(--text-muted)] text-sm">Sin gastos registrados.</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[var(--muted)] border-b border-[var(--border)]">
                  <tr>{["Fecha", "Empleado", "Concepto", "Categoría", "Importe", "Estado", ""].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">{h}</th>
                  ))}</tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {gastos.map((g) => (
                    <tr key={g.id} className="hover:bg-[var(--muted)]">
                      <td className="px-4 py-3 text-[var(--text-body)]">{new Date(g.fecha).toLocaleDateString("es-ES")}</td>
                      <td className="px-4 py-3 text-[var(--text-body)]">{g.user.nombre} {g.user.apellidos}</td>
                      <td className="px-4 py-3 text-[var(--text-dark)]">{g.concepto}</td>
                      <td className="px-4 py-3 text-[var(--text-muted)] capitalize">{g.categoria}</td>
                      <td className="px-4 py-3 font-semibold text-[var(--text-dark)] tabular-nums">{Number(g.importe).toFixed(2)} {g.moneda}</td>
                      <td className="px-4 py-3"><span className={`text-xs font-medium px-2 py-0.5 rounded-md ${ESTADO_CLS[g.estado]}`}>{g.estado}</span></td>
                      <td className="px-4 py-3 text-right">
                        {g.estado === "pendiente" && (
                          <div className="flex gap-1 justify-end">
                            <Button size="sm" variant="ghost" className="text-[var(--success-text)]" onClick={() => handleReview(g.id, "aprobado")}><CheckCircle2 className="h-4 w-4" /></Button>
                            <Button size="sm" variant="ghost" className="text-[var(--danger)]" onClick={() => handleReview(g.id, "rechazado")}><XCircle className="h-4 w-4" /></Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nuevo gasto</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>Concepto</Label><Input className="mt-1" value={concepto} onChange={(e) => setConcepto(e.target.value)} placeholder="Comida con cliente" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Importe (€)</Label><Input className="mt-1" type="number" step="0.01" value={importe} onChange={(e) => setImporte(e.target.value)} /></div>
              <div><Label>Fecha</Label><Input className="mt-1" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
            </div>
            <div>
              <Label>Categoría</Label>
              <Select value={categoria} onValueChange={setCategoria}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="dietas">Dietas</SelectItem>
                  <SelectItem value="transporte">Transporte</SelectItem>
                  <SelectItem value="hotel">Hotel</SelectItem>
                  <SelectItem value="material">Material</SelectItem>
                  <SelectItem value="varios">Varios</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Notas</Label><textarea className="mt-1 w-full min-h-[60px] rounded-md border border-[var(--border)] px-3 py-2 text-sm" value={notas} onChange={(e) => setNotas(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreate}>Registrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

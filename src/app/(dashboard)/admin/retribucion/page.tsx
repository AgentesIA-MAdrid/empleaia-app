"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Wallet, Lock, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

type Concepto = "tickets_restaurante" | "guarderia" | "transporte" | "seguro_medico";
const LABEL: Record<Concepto, string> = {
  tickets_restaurante: "Tickets restaurante",
  guarderia: "Guardería",
  transporte: "Transporte (abono)",
  seguro_medico: "Seguro médico",
};

interface Declaracion {
  id: string; periodo: string; concepto: Concepto;
  importe: number; ahorroFiscal: number; limite: number | null;
  notas: string | null;
  empleado: { id: string; nombre: string; apellidos: string };
}

export default function RetribucionFlexPage() {
  const { toast } = useToast();
  const [periodo, setPeriodo] = useState(() => new Date().toISOString().slice(0, 7));
  const [decls, setDecls] = useState<Declaracion[]>([]);
  const [limites, setLimites] = useState<Record<Concepto, number>>({} as Record<Concepto, number>);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [open, setOpen] = useState(false);
  const [concepto, setConcepto] = useState<Concepto>("tickets_restaurante");
  const [importe, setImporte] = useState("");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/retribucion?periodo=${periodo}`);
      if (r.status === 402) { setUnavailable(true); return; }
      const d = await r.json();
      setDecls(d.declaraciones ?? []);
      setLimites(d.limites ?? {});
    } finally { setLoading(false); }
  }, [periodo]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const declarar = async () => {
    const imp = parseFloat(importe);
    if (isNaN(imp) || imp < 0) { toast({ title: "Importe inválido", variant: "destructive" }); return; }
    const r = await fetch("/api/retribucion", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ periodo, concepto, importe: imp }),
    });
    if (!r.ok) { toast({ title: "Error", variant: "destructive" }); return; }
    const d = await r.json();
    toast({ title: "Declaración guardada", description: `Ahorro fiscal estimado: ${d.declaracion.ahorroFiscal.toFixed(2)} €` });
    setOpen(false); setImporte("");
    await fetchAll();
  };

  const ahorroTotal = decls.reduce((s, d) => s + d.ahorroFiscal, 0);

  if (unavailable) {
    return (
      <div className="p-6">
        <Card className="border-[var(--warning-bg)] bg-[var(--warning-bg)]">
          <CardContent className="pt-4 pb-4 flex items-start gap-3">
            <Lock className="h-5 w-5 text-[var(--warning-text)] shrink-0 mt-0.5" />
            <div className="flex-1"><p className="text-sm font-semibold text-[var(--warning-text)]">Retribución flexible — plan Pro o superior</p></div>
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
          <div className="h-10 w-10 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center"><Wallet className="h-5 w-5 text-[var(--primary)]" /></div>
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-dark)]">Retribución flexible</h1>
            <p className="text-[var(--text-muted)] text-sm mt-0.5">Declara importes y estima el ahorro fiscal (IRPF 30 %)</p>
          </div>
        </div>
        <div className="flex gap-2 items-end">
          <Input type="month" value={periodo} onChange={(e) => setPeriodo(e.target.value)} className="w-40" />
          <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1.5" /> Declarar</Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-4 pb-4 grid sm:grid-cols-2 gap-4">
          <div><p className="text-xs text-[var(--text-muted)]">Total declarado</p><p className="text-2xl font-bold text-[var(--text-dark)]">{decls.reduce((s, d) => s + d.importe, 0).toFixed(2)} €</p></div>
          <div><p className="text-xs text-[var(--text-muted)]">Ahorro fiscal estimado</p><p className="text-2xl font-bold text-[var(--success-text)]">{ahorroTotal.toFixed(2)} €</p></div>
        </CardContent>
      </Card>

      {loading ? <Loader2 className="h-6 w-6 animate-spin text-[var(--text-muted)]" /> :
        decls.length === 0 ? <Card><CardContent className="py-12 text-center text-[var(--text-muted)] text-sm">Sin declaraciones para este periodo.</CardContent></Card> : (
        <Card>
          <CardHeader><CardTitle className="text-base">Declaraciones {periodo}</CardTitle></CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--muted)] border-b border-[var(--border)]">
                <tr>{["Empleado", "Concepto", "Importe", "Límite mensual", "Ahorro estimado"].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {decls.map((d) => (
                  <tr key={d.id} className="hover:bg-[var(--muted)]">
                    <td className="px-4 py-3 text-[var(--text-dark)]">{d.empleado.nombre} {d.empleado.apellidos}</td>
                    <td className="px-4 py-3 text-[var(--text-body)]">{LABEL[d.concepto]}</td>
                    <td className="px-4 py-3 tabular-nums font-semibold">{d.importe.toFixed(2)} €</td>
                    <td className="px-4 py-3 tabular-nums text-[var(--text-muted)]">{d.limite ? d.limite.toFixed(2) + " €" : "—"}</td>
                    <td className="px-4 py-3 tabular-nums text-[var(--success-text)] font-semibold">{d.ahorroFiscal.toFixed(2)} €</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nueva declaración · {periodo}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Concepto</Label>
              <Select value={concepto} onValueChange={(v: Concepto) => setConcepto(v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{(Object.keys(LABEL) as Concepto[]).map((k) => (<SelectItem key={k} value={k}>{LABEL[k]}</SelectItem>))}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Importe (€) {limites[concepto] && <span className="text-xs text-[var(--text-muted)] ml-1">· límite mensual {limites[concepto].toFixed(2)} €</span>}</Label>
              <Input className="mt-1" type="number" step="0.01" value={importe} onChange={(e) => setImporte(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={declarar}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

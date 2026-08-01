"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Send, Plus, Lock, Loader2, Trash2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

interface Persona { id: string; nombre: string; apellidos: string; }
interface Nomina {
  id: string; periodo: string; nombreArchivo: string; tamañoBytes: number;
  vistoAt: string | null; createdAt: string;
  empleado: Persona; subidoPor?: Persona;
}

export default function EnvioNominasPage() {
  const { toast } = useToast();
  const [nominas, setNominas] = useState<Nomina[]>([]);
  const [empleados, setEmpleados] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [empleadoId, setEmpleadoId] = useState("");
  const [periodo, setPeriodo] = useState(() => new Date().toISOString().slice(0, 7));
  const [file, setFile] = useState<File | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [rN, rE] = await Promise.all([fetch("/api/nominas"), fetch("/api/empleados")]);
      if (rN.status === 402) { setUnavailable(true); return; }
      const dN = await rN.json();
      const dE = await rE.json();
      setNominas(dN.nominas ?? []);
      setEmpleados((dE.empleados ?? dE ?? []).map((e: Record<string, unknown>) => ({
        id: String(e.id), nombre: String(e.nombre ?? ""), apellidos: String(e.apellidos ?? ""),
      })));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleUpload = async () => {
    if (!empleadoId || !periodo || !file) { toast({ title: "Faltan datos", variant: "destructive" }); return; }
    if (file.type !== "application/pdf") { toast({ title: "Solo PDF", variant: "destructive" }); return; }
    if (file.size > 15_000_000) { toast({ title: "Máx 15 MB", variant: "destructive" }); return; }
    setUploading(true);
    try {
      const reader = new FileReader();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const r = await fetch("/api/nominas", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          empleadoId, periodo, pdfUrl: dataUrl,
          nombreArchivo: file.name, tamañoBytes: file.size,
        }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        toast({ title: body?.error ?? "Error", variant: "destructive" }); return;
      }
      toast({ title: "Nómina enviada" });
      setOpen(false); setFile(null); setEmpleadoId("");
      await fetchAll();
    } finally { setUploading(false); }
  };

  const handleDownload = async (id: string) => {
    const r = await fetch(`/api/nominas/${id}`);
    if (!r.ok) return;
    const d = await r.json();
    const a = document.createElement("a");
    a.href = d.pdfUrl;
    a.download = d.nombreArchivo;
    a.click();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("¿Borrar nómina?")) return;
    const r = await fetch(`/api/nominas/${id}`, { method: "DELETE" });
    if (r.ok) setNominas((prev) => prev.filter((n) => n.id !== id));
  };

  if (unavailable) {
    return (
      <div className="p-6">
        <Card className="border-[var(--warning-bg)] bg-[var(--warning-bg)]">
          <CardContent className="pt-4 pb-4 flex items-start gap-3">
            <Lock className="h-5 w-5 text-[var(--warning-text)] shrink-0 mt-0.5" />
            <div className="flex-1"><p className="text-sm font-semibold text-[var(--warning-text)]">Envío de nóminas — plan Pro o superior</p></div>
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
          <div className="h-10 w-10 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center"><Send className="h-5 w-5 text-[var(--primary)]" /></div>
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-dark)]">Envío de nóminas</h1>
            <p className="text-[var(--text-muted)] text-sm mt-0.5">Sube el PDF y el empleado lo descarga desde su perfil</p>
          </div>
        </div>
        <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1.5" /> Subir nómina</Button>
      </div>

      {loading ? <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-[var(--text-muted)]" /></div> :
        nominas.length === 0 ? <Card><CardContent className="py-12 text-center text-[var(--text-muted)] text-sm">Sin nóminas subidas.</CardContent></Card> : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="bg-[var(--muted)] border-b border-[var(--border)]">
                <tr>{["Empleado", "Periodo", "Archivo", "Estado", ""].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {nominas.map((n) => (
                  <tr key={n.id} className="hover:bg-[var(--muted)]">
                    <td className="px-4 py-3 text-[var(--text-body)]">{n.empleado.nombre} {n.empleado.apellidos}</td>
                    <td className="px-4 py-3 text-[var(--text-body)] tabular-nums">{n.periodo}</td>
                    <td className="px-4 py-3 text-[var(--text-muted)] text-xs">{n.nombreArchivo} ({(n.tamañoBytes / 1024).toFixed(0)} KB)</td>
                    <td className="px-4 py-3"><span className={`text-xs font-medium px-2 py-0.5 rounded-md ${n.vistoAt ? "bg-[var(--success-bg)] text-[var(--success-text)]" : "bg-[var(--muted)] text-[var(--text-muted)]"}`}>{n.vistoAt ? "Visto" : "Pendiente"}</span></td>
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="ghost" onClick={() => handleDownload(n.id)}><Download className="h-4 w-4" /></Button>
                      <Button size="sm" variant="ghost" className="text-[var(--danger)]" onClick={() => handleDelete(n.id)}><Trash2 className="h-4 w-4" /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Subir nómina</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Empleado</Label>
              <Select value={empleadoId} onValueChange={setEmpleadoId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Selecciona" /></SelectTrigger>
                <SelectContent>{empleados.map((e) => (<SelectItem key={e.id} value={e.id}>{e.nombre} {e.apellidos}</SelectItem>))}</SelectContent>
              </Select>
            </div>
            <div><Label>Periodo (YYYY-MM)</Label><Input className="mt-1" value={periodo} onChange={(e) => setPeriodo(e.target.value)} placeholder="2026-05" /></div>
            <div>
              <Label>Archivo PDF</Label>
              <Input className="mt-1" type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={handleUpload} disabled={uploading}>{uploading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Subir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

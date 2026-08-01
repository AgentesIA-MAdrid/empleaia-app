"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Building2, Plus, Lock, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

interface Espacio { id: string; nombre: string; descripcion: string | null; capacidad: number; ubicacion: string | null; }
interface Reserva {
  id: string; inicio: string; fin: string; motivo: string | null;
  user: { id: string; nombre: string; apellidos: string };
  espacio: { id: string; nombre: string };
}

export default function ReservaEspaciosPage() {
  const { toast } = useToast();
  const [espacios, setEspacios] = useState<Espacio[]>([]);
  const [reservas, setReservas] = useState<Reserva[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [openEsp, setOpenEsp] = useState(false);
  const [openRes, setOpenRes] = useState(false);

  // espacio form
  const [nombreEsp, setNombreEsp] = useState("");
  const [capacidad, setCapacidad] = useState("1");
  const [ubicacion, setUbicacion] = useState("");

  // reserva form
  const [espacioId, setEspacioId] = useState("");
  const [inicio, setInicio] = useState("");
  const [fin, setFin] = useState("");
  const [motivo, setMotivo] = useState("");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [rE, rR] = await Promise.all([
        fetch("/api/espacios"),
        fetch(`/api/reservas?desde=${new Date().toISOString()}`),
      ]);
      if (rE.status === 402) { setUnavailable(true); return; }
      const dE = await rE.json();
      const dR = await rR.json();
      setEspacios(dE.espacios ?? []);
      setReservas(dR.reservas ?? []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const createEspacio = async () => {
    if (!nombreEsp) return;
    const r = await fetch("/api/espacios", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre: nombreEsp, capacidad: parseInt(capacidad, 10), ubicacion: ubicacion || null }),
    });
    if (!r.ok) { toast({ title: "Error", variant: "destructive" }); return; }
    setOpenEsp(false); setNombreEsp(""); setCapacidad("1"); setUbicacion("");
    await fetchAll();
  };

  const createReserva = async () => {
    if (!espacioId || !inicio || !fin) { toast({ title: "Faltan datos", variant: "destructive" }); return; }
    const r = await fetch("/api/reservas", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        espacioId,
        inicio: new Date(inicio).toISOString(),
        fin: new Date(fin).toISOString(),
        motivo: motivo || null,
      }),
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      toast({ title: body?.error ?? "Error", variant: "destructive" }); return;
    }
    toast({ title: "Reservado" });
    setOpenRes(false); setInicio(""); setFin(""); setMotivo("");
    await fetchAll();
  };

  const deleteReserva = async (id: string) => {
    const r = await fetch(`/api/reservas/${id}`, { method: "DELETE" });
    if (r.ok) setReservas((prev) => prev.filter((x) => x.id !== id));
  };

  if (unavailable) {
    return (
      <div className="p-6">
        <Card className="border-[var(--warning-bg)] bg-[var(--warning-bg)]">
          <CardContent className="pt-4 pb-4 flex items-start gap-3">
            <Lock className="h-5 w-5 text-[var(--warning-text)] shrink-0 mt-0.5" />
            <div className="flex-1"><p className="text-sm font-semibold text-[var(--warning-text)]">Reserva de espacios — plan Pro o superior</p></div>
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
          <div className="h-10 w-10 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center"><Building2 className="h-5 w-5 text-[var(--primary)]" /></div>
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-dark)]">Reserva de espacios</h1>
            <p className="text-[var(--text-muted)] text-sm mt-0.5">Salas, mesas y plazas reservables</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setOpenEsp(true)}><Plus className="h-4 w-4 mr-1.5" /> Espacio</Button>
          <Button onClick={() => setOpenRes(true)} disabled={espacios.length === 0}><Plus className="h-4 w-4 mr-1.5" /> Reserva</Button>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Espacios ({espacios.length})</CardTitle></CardHeader>
        <CardContent>
          {espacios.length === 0 ? <p className="text-[var(--text-muted)] text-sm">Crea primero un espacio.</p> : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {espacios.map((e) => (
                <div key={e.id} className="rounded-md border border-[var(--border)] p-3">
                  <p className="font-semibold text-sm text-[var(--text-dark)]">{e.nombre}</p>
                  <p className="text-xs text-[var(--text-muted)]">Capacidad {e.capacidad}{e.ubicacion ? ` · ${e.ubicacion}` : ""}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Reservas próximas ({reservas.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {loading ? <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-[var(--text-muted)]" /></div> :
            reservas.length === 0 ? <p className="text-[var(--text-muted)] text-sm p-4">Sin reservas activas.</p> : (
            <div className="divide-y divide-slate-100">
              {reservas.map((r) => (
                <div key={r.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-[var(--text-dark)]">{r.espacio.nombre}</p>
                    <p className="text-xs text-[var(--text-muted)]">
                      {new Date(r.inicio).toLocaleString("es-ES")} → {new Date(r.fin).toLocaleString("es-ES")}
                    </p>
                    <p className="text-xs text-[var(--text-muted)]">{r.user.nombre} {r.user.apellidos}{r.motivo ? ` · ${r.motivo}` : ""}</p>
                  </div>
                  <Button size="sm" variant="ghost" className="text-[var(--danger)]" onClick={() => deleteReserva(r.id)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={openEsp} onOpenChange={setOpenEsp}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nuevo espacio</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>Nombre</Label><Input className="mt-1" value={nombreEsp} onChange={(e) => setNombreEsp(e.target.value)} placeholder="Sala azul" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Capacidad</Label><Input className="mt-1" type="number" value={capacidad} onChange={(e) => setCapacidad(e.target.value)} /></div>
              <div><Label>Ubicación</Label><Input className="mt-1" value={ubicacion} onChange={(e) => setUbicacion(e.target.value)} placeholder="Planta 2" /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenEsp(false)}>Cancelar</Button>
            <Button onClick={createEspacio}>Crear</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={openRes} onOpenChange={setOpenRes}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nueva reserva</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Espacio</Label>
              <Select value={espacioId} onValueChange={setEspacioId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Selecciona espacio" /></SelectTrigger>
                <SelectContent>{espacios.map((e) => (<SelectItem key={e.id} value={e.id}>{e.nombre}</SelectItem>))}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Inicio</Label><Input className="mt-1" type="datetime-local" value={inicio} onChange={(e) => setInicio(e.target.value)} /></div>
              <div><Label>Fin</Label><Input className="mt-1" type="datetime-local" value={fin} onChange={(e) => setFin(e.target.value)} /></div>
            </div>
            <div><Label>Motivo</Label><Input className="mt-1" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Reunión equipo" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenRes(false)}>Cancelar</Button>
            <Button onClick={createReserva}>Reservar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

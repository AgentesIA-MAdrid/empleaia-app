"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Edit2, MapPin, Phone, Mail, Users, ToggleLeft, ToggleRight, LocateFixed, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { SedeHorariosDialog } from "@/components/admin/sede-horarios-dialog";
import { SedeEmpleadosDialog } from "@/components/admin/sede-empleados-dialog";

interface Tienda {
  id: string;
  nombre: string;
  direccion: string;
  ciudad: string;
  codigoPostal?: string;
  telefono?: string;
  email?: string;
  latitud?: number;
  longitud?: number;
  radio: number;
  activa: boolean;
  color: string;
  _count?: { empleados: number };
}

const COLORES = [
  "#6366f1", "#8b5cf6", "#a78bfa", "#06b6d4", "#0ea5e9",
  "#f59e0b", "#ef4444", "#10b981", "#f97316", "#ec4899",
];

const FORM_INICIAL = {
  nombre: "", direccion: "", ciudad: "", codigoPostal: "", telefono: "",
  email: "", latitud: "", longitud: "", radio: "200", color: "#6366f1",
};

export default function TiendasPage() {
  const { toast } = useToast();
  const [tiendas, setTiendas] = useState<Tienda[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editando, setEditando] = useState<Tienda | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [form, setForm] = useState(FORM_INICIAL);
  const [horariosTienda, setHorariosTienda] = useState<{ id: string; nombre: string } | null>(null);
  const [empleadosTienda, setEmpleadosTienda] = useState<{ id: string; nombre: string } | null>(null);

  const ubicar = async () => {
    if (!form.direccion || !form.ciudad) {
      toast({ title: "Indica dirección y ciudad para ubicar", variant: "destructive" });
      return;
    }
    setGeocoding(true);
    try {
      const params = new URLSearchParams({
        direccion: form.direccion,
        ciudad: form.ciudad,
        cp: form.codigoPostal,
      });
      const res = await fetch(`/api/tiendas/geocodificar?${params.toString()}`);
      if (!res.ok) {
        toast({ title: "No se pudo ubicar la dirección", description: "Revísala o introduce las coordenadas a mano.", variant: "destructive" });
        return;
      }
      const data = await res.json();
      setForm((f) => ({ ...f, latitud: String(data.latitud), longitud: String(data.longitud) }));
      toast({ title: "Ubicación encontrada", description: "Revisa que el punto sea correcto." });
    } catch {
      toast({ title: "Error al ubicar", variant: "destructive" });
    } finally {
      setGeocoding(false);
    }
  };

  const fetchTiendas = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/tiendas");
      const data = await res.json();
      setTiendas(data.tiendas || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTiendas(); }, [fetchTiendas]);

  const abrirCrear = () => {
    setEditando(null);
    setForm(FORM_INICIAL);
    setDialogOpen(true);
  };

  const abrirEditar = (t: Tienda) => {
    setEditando(t);
    setForm({
      nombre: t.nombre, direccion: t.direccion, ciudad: t.ciudad,
      codigoPostal: t.codigoPostal || "", telefono: t.telefono || "",
      email: t.email || "", latitud: t.latitud?.toString() || "",
      longitud: t.longitud?.toString() || "", radio: t.radio.toString(),
      color: t.color,
    });
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.nombre || !form.direccion || !form.ciudad) {
      toast({ title: "Nombre, dirección y ciudad son obligatorios", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const body = {
        ...form,
        latitud: form.latitud ? parseFloat(form.latitud) : null,
        longitud: form.longitud ? parseFloat(form.longitud) : null,
        radio: parseInt(form.radio) || 200,
      };
      const url = editando ? `/api/tiendas/${editando.id}` : "/api/tiendas";
      const method = editando ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      toast({ title: editando ? "Sede actualizada" : "Sede creada" });
      setDialogOpen(false);
      fetchTiendas();
    } catch {
      toast({ title: "Error al guardar", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActiva = async (t: Tienda) => {
    try {
      await fetch(`/api/tiendas/${t.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activa: !t.activa }),
      });
      fetchTiendas();
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Sedes</h1>
          <p className="text-slate-500 text-sm mt-1">{tiendas.length} sedes configuradas</p>
        </div>
        <Button onClick={abrirCrear}>
          <Plus className="h-4 w-4 mr-2" /> Nueva Sede
        </Button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-48 bg-slate-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {tiendas.map((t) => (
            <Card key={t.id} className={cn(!t.activa && "opacity-60")}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-full" style={{ backgroundColor: t.color }} />
                    <h3 className="font-semibold text-slate-900 text-sm">{t.nombre}</h3>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setHorariosTienda({ id: t.id, nombre: t.nombre })} title="Horarios de apertura">
                      <Clock className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEmpleadosTienda({ id: t.id, nombre: t.nombre })} title="Asignar empleados">
                      <Users className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => abrirEditar(t)} title="Editar sede">
                      <Edit2 className="h-3.5 w-3.5" />
                    </Button>
                    <button onClick={() => handleToggleActiva(t)} className="text-slate-400 hover:text-slate-600" title={t.activa ? "Desactivar" : "Activar"}>
                      {t.activa
                        ? <ToggleRight className="h-5 w-5 text-emerald-500" />
                        : <ToggleLeft className="h-5 w-5" />
                      }
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5 text-sm text-slate-600">
                  <div className="flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                    <span className="truncate">{t.direccion}, {t.ciudad}</span>
                  </div>
                  {t.telefono && (
                    <div className="flex items-center gap-1.5">
                      <Phone className="h-3.5 w-3.5 text-slate-400" />
                      <span>{t.telefono}</span>
                    </div>
                  )}
                  {t.email && (
                    <div className="flex items-center gap-1.5">
                      <Mail className="h-3.5 w-3.5 text-slate-400" />
                      <span className="truncate">{t.email}</span>
                    </div>
                  )}
                </div>

                <div className="mt-3 pt-3 border-t flex items-center justify-between text-xs text-slate-500">
                  <span className="flex items-center gap-1">
                    <Users className="h-3.5 w-3.5" />
                    {t._count?.empleados || 0} empleados
                  </span>
                  <span>Radio: {t.radio}m</span>
                  {!t.activa && <span className="text-red-500 font-medium">Inactiva</span>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editando ? "Editar Sede" : "Nueva Sede"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>Nombre *</Label>
                <Input className="mt-1" value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} placeholder="Sede Madrid Centro" />
              </div>
              <div className="col-span-2">
                <Label>Dirección *</Label>
                <Input className="mt-1" value={form.direccion} onChange={(e) => setForm((f) => ({ ...f, direccion: e.target.value }))} placeholder="Calle Gran Vía 1" />
              </div>
              <div>
                <Label>Ciudad *</Label>
                <Input className="mt-1" value={form.ciudad} onChange={(e) => setForm((f) => ({ ...f, ciudad: e.target.value }))} placeholder="Madrid" />
              </div>
              <div>
                <Label>Código Postal</Label>
                <Input className="mt-1" value={form.codigoPostal} onChange={(e) => setForm((f) => ({ ...f, codigoPostal: e.target.value }))} placeholder="28013" />
              </div>
              <div>
                <Label>Teléfono</Label>
                <Input className="mt-1" value={form.telefono} onChange={(e) => setForm((f) => ({ ...f, telefono: e.target.value }))} placeholder="91 000 0000" />
              </div>
              <div>
                <Label>Email</Label>
                <Input className="mt-1" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="sede@empresa.es" />
              </div>
              <div className="col-span-2 flex items-center justify-between rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
                <span className="text-xs text-slate-500">
                  Las coordenadas se calculan solas al guardar. Pulsa para previsualizarlas y afinar.
                </span>
                <Button type="button" variant="outline" size="sm" onClick={ubicar} disabled={geocoding}>
                  <LocateFixed className="h-3.5 w-3.5 mr-1.5" />
                  {geocoding ? "Ubicando…" : "Ubicar automáticamente"}
                </Button>
              </div>
              <div>
                <Label>Latitud (geofencing)</Label>
                <Input className="mt-1" type="number" step="0.0001" value={form.latitud} onChange={(e) => setForm((f) => ({ ...f, latitud: e.target.value }))} placeholder="40.4168" />
              </div>
              <div>
                <Label>Longitud (geofencing)</Label>
                <Input className="mt-1" type="number" step="0.0001" value={form.longitud} onChange={(e) => setForm((f) => ({ ...f, longitud: e.target.value }))} placeholder="-3.7038" />
              </div>
              <div>
                <Label>Radio geofencing (metros)</Label>
                <Input className="mt-1" type="number" value={form.radio} onChange={(e) => setForm((f) => ({ ...f, radio: e.target.value }))} placeholder="200" />
              </div>
              <div>
                <Label>Color</Label>
                <div className="mt-1 flex gap-2 flex-wrap">
                  {COLORES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={cn("w-7 h-7 rounded-full border-2 transition-all", form.color === c ? "border-slate-800 scale-110" : "border-transparent")}
                      style={{ backgroundColor: c }}
                      onClick={() => setForm((f) => ({ ...f, color: c }))}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? "Guardando..." : editando ? "Actualizar" : "Crear Sede"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SedeHorariosDialog tienda={horariosTienda} onClose={() => setHorariosTienda(null)} />
      <SedeEmpleadosDialog
        tienda={empleadosTienda}
        onClose={() => setEmpleadosTienda(null)}
        onSaved={fetchTiendas}
      />
    </div>
  );
}

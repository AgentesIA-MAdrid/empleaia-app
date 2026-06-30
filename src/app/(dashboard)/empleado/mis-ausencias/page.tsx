"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Calendar, X, CheckCircle, XCircle, Clock, AlertCircle, List, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CalendarioAusencias, type FestivoCal } from "@/components/ausencias/calendario-ausencias";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn, formatFecha } from "@/lib/utils";
import { differenceInCalendarDays, parseISO } from "date-fns";

interface TipoAusencia {
  id: string;
  nombre: string;
  color: string;
  pagada: boolean;
  requiereAprobacion: boolean;
}

interface Ausencia {
  id: string;
  fechaInicio: string;
  fechaFin: string;
  dias: number;
  motivo?: string;
  estado: "PENDIENTE" | "APROBADA" | "RECHAZADA" | "CANCELADA";
  comentarioAdmin?: string;
  tipoAusencia: TipoAusencia;
  createdAt: string;
}

const ESTADO_CONFIG = {
  PENDIENTE: { label: "Pendiente", color: "bg-amber-100 text-amber-700", icon: Clock },
  APROBADA: { label: "Aprobada", color: "bg-emerald-100 text-emerald-700", icon: CheckCircle },
  RECHAZADA: { label: "Rechazada", color: "bg-red-100 text-red-700", icon: XCircle },
  CANCELADA: { label: "Cancelada", color: "bg-slate-100 text-slate-600", icon: X },
};

const TABS = ["Todas", "Pendiente", "Aprobada", "Rechazada"] as const;

export default function MisAusenciasPage() {
  const { toast } = useToast();
  const [ausencias, setAusencias] = useState<Ausencia[]>([]);
  const [festivos, setFestivos] = useState<FestivoCal[]>([]);
  const [vista, setVista] = useState<"lista" | "calendario">("lista");
  const [tipos, setTipos] = useState<TipoAusencia[]>([]);
  const [loading, setLoading] = useState(true);
  const [tabActiva, setTabActiva] = useState<(typeof TABS)[number]>("Todas");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    tipoAusenciaId: "",
    fechaInicio: "",
    fechaFin: "",
    motivo: "",
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [ausRes, tiposRes] = await Promise.all([
        fetch("/api/ausencias"),
        fetch("/api/ausencias/tipos"),
      ]);
      const [ausData, tiposData] = await Promise.all([ausRes.json(), tiposRes.json()]);
      setAusencias(Array.isArray(ausData) ? ausData : (ausData?.ausencias ?? []));
      setTipos(Array.isArray(tiposData) ? tiposData : (tiposData?.tipos ?? []));
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchFestivos = useCallback(async () => {
    try {
      const res = await fetch("/api/festivos?scope=me");
      const data = await res.json();
      setFestivos(data?.festivos ?? []);
    } catch {
      // la lista sigue funcionando aunque falle el calendario
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { fetchFestivos(); }, [fetchFestivos]);

  const ausenciasFiltradas = ausencias.filter((a) =>
    tabActiva === "Todas" ? true : a.estado === tabActiva.toUpperCase()
  );

  const diasCalc =
    form.fechaInicio && form.fechaFin
      ? Math.max(
          0,
          differenceInCalendarDays(parseISO(form.fechaFin), parseISO(form.fechaInicio)) + 1
        )
      : 0;

  const handleSubmit = async () => {
    if (!form.tipoAusenciaId || !form.fechaInicio || !form.fechaFin) {
      toast({ title: "Completa todos los campos", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/ausencias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, dias: diasCalc }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Error al crear ausencia");
      }
      toast({ title: "Solicitud enviada", description: "Tu solicitud está pendiente de aprobación" });
      setDialogOpen(false);
      setForm({ tipoAusenciaId: "", fechaInicio: "", fechaFin: "", motivo: "" });
      fetchData();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelar = async (id: string) => {
    try {
      const res = await fetch(`/api/ausencias/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: "CANCELADA" }),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Ausencia cancelada" });
      fetchData();
    } catch {
      toast({ title: "Error al cancelar", variant: "destructive" });
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Mis Ausencias</h1>
          <p className="text-slate-500 text-sm mt-1">Gestiona tus solicitudes de ausencia</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" /> Nueva Solicitud
        </Button>
      </div>

      {/* Tabs + toggle de vista */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        {vista === "lista" ? (
          <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
            {TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => setTabActiva(tab)}
                className={cn(
                  "px-4 py-1.5 rounded-lg text-sm font-medium transition-all",
                  tabActiva === tab
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                )}
              >
                {tab}
                {tab !== "Todas" && (
                  <span className="ml-1.5 text-xs">
                    ({ausencias.filter((a) => a.estado === tab.toUpperCase()).length})
                  </span>
                )}
              </button>
            ))}
          </div>
        ) : <div />}
        <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
          <button
            onClick={() => setVista("lista")}
            className={cn(
              "px-3 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5",
              vista === "lista" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
            )}
          >
            <List className="h-4 w-4" /> Lista
          </button>
          <button
            onClick={() => setVista("calendario")}
            className={cn(
              "px-3 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5",
              vista === "calendario" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
            )}
          >
            <CalendarDays className="h-4 w-4" /> Calendario
          </button>
        </div>
      </div>

      {/* Lista / Calendario */}
      {vista === "calendario" ? (
        <CalendarioAusencias ausencias={ausencias} festivos={festivos} />
      ) : loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-slate-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : ausenciasFiltradas.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Calendar className="h-10 w-10 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500">No tienes ausencias en esta categoría</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {ausenciasFiltradas.map((a) => {
            const config = ESTADO_CONFIG[a.estado];
            const Icon = config.icon;
            return (
              <Card key={a.id}>
                <CardContent className="py-4">
                  <div className="flex items-start gap-4">
                    <div
                      className="w-1 h-16 rounded-full flex-shrink-0 mt-1"
                      style={{ backgroundColor: a.tipoAusencia.color }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-slate-900">{a.tipoAusencia.nombre}</span>
                        <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium", config.color)}>
                          <Icon className="h-3 w-3" />
                          {config.label}
                        </span>
                      </div>
                      <p className="text-sm text-slate-600 mt-1">
                        {formatFecha(a.fechaInicio)} — {formatFecha(a.fechaFin)}
                        <span className="text-slate-400 ml-2">({a.dias} {a.dias === 1 ? "día" : "días"})</span>
                      </p>
                      {a.motivo && <p className="text-xs text-slate-400 mt-1">{a.motivo}</p>}
                      {a.comentarioAdmin && (
                        <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                          <AlertCircle className="h-3 w-3" />
                          {a.comentarioAdmin}
                        </p>
                      )}
                    </div>
                    {a.estado === "PENDIENTE" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-slate-400 hover:text-red-500"
                        onClick={() => handleCancelar(a.id)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Dialog nueva ausencia */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nueva Solicitud de Ausencia</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Tipo de ausencia</Label>
              <Select value={form.tipoAusenciaId} onValueChange={(v) => setForm((f) => ({ ...f, tipoAusenciaId: v }))}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Selecciona tipo..." />
                </SelectTrigger>
                <SelectContent>
                  {tipos.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      <span className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: t.color }} />
                        {t.nombre}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Fecha inicio</Label>
                <Input
                  type="date"
                  className="mt-1"
                  value={form.fechaInicio}
                  min={new Date().toISOString().split("T")[0]}
                  onChange={(e) => setForm((f) => ({ ...f, fechaInicio: e.target.value }))}
                />
              </div>
              <div>
                <Label>Fecha fin</Label>
                <Input
                  type="date"
                  className="mt-1"
                  value={form.fechaFin}
                  min={form.fechaInicio || new Date().toISOString().split("T")[0]}
                  onChange={(e) => setForm((f) => ({ ...f, fechaFin: e.target.value }))}
                />
              </div>
            </div>
            {diasCalc > 0 && (
              <p className="text-sm text-[var(--primary)] font-medium">
                Total: {diasCalc} {diasCalc === 1 ? "día" : "días"}
              </p>
            )}
            <div>
              <Label>Motivo (opcional)</Label>
              <textarea
                className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                rows={3}
                placeholder="Describe el motivo de la ausencia..."
                value={form.motivo}
                onChange={(e) => setForm((f) => ({ ...f, motivo: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? "Enviando..." : "Enviar Solicitud"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

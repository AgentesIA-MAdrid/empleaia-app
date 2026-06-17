"use client";

import { useEffect, useState, useCallback } from "react";
import { CheckCircle, XCircle, Clock, Calendar, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn, formatFecha } from "@/lib/utils";

interface Ausencia {
  id: string;
  fechaInicio: string;
  fechaFin: string;
  dias: number;
  motivo?: string;
  estado: "PENDIENTE" | "APROBADA" | "RECHAZADA" | "CANCELADA";
  comentarioAdmin?: string;
  tipoAusencia: { nombre: string; color: string };
  user: { nombre: string; apellidos: string };
  createdAt: string;
}

const TABS = ["PENDIENTE", "APROBADA", "RECHAZADA", "TODAS"] as const;
type Tab = (typeof TABS)[number];

const ESTADO = {
  PENDIENTE: { label: "Pendiente", color: "bg-amber-100 text-amber-700" },
  APROBADA: { label: "Aprobada", color: "bg-emerald-100 text-emerald-700" },
  RECHAZADA: { label: "Rechazada", color: "bg-red-100 text-red-700" },
  CANCELADA: { label: "Cancelada", color: "bg-slate-100 text-slate-600" },
};

export default function ManagerAusenciasPage() {
  const { toast } = useToast();
  const [ausencias, setAusencias] = useState<Ausencia[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("PENDIENTE");
  const [rechazarId, setRechazarId] = useState<string | null>(null);
  const [comentario, setComentario] = useState("");
  const [procesando, setProcesando] = useState<string | null>(null);

  const fetchAusencias = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ausencias");
      const data = await res.json();
      setAusencias(Array.isArray(data) ? data : (data?.ausencias ?? []));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAusencias(); }, [fetchAusencias]);

  const filtradas = ausencias.filter((a) =>
    tab === "TODAS" ? a.estado !== "CANCELADA" : a.estado === tab
  );

  const pendientesCount = ausencias.filter((a) => a.estado === "PENDIENTE").length;

  const handleAccion = async (id: string, estado: "APROBADA" | "RECHAZADA", comentarioAdmin?: string) => {
    setProcesando(id);
    try {
      const res = await fetch(`/api/ausencias/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado, comentarioAdmin }),
      });
      if (!res.ok) throw new Error();
      toast({
        title: estado === "APROBADA" ? "Ausencia aprobada" : "Ausencia rechazada",
        variant: estado === "APROBADA" ? "default" : "destructive",
      });
      setRechazarId(null);
      setComentario("");
      fetchAusencias();
    } catch {
      toast({ title: "Error al procesar", variant: "destructive" });
    } finally {
      setProcesando(null);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Ausencias</h1>
        <p className="text-slate-500 text-sm mt-1">Gestiona las solicitudes de ausencia de tu equipo</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit flex-wrap">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-4 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5",
              tab === t ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
            )}
          >
            {t === "PENDIENTE" ? "Pendientes" : t === "APROBADA" ? "Aprobadas" : t === "RECHAZADA" ? "Rechazadas" : "Todas"}
            {t === "PENDIENTE" && pendientesCount > 0 && (
              <span className="bg-amber-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                {pendientesCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 bg-slate-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : filtradas.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Calendar className="h-10 w-10 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500">No hay ausencias en esta categoría</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtradas.map((a) => (
            <Card key={a.id} className={cn(a.estado === "PENDIENTE" && "border-amber-200")}>
              <CardContent className="py-4">
                <div className="flex items-start gap-4">
                  <div className="w-1 h-16 rounded-full flex-shrink-0" style={{ backgroundColor: a.tipoAusencia.color }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div>
                        <p className="font-semibold text-slate-900">
                          {a.user.nombre} {a.user.apellidos}
                        </p>
                        <p className="text-sm text-slate-500 mt-0.5">{a.tipoAusencia.nombre}</p>
                      </div>
                      <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium", ESTADO[a.estado].color)}>
                        {ESTADO[a.estado].label}
                      </span>
                    </div>
                    <p className="text-sm text-slate-600 mt-1">
                      {formatFecha(a.fechaInicio)} — {formatFecha(a.fechaFin)}
                      <span className="text-slate-400 ml-2">({a.dias} días)</span>
                    </p>
                    {a.motivo && <p className="text-xs text-slate-400 mt-1">{a.motivo}</p>}
                    {a.comentarioAdmin && (
                      <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" />{a.comentarioAdmin}
                      </p>
                    )}
                  </div>
                  {a.estado === "PENDIENTE" && (
                    <div className="flex gap-2 flex-shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-green-300 text-emerald-600 hover:bg-emerald-50"
                        disabled={procesando === a.id}
                        onClick={() => handleAccion(a.id, "APROBADA")}
                      >
                        <CheckCircle className="h-4 w-4 mr-1" /> Aprobar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-red-300 text-red-600 hover:bg-red-50"
                        disabled={procesando === a.id}
                        onClick={() => setRechazarId(a.id)}
                      >
                        <XCircle className="h-4 w-4 mr-1" /> Rechazar
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Dialog rechazar */}
      <Dialog open={!!rechazarId} onOpenChange={() => setRechazarId(null)}>
        <DialogContent className="max-w-[95vw] sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rechazar ausencia</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Label>Motivo del rechazo (opcional)</Label>
            <textarea
              className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
              rows={3}
              placeholder="Indica el motivo del rechazo..."
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRechazarId(null)}>Cancelar</Button>
            <Button
              variant="destructive"
              disabled={!!procesando}
              onClick={() => rechazarId && handleAccion(rechazarId, "RECHAZADA", comentario)}
            >
              Confirmar rechazo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

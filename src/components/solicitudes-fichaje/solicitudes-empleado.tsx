"use client";

/**
 * Tarjeta del empleado para solicitar el registro de un fichaje olvidado o
 * la corrección de la hora de uno existente, y ver el estado de sus
 * solicitudes. Se inserta en /empleado/mis-fichajes.
 */

import { useCallback, useEffect, useState } from "react";
import { Plus, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type Tipo = "ENTRADA" | "PAUSA" | "VUELTA_PAUSA" | "SALIDA";

interface Solicitud {
  id: string;
  clase: string;
  tipo: Tipo;
  fechaHora: string;
  motivo: string;
  estado: "PENDIENTE" | "APROBADA" | "RECHAZADA" | "CANCELADA";
  respuesta: string | null;
  createdAt: string;
}

const TIPO_LABEL: Record<Tipo, string> = {
  ENTRADA: "Entrada",
  PAUSA: "Pausa",
  VUELTA_PAUSA: "Vuelta de pausa",
  SALIDA: "Salida",
};

const ESTADO_BADGE: Record<string, string> = {
  PENDIENTE: "bg-[var(--warning-bg)] text-[var(--warning-text)]",
  APROBADA: "bg-[var(--success-bg)] text-[var(--success-text)]",
  RECHAZADA: "bg-rose-100 text-rose-700",
  CANCELADA: "bg-muted text-muted-foreground",
};

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const inputCls =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

export function SolicitudesEmpleado() {
  const { toast } = useToast();
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [tipo, setTipo] = useState<Tipo>("ENTRADA");
  const [fechaHora, setFechaHora] = useState("");
  const [motivo, setMotivo] = useState("");

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/solicitudes-fichaje?vista=mias");
      if (r.ok) setSolicitudes(await r.json());
    } catch {
      /* noop */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const enviar = useCallback(async () => {
    if (!fechaHora || motivo.trim().length < 3) {
      toast({ variant: "destructive", title: "Completa fecha/hora y un motivo" });
      return;
    }
    setSubmitting(true);
    try {
      const r = await fetch("/api/solicitudes-fichaje", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clase: "olvido",
          tipo,
          fechaHora: new Date(fechaHora).toISOString(),
          motivo: motivo.trim(),
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? "Error");
      }
      toast({ title: "Solicitud enviada", description: "Tu coordinador la revisará." });
      setOpen(false);
      setFechaHora("");
      setMotivo("");
      setTipo("ENTRADA");
      cargar();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "No se pudo enviar",
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  }, [tipo, fechaHora, motivo, toast, cargar]);

  const cancelar = useCallback(
    async (id: string) => {
      try {
        const r = await fetch(`/api/solicitudes-fichaje/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ estado: "CANCELADA" }),
        });
        if (!r.ok) throw new Error();
        setSolicitudes((prev) =>
          prev.map((s) => (s.id === id ? { ...s, estado: "CANCELADA" } : s)),
        );
      } catch {
        toast({ variant: "destructive", title: "No se pudo cancelar" });
      }
    },
    [toast],
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base">Solicitudes de fichaje</CardTitle>
        <Button size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
          Solicitar
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin text-[var(--primary)]" />
            Cargando…
          </div>
        ) : solicitudes.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-muted-foreground">
            ¿Olvidaste fichar o ficharon a una hora incorrecta? Pulsa “Solicitar”
            y tu coordinador lo aprobará.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {solicitudes.map((s) => (
              <div key={s.id} className="flex items-center justify-between px-6 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {s.clase === "correccion"
                      ? "Corrección"
                      : s.clase === "fuera_horario"
                      ? "Ajuste al turno"
                      : "Registro"}{" "}
                    ·{" "}
                    {TIPO_LABEL[s.tipo]} · {fmt(s.fechaHora)}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{s.motivo}</p>
                  {s.estado === "RECHAZADA" && s.respuesta && (
                    <p className="text-xs text-rose-600">Motivo: {s.respuesta}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
                      ESTADO_BADGE[s.estado],
                    )}
                  >
                    {s.estado}
                  </span>
                  {s.estado === "PENDIENTE" && (
                    <button
                      onClick={() => cancelar(s.id)}
                      className="text-muted-foreground hover:text-rose-600"
                      title="Cancelar"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Solicitar registro de fichaje</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Tipo de fichaje</Label>
              <select
                className={inputCls}
                value={tipo}
                onChange={(e) => setTipo(e.target.value as Tipo)}
              >
                {(Object.keys(TIPO_LABEL) as Tipo[]).map((t) => (
                  <option key={t} value={t}>
                    {TIPO_LABEL[t]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Fecha y hora</Label>
              <input
                type="datetime-local"
                className={inputCls}
                value={fechaHora}
                onChange={(e) => setFechaHora(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Motivo</Label>
              <textarea
                className={cn(inputCls, "min-h-[80px] resize-y")}
                placeholder="Ej.: olvidé fichar la entrada al llegar"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
              Cancelar
            </Button>
            <Button onClick={enviar} disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Enviar solicitud
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

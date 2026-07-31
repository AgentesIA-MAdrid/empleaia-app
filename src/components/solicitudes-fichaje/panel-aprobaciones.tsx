"use client";

/**
 * Panel de aprobación de solicitudes de fichaje. Compartido por la página
 * de OWNER (/admin/solicitudes-fichaje) y la de MANAGER
 * (/manager/solicitudes-fichaje). La API ya filtra por scope del rol, así
 * que el mismo componente sirve para ambos.
 */

import { useCallback, useEffect, useState } from "react";
import { CheckCircle, XCircle, Clock, AlertCircle, Loader2, InboxIcon, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

interface Solicitud {
  id: string;
  clase: string;
  tipo: "ENTRADA" | "PAUSA" | "VUELTA_PAUSA" | "SALIDA";
  fechaHora: string;
  motivo: string;
  estado: string;
  createdAt: string;
  /** Solo en clase "fuera_sede": metros a los que se intentó fichar. */
  distancia?: number | null;
  solicitante: { id: string; nombre: string; apellidos: string };
}

const TIPO_LABEL: Record<string, string> = {
  ENTRADA: "Entrada",
  PAUSA: "Pausa",
  VUELTA_PAUSA: "Vuelta de pausa",
  SALIDA: "Salida",
};

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PanelAprobaciones() {
  const { toast } = useToast();
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [procesando, setProcesando] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/solicitudes-fichaje?vista=aprobaciones&estado=PENDIENTE");
      if (!r.ok) throw new Error();
      setSolicitudes(await r.json());
    } catch {
      setError("No se pudieron cargar las solicitudes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const resolver = useCallback(
    async (id: string, estado: "APROBADA" | "RECHAZADA") => {
      setProcesando(id);
      try {
        let respuesta: string | undefined;
        if (estado === "RECHAZADA") {
          respuesta = window.prompt("Motivo del rechazo (opcional):") ?? undefined;
        }
        const r = await fetch(`/api/solicitudes-fichaje/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ estado, respuesta }),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error ?? "Error");
        }
        toast({
          title: estado === "APROBADA" ? "Solicitud aprobada" : "Solicitud rechazada",
          description:
            estado === "APROBADA" ? "El fichaje se ha registrado." : undefined,
        });
        setSolicitudes((prev) => prev.filter((s) => s.id !== id));
      } catch (e) {
        toast({
          variant: "destructive",
          title: "No se pudo resolver",
          description: e instanceof Error ? e.message : undefined,
        });
      } finally {
        setProcesando(null);
      }
    },
    [toast],
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--primary-light)]">
          <Clock className="h-5 w-5 text-[var(--primary)]" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">Aprobaciones de fichaje</h1>
          <p className="text-sm text-muted-foreground">
            Solicitudes de registro o corrección pendientes de tu aprobación
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="mr-3 h-7 w-7 animate-spin text-[var(--primary)]" />
              Cargando…
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
              <AlertCircle className="h-8 w-8 text-rose-400" />
              <p>{error}</p>
            </div>
          ) : solicitudes.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
              <InboxIcon className="h-10 w-10 opacity-30" />
              <p className="text-sm">No hay solicitudes pendientes</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {solicitudes.map((s) => (
                <div
                  key={s.id}
                  className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground">
                      {s.solicitante.nombre} {s.solicitante.apellidos}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {s.clase === "correccion" ? "Corregir" : "Registrar"}{" "}
                      <span className="font-medium">{TIPO_LABEL[s.tipo] ?? s.tipo}</span> ·{" "}
                      {fmt(s.fechaHora)}
                    </p>
                    {s.clase === "fuera_horario" && (
                      <p className="mt-0.5 inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                        <Clock className="h-3.5 w-3.5" />
                        Fichaje fuera del horario del turno · hora ajustada al cuadrante
                      </p>
                    )}
                    {s.clase === "fuera_sede" && (
                      <p className="mt-0.5 inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                        <MapPin className="h-3.5 w-3.5" />
                        Fichaje fuera de la sede
                        {typeof s.distancia === "number" ? ` · a ${s.distancia} m` : ""}
                      </p>
                    )}
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      <span className="font-medium">Motivo:</span> {s.motivo}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      size="sm"
                      className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
                      disabled={procesando === s.id}
                      onClick={() => resolver(s.id, "APROBADA")}
                    >
                      <CheckCircle className="h-4 w-4" />
                      Aprobar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 text-rose-600 hover:bg-rose-50"
                      disabled={procesando === s.id}
                      onClick={() => resolver(s.id, "RECHAZADA")}
                    >
                      <XCircle className="h-4 w-4" />
                      Rechazar
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

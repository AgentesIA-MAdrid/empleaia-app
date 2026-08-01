"use client";

/**
 * "Mis turnos" — el horario propio de quien mira, sea comercial o coordinadora.
 *
 * Compartido a propósito por `/empleado/mis-turnos` y `/manager/mis-turnos`:
 * el ticket 73 pide que la coordinadora tenga su horario separado del de su
 * equipo, y su horario se consulta exactamente igual que el de cualquiera. La
 * llamada va con `mios=1`, que en el servidor fuerza el filtro por el usuario
 * de la sesión (para un comercial es lo que ya hacía; para la coordinadora, lo
 * que la saca del cuadrante de sus tiendas).
 */


import { useEffect, useState, useCallback } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  Clock,
  Store,
  List,
  CalendarDays,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn, formatFecha } from "@/lib/utils";
import { addDays, startOfWeek, endOfWeek, isSameDay, format, addWeeks, subWeeks, isBefore, startOfDay } from "date-fns";
import { es } from "date-fns/locale";

interface Turno {
  id: string;
  fecha: string;
  horaInicio: string;
  horaFin: string;
  nota?: string;
  estado: "BORRADOR" | "PUBLICADO";
  tienda: { id: string; nombre: string; color: string };
}

const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

export function MisTurnos() {
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [loading, setLoading] = useState(true);
  const [semanaActual, setSemanaActual] = useState(new Date());
  const [vista, setVista] = useState<"semana" | "lista">("semana");

  const inicioSemana = startOfWeek(semanaActual, { weekStartsOn: 1 });
  const finSemana = endOfWeek(semanaActual, { weekStartsOn: 1 });

  const fetchTurnos = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        fechaInicio: inicioSemana.toISOString(),
        fechaFin: (vista === "semana" ? finSemana : addDays(new Date(), 30)).toISOString(),
        estado: "PUBLICADO",
        mios: "1",
      });
      const res = await fetch(`/api/turnos?${params}`);
      const data = await res.json();
      setTurnos(Array.isArray(data) ? data : (data.turnos || []));
    } catch {
      setTurnos([]);
    } finally {
      setLoading(false);
    }
  }, [inicioSemana.toISOString(), finSemana.toISOString(), vista]);

  useEffect(() => { fetchTurnos(); }, [fetchTurnos]);

  const diasSemana = Array.from({ length: 7 }, (_, i) => addDays(inicioSemana, i));
  const hoy = startOfDay(new Date());

  const turnosDia = (dia: Date) =>
    turnos.filter((t) => isSameDay(new Date(t.fecha), dia));

  const turnosFuturos = turnos
    .filter((t) => !isBefore(new Date(t.fecha), hoy))
    .sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime());

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-dark)]">Mis Turnos</h1>
          <p className="text-[var(--text-muted)] text-sm mt-1">Consulta tus turnos asignados</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={vista === "semana" ? "default" : "outline"}
            size="sm"
            onClick={() => setVista("semana")}
          >
            <CalendarDays className="h-4 w-4 mr-1" /> Semana
          </Button>
          <Button
            variant={vista === "lista" ? "default" : "outline"}
            size="sm"
            onClick={() => setVista("lista")}
          >
            <List className="h-4 w-4 mr-1" /> Lista
          </Button>
        </div>
      </div>

      {vista === "semana" && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <Button variant="ghost" size="icon" onClick={() => setSemanaActual(subWeeks(semanaActual, 1))}>
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <div className="text-center">
                <p className="font-semibold text-[var(--text-dark)]">
                  {format(inicioSemana, "d MMM", { locale: es })} — {format(finSemana, "d MMM yyyy", { locale: es })}
                </p>
                <button
                  className="text-xs text-[var(--primary)] hover:underline"
                  onClick={() => setSemanaActual(new Date())}
                >
                  Semana actual
                </button>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setSemanaActual(addWeeks(semanaActual, 1))}>
                <ChevronRight className="h-5 w-5" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
                {Array.from({ length: 7 }).map((_, i) => (
                  <div key={i} className="h-32 bg-[var(--muted)] rounded-xl animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
                {diasSemana.map((dia, i) => {
                  const eHoy = isSameDay(dia, hoy);
                  const turnDia = turnosDia(dia);
                  const esPasado = isBefore(dia, hoy);
                  return (
                    <div
                      key={i}
                      className={cn(
                        "rounded-xl p-2 min-h-[130px] border",
                        eHoy ? "border-[var(--primary)] bg-[var(--primary-light)]" : "border-[var(--border)] bg-[var(--muted)]",
                        esPasado && !eHoy && "opacity-60"
                      )}
                    >
                      <p className={cn("text-xs font-medium text-center mb-1", eHoy ? "text-[var(--primary)]" : "text-[var(--text-muted)]")}>
                        {DIAS[i]}
                      </p>
                      <p className={cn("text-lg font-bold text-center mb-2", eHoy ? "text-[var(--primary)]" : "text-[var(--text-dark)]")}>
                        {format(dia, "d")}
                      </p>
                      {turnDia.length === 0 ? (
                        <p className="text-xs text-[var(--text-muted)] text-center">Libre</p>
                      ) : (
                        turnDia.map((t) => (
                          <div
                            key={t.id}
                            className="rounded-lg p-1.5 mb-1 text-xs text-white font-medium"
                            style={{ backgroundColor: t.tienda.color }}
                          >
                            <div>{t.horaInicio} - {t.horaFin}</div>
                            <div className="truncate opacity-90">{t.tienda.nombre.split(" ").slice(-1)[0]}</div>
                          </div>
                        ))
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {vista === "lista" && (
        <div className="space-y-3">
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-20 bg-[var(--muted)] rounded-xl animate-pulse" />
            ))
          ) : turnosFuturos.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Calendar className="h-10 w-10 text-[var(--text-muted)] mx-auto mb-3" />
                <p className="text-[var(--text-muted)]">No tienes turnos asignados en los próximos 30 días</p>
              </CardContent>
            </Card>
          ) : (
            turnosFuturos.map((t) => {
              const eHoy = isSameDay(new Date(t.fecha), hoy);
              return (
                <Card key={t.id} className={cn("border", eHoy && "border-[var(--primary)]")}>
                  <CardContent className="py-4 flex items-center gap-4">
                    <div
                      className="w-1 h-12 rounded-full flex-shrink-0"
                      style={{ backgroundColor: t.tienda.color }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-[var(--text-dark)] capitalize">
                          {format(new Date(t.fecha), "EEEE, d 'de' MMMM", { locale: es })}
                        </p>
                        {eHoy && <Badge variant="default" className="text-xs">Hoy</Badge>}
                      </div>
                      <div className="flex items-center gap-4 text-sm text-[var(--text-muted)] mt-1">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" />
                          {t.horaInicio} – {t.horaFin}
                        </span>
                        <span className="flex items-center gap-1">
                          <Store className="h-3.5 w-3.5" />
                          {t.tienda.nombre}
                        </span>
                      </div>
                      {t.nota && <p className="text-xs text-[var(--text-muted)] mt-1">{t.nota}</p>}
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

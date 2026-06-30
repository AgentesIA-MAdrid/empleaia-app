"use client";

/**
 * Vista de calendario mensual para ausencias + festivos.
 *
 * Reutilizable por las tres páginas de ausencias (admin / manager / empleado)
 * mediante un toggle lista↔calendario. Pinta, por día:
 *  - Ausencias (no canceladas/rechazadas), con el color de su tipo.
 *  - Festivos como "concedidos" (banda verde).
 *
 * Si `editable` (panel admin), al pulsar un festivo se pueden gestionar sus
 * excepciones por empleado: "quitar" el festivo a alguien = asignarle jornada
 * (horas extra) ese día.
 */

import { useState } from "react";
import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export interface AusenciaCal {
  id: string;
  fechaInicio: string;
  fechaFin: string;
  estado: "PENDIENTE" | "APROBADA" | "RECHAZADA" | "CANCELADA";
  tipoAusencia: { nombre: string; color: string };
  user?: { nombre: string; apellidos: string };
}

export interface FestivoCal {
  id: string;
  nombre: string;
  fecha: string;
  ambito: string;
  tiendaId: string | null;
  tienda?: { id: string; nombre: string } | null;
  excepciones?: { userId: string }[];
}

export interface EmpleadoCal {
  id: string;
  nombre: string;
  apellidos: string;
}

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];
const DOW = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

const pad = (n: number) => String(n).padStart(2, "0");
const claveDia = (year: number, month: number, day: number) =>
  `${year}-${pad(month + 1)}-${pad(day)}`;

export function CalendarioAusencias({
  ausencias,
  festivos,
  empleados = [],
  editable = false,
  onChange,
}: {
  ausencias: AusenciaCal[];
  festivos: FestivoCal[];
  empleados?: EmpleadoCal[];
  editable?: boolean;
  onChange?: () => void;
}) {
  const { toast } = useToast();
  const hoy = new Date();
  const [cursor, setCursor] = useState(
    () => new Date(hoy.getFullYear(), hoy.getMonth(), 1),
  );
  const [festivoSel, setFestivoSel] = useState<FestivoCal | null>(null);
  const [nuevoUserId, setNuevoUserId] = useState("");
  const [procesando, setProcesando] = useState(false);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const startWeekday = (new Date(year, month, 1).getDay() + 6) % 7; // 0 = lunes
  const diasMes = new Date(year, month + 1, 0).getDate();

  // Celdas: huecos iniciales + días del mes.
  const celdas: (number | null)[] = [
    ...Array.from({ length: startWeekday }, () => null),
    ...Array.from({ length: diasMes }, (_, i) => i + 1),
  ];
  while (celdas.length % 7 !== 0) celdas.push(null);

  const ausenciasVisibles = ausencias.filter(
    (a) => a.estado === "APROBADA" || a.estado === "PENDIENTE",
  );

  const claveHoy = claveDia(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());

  function ausenciasDeDia(clave: string) {
    return ausenciasVisibles.filter(
      (a) => a.fechaInicio.slice(0, 10) <= clave && a.fechaFin.slice(0, 10) >= clave,
    );
  }
  function festivosDeDia(clave: string) {
    return festivos.filter((f) => f.fecha.slice(0, 10) === clave);
  }

  const nombreEmpleado = (id: string) => {
    const e = empleados.find((x) => x.id === id);
    return e ? `${e.nombre} ${e.apellidos}` : "Empleado";
  };

  // El festivo seleccionado puede haberse refrescado en el padre: re-lee del array.
  const festivoActual = festivoSel
    ? festivos.find((f) => f.id === festivoSel.id) ?? festivoSel
    : null;
  const excepcionesActuales = festivoActual?.excepciones ?? [];
  const empleadosDisponibles = empleados.filter(
    (e) => !excepcionesActuales.some((x) => x.userId === e.id),
  );

  async function quitarFestivo(userId: string) {
    if (!festivoActual || !userId) return;
    setProcesando(true);
    try {
      const res = await fetch(`/api/festivos/${festivoActual.id}/excepciones`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) throw new Error();
      setNuevoUserId("");
      toast({ title: "Festivo quitado", description: "Ese día será laborable para esa persona" });
      onChange?.();
    } catch {
      toast({ title: "Error al quitar el festivo", variant: "destructive" });
    } finally {
      setProcesando(false);
    }
  }

  async function restaurarFestivo(userId: string) {
    if (!festivoActual) return;
    setProcesando(true);
    try {
      const res = await fetch(
        `/api/festivos/${festivoActual.id}/excepciones?userId=${encodeURIComponent(userId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error();
      toast({ title: "Festivo restaurado" });
      onChange?.();
    } catch {
      toast({ title: "Error al restaurar el festivo", variant: "destructive" });
    } finally {
      setProcesando(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Cabecera con navegación de mes */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCursor(new Date(year, month - 1, 1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h2 className="text-base font-semibold text-slate-900">
          {MESES[month]} {year}
        </h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCursor(new Date(year, month + 1, 1))}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="rounded-xl border border-slate-200 overflow-hidden">
        {/* Cabecera días de la semana */}
        <div className="grid grid-cols-7 bg-slate-50 text-center text-xs font-medium text-slate-500">
          {DOW.map((d) => (
            <div key={d} className="py-2 border-b border-slate-200">{d}</div>
          ))}
        </div>
        {/* Rejilla de días */}
        <div className="grid grid-cols-7">
          {celdas.map((dia, idx) => {
            if (dia === null) {
              return <div key={`empty-${idx}`} className="min-h-[88px] border-b border-r border-slate-100 bg-slate-50/40" />;
            }
            const clave = claveDia(year, month, dia);
            const ausDia = ausenciasDeDia(clave);
            const festDia = festivosDeDia(clave);
            const esHoy = clave === claveHoy;
            return (
              <div
                key={clave}
                className={cn(
                  "min-h-[88px] border-b border-r border-slate-100 p-1.5 align-top",
                  (idx + 1) % 7 === 0 && "border-r-0",
                )}
              >
                <div className={cn(
                  "text-xs font-medium mb-1 inline-flex h-5 w-5 items-center justify-center rounded-full",
                  esHoy ? "bg-[var(--primary)] text-white" : "text-slate-500",
                )}>
                  {dia}
                </div>
                <div className="space-y-0.5">
                  {festDia.map((f) => {
                    const nExcep = f.excepciones?.length ?? 0;
                    return (
                      <button
                        key={f.id}
                        type="button"
                        disabled={!editable}
                        onClick={() => editable && setFestivoSel(f)}
                        title={`${f.nombre}${f.ambito === "local" && f.tienda ? ` · ${f.tienda.nombre}` : ""}`}
                        className={cn(
                          "block w-full truncate rounded px-1 py-0.5 text-left text-[10px] font-medium bg-emerald-100 text-emerald-700",
                          editable && "hover:bg-emerald-200 cursor-pointer",
                        )}
                      >
                        🎉 {f.nombre}
                        {nExcep > 0 && <span className="ml-1 text-emerald-500">−{nExcep}</span>}
                      </button>
                    );
                  })}
                  {ausDia.map((a) => (
                    <div
                      key={a.id}
                      title={`${a.user ? `${a.user.nombre} ${a.user.apellidos} · ` : ""}${a.tipoAusencia.nombre}${a.estado === "PENDIENTE" ? " (pendiente)" : ""}`}
                      className={cn(
                        "truncate rounded px-1 py-0.5 text-[10px] text-white",
                        a.estado === "PENDIENTE" && "opacity-60",
                      )}
                      style={{ backgroundColor: a.tipoAusencia.color }}
                    >
                      {a.user ? `${a.user.nombre} ${a.user.apellidos}` : a.tipoAusencia.nombre}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Leyenda */}
      <div className="flex items-center gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded bg-emerald-100" /> Festivo
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded bg-slate-400 opacity-60" /> Pendiente
        </span>
      </div>

      {/* Dialog de gestión de excepciones del festivo (solo admin) */}
      <Dialog open={!!festivoSel} onOpenChange={(o) => { if (!o) { setFestivoSel(null); setNuevoUserId(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{festivoActual?.nombre}</DialogTitle>
          </DialogHeader>
          {festivoActual && (
            <div className="space-y-4 py-1">
              <p className="text-sm text-slate-500">
                {festivoActual.fecha.slice(0, 10)} ·{" "}
                {festivoActual.ambito === "local"
                  ? `Local${festivoActual.tienda ? ` — ${festivoActual.tienda.nombre}` : ""}`
                  : "Nacional"}
              </p>

              <div>
                <p className="text-sm font-medium text-slate-700 mb-2">
                  Trabajan este día (festivo quitado)
                </p>
                {excepcionesActuales.length === 0 ? (
                  <p className="text-sm text-slate-400 italic">
                    Nadie: el festivo aplica a toda la plantilla{festivoActual.ambito === "local" ? " de la sede" : ""}.
                  </p>
                ) : (
                  <div className="space-y-1">
                    {excepcionesActuales.map((e) => (
                      <div
                        key={e.userId}
                        className="flex items-center justify-between rounded-md bg-slate-50 px-2 py-1.5 text-sm"
                      >
                        <span className="text-slate-700">{nombreEmpleado(e.userId)}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-slate-400 hover:text-emerald-600"
                          disabled={procesando}
                          onClick={() => restaurarFestivo(e.userId)}
                          title="Restaurar festivo para esta persona"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-700 mb-1">
                    Asignar día de trabajo a…
                  </p>
                  <Select value={nuevoUserId} onValueChange={setNuevoUserId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecciona empleado…" />
                    </SelectTrigger>
                    <SelectContent>
                      {empleadosDisponibles.map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.nombre} {e.apellidos}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  disabled={!nuevoUserId || procesando}
                  onClick={() => quitarFestivo(nuevoUserId)}
                >
                  <Plus className="h-4 w-4 mr-1" /> Quitar
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

"use client";

/**
 * Área "Objetivos de venta", con sus dos subáreas:
 *
 *  1. **Definición de objetivos** — la parrilla de siempre: el objetivo de cada
 *     comercial, de cada punto de venta, por grupo de productos y por producto,
 *     más el objetivo de zona de coordinación.
 *  2. **Seguimiento de objetivos** — cómo va el mes día a día, con filtros y
 *     descarga en CSV de lo que se esté mirando.
 *
 * El mes vive aquí y no dentro de cada subárea porque los objetivos son
 * mensuales y las dos hablan del mismo mes: se cambia una vez arriba y las dos
 * pestañas siguen mirando lo mismo. Arriba se ve además qué mes se está
 * mirando ("Julio de 2026 · mes en curso"), que era justo lo que se pedía: que
 * no haya que deducirlo del contenido de la tabla.
 *
 * Las pestañas se pintan como en `/admin/informes`, que es el otro sitio del
 * producto donde una pantalla tiene dos vistas del mismo dato.
 */

import { useState } from "react";
import { CalendarRange, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ObjetivosVenta } from "@/components/cierre-turno/objetivos-venta";
import { SeguimientoObjetivos } from "@/components/cierre-turno/seguimiento-objetivos";

type Subarea = "definicion" | "seguimiento";

/** Mes en curso como "YYYY-MM" en horario peninsular. */
function mesActual(): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit" })
      .formatToParts(new Date())
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}`;
}

/** "Julio de 2026" a partir de "2026-07". */
function nombreDelMes(mes: string): string {
  const texto = new Intl.DateTimeFormat("es-ES", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${mes}-01T00:00:00Z`));
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** Mes vecino ("2026-01" − 1 = "2025-12"). */
function mesDesplazado(mes: string, meses: number): string {
  const [anio, m] = mes.split("-").map((x) => Number.parseInt(x, 10));
  const d = new Date(Date.UTC(anio, m - 1 + meses, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function ObjetivosVentaArea({ titulo, descripcion }: { titulo: string; descripcion: string }) {
  const [mes, setMes] = useState(mesActual());
  const [subarea, setSubarea] = useState<Subarea>("definicion");

  const hoy = mesActual();
  const etiqueta = mes === hoy ? "Mes en curso" : mes < hoy ? "Mes cerrado" : "Mes por venir";

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{titulo}</h1>
        <p className="text-slate-500 text-sm mt-1 max-w-2xl">{descripcion}</p>
      </div>

      {/* El mes que se está mirando, arriba del todo y para las dos subáreas:
          los objetivos son mensuales y sin decir de qué mes son, una tabla de
          consecución no significa nada. */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-end gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <CalendarRange className="h-5 w-5 text-[var(--primary)]" />
              <div>
                <p className="text-xl font-bold text-slate-900 leading-tight">{nombreDelMes(mes)}</p>
                <p className="text-xs text-slate-400">{etiqueta}</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                aria-label="Mes anterior"
                onClick={() => setMes(mesDesplazado(mes, -1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                aria-label="Mes siguiente"
                onClick={() => setMes(mesDesplazado(mes, 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <div>
              <Label htmlFor="objetivos-mes">Ver otro mes</Label>
              <Input
                id="objetivos-mes"
                type="month"
                className="mt-1 w-44"
                value={mes}
                onChange={(e) => setMes(e.target.value || mesActual())}
              />
            </div>
            {mes !== hoy && (
              <Button variant="ghost" size="sm" onClick={() => setMes(hoy)}>
                Volver al mes en curso
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-2 border-b border-slate-200">
        {(
          [
            { key: "definicion" as const, label: "Definición de objetivos" },
            { key: "seguimiento" as const, label: "Seguimiento de objetivos" },
          ]
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setSubarea(t.key)}
            aria-current={subarea === t.key ? "page" : undefined}
            className={
              subarea === t.key
                ? "px-3 py-2 text-sm font-semibold text-[var(--primary)] border-b-2 border-[var(--primary)] -mb-px"
                : "px-3 py-2 text-sm text-slate-500 hover:text-slate-800"
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {subarea === "definicion" ? <ObjetivosVenta mes={mes} /> : <SeguimientoObjetivos mes={mes} />}
    </div>
  );
}

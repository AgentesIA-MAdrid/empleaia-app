"use client";

/**
 * Marco de las áreas del módulo cuya funcionalidad llega en entregas
 * posteriores (Objetivos, Arqueos, Conciliación).
 *
 * Muestra la estructura real —para qué sirve el área, qué filtros tendrá y qué
 * columnas— y dice con claridad que todavía no opera. Una pantalla en blanco
 * confunde; una que finge funcionar es peor.
 */

import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function AreaPendiente({
  titulo,
  descripcion,
  entrega,
  filtros,
  columnas,
  nota,
}: {
  titulo: string;
  descripcion: string;
  /** Qué entrega del plan la pone en marcha. */
  entrega: string;
  filtros: string[];
  columnas: string[];
  nota?: ReactNode;
}) {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text-dark)]">{titulo}</h1>
        <p className="text-[var(--text-muted)] text-sm mt-1 max-w-2xl">{descripcion}</p>
      </div>

      <div className="rounded-md border border-[var(--border)] bg-[var(--muted)] px-3 py-2.5 text-sm text-[var(--text-body)] flex items-start gap-2 max-w-2xl">
        <Info className="h-4 w-4 mt-0.5 shrink-0 text-[var(--text-muted)]" />
        <span>
          Área ya creada y con permisos aplicados; entra en funcionamiento en la{" "}
          <strong className="font-semibold text-[var(--text-dark)]">{entrega}</strong>.
        </span>
      </div>

      <Card>
        <CardContent className="pt-4 pb-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">
            Filtros
          </p>
          <div className="flex flex-wrap gap-2">
            {filtros.map((f) => (
              <span
                key={f}
                className="px-2.5 py-1 rounded border border-dashed border-[var(--border-strong)] text-sm text-[var(--text-muted)]"
              >
                {f}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-[var(--muted)] border-b border-[var(--border)]">
                <tr>
                  {columnas.map((c) => (
                    <th
                      key={c}
                      className="text-left text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] px-4 py-3"
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td colSpan={columnas.length} className="text-center py-10 text-[var(--text-muted)] text-sm">
                    Sin datos todavía.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {nota && <div className="text-sm text-[var(--text-muted)] max-w-2xl">{nota}</div>}
    </div>
  );
}

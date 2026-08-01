"use client";

/**
 * `<PlanUsageCard>` — muestra uso vs límite de los limits con `current`.
 * Plan Fase 5 §5 commit 15.
 *
 * Lee de useFeatures() (sessionStorage caché). Renderiza solo limits
 * con `current` opt-in (max_employees, max_tiendas). Los otros limits
 * (historial_meses, max_storage_mb) se omiten — no tienen barra de
 * progreso porque no hay loader del current.
 *
 * Estados:
 *  - Cargando → skeleton.
 *  - Sin features → null.
 *  - max=null → "Sin límite".
 *  - current >= max * 0.8 → barra ámbar + texto upgrade.
 *  - current >= max → barra roja + UpsellCTA.
 */

import Link from "next/link";
import { useFeatures } from "@/lib/hooks/use-features";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Store, AlertTriangle } from "lucide-react";

type LimitDef = {
  key: "max_employees" | "max_tiendas";
  label: string;
  icon: typeof Users;
};

const TRACKED: LimitDef[] = [
  { key: "max_employees", label: "Empleados activos", icon: Users },
  { key: "max_tiendas", label: "Sedes activas", icon: Store },
];

export function PlanUsageCard() {
  const { data, loading } = useFeatures();

  if (loading || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Uso del plan</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-12 animate-pulse rounded bg-[var(--muted)]" />
        </CardContent>
      </Card>
    );
  }

  const rows = TRACKED.flatMap((def) => {
    const limit = data.limits[def.key];
    if (!limit) return [];
    return [{ ...def, current: limit.current ?? null, max: limit.max }];
  });
  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Uso del plan</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.map((row) => {
          const Icon = row.icon;
          const max = row.max;
          const current = row.current;
          const ratio =
            max !== null && current !== null && max > 0 ? current / max : 0;
          const overLimit = max !== null && current !== null && current >= max;
          const nearLimit = max !== null && ratio >= 0.8 && !overLimit;

          return (
            <div key={row.key}>
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="flex items-center gap-2 text-[var(--text-body)]">
                  <Icon className="h-4 w-4" />
                  {row.label}
                </span>
                <span className="font-medium text-[var(--text-dark)]">
                  {current ?? "—"}
                  {max !== null ? ` / ${max}` : " / sin límite"}
                </span>
              </div>
              {max !== null && (
                <div className="h-2 rounded bg-[var(--muted)] overflow-hidden">
                  <div
                    className={
                      overLimit
                        ? "h-full bg-[var(--danger)]"
                        : nearLimit
                          ? "h-full bg-[var(--warning)]"
                          : "h-full bg-indigo-500"
                    }
                    style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }}
                  />
                </div>
              )}
              {(nearLimit || overLimit) && (
                <Link
                  href={`/admin/configuracion/facturacion?upgrade=${row.key}`}
                  className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--warning-text)] hover:underline"
                >
                  <AlertTriangle className="h-3 w-3" />
                  {overLimit
                    ? "Has alcanzado el límite — actualiza tu plan"
                    : "Cerca del límite — considera actualizar"}
                </Link>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

/**
 * GET /api/me/features — devuelve la matriz de features del tenant.
 * ADR-004 §2.6 + plan Fase 5 §4.
 *
 * Shape de respuesta:
 *
 * {
 *   "booleans": { "geofencing": true, "export_csv": true, ... },
 *   "limits":   {
 *     "max_employees":   { "current": 12, "max": 50 },
 *     "max_tiendas":     { "current": 2,  "max": 5 },
 *     "historial_meses": { "max": 36 },          // sin current
 *     "max_storage_mb":  { "max": 5000 }         // sin current
 *   },
 *   "quotas":   {
 *     "emails_mes":  { "used": 230, "max": 5000, "resetAt": "..." },
 *     ...
 *   }
 * }
 *
 * Clasificación: el catálogo `master.features.type` es la fuente de verdad
 * (boolean | limit | quota). NO se infiere del tipo de `value`, porque
 * limit y quota son ambos numéricos.
 *
 * `current` opt-in: solo `max_employees` y `max_tiendas` (plan §15.3).
 * Los otros limits se exponen sin `current`.
 *
 * Quotas: si no existe fila en `tenant_quota_usage` para el periodo actual
 * (caso típico: tenant recién provisionado, aún sin consumo registrado), se
 * sintetiza `{ used: 0, max: feature.value, resetAt: <fin del periodo> }`
 * usando `computeCurrentPeriod()` para alinearse con `tenants-provision.ts`.
 *
 * Cliente cachea en sessionStorage (5 min). Hook useFeatures (commit 7).
 */

import { withTenant } from "@/lib/tenant/with-tenant";
import { currentTenant } from "@/lib/tenant/context";
import { auth } from "@/lib/auth";
import { prismaApp, prismaRuntime } from "@/lib/prisma";
import { NextResponse } from "next/server";
import type { ResolvedFeature } from "@/lib/tenant/features";
import { computeCurrentPeriod, type QuotaPeriod } from "@/lib/feature-guard/period";
import {
  loadTypedFeatureCatalog,
  type FeatureMeta,
} from "@/lib/feature-guard/catalog";

type LimitOut = { current?: number; max: number | null };
type QuotaOut = { used: number; max: number | null; resetAt: string };

/**
 * Loaders del campo `current` para limits — solo los que pueden
 * calcularse con un count barato. Ver plan §15.3.
 */
const LIMIT_CURRENT_LOADERS: Record<string, () => Promise<number>> = {
  max_employees: () => prismaApp.user.count({ where: { activo: true } }),
  max_tiendas: () => prismaApp.tienda.count({ where: { activa: true } }),
};

export const GET = withTenant(async () => {
  // Sin sesión no se responde: `current` expone plantilla activa y número
  // de tiendas del cliente, y las quotas su consumo. `withTenant` no
  // autentica (sólo cruza el JWT con el host cuando el JWT existe).
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const ctx = currentTenant();

  const catalog = await loadTypedFeatureCatalog();

  const booleans: Record<string, boolean> = {};
  const limits: Record<string, LimitOut> = {};
  const quotaKeys: { key: string; max: number | null; period: QuotaPeriod }[] = [];

  for (const [key, feature] of ctx.features.entries()) {
    const meta = catalog.get(key);
    if (!meta) {
      // Feature en tenant_features pero no en catálogo activo:
      // catálogo se considera fuente de verdad. Omitir.
      continue;
    }
    classifyFeature(key, feature, meta, booleans, limits, quotaKeys);
  }

  // Calcular `current` opt-in para los limits con loader.
  for (const [key, loader] of Object.entries(LIMIT_CURRENT_LOADERS)) {
    if (limits[key]) {
      try {
        limits[key].current = await loader();
      } catch {
        // Loader falló (e.g. tabla aún no migrada en tenant nuevo).
        // Omitir current — el front no muestra barra de progreso.
      }
    }
  }

  // Quotas: leer filas existentes de master.tenant_quota_usage para el
  // periodo actual y, para las que no tengan fila, sintetizar con used=0.
  const now = new Date();
  const usageRows = await prismaRuntime.tenantQuotaUsage.findMany({
    where: {
      tenantId: ctx.tenantId,
      periodStart: { lte: now },
      periodEnd: { gt: now },
    },
  });
  const usageByKey = new Map(usageRows.map((r) => [r.featureKey, r] as const));

  const quotas: Record<string, QuotaOut> = {};
  for (const q of quotaKeys) {
    const row = usageByKey.get(q.key);
    if (row) {
      quotas[q.key] = {
        used: Number(row.consumed),
        max: row.max === null ? null : Number(row.max),
        resetAt: row.periodEnd.toISOString(),
      };
    } else {
      const { end } = computeCurrentPeriod(q.period, now);
      quotas[q.key] = {
        used: 0,
        max: q.max,
        resetAt: end.toISOString(),
      };
    }
  }

  return NextResponse.json({ booleans, limits, quotas });
});

function classifyFeature(
  key: string,
  feature: ResolvedFeature,
  meta: FeatureMeta,
  booleans: Record<string, boolean>,
  limits: Record<string, LimitOut>,
  quotaKeys: { key: string; max: number | null; period: QuotaPeriod }[],
): void {
  if (meta.type === "boolean") {
    booleans[key] = feature.value === true;
    return;
  }
  if (meta.type === "limit") {
    limits[key] = {
      max: typeof feature.value === "number" ? feature.value : null,
    };
    return;
  }
  if (meta.type === "quota") {
    if (meta.quotaPeriod === null) {
      // Catálogo inconsistente: type=quota sin quota_period. Omitir.
      return;
    }
    quotaKeys.push({
      key,
      max: typeof feature.value === "number" ? feature.value : null,
      period: meta.quotaPeriod,
    });
  }
}

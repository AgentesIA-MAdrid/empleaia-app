/**
 * POST /api/cron/recordatorio-fichaje
 *
 * Recorre todos los tenants activos y, para cada uno, detecta empleados con
 * un turno PUBLICADO ya empezado (con margen de gracia) que no han fichado
 * la entrada, y avisa al empleado y a su coordinador (in-app + email).
 *
 * Pensado para dispararse desde un cron de Dokploy cada ~10–15 min en
 * horario laboral:
 *   curl -fsS -X POST https://<host>/api/cron/recordatorio-fichaje \
 *        -H "Authorization: Bearer $CRON_SECRET"
 *
 * Auth: header `Authorization: Bearer ${CRON_SECRET}` (mismo secreto que el
 * resto de crons de plataforma). Idempotente: cada turno se avisa una sola
 * vez (Turno.avisoFichajeEnviadoAt).
 */

import { NextResponse, type NextRequest } from "next/server";
import { prismaMaster, prismaApp } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant/context";
import { detectarOlvidosFichaje } from "@/lib/worker/jobs/recordatorio-fichaje";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const expected = process.env.CRON_SECRET;
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const ahora = new Date();
  const tenants = await prismaMaster.tenant.findMany({
    where: { status: "active" },
    select: { id: true, slug: true },
  });

  type Result = { slug: string; revisados: number; avisados: number; error?: string };
  const results: Result[] = [];

  for (const t of tenants) {
    try {
      const r = await runWithTenant(
        { tenantId: t.id, slug: t.slug, status: "active", features: new Map() },
        async () => detectarOlvidosFichaje(prismaApp, ahora),
      );
      results.push({ slug: t.slug, revisados: r.revisados, avisados: r.avisados });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[cron/recordatorio-fichaje] tenant=${t.slug} error:`, msg);
      results.push({ slug: t.slug, revisados: 0, avisados: 0, error: msg });
    }
  }

  const totalAvisados = results.reduce((acc, r) => acc + r.avisados, 0);
  return NextResponse.json({ ok: true, tenantsProcesados: results.length, totalAvisados, results });
}

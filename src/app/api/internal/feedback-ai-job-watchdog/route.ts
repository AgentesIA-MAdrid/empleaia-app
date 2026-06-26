/**
 * POST /api/internal/feedback-ai-job-watchdog
 *
 * Cron: rescata jobs zombi de "Resolver con Claude". Un job en `ejecutando`
 * cuyo heartbeat (`updatedAt`) sea más viejo que STALE_MIN se marca `fallido`,
 * liberando la cola. Si el runner muere, el latido se detiene y este guard lo
 * recupera. Sin auto-retry: queda `fallido` hasta que el admin lo relance.
 *
 * Auth: header `Authorization: Bearer ${CRON_SECRET}` (mismo patrón que el
 * resto de crons de plataforma — el cron de Dokploy lo dispara).
 */

import { NextResponse, type NextRequest } from "next/server";
import { prismaMaster } from "@/lib/prisma";
import { transitionAiJob } from "@/lib/feedback/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STALE_MIN = Number(process.env.FEEDBACK_AI_JOB_STALE_MIN || 15);

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const expected = process.env.CRON_SECRET;
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - STALE_MIN * 60 * 1000);
  const zombies = await prismaMaster.feedbackAiJob.findMany({
    where: { status: "ejecutando", updatedAt: { lt: cutoff } },
    select: { id: true },
  });

  let rescued = 0;
  for (const job of zombies) {
    const r = await transitionAiJob(job.id, "fallido", {
      error: `runner sin latido > ${STALE_MIN} min — job zombi rescatado por el watchdog`,
    });
    if (r.ok) rescued++;
  }

  return NextResponse.json({ ok: true, summary: { scanned: zombies.length, rescued, stale_min: STALE_MIN } });
}

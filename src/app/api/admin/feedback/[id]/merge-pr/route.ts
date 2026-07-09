import { NextResponse, type NextRequest } from "next/server";
import { withSuperAdmin } from "@/lib/admin/with-super-admin";
import { getLatestAiJob } from "@/lib/feedback/repository";
import { mergePr } from "@/lib/telegram/github";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/admin/feedback/[id]/merge-pr — mergea (squash) el PR del último job.
// Misma lógica que la acción `mergearPr` del bot de Telegram: el webhook de
// GitHub marcará el job como desplegado y resolverá el ticket + avisará al
// cliente en unos segundos.
export const POST = withSuperAdmin(async (req: NextRequest) => {
  const segments = new URL(req.url).pathname.split("/").filter(Boolean);
  const id = segments[segments.indexOf("feedback") + 1];
  if (!id || !UUID_RE.test(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 });

  const job = await getLatestAiJob(id);
  if (!job?.pr_url) return NextResponse.json({ error: "Este ticket no tiene un PR abierto" }, { status: 404 });

  const r = await mergePr(job.pr_url);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
  return NextResponse.json({ ok: true });
});

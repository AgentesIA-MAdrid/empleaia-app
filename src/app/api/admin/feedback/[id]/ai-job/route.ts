import { NextResponse, type NextRequest } from "next/server";
import { withSuperAdmin } from "@/lib/admin/with-super-admin";
import { getLatestAiJob, listJobEvents } from "@/lib/feedback/repository";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/admin/feedback/[id]/ai-job — último job + timeline (poll del panel).
// La captura del resumen se sirve por el endpoint screenshot (?adjunto=<id>).
export const GET = withSuperAdmin(async (req: NextRequest) => {
  const segments = new URL(req.url).pathname.split("/").filter(Boolean);
  const id = segments[segments.indexOf("feedback") + 1];
  if (!id || !UUID_RE.test(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 });

  const job = await getLatestAiJob(id);
  const events = job ? await listJobEvents(job.id) : [];
  return NextResponse.json({ job, events, resumen_adjunto_path: job?.resumen_adjunto_path ?? null });
});

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireServiceAuth } from "@/lib/internal/auth";
import { addJobEvent } from "@/lib/feedback/repository";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const Body = z.object({
  phase: z.enum(["preparando", "analizando", "verificando", "subiendo", "pr_abierto", "sin_cambios", "fallido"]),
  detail: z.string().max(2000).optional(),
});

// POST /api/internal/feedback-ai-job/[id]/progress
// El runner reporta un hito de progreso (HMAC). Traza paralela append-only; no
// valida la máquina de estados (eso lo hace /callback).
export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();
  const authError = requireServiceAuth(req, rawBody);
  if (authError) return authError;

  const segments = new URL(req.url).pathname.split("/").filter(Boolean);
  const jobId = segments[segments.indexOf("feedback-ai-job") + 1];
  if (!jobId || !UUID_RE.test(jobId)) {
    return NextResponse.json({ error: "job id inválido" }, { status: 400 });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(JSON.parse(rawBody));
  } catch (e) {
    return NextResponse.json(
      { error: "Invalid body", detail: e instanceof Error ? e.message : "parse error" },
      { status: 400 },
    );
  }

  try {
    await addJobEvent(jobId, body.phase, body.detail);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    const status = /foreign key|violates|constraint/i.test(msg) ? 404 : 500;
    return NextResponse.json({ error: "no se pudo registrar el evento" }, { status });
  }

  return NextResponse.json({ ok: true });
}

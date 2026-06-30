import { NextResponse } from "next/server";
import { z } from "zod";
import { requireServiceAuth } from "@/lib/internal/auth";
import {
  transitionAiJob,
  recordJobOutcome,
  getTicketById,
  getTicketOrgName,
} from "@/lib/feedback/repository";
import { sendJobResultAlert } from "@/lib/feedback/send-emails";
import { TERMINAL_STATES } from "@/lib/feedback/ai-jobs";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// El runner solo reporta estos eventos (encolado lo pone el app al encolar).
const Body = z.object({
  event: z.enum(["ejecutando", "pr_abierto", "sin_cambios", "fallido"]),
  pr_url: z.string().max(500).optional(),
  branch: z.string().max(200).optional(),
  error: z.string().max(5000).optional(),
  diagnostico: z.string().max(10000).optional(),
  resumen: z.string().max(5000).optional(),
  resumen_adjunto_path: z.string().max(500).optional(),
});

// POST /api/internal/feedback-ai-job/[id]/callback
// El runner reporta el avance del job (HMAC). La transición se valida contra la
// máquina de estados (idempotente); los efectos terminales solo en `changed`.
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

  const result = await transitionAiJob(jobId, body.event, {
    pr_url: body.pr_url,
    branch: body.branch,
    error: body.error,
  });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 409 });

  // Efectos terminales SOLO en la transición real (un callback duplicado no
  // duplica mensajes/emails). Best-effort: el estado ya está persistido.
  if (result.changed) {
    const job = result.job;
    if (body.event === "pr_abierto" || body.event === "sin_cambios") {
      try {
        await recordJobOutcome(job, {
          diagnostico: body.diagnostico,
          resumen: body.resumen,
          adjuntoPath: body.resumen_adjunto_path,
        });
      } catch (e) {
        console.error(`[feedback-ai-job] registrar salida falló (job ${jobId}):`, e);
      }
    }
    if ((TERMINAL_STATES as readonly string[]).includes(body.event)) {
      try {
        const ticket = await getTicketById(job.ticket_id);
        if (ticket) {
          const org_name = await getTicketOrgName(ticket.org_id);
          await sendJobResultAlert({
            resultado: body.event as "pr_abierto" | "sin_cambios" | "fallido",
            ticket: { id: ticket.id, numero: ticket.numero, tipo: ticket.tipo, descripcion: ticket.descripcion, pagina: ticket.pagina },
            org_name,
            pr_url: job.pr_url,
            error: job.error,
          });
        }
      } catch (e) {
        console.error(`[feedback-ai-job] email de resultado falló (job ${jobId}):`, e);
      }
    }
  }

  return NextResponse.json({ ok: true, job: result.job });
}

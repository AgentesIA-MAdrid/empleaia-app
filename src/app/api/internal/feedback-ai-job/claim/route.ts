import { NextResponse } from "next/server";
import { requireServiceAuth } from "@/lib/internal/auth";
import { claimNextAiJob, getTicketById, listMessages, isRunnerEnabled } from "@/lib/feedback/repository";
import { buildClaudePrompt } from "@/lib/feedback/claude-prompt";

export const dynamic = "force-dynamic";

// POST /api/internal/feedback-ai-job/claim
// El runner lo llama en cada ciclo de polling. Reclama atómicamente el siguiente
// job encolado (encolado→ejecutando) y devuelve el job + el prompt ya construido.
// { job: null } si no hay cola. (Las capturas del usuario aún no se entregan al
// runner — v1; el prompt funciona sin ellas.)
export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();
  const authError = requireServiceAuth(req, rawBody);
  if (authError) return authError;

  // Kill-switch: si el runner está desactivado (FEEDBACK_RUNNER_DISABLED=1) no
  // reclamamos → la cola se acumula y el runner queda idle sin redeploy.
  if (!(await isRunnerEnabled())) return NextResponse.json({ job: null, paused: true });

  const job = await claimNextAiJob();
  if (!job) return NextResponse.json({ job: null });

  const ticket = await getTicketById(job.ticket_id);
  if (!ticket) return NextResponse.json({ job, ticket: null });

  const messages = await listMessages(job.ticket_id);
  // Claude SIEMPRE recibe la conversación completa del ticket. Las instrucciones
  // del admin (prompt_override) se añaden como sección prioritaria, no
  // reemplazan el contexto — así no hay que copiar/pegar el hilo a mano.
  const prompt = buildClaudePrompt({
    ticket: {
      id: ticket.id,
      tipo: ticket.tipo,
      descripcion: ticket.descripcion,
      pagina: ticket.pagina,
      created_at: ticket.created_at,
    },
    messages: messages.map((m) => ({ autor: m.autor, cuerpo: m.cuerpo, is_ai: m.is_ai })),
    instruccionesAdmin: job.prompt_override ?? undefined,
  });

  return NextResponse.json({
    job,
    prompt,
    ticket: { id: ticket.id, screenshot_paths: ticket.screenshot_paths ?? [] },
    screenshots: [],
  });
}

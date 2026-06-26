import { NextResponse } from "next/server";
import { verifyFeedbackActionToken } from "@/lib/feedback/action-token";
import {
  getTicketById,
  consumeActionToken,
  enqueueAiJob,
  updateTicket,
  addMessage,
} from "@/lib/feedback/repository";
import { checkRate } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const MAX_COMMENT_LEN = 2000;
const APP_URL = process.env.APP_BASE_URL ?? "https://app.empleaia.es";

// POST /api/feedback-action/resolve
// Encola un job "Resolver con Claude" desde el botón del email, SIN sesión.
// Auth = token HMAC firmado (TTL + single-use). La mutación va en POST (no en el
// GET del enlace) para que un escáner de correo que prefetch-ee el GET no gaste
// el token. Responde 303 a /resolver-con-claude?r=<resultado>.
export async function POST(req: Request): Promise<Response> {
  const resultUrl = (r: string) => `${APP_URL}/resolver-con-claude?r=${encodeURIComponent(r)}`;
  const redirect = (r: string) => NextResponse.redirect(resultUrl(r), { status: 303 });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!checkRate(`feedback-action:${ip}`, 60, 60_000).ok) return redirect("rate");

  let token: string | null = null;
  let comment = "";
  try {
    const form = await req.formData();
    const v = form.get("token");
    token = typeof v === "string" ? v : null;
    const c = form.get("comment");
    if (typeof c === "string") comment = c.trim().slice(0, MAX_COMMENT_LEN);
  } catch {
    token = null;
  }
  if (!token) return redirect("invalid");

  const payload = verifyFeedbackActionToken(token);
  if (!payload) return redirect("invalid");

  // Single-use: consumir el jti ANTES de actuar.
  const consumed = await consumeActionToken(payload.jti, payload.ticket_id, payload.action);
  if (!consumed) return redirect("used");

  const ticket = await getTicketById(payload.ticket_id);
  if (!ticket) return redirect("notfound");

  if (comment) {
    try {
      await addMessage({ ticket_id: payload.ticket_id, autor: "admin", user_id: null, cuerpo: comment, internal: true });
    } catch (e) {
      console.error(`[feedback-action] addMessage (comentario) falló (ticket ${payload.ticket_id}):`, e);
    }
  }

  const result = await enqueueAiJob(payload.ticket_id, null);
  if (!result.ok) return redirect("active");

  if (ticket.estado === "nuevo") {
    try {
      await updateTicket(payload.ticket_id, { estado: "en_revision" });
    } catch {
      /* best-effort */
    }
  }
  return redirect("ok");
}

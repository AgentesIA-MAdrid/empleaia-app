// Emails del ticketing. Adaptado de TuFacturaIA: en vez del sistema de
// plantillas + bucket, usa `sendSystemEmail` (Resend global) con HTML inline.
// Destinatarios de avisos internos por env FEEDBACK_ALERT_EMAILS (coma-sep).

import { sendSystemEmail } from "@/lib/email";
import { signFeedbackActionToken } from "@/lib/feedback/action-token";

const ADMIN_URL = process.env.ADMIN_BASE_URL ?? "https://admin.empleaia.es";
// La página de confirmación del email vive en el subdominio app (sin sesión,
// token); el panel vive en admin. Ver proxy.ts (admin solo sirve /admin*).
const APP_URL = process.env.APP_BASE_URL ?? "https://app.empleaia.es";
const FALLBACK_ALERT = process.env.SUPERADMIN_EMAIL ?? "soporte@empleaia.es";

const TIPO_LABEL: Record<string, string> = { bug: "Bug", mejora: "Mejora", pregunta: "Pregunta" };
const RESULTADO_LABEL: Record<string, string> = {
  pr_abierto: "PR abierto",
  sin_cambios: "Sin cambios",
  fallido: "Falló",
};

function esc(s: unknown): string {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

/** Destinatarios de avisos internos. `FEEDBACK_ALERT_EMAILS` coma-separado;
 *  si falta, cae al fallback para no perder el aviso. El parámetro `event` se
 *  acepta por compat futura (listas por evento) — hoy todos comparten lista. */
function alertRecipients(): string[] {
  const raw = process.env.FEEDBACK_ALERT_EMAILS ?? "";
  const list = raw
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e.includes("@"));
  return list.length > 0 ? list : [FALLBACK_ALERT];
}

function shell(titulo: string, cuerpo: string): string {
  return `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;border:1px solid #eee;border-radius:12px;overflow:hidden">
    <div style="background:#1e1b4b;padding:16px 24px"><span style="color:#fff;font-weight:700">empleaIA</span></div>
    <div style="padding:24px">
      <h2 style="color:#6366f1;margin:0 0 12px">${esc(titulo)}</h2>
      ${cuerpo}
    </div>
  </div>`;
}

async function sendInternalAlert(subject: string, html: string): Promise<void> {
  await Promise.allSettled(
    alertRecipients().map((to) => sendSystemEmail(to, subject, html)),
  );
}

interface TicketInfo {
  id: string;
  numero: number;
  tipo: "bug" | "mejora" | "pregunta";
  descripcion: string;
  pagina: string;
}

/** Referencia legible del ticket para asuntos y cuerpos: #0001. */
const ref = (n: number) => `#${String(n).padStart(4, "0")}`;
interface OrgInfo {
  id: string;
  nombre: string;
}
interface UserInfo {
  email: string;
  full_name?: string | null;
}

export async function sendNewTicketAlert(
  ticket: TicketInfo,
  org: OrgInfo,
  user: UserInfo,
): Promise<void> {
  let resolveUrl: string | undefined;
  try {
    const token = signFeedbackActionToken({ ticket_id: ticket.id, action: "resolve" });
    resolveUrl = `${APP_URL}/resolver-con-claude?token=${encodeURIComponent(token)}`;
  } catch (e) {
    console.error("[feedback/send-emails] firmar token de acción falló:", e);
  }
  const adminUrl = `${ADMIN_URL}/admin/feedback`;
  const html = shell(
    `Ticket ${ref(ticket.numero)} — ${TIPO_LABEL[ticket.tipo] ?? ticket.tipo}`,
    `<p><strong>${esc(org.nombre || "—")}</strong> · ${esc(user.full_name || user.email || "—")}</p>
     <p style="color:#555"><strong>Página:</strong> ${esc(ticket.pagina)}</p>
     <p>${esc(ticket.descripcion)}</p>
     <p style="margin-top:16px">
       <a href="${esc(adminUrl)}" style="color:#6366f1">Ver en el panel</a>
       ${resolveUrl ? ` &nbsp;·&nbsp; <a href="${esc(resolveUrl)}" style="color:#6366f1">Resolver con Claudia</a>` : ""}
     </p>`,
  );
  await sendInternalAlert(`Ticket ${ref(ticket.numero)} — Nuevo (${org.nombre || "—"})`, html);
}

export async function sendAdminReplyEmail(
  ticket: TicketInfo,
  respuesta: string,
  userEmail: string,
): Promise<void> {
  const html = shell(
    `Respuesta a tu incidencia ${ref(ticket.numero)}`,
    `<p>El equipo ha respondido a tu reporte ${ref(ticket.numero)} (${esc(TIPO_LABEL[ticket.tipo] ?? ticket.tipo)}):</p>
     <blockquote style="border-left:3px solid #6366f1;padding-left:12px;color:#333">${esc(respuesta)}</blockquote>`,
  );
  await sendSystemEmail(userEmail, `Respuesta a tu incidencia ${ref(ticket.numero)} — empleaIA`, html);
}

export async function sendUserReplyAlert(
  ticket: TicketInfo,
  respuesta: string,
  org: OrgInfo,
  user: UserInfo,
): Promise<void> {
  const adminUrl = `${ADMIN_URL}/admin/feedback`;
  const html = shell(
    `El usuario ha respondido — Ticket ${ref(ticket.numero)}`,
    `<p><strong>${esc(org.nombre || "—")}</strong> · ${esc(user.full_name || user.email || "—")}</p>
     <blockquote style="border-left:3px solid #6366f1;padding-left:12px;color:#333">${esc(respuesta)}</blockquote>
     <p><a href="${esc(adminUrl)}" style="color:#6366f1">Ver en el panel</a></p>`,
  );
  await sendInternalAlert(`Ticket ${ref(ticket.numero)} — Respuesta de usuario (${org.nombre || "—"})`, html);
}

export async function sendJobResultAlert(input: {
  resultado: "pr_abierto" | "sin_cambios" | "fallido";
  ticket: TicketInfo;
  org_name: string;
  pr_url?: string | null;
  error?: string | null;
}): Promise<void> {
  const { resultado, ticket, org_name, pr_url, error } = input;
  const adminUrl = `${ADMIN_URL}/admin/feedback`;
  const html = shell(
    `Claudia terminó el ticket ${ref(ticket.numero)}: ${RESULTADO_LABEL[resultado] ?? resultado}`,
    `<p><strong>${esc(org_name || "—")}</strong> · ${esc(TIPO_LABEL[ticket.tipo] ?? ticket.tipo)}</p>
     <p style="color:#555">${esc(ticket.descripcion)}</p>
     ${pr_url ? `<p><a href="${esc(pr_url)}" style="color:#6366f1">Ver PR ↗</a></p>` : ""}
     ${error ? `<p style="color:#b91c1c"><strong>Error:</strong> ${esc(error)}</p>` : ""}
     <p><a href="${esc(adminUrl)}" style="color:#6366f1">Ver en el panel</a></p>`,
  );
  await sendInternalAlert(`Ticket ${ref(ticket.numero)} — Claudia: ${RESULTADO_LABEL[resultado] ?? resultado} (${org_name || "—"})`, html);
}

export async function sendResolutionEmail(ticket: TicketInfo, userEmail: string): Promise<void> {
  const html = shell(
    `Tu incidencia ${ref(ticket.numero)} se ha resuelto`,
    `<p>Hemos marcado como resuelta tu incidencia ${ref(ticket.numero)} (${esc(TIPO_LABEL[ticket.tipo] ?? ticket.tipo)}). Si sigues teniendo el problema, respóndenos desde la app.</p>`,
  );
  await sendSystemEmail(userEmail, `Tu incidencia ${ref(ticket.numero)} se ha resuelto — empleaIA`, html);
}

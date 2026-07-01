/**
 * Acciones del bot de Telegram sobre un ticket. Replican EXACTAMENTE la lógica
 * de los endpoints del panel super-admin, reutilizando las mismas funciones del
 * repository y de send-emails (nada de fetch interno). Cada acción devuelve un
 * texto corto para confirmar al operador en el chat.
 *
 * El `operadorId` que se guarda como autor de mensajes/jobs es un sentinel
 * `telegram:<recipientId>` para trazar quién actuó desde Telegram.
 */

import {
  getTicketById,
  listMessages,
  addMessage,
  updateTicket,
  enqueueAiJob,
  getTicketUserEmail,
  getTicketOrgName,
  getLatestAiJob,
} from "@/lib/feedback/repository";
import { sendAdminReplyEmail, sendResolutionEmail } from "@/lib/feedback/send-emails";
import { escapeHtml } from "./client";
import { getPrInfo, mergePr } from "./github";

const ref = (n: number) => `#${String(n).padStart(4, "0")}`;

// Misma instrucción que el botón "En desarrollo → Claudia" del panel web.
const INSTRUCCION_DESARROLLO =
  "Implementa lo que pide el usuario en este ticket; revisa TODA la conversación, " +
  "incluidas sus aclaraciones. Hazlo aunque sea una mejora grande o de varias piezas: " +
  "NO te limites a diagnosticar ni te frenes por el tamaño — implementa la solución " +
  "completa y abre un PR.";

type Res = { ok: boolean; text: string };

function tInfo(t: { id: string; numero: number; tipo: string; descripcion: string; pagina: string }) {
  return { id: t.id, numero: t.numero, tipo: t.tipo as "bug" | "mejora" | "pregunta", descripcion: t.descripcion, pagina: t.pagina };
}

/** Responder al cliente (mensaje público + email). */
export async function responderCliente(ticketId: string, cuerpo: string, operadorId: string): Promise<Res> {
  const texto = cuerpo.trim();
  if (!texto) return { ok: false, text: "La respuesta está vacía." };
  if (texto.length > 5000) return { ok: false, text: "La respuesta supera los 5000 caracteres." };
  const ticket = await getTicketById(ticketId);
  if (!ticket) return { ok: false, text: "Ticket no encontrado." };

  await addMessage({ ticket_id: ticketId, autor: "admin", user_id: operadorId, cuerpo: texto, internal: false });
  await updateTicket(ticketId, { visto_por_user: false });
  const email = await getTicketUserEmail(ticketId);
  if (email) void sendAdminReplyEmail(tInfo(ticket), texto, email).catch(() => {});
  return { ok: true, text: `✅ Respuesta enviada al cliente (Ticket ${ref(ticket.numero)}).` };
}

/** Enviar a Claudia (encola job). */
export async function enviarAClaudia(ticketId: string, operadorId: string): Promise<Res> {
  const ticket = await getTicketById(ticketId);
  if (!ticket) return { ok: false, text: "Ticket no encontrado." };
  const result = await enqueueAiJob(ticketId, operadorId, "opus", null);
  if (!result.ok) return { ok: false, text: "Ya hay un job de Claudia activo para este ticket." };
  if (ticket.estado === "nuevo") await updateTicket(ticketId, { estado: "en_revision" }).catch(() => {});
  return { ok: true, text: `🤖 Enviado a Claudia (Ticket ${ref(ticket.numero)}). Te aviso cuando termine.` };
}

/** En desarrollo → Claudia: marca en_desarrollo y encola con instrucción de implementar. */
export async function enDesarrolloClaudia(ticketId: string, operadorId: string): Promise<Res> {
  const ticket = await getTicketById(ticketId);
  if (!ticket) return { ok: false, text: "Ticket no encontrado." };
  await updateTicket(ticketId, { estado: "en_desarrollo" });
  const result = await enqueueAiJob(ticketId, operadorId, "opus", INSTRUCCION_DESARROLLO);
  if (!result.ok) {
    return { ok: true, text: `🛠 Marcado en desarrollo (Ticket ${ref(ticket.numero)}), pero ya había un job activo.` };
  }
  return { ok: true, text: `🛠 En desarrollo — enviado a Claudia para implementar (Ticket ${ref(ticket.numero)}).` };
}

/** Marcar resuelto (email al cliente si es transición). */
export async function resolver(ticketId: string): Promise<Res> {
  const ticket = await getTicketById(ticketId);
  if (!ticket) return { ok: false, text: "Ticket no encontrado." };
  const eraResuelto = ticket.estado === "resuelto";
  await updateTicket(ticketId, { estado: "resuelto" });
  if (!eraResuelto) {
    const email = await getTicketUserEmail(ticketId);
    if (email) void sendResolutionEmail(tInfo(ticket), email).catch(() => {});
  }
  return { ok: true, text: `✅ Ticket ${ref(ticket.numero)} marcado como resuelto.` };
}

/** Descartar. */
export async function descartar(ticketId: string): Promise<Res> {
  const ticket = await getTicketById(ticketId);
  if (!ticket) return { ok: false, text: "Ticket no encontrado." };
  await updateTicket(ticketId, { estado: "descartado" });
  return { ok: true, text: `✖ Ticket ${ref(ticket.numero)} descartado.` };
}

/** Revisar el PR del ticket: estado, líneas y archivos cambiados. */
export async function revisarPr(ticketId: string): Promise<Res> {
  const ticket = await getTicketById(ticketId);
  if (!ticket) return { ok: false, text: "Ticket no encontrado." };
  const job = await getLatestAiJob(ticketId);
  if (!job?.pr_url) return { ok: false, text: "Este ticket no tiene un PR abierto." };
  const r = await getPrInfo(job.pr_url);
  if (!r.ok) return { ok: false, text: `No pude leer el PR: ${r.error}` };
  const i = r.info;
  const estado = i.merged ? "mergeado" : i.draft ? "borrador" : i.state === "open" ? "abierto" : i.state;
  const mergeable = i.merged ? "" : i.mergeable === true ? " · ✅ mergeable" : i.mergeable === false ? " · ⚠️ con conflictos" : " · (calculando…)";
  const cab =
    `🔍 <b>PR del Ticket ${ref(ticket.numero)}</b> — ${escapeHtml(estado)}${mergeable}\n` +
    `<b>${escapeHtml(i.title)}</b>\n` +
    `${i.changedFiles} archivo(s) · <b>+${i.additions}</b> / <b>−${i.deletions}</b>\n${escapeHtml(job.pr_url)}`;
  const lista = i.files
    .slice(0, 30)
    .map((f) => `• ${escapeHtml(f.filename)} <b>+${f.additions}</b>/<b>−${f.deletions}</b>`)
    .join("\n");
  const extra = i.files.length > 30 ? `\n…y ${i.files.length - 30} más` : "";
  return { ok: true, text: `${cab}\n\n${lista}${extra}` };
}

/** Mergear el PR del ticket (squash). El webhook de GitHub resolverá el ticket. */
export async function mergearPr(ticketId: string): Promise<Res> {
  const ticket = await getTicketById(ticketId);
  if (!ticket) return { ok: false, text: "Ticket no encontrado." };
  const job = await getLatestAiJob(ticketId);
  if (!job?.pr_url) return { ok: false, text: "Este ticket no tiene un PR abierto." };
  const r = await mergePr(job.pr_url);
  if (!r.ok) return { ok: false, text: `No se pudo mergear: ${r.error}` };
  return { ok: true, text: `🔀 PR mergeado (Ticket ${ref(ticket.numero)}). El ticket se marcará como resuelto y el cliente recibirá el aviso en unos segundos.` };
}

const ESTADO_LABEL: Record<string, string> = {
  nuevo: "Nuevo", en_revision: "En revisión", en_desarrollo: "En desarrollo", resuelto: "Resuelto", descartado: "Descartado",
};

/** Render de la conversación completa para enviar al chat (HTML de Telegram). */
export async function verConversacion(ticketId: string): Promise<Res> {
  const ticket = await getTicketById(ticketId);
  if (!ticket) return { ok: false, text: "Ticket no encontrado." };
  const org = await getTicketOrgName(ticket.org_id).catch(() => "");
  const mensajes = await listMessages(ticketId).catch(() => []);

  const cabecera =
    `<b>Ticket ${ref(ticket.numero)}</b> · ${escapeHtml(ESTADO_LABEL[ticket.estado] ?? ticket.estado)}\n` +
    `<b>${escapeHtml(org || "—")}</b> · <i>${escapeHtml(ticket.pagina)}</i>\n\n` +
    `${escapeHtml(ticket.descripcion)}`;

  if (mensajes.length === 0) return { ok: true, text: `${cabecera}\n\n<i>Sin respuestas todavía.</i>` };

  const hilo = mensajes
    .map((m) => {
      const quien = m.is_ai ? "🤖 Claudia" : m.autor === "admin" ? "🏢 Equipo" : "👤 Cliente";
      const tag = m.internal ? " <i>(interno)</i>" : "";
      const cuerpo = m.cuerpo.length > 500 ? `${m.cuerpo.slice(0, 500)}…` : m.cuerpo;
      return `<b>${quien}</b>${tag}\n${escapeHtml(cuerpo)}`;
    })
    .join("\n\n");
  return { ok: true, text: `${cabecera}\n\n———\n\n${hilo}` };
}

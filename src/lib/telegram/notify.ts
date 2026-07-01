/**
 * Notificaciones salientes del bot de Telegram para el ticketing.
 *
 * Se llaman fire-and-forget (`void notify…()`) JUNTO a las alertas por email
 * existentes (complementan, no sustituyen). Envían a cada destinatario activo
 * un mensaje con botones inline para operar el ticket sin salir de Telegram;
 * los destinatarios "solo recibe" (canOperate=false) reciben solo el botón de
 * ver la conversación.
 */

import { prismaMaster } from "@/lib/prisma";
import { sendMessage, escapeHtml, type InlineButton } from "./client";

const ref = (n: number) => `#${String(n).padStart(4, "0")}`;
const TIPO_LABEL: Record<string, string> = { bug: "Bug", mejora: "Mejora", pregunta: "Pregunta" };
const RESULTADO_LABEL: Record<string, string> = { pr_abierto: "PR abierto", sin_cambios: "Sin cambios", fallido: "Falló" };

interface TicketRef {
  id: string;
  numero: number;
  tipo: string;
  descripcion: string;
  pagina: string;
}

async function activeRecipients(): Promise<{ chatId: string; canOperate: boolean }[]> {
  const rows = await prismaMaster.telegramRecipient.findMany({
    where: { active: true, chatId: { not: null } },
    select: { chatId: true, canOperate: true },
  });
  return rows.filter((r): r is { chatId: string; canOperate: boolean } => !!r.chatId);
}

/**
 * Teclado inline de acciones sobre un ticket. Compartido con el webhook.
 * `soloVer` (o !canOperate) → únicamente el botón de ver: para avisos de
 * tickets ya cerrados (desplegado/resuelto) donde el resto de acciones no
 * aplican, o para destinatarios que solo reciben.
 */
export function ticketKeyboard(ticketId: string, canOperate: boolean, soloVer = false): InlineButton[][] {
  if (soloVer || !canOperate) return [[{ text: "👁 Ver conversación", callback_data: `t:${ticketId}:ver` }]];
  return [
    [
      { text: "💬 Responder", callback_data: `t:${ticketId}:resp` },
      { text: "👁 Ver", callback_data: `t:${ticketId}:ver` },
    ],
    [
      { text: "🤖 A Claudia", callback_data: `t:${ticketId}:claudia` },
      { text: "🛠 En desarrollo", callback_data: `t:${ticketId}:dev` },
    ],
    [
      { text: "✅ Resolver", callback_data: `t:${ticketId}:ok` },
      { text: "✖ Descartar", callback_data: `t:${ticketId}:no` },
    ],
  ];
}

function recorta(s: string, n = 400): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

async function broadcast(header: string, body: string, ticketId: string, soloVer = false): Promise<void> {
  const recipients = await activeRecipients();
  await Promise.allSettled(
    recipients.map((r) =>
      sendMessage(r.chatId, `${header}\n\n${body}`, { inlineKeyboard: ticketKeyboard(ticketId, r.canOperate, soloVer) }),
    ),
  );
}

export async function notifyNuevoTicket(ticket: TicketRef, orgNombre: string, userLabel: string): Promise<void> {
  const header = `🆕 <b>Ticket ${ref(ticket.numero)}</b> · ${escapeHtml(TIPO_LABEL[ticket.tipo] ?? ticket.tipo)}`;
  const body =
    `<b>${escapeHtml(orgNombre || "—")}</b> · ${escapeHtml(userLabel || "—")}\n` +
    `<i>Página:</i> ${escapeHtml(ticket.pagina)}\n\n${escapeHtml(recorta(ticket.descripcion))}`;
  await broadcast(header, body, ticket.id);
}

export async function notifyRespuestaCliente(ticket: TicketRef, respuesta: string, orgNombre: string, userLabel: string): Promise<void> {
  const header = `↩️ <b>Respuesta del cliente</b> · Ticket ${ref(ticket.numero)}`;
  const body = `<b>${escapeHtml(orgNombre || "—")}</b> · ${escapeHtml(userLabel || "—")}\n\n💬 ${escapeHtml(recorta(respuesta))}`;
  await broadcast(header, body, ticket.id);
}

export async function notifyResultadoClaudia(input: {
  resultado: "pr_abierto" | "sin_cambios" | "fallido";
  ticket: TicketRef;
  orgNombre: string;
  prUrl?: string | null;
  error?: string | null;
}): Promise<void> {
  const { resultado, ticket, orgNombre, prUrl, error } = input;
  const emoji = resultado === "pr_abierto" ? "🤖✅" : resultado === "sin_cambios" ? "🤖🤷" : "🤖❌";
  const header = `${emoji} <b>Claudia — ${escapeHtml(RESULTADO_LABEL[resultado] ?? resultado)}</b> · Ticket ${ref(ticket.numero)}`;
  let body = `<b>${escapeHtml(orgNombre || "—")}</b>\n${escapeHtml(recorta(ticket.descripcion, 200))}`;
  if (prUrl) body += `\n\n🔗 ${escapeHtml(prUrl)}`;
  if (error) body += `\n\n⚠️ ${escapeHtml(recorta(error, 300))}`;
  await broadcast(header, body, ticket.id);
}

export async function notifyPrDesplegado(ticket: TicketRef, orgNombre: string): Promise<void> {
  const header = `🚀 <b>Desplegado</b> · Ticket ${ref(ticket.numero)}`;
  const body = `<b>${escapeHtml(orgNombre || "—")}</b>\nEl PR se ha mergeado y el ticket queda resuelto.\n\n${escapeHtml(recorta(ticket.descripcion, 200))}`;
  // Ticket ya resuelto → solo "Ver": responder/resolver/etc. no aplican.
  await broadcast(header, body, ticket.id, true);
}

// Auto-resolución de tickets al mergear el PR de Claude.
//
// Lo dispara el webhook de GitHub (`/api/webhooks/github`) cuando un
// `pull_request` se cierra con `merged: true`. Localiza el job por rama/URL del
// PR y, en un solo paso:
//   1. Publica al cliente el resumen (borrador de Claude); si no hay resumen,
//      manda un aviso genérico para que el usuario igualmente se entere.
//   2. Marca el ticket como `resuelto` y enciende el badge del usuario.
//   3. Mueve el job a `desplegado` (columna CLAUDE del panel).
//   4. Envía el email de respuesta al usuario.
//
// Idempotente: si el job ya está `desplegado` (el webhook reintenta), no hace
// nada. El trigger es el MERGE del PR; el deploy de Dokploy lo sigue en minutos.

import {
  findAiJobByBranchOrUrl,
  getTicketById,
  getTicketUserEmail,
  getTicketOrgName,
  publishResumenToClient,
  setAiJobStatus,
  updateTicket,
  addMessage,
} from "@/lib/feedback/repository";
import { sendAdminReplyEmail } from "@/lib/feedback/send-emails";
import { notifyPrDesplegado } from "@/lib/telegram/notify";

const AVISO_GENERICO =
  "¡Hecho! Ya hemos implementado y desplegado lo que pedías. " +
  "Si ves algo que no encaja, respóndenos por aquí y lo revisamos.";

export type ResolvePrResult =
  | { matched: false }
  | { matched: true; ticketId: string; alreadyDone: boolean };

export async function resolvePrMerged(opts: {
  branch?: string | null;
  prUrl?: string | null;
}): Promise<ResolvePrResult> {
  const job = await findAiJobByBranchOrUrl(opts.branch, opts.prUrl);
  if (!job) return { matched: false };
  if (job.status === "desplegado") {
    return { matched: true, ticketId: job.ticket_id, alreadyDone: true };
  }

  const ticket = await getTicketById(job.ticket_id);
  if (!ticket) return { matched: false };

  // 1. Publicar al cliente (resumen de Claude o, si no hay, aviso genérico).
  let cuerpoNotificado: string | null = null;
  const pub = await publishResumenToClient(job.id);
  if (pub.ok) {
    cuerpoNotificado = pub.message.cuerpo;
  } else if (pub.reason === "sin_resumen") {
    const msg = await addMessage({
      ticket_id: job.ticket_id,
      autor: "admin",
      user_id: null,
      cuerpo: AVISO_GENERICO,
      is_ai: true,
      internal: false,
    });
    cuerpoNotificado = msg.cuerpo;
  }
  // reason === "ya_publicado" → ya se publicó a mano; no re-publicamos pero
  // igualmente cerramos el ticket y marcamos el job desplegado.

  // 2 + 3. Cerrar ticket y marcar job desplegado.
  await updateTicket(job.ticket_id, { estado: "resuelto", visto_por_user: false });
  await setAiJobStatus(job.id, "desplegado");

  // Aviso a Telegram (best-effort) — el ticket queda resuelto y desplegado.
  void getTicketOrgName(ticket.org_id)
    .then((org) =>
      notifyPrDesplegado(
        { id: ticket.id, numero: ticket.numero, tipo: ticket.tipo, descripcion: ticket.descripcion, pagina: ticket.pagina },
        org,
      ),
    )
    .catch(() => {});

  // 4. Email al usuario (best-effort; no rompe el webhook si Resend falla).
  if (cuerpoNotificado) {
    const email = await getTicketUserEmail(job.ticket_id);
    if (email) {
      await sendAdminReplyEmail(
        { id: ticket.id, numero: ticket.numero, tipo: ticket.tipo, descripcion: ticket.descripcion, pagina: ticket.pagina },
        cuerpoNotificado,
        email,
      ).catch((e) => console.error("[feedback/auto-resolve] email falló", e));
    }
  }

  return { matched: true, ticketId: job.ticket_id, alreadyDone: false };
}

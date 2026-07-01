/**
 * Gestión de destinatarios/operadores del bot y estado de sesión (responder).
 * Todo vive en el schema master (`prismaMaster`).
 */

import { prismaMaster } from "@/lib/prisma";

/** ¿Este chat está autorizado a OPERAR (mutar tickets)? */
export async function isOperator(chatId: string): Promise<{ id: string } | null> {
  const r = await prismaMaster.telegramRecipient.findFirst({
    where: { chatId, active: true, canOperate: true },
    select: { id: true },
  });
  return r;
}

/** ¿Este chat está vinculado y activo (recibe avisos)? */
export async function isKnownChat(chatId: string): Promise<{ id: string } | null> {
  return prismaMaster.telegramRecipient.findFirst({
    where: { chatId, active: true },
    select: { id: true },
  });
}

/**
 * Vincula un chatId a un destinatario dado de alta con `code`. Devuelve el
 * label si funcionó, o un motivo de fallo. El código caduca (pairingExpiresAt)
 * y es de un solo uso (se limpia al vincular).
 */
export async function linkChatByCode(
  code: string,
  chatId: string,
): Promise<{ ok: true; label: string } | { ok: false; reason: "codigo_invalido" | "caducado" | "chat_ya_vinculado" }> {
  const normalized = code.trim().toUpperCase();
  const rec = await prismaMaster.telegramRecipient.findFirst({
    where: { pairingCode: normalized },
    select: { id: true, label: true, pairingExpiresAt: true },
  });
  if (!rec) return { ok: false, reason: "codigo_invalido" };
  if (rec.pairingExpiresAt && rec.pairingExpiresAt.getTime() < Date.now()) {
    return { ok: false, reason: "caducado" };
  }
  // Si el chat ya está vinculado a OTRO destinatario, no duplicar.
  const yaVinculado = await prismaMaster.telegramRecipient.findFirst({
    where: { chatId, NOT: { id: rec.id } },
    select: { id: true },
  });
  if (yaVinculado) return { ok: false, reason: "chat_ya_vinculado" };

  await prismaMaster.telegramRecipient.update({
    where: { id: rec.id },
    data: { chatId, pairingCode: null, pairingExpiresAt: null, active: true, linkedAt: new Date() },
  });
  return { ok: true, label: rec.label };
}

// ─── Estado de sesión: "responder al cliente" ────────────────────────────────

export async function setPendingReply(chatId: string, tgUserId: string, ticketId: string): Promise<void> {
  await prismaMaster.telegramSession.upsert({
    where: { chatId_tgUserId: { chatId, tgUserId } },
    create: { chatId, tgUserId, ticketId, action: "reply" },
    update: { ticketId, action: "reply" },
  });
}

/** Lee y BORRA la sesión pendiente (un solo uso). */
export async function popPendingReply(chatId: string, tgUserId: string): Promise<{ ticketId: string } | null> {
  const s = await prismaMaster.telegramSession.findUnique({
    where: { chatId_tgUserId: { chatId, tgUserId } },
    select: { ticketId: true },
  });
  if (!s) return null;
  await prismaMaster.telegramSession
    .delete({ where: { chatId_tgUserId: { chatId, tgUserId } } })
    .catch(() => {});
  return { ticketId: s.ticketId };
}

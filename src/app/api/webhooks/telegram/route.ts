/**
 * Webhook del bot de Telegram para gestionar tickets.
 *
 * - Sin NextAuth, sin withTenant (whitelist `/api/webhooks/**` en AGENTS.md).
 *   Opera sobre `master` (tickets globales), como el webhook de GitHub.
 * - Autenticación: header nativo `X-Telegram-Bot-Api-Secret-Token` ==
 *   `TELEGRAM_WEBHOOK_SECRET` (se fija al registrar el webhook con setWebhook).
 * - Responde 200 SIEMPRE (aunque ignore el update) para que Telegram no
 *   reintente en bucle.
 *
 * Maneja dos tipos de update:
 *   - callback_query: pulsación de botón inline → ejecuta acción sobre el ticket.
 *   - message: vinculación por código, o respuesta al cliente si hay sesión.
 */

import { type NextRequest, NextResponse } from "next/server";
import { sendMessage, answerCallbackQuery, clearInlineKeyboard } from "@/lib/telegram/client";
import { isOperator, isKnownChat, linkChatByCode, setPendingReply, popPendingReply } from "@/lib/telegram/recipients";
import {
  responderCliente,
  enviarAClaudia,
  enDesarrolloClaudia,
  resolver,
  descartar,
  verConversacion,
  revisarPr,
  mergearPr,
} from "@/lib/telegram/actions";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE_RE = /^[A-Z0-9]{6}$/i;
const TG_LIMIT = 4000; // límite de mensaje de Telegram (4096) con margen.

const ok = () => NextResponse.json({ ok: true });
const trunc = (s: string) => (s.length > TG_LIMIT ? `${s.slice(0, TG_LIMIT)}…` : s);

interface TgUpdate {
  message?: {
    chat?: { id?: number | string };
    from?: { id?: number | string };
    text?: string;
  };
  callback_query?: {
    id?: string;
    from?: { id?: number | string };
    message?: { chat?: { id?: number | string }; message_id?: number };
    data?: string;
  };
}

export async function POST(req: NextRequest): Promise<Response> {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[webhooks/telegram] TELEGRAM_WEBHOOK_SECRET no definido.");
    return new NextResponse("Server misconfigured", { status: 500 });
  }
  if (req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return new NextResponse("Invalid secret", { status: 401 });
  }

  let update: TgUpdate;
  try {
    update = (await req.json()) as TgUpdate;
  } catch {
    return ok();
  }

  try {
    if (update.callback_query) return await handleCallback(update.callback_query);
    if (update.message) return await handleMessage(update.message);
  } catch (e) {
    console.error("[webhooks/telegram] procesar update falló", e);
  }
  return ok();
}

async function handleCallback(cq: NonNullable<TgUpdate["callback_query"]>): Promise<Response> {
  const chatId = cq.message?.chat?.id != null ? String(cq.message.chat.id) : null;
  const messageId = cq.message?.message_id;
  const data = cq.data ?? "";
  if (!chatId || !cq.id) return ok();

  // callback_data: t:<ticketId>:<accion>
  const parts = data.split(":");
  if (parts[0] !== "t" || parts.length < 3 || !UUID_RE.test(parts[1])) {
    await answerCallbackQuery(cq.id);
    return ok();
  }
  const ticketId = parts[1];
  const accion = parts[2];

  // "ver" solo requiere chat conocido; el resto exige poder operar.
  if (accion === "ver") {
    if (!(await isKnownChat(chatId))) {
      await answerCallbackQuery(cq.id, "No autorizado");
      return ok();
    }
    const res = await verConversacion(ticketId);
    await answerCallbackQuery(cq.id);
    await sendMessage(chatId, trunc(res.text));
    return ok();
  }

  const operator = await isOperator(chatId);
  if (!operator) {
    await answerCallbackQuery(cq.id, "No puedes operar (solo recibes avisos)");
    return ok();
  }
  const operadorId = `telegram:${operator.id}`;

  if (accion === "resp") {
    await setPendingReply(chatId, String(cq.from?.id ?? chatId), ticketId);
    await answerCallbackQuery(cq.id);
    await sendMessage(chatId, "✍️ Responde a este mensaje con el texto para el cliente.", { forceReply: true });
    return ok();
  }

  // Revisar PR es solo lectura (respuesta rápida, sin tocar botones).
  if (accion === "revpr") {
    const res = await revisarPr(ticketId);
    await answerCallbackQuery(cq.id);
    await sendMessage(chatId, trunc(res.text));
    return ok();
  }

  let res: { ok: boolean; text: string };
  switch (accion) {
    case "claudia": res = await enviarAClaudia(ticketId, operadorId); break;
    case "dev": res = await enDesarrolloClaudia(ticketId, operadorId); break;
    case "merge": res = await mergearPr(ticketId); break;
    case "ok": res = await resolver(ticketId); break;
    case "no": res = await descartar(ticketId); break;
    default:
      await answerCallbackQuery(cq.id);
      return ok();
  }
  await answerCallbackQuery(cq.id, res.ok ? "Hecho" : "No se pudo");
  await sendMessage(chatId, res.text);
  // Tras una acción terminal, quitamos los botones del mensaje original.
  if (res.ok && messageId != null && (accion === "ok" || accion === "no" || accion === "merge")) {
    await clearInlineKeyboard(chatId, messageId);
  }
  return ok();
}

async function handleMessage(msg: NonNullable<TgUpdate["message"]>): Promise<Response> {
  const chatId = msg.chat?.id != null ? String(msg.chat.id) : null;
  const tgUserId = msg.from?.id != null ? String(msg.from.id) : chatId;
  const text = (msg.text ?? "").trim();
  if (!chatId || !tgUserId) return ok();

  // /start <code> o /vincular <code> o un código suelto → vincular.
  const startMatch = /^\/(?:start|vincular)(?:@\w+)?\s+(\S+)/i.exec(text);
  const codeCandidate = startMatch ? startMatch[1] : CODE_RE.test(text) ? text : null;
  if (codeCandidate) {
    const r = await linkChatByCode(codeCandidate, chatId);
    if (r.ok) {
      await sendMessage(chatId, `✅ Vinculado como <b>${escapeMinimal(r.label)}</b>. Ya recibirás los tickets aquí.`);
    } else {
      const motivo =
        r.reason === "caducado" ? "El código ha caducado. Pide uno nuevo en el panel."
        : r.reason === "chat_ya_vinculado" ? "Este chat ya está vinculado a otra persona."
        : "Código no válido.";
      await sendMessage(chatId, `⚠️ ${motivo}`);
    }
    return ok();
  }

  // /start sin código → dar el chatId para que un admin lo autorice.
  if (/^\/start(?:@\w+)?$/i.test(text)) {
    await sendMessage(
      chatId,
      `👋 Hola. Tu ID de chat es <code>${chatId}</code>.\n\nPide a un administrador que te dé de alta en el panel y te pase un código de vinculación, o envíamelo aquí directamente.`,
    );
    return ok();
  }

  // ¿Hay una respuesta pendiente de este operador? → publicar al cliente.
  const operator = await isOperator(chatId);
  if (operator && text) {
    const pending = await popPendingReply(chatId, tgUserId);
    if (pending) {
      const res = await responderCliente(pending.ticketId, text, `telegram:${operator.id}`);
      await sendMessage(chatId, res.text);
      return ok();
    }
  }

  // Sin contexto: ayuda mínima solo a chats conocidos (no filtrar a extraños).
  if (await isKnownChat(chatId)) {
    await sendMessage(chatId, "Usa los botones bajo cada ticket para gestionarlo. Para responder a un cliente, pulsa 💬 Responder en el ticket.");
  }
  return ok();
}

// Escape mínimo para HTML de Telegram en los pocos textos construidos aquí.
function escapeMinimal(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}

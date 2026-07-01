/**
 * Cliente HTTP mínimo de la Bot API de Telegram (fetch directo, sin SDK).
 *
 * El token vive en env `TELEGRAM_BOT_TOKEN` (secreto, no en BD). Todas las
 * llamadas son best-effort: si el token falta o la API responde error, se
 * loguea y se devuelve `false` sin lanzar — nunca deben tumbar un request de
 * la app (las notificaciones son fire-and-forget).
 */

const API = "https://api.telegram.org";

function token(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN ?? null;
}

/** Escapa texto para `parse_mode: "HTML"` de Telegram (solo & < >). */
export function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}

export interface InlineButton {
  text: string;
  /** callback_data (máx 64 bytes) para acciones, o url para enlaces. */
  callback_data?: string;
  url?: string;
}

type InlineKeyboard = InlineButton[][];

async function call(method: string, body: Record<string, unknown>): Promise<{ ok: boolean; result?: unknown }> {
  const t = token();
  if (!t) {
    console.error(`[telegram] TELEGRAM_BOT_TOKEN no definido; se omite ${method}`);
    return { ok: false };
  }
  try {
    const res = await fetch(`${API}/bot${t}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: unknown; description?: string };
    if (!json.ok) console.error(`[telegram] ${method} falló: ${json.description ?? res.status}`);
    return { ok: !!json.ok, result: json.result };
  } catch (e) {
    console.error(`[telegram] ${method} error de red:`, e instanceof Error ? e.message : e);
    return { ok: false };
  }
}

/** Envía un mensaje. `text` debe venir ya escapado con escapeHtml si usa HTML. */
export async function sendMessage(
  chatId: string,
  text: string,
  opts: { inlineKeyboard?: InlineKeyboard; forceReply?: boolean; disablePreview?: boolean } = {},
): Promise<boolean> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: opts.disablePreview ?? true },
  };
  if (opts.inlineKeyboard) body.reply_markup = { inline_keyboard: opts.inlineKeyboard };
  else if (opts.forceReply) body.reply_markup = { force_reply: true, input_field_placeholder: "Escribe tu respuesta…" };
  const { ok } = await call("sendMessage", body);
  return ok;
}

/** Responde a una pulsación de botón (quita el "reloj" de carga en el cliente). */
export async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
  await call("answerCallbackQuery", { callback_query_id: callbackQueryId, text: text ?? "", show_alert: false });
}

/** Quita los botones inline de un mensaje ya enviado (tras ejecutar la acción). */
export async function clearInlineKeyboard(chatId: string, messageId: number): Promise<void> {
  await call("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
}

/** Registra el webhook en Telegram. Devuelve ok. */
export async function setWebhook(url: string, secretToken: string): Promise<boolean> {
  const { ok } = await call("setWebhook", {
    url,
    secret_token: secretToken,
    allowed_updates: ["message", "callback_query"],
  });
  return ok;
}

/** Info del webhook actual (para mostrar estado en el panel). */
export async function getWebhookInfo(): Promise<{ url?: string; pending_update_count?: number; last_error_message?: string } | null> {
  const { ok, result } = await call("getWebhookInfo", {});
  return ok ? (result as { url?: string; pending_update_count?: number; last_error_message?: string }) : null;
}

/** Username del bot (para construir el enlace t.me y las instrucciones). */
export async function getBotUsername(): Promise<string | null> {
  const { ok, result } = await call("getMe", {});
  return ok ? ((result as { username?: string }).username ?? null) : null;
}

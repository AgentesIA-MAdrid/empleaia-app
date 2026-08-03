/**
 * Cliente mínimo de WhatsApp Cloud API (Meta Graph API v22).
 *
 * Solo cubre el envío de mensajes de texto y la verificación de
 * webhooks. Suficiente para el MVP del módulo `whatsapp_bot`:
 * encolar un MensajeWhatsapp + dispararlo cuando WhatsappConfig.activo.
 *
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/
 *
 * Para enviar a un número que NO inició la conversación (>24h sin
 * interacción), Meta exige plantillas pre-aprobadas. Aquí enviamos
 * mensajes free-form, que funcionan dentro de la ventana de 24h
 * tras un inbound del usuario. Para campañas iniciadas por la
 * empresa hace falta `template` — se deja como mejora.
 */

import { decryptString } from "@/lib/crypto/aes-gcm";

const META_GRAPH = "https://graph.facebook.com/v22.0";

export interface WhatsappConfigDecoded {
  phoneNumberId: string;
  accessToken: string;
}

export function decodeWhatsappConfig(
  config: { phoneNumberId: string | null; tokenEnc: Uint8Array | null },
): WhatsappConfigDecoded | null {
  if (!config.phoneNumberId || !config.tokenEnc) return null;
  try {
    const accessToken = decryptString(config.tokenEnc);
    return { phoneNumberId: config.phoneNumberId, accessToken };
  } catch {
    return null;
  }
}

export interface SendResult {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
}

/**
 * Normaliza un número a formato E.164 sin "+" — el formato que Meta
 * espera en `to`. Acepta entradas con espacios, guiones o "+".
 */
export function normalizePhone(s: string): string {
  return s.replace(/[^\d]/g, "");
}

export async function sendWhatsappText(
  config: WhatsappConfigDecoded,
  to: string,
  text: string,
): Promise<SendResult> {
  const url = `${META_GRAPH}/${config.phoneNumberId}/messages`;
  const body = {
    messaging_product: "whatsapp",
    to: normalizePhone(to),
    type: "text",
    text: { body: text },
  };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as {
      messages?: { id: string }[];
      error?: { message?: string };
    };
    if (!res.ok || data.error) {
      return {
        ok: false,
        error: data.error?.message ?? `HTTP ${res.status}`,
      };
    }
    return { ok: true, providerMessageId: data.messages?.[0]?.id };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Verifica la firma del webhook de Meta (HMAC-SHA256 con APP_SECRET).
 * La firma es la ÚNICA autenticación del webhook, así que sin secret se
 * falla cerrado —como GitHub, Telegram y Stripe—: aceptar sin validar
 * convertiría el endpoint en un buzón abierto donde cualquiera inyecta
 * mensajes en la bandeja de un tenant. `WHATSAPP_APP_SECRET` es
 * obligatorio para usar el webhook, también en desarrollo.
 */
export async function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
): Promise<boolean> {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) {
    console.error("[whatsapp] WHATSAPP_APP_SECRET sin definir: webhook rechazado");
    return false;
  }
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const provided = signatureHeader.slice("sha256=".length);
  const { createHmac, timingSafeEqual } = await import("node:crypto");
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

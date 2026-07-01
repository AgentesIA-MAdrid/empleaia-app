/**
 * POST /api/admin/telegram/connect — registra el webhook del bot en Telegram
 * (setWebhook con el secret_token nativo). Solo SUPER_ADMIN.
 *
 * La URL del webhook es `${APP_BASE_URL}/api/webhooks/telegram` (la app, no el
 * subdominio admin — el webhook vive en /api/webhooks/**, servido por app).
 */

import { NextResponse, type NextRequest } from "next/server";
import { withSuperAdmin } from "@/lib/admin/with-super-admin";
import { currentSuperAdmin } from "@/lib/admin/context";
import { writeAuditEntry, extractRequestMeta } from "@/lib/admin/audit";
import { setWebhook, getWebhookInfo } from "@/lib/telegram/client";

const APP_URL = process.env.APP_BASE_URL ?? "https://app.empleaia.es";

export const POST = withSuperAdmin(async (req: NextRequest) => {
  const sa = currentSuperAdmin();
  if (sa.role !== "SUPER_ADMIN") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!process.env.TELEGRAM_BOT_TOKEN || !secret) {
    return NextResponse.json({ error: "faltan_env", detail: "Configura TELEGRAM_BOT_TOKEN y TELEGRAM_WEBHOOK_SECRET en el servidor." }, { status: 400 });
  }

  const url = `${APP_URL.replace(/\/$/, "")}/api/webhooks/telegram`;
  const ok = await setWebhook(url, secret);
  if (!ok) return NextResponse.json({ error: "setwebhook_fallo" }, { status: 502 });

  const meta = extractRequestMeta(req.headers);
  await writeAuditEntry({
    superAdminId: sa.id, action: "telegram:connect", targetKind: "telegram", targetId: "webhook",
    summary: { url }, ipAddress: meta.ipAddress, userAgent: meta.userAgent,
  });

  const webhook = await getWebhookInfo();
  return NextResponse.json({ ok: true, url, webhook });
});

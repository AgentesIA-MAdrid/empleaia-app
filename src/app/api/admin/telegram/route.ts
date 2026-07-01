/**
 * GET  /api/admin/telegram — lista destinatarios del bot + estado del webhook.
 * POST /api/admin/telegram — alta de destinatario (genera código de vinculación).
 *
 * Solo SUPER_ADMIN puede mutar; ambos roles pueden leer.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { prismaMaster } from "@/lib/prisma";
import { withSuperAdmin } from "@/lib/admin/with-super-admin";
import { currentSuperAdmin } from "@/lib/admin/context";
import { writeAuditEntry, extractRequestMeta } from "@/lib/admin/audit";
import { getWebhookInfo, getBotUsername } from "@/lib/telegram/client";

const PAIRING_TTL_MIN = 15;

// Código de vinculación legible: 6 chars sin caracteres ambiguos (0/O/1/I).
function pairingCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(6);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export const GET = withSuperAdmin(async () => {
  const recipients = await prismaMaster.telegramRecipient.findMany({
    orderBy: [{ active: "desc" }, { createdAt: "asc" }],
    select: {
      id: true, label: true, chatId: true, active: true, canOperate: true,
      pairingCode: true, pairingExpiresAt: true, linkedAt: true, createdAt: true,
    },
  });
  const [webhook, botUsername] = await Promise.all([getWebhookInfo(), getBotUsername()]);
  const configured = !!process.env.TELEGRAM_BOT_TOKEN && !!process.env.TELEGRAM_WEBHOOK_SECRET;
  return NextResponse.json({ recipients, webhook, botUsername, configured });
});

const postSchema = z.object({
  label: z.string().trim().min(1).max(120),
  canOperate: z.boolean().optional(),
});

export const POST = withSuperAdmin(async (req: NextRequest) => {
  const sa = currentSuperAdmin();
  if (sa.role !== "SUPER_ADMIN") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "datos_invalidos" }, { status: 400 });

  const code = pairingCode();
  const rec = await prismaMaster.telegramRecipient.create({
    data: {
      label: parsed.data.label,
      canOperate: parsed.data.canOperate ?? true,
      pairingCode: code,
      pairingExpiresAt: new Date(Date.now() + PAIRING_TTL_MIN * 60_000),
    },
    select: { id: true, label: true, pairingCode: true, pairingExpiresAt: true },
  });

  const meta = extractRequestMeta(req.headers);
  await writeAuditEntry({
    superAdminId: sa.id,
    action: "telegram:add",
    targetKind: "telegram",
    targetId: rec.id,
    summary: { label: rec.label },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return NextResponse.json(rec, { status: 201 });
});

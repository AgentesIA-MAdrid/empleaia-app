/**
 * PATCH  /api/admin/telegram/[id] — activar/desactivar o cambiar puede-operar.
 * DELETE /api/admin/telegram/[id] — baja del destinatario.
 * Solo SUPER_ADMIN.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prismaMaster } from "@/lib/prisma";
import { withSuperAdmin } from "@/lib/admin/with-super-admin";
import { currentSuperAdmin } from "@/lib/admin/context";
import { writeAuditEntry, extractRequestMeta } from "@/lib/admin/audit";

function idFromUrl(req: NextRequest): string | null {
  const segs = new URL(req.url).pathname.split("/").filter(Boolean);
  return segs[segs.indexOf("telegram") + 1] ?? null;
}

const patchSchema = z.object({
  active: z.boolean().optional(),
  canOperate: z.boolean().optional(),
});

export const PATCH = withSuperAdmin(async (req: NextRequest) => {
  const sa = currentSuperAdmin();
  if (sa.role !== "SUPER_ADMIN") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = idFromUrl(req);
  if (!id) return NextResponse.json({ error: "id_invalido" }, { status: 400 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || (parsed.data.active === undefined && parsed.data.canOperate === undefined)) {
    return NextResponse.json({ error: "datos_invalidos" }, { status: 400 });
  }

  const existing = await prismaMaster.telegramRecipient.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "no_encontrado" }, { status: 404 });

  const updated = await prismaMaster.telegramRecipient.update({
    where: { id },
    data: { ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}), ...(parsed.data.canOperate !== undefined ? { canOperate: parsed.data.canOperate } : {}) },
    select: { id: true, label: true, active: true, canOperate: true },
  });

  const meta = extractRequestMeta(req.headers);
  await writeAuditEntry({
    superAdminId: sa.id, action: "telegram:update", targetKind: "telegram", targetId: id,
    summary: { ...parsed.data }, ipAddress: meta.ipAddress, userAgent: meta.userAgent,
  });
  return NextResponse.json(updated);
});

export const DELETE = withSuperAdmin(async (req: NextRequest) => {
  const sa = currentSuperAdmin();
  if (sa.role !== "SUPER_ADMIN") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = idFromUrl(req);
  if (!id) return NextResponse.json({ error: "id_invalido" }, { status: 400 });

  const existing = await prismaMaster.telegramRecipient.findUnique({ where: { id }, select: { label: true } });
  if (!existing) return NextResponse.json({ error: "no_encontrado" }, { status: 404 });

  await prismaMaster.telegramRecipient.delete({ where: { id } });

  const meta = extractRequestMeta(req.headers);
  await writeAuditEntry({
    superAdminId: sa.id, action: "telegram:remove", targetKind: "telegram", targetId: id,
    summary: { label: existing.label }, ipAddress: meta.ipAddress, userAgent: meta.userAgent,
  });
  return NextResponse.json({ ok: true });
});

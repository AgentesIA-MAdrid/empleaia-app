/**
 * POST /api/admin/admins/[id]/deactivate — desactivar un super-admin.
 *
 * Solo SUPER_ADMIN. No se permite auto-desactivarse (evita quedarse
 * sin acceso). Reversible vía nueva invitación (upsertSuperAdmin
 * reactiva la cuenta).
 */

import { type NextRequest, NextResponse } from "next/server";
import { prismaMaster } from "@/lib/prisma";
import { withSuperAdmin } from "@/lib/admin/with-super-admin";
import { currentSuperAdmin } from "@/lib/admin/context";
import { writeAuditEntry, extractRequestMeta } from "@/lib/admin/audit";

export const POST = withSuperAdmin(async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const sa = currentSuperAdmin();
  if (sa.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  if (id === sa.id) {
    return NextResponse.json(
      { error: "no_puedes_desactivarte_a_ti_mismo" },
      { status: 400 },
    );
  }

  const target = await prismaMaster.superAdmin.findUnique({
    where: { id },
    select: { id: true, email: true },
  });
  if (!target) {
    return NextResponse.json({ error: "admin_no_encontrado" }, { status: 404 });
  }

  await prismaMaster.superAdmin.update({
    where: { id },
    data: { active: false },
  });

  const meta = extractRequestMeta(req.headers);
  await writeAuditEntry({
    superAdminId: sa.id,
    action: "super_admin:deactivate",
    targetKind: "super_admin",
    targetId: id,
    summary: { email: target.email },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return NextResponse.json({ ok: true });
});

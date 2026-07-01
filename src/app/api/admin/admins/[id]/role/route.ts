/**
 * POST /api/admin/admins/[id]/role — cambiar el rol de un super-admin
 * existente (SUPER_ADMIN ↔ SUPPORT).
 *
 * Solo SUPER_ADMIN. Salvaguardas:
 * - No puedes cambiar tu propio rol (evita auto-degradarte y perder acceso).
 * - No se puede degradar al último SUPER_ADMIN activo: dejaría el panel sin
 *   ninguna cuenta capaz de invitar / gestionar (nadie podría revertirlo).
 */

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prismaMaster } from "@/lib/prisma";
import { withSuperAdmin } from "@/lib/admin/with-super-admin";
import { currentSuperAdmin } from "@/lib/admin/context";
import { writeAuditEntry, extractRequestMeta } from "@/lib/admin/audit";

const bodySchema = z.object({ role: z.enum(["SUPER_ADMIN", "SUPPORT"]) });

export const POST = withSuperAdmin(async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const sa = currentSuperAdmin();
  if (sa.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "role_invalido" }, { status: 400 });
  }
  const { role } = parsed.data;

  const { id } = await params;
  if (id === sa.id) {
    return NextResponse.json({ error: "no_puedes_cambiar_tu_propio_rol" }, { status: 400 });
  }

  const target = await prismaMaster.superAdmin.findUnique({
    where: { id },
    select: { id: true, email: true, role: true, active: true },
  });
  if (!target) {
    return NextResponse.json({ error: "admin_no_encontrado" }, { status: 404 });
  }

  if (target.role === role) {
    return NextResponse.json({ ok: true, unchanged: true });
  }

  // Degradar SUPER_ADMIN → SUPPORT: no permitir dejar el sistema sin ningún
  // SUPER_ADMIN activo.
  if (target.role === "SUPER_ADMIN" && role === "SUPPORT") {
    const superAdminsActivos = await prismaMaster.superAdmin.count({
      where: { role: "SUPER_ADMIN", active: true },
    });
    if (superAdminsActivos <= 1) {
      return NextResponse.json({ error: "ultimo_super_admin" }, { status: 400 });
    }
  }

  await prismaMaster.superAdmin.update({ where: { id }, data: { role } });

  const meta = extractRequestMeta(req.headers);
  await writeAuditEntry({
    superAdminId: sa.id,
    action: "super_admin:change_role",
    targetKind: "super_admin",
    targetId: id,
    summary: { email: target.email, from: target.role, to: role },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return NextResponse.json({ ok: true });
});

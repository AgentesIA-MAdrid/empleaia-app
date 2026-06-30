/**
 * GET /api/admin/admins — lista super-admins + invitaciones pendientes.
 *
 * Cualquier rol del panel puede leer (SUPER_ADMIN y SUPPORT). La
 * invitación / desactivación viven en rutas aparte y exigen SUPER_ADMIN.
 */

import { NextResponse } from "next/server";
import { prismaMaster } from "@/lib/prisma";
import { withSuperAdmin } from "@/lib/admin/with-super-admin";
import { currentSuperAdmin } from "@/lib/admin/context";
import { writeAuditEntry, extractRequestMeta } from "@/lib/admin/audit";

export const GET = withSuperAdmin(async (req) => {
  const sa = currentSuperAdmin();
  const meta = extractRequestMeta(req.headers);

  const [admins, invitations] = await Promise.all([
    prismaMaster.superAdmin.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        active: true,
        lastLogin: true,
        createdAt: true,
      },
      orderBy: [{ active: "desc" }, { createdAt: "asc" }],
    }),
    prismaMaster.adminInvitation.findMany({
      where: { acceptedAt: null, expiresAt: { gt: new Date() } },
      select: {
        id: true,
        email: true,
        role: true,
        expiresAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  await writeAuditEntry({
    superAdminId: sa.id,
    action: "super_admin:list",
    targetKind: "super_admin",
    targetId: sa.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return NextResponse.json({ admins, invitations });
});

/**
 * POST /api/admin/accept-invite — aceptar una invitación de super-admin.
 *
 * PÚBLICO: NO usa withSuperAdmin — el token de la invitación ES la
 * autorización. Bajo /api/admin/** está exento de withTenant por la
 * whitelist del proyecto (panel super-admin, contexto propio).
 *
 * Valida la invitación (existe / no aceptada / no expirada), crea o
 * reactiva la cuenta vía upsertSuperAdmin y marca acceptedAt.
 */

import { type NextRequest, NextResponse } from "next/server";
import { prismaMaster } from "@/lib/prisma";
import { upsertSuperAdmin } from "@/lib/super-admin";
import { writeAuditEntry, extractRequestMeta } from "@/lib/admin/audit";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    token?: unknown;
    name?: unknown;
    password?: unknown;
  };

  const token = typeof body.token === "string" ? body.token : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!token) {
    return NextResponse.json({ error: "token_requerido" }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ error: "nombre_requerido" }, { status: 400 });
  }
  if (password.length < 12) {
    return NextResponse.json(
      { error: "La contraseña debe tener al menos 12 caracteres." },
      { status: 400 },
    );
  }

  const invitation = await prismaMaster.adminInvitation.findUnique({
    where: { token },
    select: { id: true, email: true, role: true, acceptedAt: true, expiresAt: true },
  });

  if (!invitation) {
    return NextResponse.json(
      { error: "Invitación no válida." },
      { status: 400 },
    );
  }
  if (invitation.acceptedAt) {
    return NextResponse.json(
      { error: "Esta invitación ya se ha usado." },
      { status: 400 },
    );
  }
  if (invitation.expiresAt.getTime() < Date.now()) {
    return NextResponse.json(
      { error: "Esta invitación ha caducado." },
      { status: 400 },
    );
  }

  const result = await upsertSuperAdmin(prismaMaster, {
    email: invitation.email,
    name,
    password,
    role: invitation.role,
  });

  await prismaMaster.adminInvitation.update({
    where: { id: invitation.id },
    data: { acceptedAt: new Date() },
  });

  const meta = extractRequestMeta(req.headers);
  await writeAuditEntry({
    superAdminId: result.id,
    action: "super_admin:accept-invite",
    targetKind: "super_admin",
    targetId: result.id,
    summary: { email: invitation.email, role: invitation.role },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return NextResponse.json({ ok: true });
}

/**
 * POST /api/admin/admins/invite — invitar un nuevo super-admin por email.
 *
 * Solo SUPER_ADMIN. Crea una AdminInvitation con token aleatorio
 * (válido 7 días) y envía el enlace de aceptación por email de sistema.
 */

import { type NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prismaMaster } from "@/lib/prisma";
import { withSuperAdmin } from "@/lib/admin/with-super-admin";
import { currentSuperAdmin } from "@/lib/admin/context";
import { writeAuditEntry, extractRequestMeta } from "@/lib/admin/audit";
import { sendSystemEmail } from "@/lib/email";
import {
  adminInvitationSubject,
  adminInvitationTemplate,
} from "@/lib/admin/invitation-email";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Origen del panel (admin.<root>). Construido desde las cabeceras del
 * proxy (x-forwarded-*) con fallback a Host. NO se usa req.url porque
 * detrás del proxy es el host interno (0.0.0.0:3000).
 */
function adminBaseUrl(headers: Headers): string {
  const proto = headers.get("x-forwarded-proto") ?? "https";
  const host =
    headers.get("x-forwarded-host") ?? headers.get("host") ?? "empleaia.es";
  return `${proto}://${host}`;
}

export const POST = withSuperAdmin(async (req: NextRequest) => {
  const sa = currentSuperAdmin();
  if (sa.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    email?: unknown;
    role?: unknown;
  };

  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const role = body.role;

  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "email_invalido" }, { status: 400 });
  }
  if (role !== "SUPER_ADMIN" && role !== "SUPPORT") {
    return NextResponse.json({ error: "role_invalido" }, { status: 400 });
  }

  // Si ya existe una cuenta activa con ese email, no tiene sentido invitar.
  const existing = await prismaMaster.superAdmin.findUnique({
    where: { email },
    select: { id: true, active: true },
  });
  if (existing?.active) {
    return NextResponse.json(
      { error: "ya_existe_admin_activo" },
      { status: 409 },
    );
  }

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await prismaMaster.adminInvitation.create({
    data: { email, role, token, invitedById: sa.id, expiresAt },
  });

  const acceptUrl = `${adminBaseUrl(req.headers)}/admin/aceptar-invitacion?token=${token}`;

  try {
    await sendSystemEmail(
      email,
      adminInvitationSubject(),
      adminInvitationTemplate({ acceptUrl, role, invitedByEmail: sa.email }),
    );
  } catch (err) {
    // La invitación ya está en BD. Si el email falla, queda registrado el
    // intento; el enlace sigue siendo válido y reenviable.
    console.error("[/api/admin/admins/invite] fallo enviando email:", err);
  }

  const meta = extractRequestMeta(req.headers);
  await writeAuditEntry({
    superAdminId: sa.id,
    action: "super_admin:invite",
    targetKind: "super_admin",
    targetId: email,
    summary: { email, role },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return NextResponse.json({ ok: true });
});

/**
 * POST /api/empleados/[id]/restablecer-password
 *
 * Acción de administrador: envía a un empleado QUE YA TIENE contraseña
 * un email para restablecerla (genera resetToken + enlace a
 * /set-password). Distinto de `reenviar-invitacion`, que es para
 * empleados que todavía no han establecido contraseña (invitación
 * pendiente).
 *
 * Solo OWNER. Reusa el resetToken/resetTokenExpiry de `User`, la
 * página /set-password y la plantilla resetPasswordTemplate.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { sendSystemEmail } from "@/lib/email";
import { resetPasswordTemplate } from "@/lib/email-templates";
import { buildResetPasswordUrl } from "@/lib/tenant/urls";
import { currentTenant } from "@/lib/tenant/context";
import { withTenant } from "@/lib/tenant/with-tenant";
import crypto from "crypto";
import type { NextRequest } from "next/server";

// 24h: el reset lo inicia el admin, el empleado puede no estar delante
// en ese momento (más holgado que el flujo self-service de 1h).
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export const POST = withTenant(async (_request: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  try {
    const session = await auth();
    if (!session?.user) return Response.json({ error: "No autorizado" }, { status: 401 });
    const userRol = (session.user as { rol?: Rol }).rol;
    if (userRol !== Rol.OWNER) return Response.json({ error: "No autorizado" }, { status: 403 });

    const { id } = await params;
    const empleado = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, nombre: true, apellidos: true, password: true },
    });

    if (!empleado) return Response.json({ error: "Empleado no encontrado" }, { status: 404 });
    if (!empleado.password) {
      return Response.json(
        { error: "El empleado aún no tiene contraseña. Usa 'Reenviar invitación'." },
        { status: 400 },
      );
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetTokenExpiry = new Date(Date.now() + TOKEN_TTL_MS);

    await prisma.user.update({
      where: { id },
      data: { resetToken, resetTokenExpiry },
    });

    const resetUrl = buildResetPasswordUrl(currentTenant().slug, resetToken);
    const config = await prisma.configuracionEmpresa.findFirst({
      select: { nombre: true, appNombre: true, colorPrimario: true, colorSidebar: true, logo: true },
    });
    const empresa = config?.nombre ?? config?.appNombre ?? "empleaIA";
    const html = resetPasswordTemplate({
      nombre: empleado.nombre,
      apellidos: empleado.apellidos,
      empresa,
      colorPrimario: config?.colorPrimario ?? "#6366f1",
      colorSidebar: config?.colorSidebar ?? "#1e1b4b",
      logo: config?.logo ?? null,
      resetUrl,
    });

    await sendSystemEmail(empleado.email, `Restablece tu contraseña en ${empresa}`, html);

    return Response.json({ success: true });
  } catch (error) {
    console.error("POST /api/empleados/[id]/restablecer-password error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
});

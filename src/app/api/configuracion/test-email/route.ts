import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { sendEmail } from "@/lib/email";

import { withTenant } from "@/lib/tenant/with-tenant";
export const POST = withTenant(async () => {
  try {
    const session = await auth();
    const user = session?.user as { rol?: string; email?: string } | undefined;
    if (!user || user.rol !== Rol.OWNER) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const config = await prisma.configuracionEmpresa.findFirst();
    // El correo del producto usa Resend: se configura con la API Key
    // (`emailPassword`) y el remitente (`emailFrom`), no con SMTP host/puerto.
    // Gateamos igual que el envío real (`getTenantSmtpConfig` en lib/email).
    if (!config?.emailActivo || !config?.emailPassword) {
      return Response.json({ error: "Email no configurado" }, { status: 400 });
    }

    if (!user.email) {
      return Response.json(
        { error: "Tu cuenta no tiene un email al que enviar la prueba" },
        { status: 400 },
      );
    }

    const result = await sendEmail(
      user.email,
      "Email de prueba – empleaIA",
      `<div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto">
        <h2 style="color:#2563EB">Prueba de configuración de email</h2>
        <p>La configuración de correo electrónico funciona correctamente.</p>
        <p style="color:#475569;font-size:14px">Remitente: ${config.emailFrom ?? "noreply@resend.dev"}</p>
      </div>`
    );

    if (!result.ok) {
      // `sendEmail` no lanza: devuelve el motivo. Sin esto el botón daría un
      // falso "enviado" aunque no saliera ningún correo.
      const motivo: Record<typeof result.reason, string> = {
        feature_not_contracted: "Tu plan no incluye notificaciones por email.",
        quota_exceeded: "Has alcanzado el límite de emails de este mes.",
        smtp_not_configured: "Falta la API Key de Resend o el remitente.",
        no_tenant_context: "No se pudo resolver la empresa; recarga e inténtalo de nuevo.",
      };
      return Response.json({ error: motivo[result.reason] }, { status: 400 });
    }

    return Response.json({ ok: true });
  } catch (error: any) {
    console.error("POST /api/configuracion/test-email error:", error);
    const message = error?.message ?? "Error desconocido";
    const code = error?.code ?? null;
    return Response.json({ error: message, code }, { status: 500 });
  }
});

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import {
  decodeWhatsappConfig,
  sendWhatsappText,
} from "@/lib/whatsapp/cloud-api";

const createSchema = z.object({
  destinatarioTelefono: z.string().min(5).max(40),
  texto: z.string().min(1).max(4096),
});

export const GET = withTenant(withFeature("whatsapp_bot", async () => {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const userRol = (session.user as { rol?: Rol }).rol;
  if (userRol !== Rol.OWNER && userRol !== Rol.MANAGER) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const mensajes = await prisma.mensajeWhatsapp.findMany({
    orderBy: { createdAt: "desc" }, take: 200,
  });
  return NextResponse.json({ mensajes });
}));

export const POST = withTenant(withFeature("whatsapp_bot", async (req: NextRequest) => {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const userRol = (session.user as { rol?: Rol }).rol;
  if (userRol !== Rol.OWNER) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });

  // Crear el registro como pendiente.
  const mensaje = await prisma.mensajeWhatsapp.create({ data: parsed.data });

  // Intento de envío inmediato si WhatsappConfig.activo y credenciales presentes.
  const config = await prisma.whatsappConfig.findUnique({
    where: { id: "singleton" },
    select: { activo: true, phoneNumberId: true, tokenEnc: true },
  });
  if (!config?.activo) {
    return NextResponse.json(
      { mensaje, info: "Mensaje encolado. Activa WhatsApp en configuración para enviarlo." },
      { status: 201 },
    );
  }
  const decoded = decodeWhatsappConfig({
    phoneNumberId: config.phoneNumberId,
    tokenEnc: config.tokenEnc,
  });
  if (!decoded) {
    await prisma.mensajeWhatsapp.update({
      where: { id: mensaje.id },
      data: { estado: "fallido", motivoError: "Configuración WhatsApp inválida" },
    });
    return NextResponse.json(
      { mensaje, error: "Configuración WhatsApp inválida (token no descifrable)" },
      { status: 200 },
    );
  }

  const result = await sendWhatsappText(decoded, parsed.data.destinatarioTelefono, parsed.data.texto);
  const updated = await prisma.mensajeWhatsapp.update({
    where: { id: mensaje.id },
    data: result.ok
      ? { estado: "enviado", enviadoAt: new Date() }
      : { estado: "fallido", motivoError: result.error ?? "Error desconocido" },
  });
  return NextResponse.json({ mensaje: updated }, { status: result.ok ? 201 : 200 });
}));

/**
 * /api/solicitudes-firma
 *
 *   GET  → lista solicitudes (admin todas, empleado solo las suyas)
 *   POST → crear solicitud (admin asigna a un empleado un doc para firmar)
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { Rol } from "@/generated/prisma-tenant/client";
import { prismaApp } from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/with-tenant";
import { currentTenant } from "@/lib/tenant/context";
import { sendSystemEmail } from "@/lib/email";
import { solicitudFirmaTemplate } from "@/lib/email-templates/solicitud-firma";
import { tenantBaseUrl } from "@/lib/tenant/urls";

const createSchema = z.object({
  documentoId: z.string(),
  destinatarioId: z.string(),
  mensaje: z.string().max(1000).optional(),
  expiraEn: z.string().datetime().optional(),
});

export const POST = withTenant(async (req: NextRequest) => {
  const session = await auth();
  const user = session?.user as { id?: string; rol?: Rol | string } | undefined;
  // Asignar documentos para firma es gestión: solo el Administrador (OWNER).
  if (!user?.id || user.rol !== Rol.OWNER) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Datos inválidos" },
      { status: 400 },
    );
  }
  const data = parsed.data;

  const documento = await prismaApp.documento.findUnique({
    where: { id: data.documentoId },
    select: { id: true },
  });
  if (!documento) {
    return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 });
  }

  const solicitud = await prismaApp.solicitudFirma.create({
    data: {
      documentoId: data.documentoId,
      destinatarioId: data.destinatarioId,
      solicitadaPorId: user.id,
      mensaje: data.mensaje,
      expiraEn: data.expiraEn ? new Date(data.expiraEn) : null,
    },
    include: {
      destinatario: { select: { email: true, nombre: true, apellidos: true } },
      solicitadaPor: { select: { nombre: true, apellidos: true } },
      documento: { select: { nombre: true } },
    },
  });

  // Email al destinatario con link a /empleado/firmas/[id].
  try {
    const config = await prismaApp.configuracionEmpresa.findFirst({
      select: { nombre: true, appNombre: true },
    });
    const empresa = config?.nombre ?? config?.appNombre ?? "tu empresa";
    const firmarUrl = `${tenantBaseUrl(currentTenant().slug)}/empleado/firmas/${solicitud.id}`;
    const html = solicitudFirmaTemplate({
      destinatarioNombre: solicitud.destinatario.nombre,
      solicitanteNombre: `${solicitud.solicitadaPor.nombre} ${solicitud.solicitadaPor.apellidos}`,
      documentoNombre: solicitud.documento.nombre,
      empresa,
      mensaje: solicitud.mensaje,
      expiraEn: solicitud.expiraEn,
      firmarUrl,
    });
    await sendSystemEmail(
      solicitud.destinatario.email,
      `Tienes un documento para firmar: ${solicitud.documento.nombre}`,
      html,
    );
  } catch (err) {
    console.error("[solicitudes-firma POST] fallo email:", err);
  }

  return NextResponse.json({ solicitud }, { status: 201 });
});

export const GET = withTenant(async (req: NextRequest) => {
  const session = await auth();
  const user = session?.user as { id?: string; rol?: Rol | string } | undefined;
  if (!user?.id) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const isAdmin = user.rol === Rol.OWNER || user.rol === Rol.MANAGER;
  const ambito = req.nextUrl.searchParams.get("ambito") ?? "todas";

  const where: Record<string, unknown> = {};
  if (!isAdmin || ambito === "mias") {
    where.destinatarioId = user.id;
  } else if (ambito === "enviadas") {
    where.solicitadaPorId = user.id;
  }

  const items = await prismaApp.solicitudFirma.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      documento: { select: { id: true, nombre: true } },
      destinatario: { select: { id: true, nombre: true, apellidos: true, email: true } },
      solicitadaPor: { select: { id: true, nombre: true, apellidos: true } },
      firma: { select: { id: true, firmadoEn: true } },
    },
  });
  return NextResponse.json({ items, total: items.length });
});
